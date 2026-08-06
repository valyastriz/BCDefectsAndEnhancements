const express = require('express');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const dbApi = require('../../db');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { toBooleanSql, toIsoOrNow, isBlank, normalizeCleanupTagType } = require('../helpers/utils');
const {
  resolveSubmissionLookupIds,
  collectMissingLookupIds,
  formatMissingLookupError,
  getApplications,
  getDefectEnhancementStatuses,
  getLevelsOfEffort,
  getLookupIdByName,
  getSubmissionTypes,
  getCleanupStatuses,
  getCleanupTagTypes,
} = require('../helpers/lookups');
const { mapExcelImportRun } = require('../helpers/mappers');
const {
  normalizeImportHeader,
  normalizeStatusToken,
  normalizeImportRow,
  suggestImportMappings,
  normalizeColumnMappings,
  getMappedImportValue,
  parseImportBoolean,
  parseImportNumber,
  parsePolicyAndAccountNumbers,
} = require('../helpers/importUtils');
const {
  IMPORT_COLUMN_TARGETS,
  SUBMISSION_TYPE_REPORT,
  REPORT_DELIVERED_STATUS,
  REPORT_USAGE_FREQUENCIES,
  statusesForRequestType,
} = require('../constants');
const { SUBMISSION_INSERT_COLUMNS, buildInsertPayload } = require('../helpers/submissionInsert');
const { logStatusChange } = require('../services/submissionService');
const {
  addTimeEntry,
  dayOf,
  listAssignableUsers,
  listPeopleForImport,
  recordAssignment,
  resolveImportedAssignee,
} = require('../services/deliveryService');
const { scheduleBatchEmbeddingRefresh } = require('../services/embeddingIndexService');
const { tempUpload } = require('../middleware/upload');
const { emitAdminNotification } = require('../socket');

const router = express.Router();

// How much of the sheet the analyze step echoes back for the pre-write preview.
// Small on purpose: the preview exists to let an admin recognise their own data,
// not to ship the spreadsheet through the API a second time.
const ANALYZE_SAMPLE_ROWS = 3;
const ANALYZE_SAMPLE_CELL_CHARS = 200;

// ── Analyze uploaded Excel file ──────────────────────────────────────────────
router.post('/api/admin/submissions/import-xlsx/analyze', ensureAdmin, tempUpload.single('file'), async (req, res) => {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx or .xls).' });
  }

  const extension = path.extname(uploadedFile.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(extension)) {
    fs.rmSync(uploadedFile.path, { force: true });
    return res.status(400).json({ error: 'Unsupported file type. Please upload .xlsx or .xls.' });
  }

  try {
    const workbook = XLSX.readFile(uploadedFile.path, { cellDates: true, cellText: true });
    const requestedSheet = String(req.body?.sheet || req.query?.sheet || '').trim();
    const sheetName = requestedSheet && workbook.SheetNames.includes(requestedSheet)
      ? requestedSheet
      : workbook.SheetNames[0];

    if (!sheetName) {
      return res.status(400).json({ error: 'No worksheet found in the uploaded file.' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'The worksheet is empty. Add header row and data rows.' });
    }

    const headers = Object.keys(rawRows[0] || {});
    const normalizedHeaders = headers.map((header) => normalizeImportHeader(header));
    const suggestedMappings = suggestImportMappings(headers);
    const normalizedSuggestedMappings = normalizeColumnMappings(suggestedMappings);

    const applicationAliases = ['application_name', 'application'];
    const mappedApplicationHeader = normalizedSuggestedMappings.application_name || '';
    const hasApplicationColumn = Boolean(mappedApplicationHeader)
      || applicationAliases.some((alias) => normalizedHeaders.includes(alias));
    // Scoped to what the admin has said the rows ARE. The dialog asks that before
    // it will take a file, so this can be exact: on a report-request sheet
    // 'Deployed' has to read as an unknown value needing a decision, and the
    // "map it to" list must not offer a word the import would then refuse.
    const analyzeMode = String(req.body?.importMode || req.query?.importMode || '').trim().toLowerCase();
    const allowedStatuses = await withDb(async (db) => statusesForRequestType(
      analyzeMode,
      await getDefectEnhancementStatuses(db, { includeRetired: true }),
    ));

    // How many rows carry each unrecognised status, not just which ones: the
    // dialog asks the admin to decide what one means, and "appears in 6 rows" is
    // what tells them whether the decision matters.
    const unknownStatusCounts = {};
    rawRows.forEach((rawRow) => {
      const row = normalizeImportRow(rawRow);
      const rawStatus = String(
        getMappedImportValue(
          row,
          'status',
          ['status', 'defect_enhancement_status'],
          normalizedSuggestedMappings,
          '',
        ) || '',
      ).trim();
      if (!rawStatus) return;
      if (!allowedStatuses.includes(rawStatus)) {
        unknownStatusCounts[rawStatus] = (unknownStatusCounts[rawStatus] || 0) + 1;
      }
    });

    return res.json({
      sheet: sheetName,
      headers,
      mappingTargets: IMPORT_COLUMN_TARGETS.map((target) => ({ key: target.key, label: target.label })),
      suggestedMappings,
      requiresApplicationDefault: !hasApplicationColumn,
      unknownStatuses: Object.keys(unknownStatusCounts),
      unknownStatusCounts,
      allowedStatuses,
      // The first rows as they sit in the sheet, keyed by their own header. The
      // dialog shows them BEFORE anything is written, and maps them through
      // whatever the admin has since decided — so the preview cannot claim a
      // mapping the import will not use. Cells are clipped because a preview only
      // has to be recognisable.
      sampleRows: rawRows.slice(0, ANALYZE_SAMPLE_ROWS).map((rawRow) => {
        const sample = {};
        for (const header of headers) {
          sample[header] = String(rawRow?.[header] ?? '').slice(0, ANALYZE_SAMPLE_CELL_CHARS);
        }
        return sample;
      }),
      previewRows: Math.min(rawRows.length, ANALYZE_SAMPLE_ROWS),
      totalRows: rawRows.length,
    });
  } finally {
    fs.rmSync(uploadedFile.path, { force: true });
  }
});

// ── Import history ───────────────────────────────────────────────────────────
router.get('/api/admin/submissions/import-xlsx/history', ensureAdmin, async (req, res) => {
  const requestedLimit = Number.parseInt(String(req.query?.limit || '10'), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 50)
    : 10;

  await dbApi.init();
  const dbModels = dbApi.getModels() || {};
  const ExcelImportRun = dbModels.ExcelImportRun;
  if (!ExcelImportRun) {
    return res.status(500).json({ error: 'ExcelImportRun model is not initialized' });
  }

  const rows = await ExcelImportRun.findAll({
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit,
    raw: true,
  });

  return res.json(rows.map(mapExcelImportRun));
});

// ── Main import endpoint ─────────────────────────────────────────────────────
router.post('/api/admin/submissions/import-xlsx', ensureAdmin, tempUpload.single('file'), async (req, res) => {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx or .xls).' });
  }

  const extension = path.extname(uploadedFile.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(extension)) {
    fs.rmSync(uploadedFile.path, { force: true });
    return res.status(400).json({ error: 'Unsupported file type. Please upload .xlsx or .xls.' });
  }

  const requestedImportMode = String(req.body?.importMode || req.query?.importMode || '').trim().toLowerCase();
  // `report` is the fourth mode. Without it a sheet of report requests could not be
  // imported at all: the mode FORCES the type of every row, so a report sheet came
  // in as defects and its report columns were never even read.
  const importMode = ['defect', 'enhancement', 'cleanup', SUBMISSION_TYPE_REPORT].includes(requestedImportMode)
    ? requestedImportMode
    : null;
  if (!importMode) {
    fs.rmSync(uploadedFile.path, { force: true });
    return res.status(400).json({
      error: 'Choose import type: Defect, Enhancement, Cleanup, or Report request.',
    });
  }
  const isReportImport = importMode === SUBMISSION_TYPE_REPORT;

  let columnMappings = {};
  try {
    if (req.body?.columnMappings) {
      columnMappings = typeof req.body.columnMappings === 'string'
        ? JSON.parse(req.body.columnMappings)
        : req.body.columnMappings;
    }
  } catch {
    columnMappings = {};
  }
  const normalizedColumnMappings = normalizeColumnMappings(columnMappings);

  // Checked against the applications the portal actually has, not two names typed
  // in here. The hardcoded pair silently refused any third application — which
  // stopped being hypothetical the moment "Other" was added as the queue a report
  // request lands in when nobody knows whose data it is yet.
  const activeApplications = await withDb(async (db) => getApplications(db));
  const defaultApplicationNameRaw = String(req.body?.defaultApplicationName || '').trim();
  const defaultApplicationName = activeApplications.some(
    (name) => name.toLowerCase() === defaultApplicationNameRaw.toLowerCase(),
  ) ? defaultApplicationNameRaw : '';

  let statusValueMappings = {};
  try {
    if (req.body?.statusValueMappings) {
      statusValueMappings = typeof req.body.statusValueMappings === 'string'
        ? JSON.parse(req.body.statusValueMappings)
        : req.body.statusValueMappings;
    }
  } catch {
    statusValueMappings = {};
  }

  const dynamicImportOptions = await withDb(async (db) => ({
    // Scoped to what the rows ARE: a sheet of report requests may not carry a row
    // that ends at 'Deployed', so that value has to read as unknown here rather
    // than importing and then being refused on the next save.
    allowedStatusesWithRetired: statusesForRequestType(
      importMode,
      await getDefectEnhancementStatuses(db, { includeRetired: true }),
    ),
    allowedSubmissionTypes: await getSubmissionTypes(db),
    allowedCleanupStatuses: await getCleanupStatuses(db),
    allowedCleanupTagTypes: await getCleanupTagTypes(db),
    // Report requests only, and one query each for the whole file rather than one
    // per row: the levels of effort by name, everyone a spreadsheet might name as
    // an assignee, and who may actually be handed work here.
    levelsOfEffort: isReportImport ? await getLevelsOfEffort(db) : [],
    people: isReportImport ? await listPeopleForImport() : [],
  }));

  const {
    allowedStatusesWithRetired,
    allowedSubmissionTypes,
    allowedCleanupStatuses,
    allowedCleanupTagTypes,
    levelsOfEffort,
    people,
  } = dynamicImportOptions;

  const normalizedStatusValueMappings = {};
  if (statusValueMappings && typeof statusValueMappings === 'object') {
    for (const [rawKey, rawValue] of Object.entries(statusValueMappings)) {
      const fromKey = normalizeStatusToken(rawKey);
      const toStatus = String(rawValue || '').trim();
      if (!fromKey) continue;
      if (!allowedStatusesWithRetired.includes(toStatus)) continue;
      normalizedStatusValueMappings[fromKey] = toStatus;
    }
  }

  try {
    const workbook = XLSX.readFile(uploadedFile.path, {
      cellDates: true,
      cellText: true,
    });

    const requestedSheet = String(req.body?.sheet || req.query?.sheet || '').trim();
    const sheetName = requestedSheet && workbook.SheetNames.includes(requestedSheet)
      ? requestedSheet
      : workbook.SheetNames[0];

    if (!sheetName) {
      return res.status(400).json({ error: 'No worksheet found in the uploaded file.' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'The worksheet is empty. Add header row and data rows.' });
    }

    const availableHeaders = Object.keys(rawRows[0] || {});
    const normalizedHeaders = availableHeaders.map((header) => normalizeImportHeader(header));
    const knownIdentifierHeaders = [
      'policy_num', 'policy_number', 'account_num', 'account_number',
      'policy_account', 'policy_account_num', 'policy_account_number', 'policy_or_account',
    ];
    const hasAutoIdentifierMapping = knownIdentifierHeaders.some((header) => normalizedHeaders.includes(header));
    const normalizedMappedCombinedHeader = normalizedColumnMappings.combined_policy_account || '';
    const normalizedMappedApplicationHeader = normalizedColumnMappings.application_name || '';
    const hasAutoApplicationMapping = ['application_name', 'application'].some((header) => normalizedHeaders.includes(header));

    if (normalizedMappedApplicationHeader && !normalizedHeaders.includes(normalizedMappedApplicationHeader)) {
      return res.status(400).json({
        error: 'Mapped Application column was not found in this file. Please select a valid column name.',
        mappingRequired: true,
        mappingField: 'applicationColumn',
        availableHeaders,
      });
    }

    if (!hasAutoApplicationMapping && !normalizedMappedApplicationHeader && !defaultApplicationName) {
      return res.status(400).json({
        error: 'No Application column was detected. Please choose a default application before importing.',
        mappingRequired: true,
        mappingField: 'defaultApplicationName',
        // The real list, so the dialog offers what exists rather than what was
        // true when this line was written.
        availableApplications: activeApplications,
      });
    }

    if (normalizedMappedCombinedHeader && !normalizedHeaders.includes(normalizedMappedCombinedHeader)) {
      return res.status(400).json({
        error: 'Mapped combined Policy/Account column was not found in this file. Please select a valid column name.',
        mappingRequired: true,
        mappingField: 'combinedPolicyAccountColumn',
        availableHeaders,
      });
    }

    // A policy or account number identifies where a DEFECT happened. A report
    // request has neither — nothing about "the unapplied cash dashboard needs a
    // write-off column" involves a policy — so demanding one of a report sheet
    // would refuse every such file for a column it should not have.
    if (!isReportImport && !hasAutoIdentifierMapping && !normalizedMappedCombinedHeader) {
      return res.status(400).json({
        error: 'Could not auto-map Policy/Account columns. Please choose the combined Policy/Account column and retry.',
        mappingRequired: true,
        mappingField: 'combinedPolicyAccountColumn',
        availableHeaders,
      });
    }

    const dryRun = ['1', 'true', 'yes'].includes(String(req.body?.dryRun || req.query?.dryRun || '').trim().toLowerCase());
    const preparedRows = [];
    const errors = [];
    const unknownStatusesDetected = new Set();

    /**
     * A mapped text column, trimmed, or null when the sheet does not say.
     *
     * The rows above spell this out per field because each one has its own
     * default ('-', 'Unknown', a computed value). The report columns are all the
     * same shape — a nullable string — so they share one reader rather than
     * repeating the same three calls nine times.
     */
    const importedText = (row, key, aliases) => {
      const value = getMappedImportValue(row, key, aliases, normalizedColumnMappings, null);
      return isBlank(value) ? null : String(value).trim();
    };

    rawRows.forEach((rawRow, index) => {
      const rowNumber = index + 2;
      const row = normalizeImportRow(rawRow);
      const identifiers = parsePolicyAndAccountNumbers(row, {
        columnMappings: normalizedColumnMappings,
      });

      const createdByRaw = String(getMappedImportValue(row, 'created_by', ['created_by', 'requester_name', 'requester', 'submitted_by_name'], normalizedColumnMappings, '') || '').trim();
      const summaryOfIssueRaw = String(getMappedImportValue(row, 'summary_of_issue', ['summary_of_issue', 'summary', 'title', 'issue_summary'], normalizedColumnMappings, '') || '').trim();
      const createdBy = createdByRaw || '-';
      const summaryOfIssue = summaryOfIssueRaw || '-';
      const requestedType = String(getMappedImportValue(row, 'type', ['type', 'ticket_type', 'defect_or_enhancement'], normalizedColumnMappings, 'defect') || 'defect').trim().toLowerCase();

      const statusInput = String(getMappedImportValue(row, 'status', ['status', 'defect_enhancement_status'], normalizedColumnMappings, '') || '').trim();
      let importedStatus = 'New';
      if (!statusInput) {
        importedStatus = 'New';
      } else if (allowedStatusesWithRetired.includes(statusInput)) {
        importedStatus = statusInput;
      } else {
        const mappedStatus = normalizedStatusValueMappings[normalizeStatusToken(statusInput)] || '';
        if (mappedStatus && allowedStatusesWithRetired.includes(mappedStatus)) {
          importedStatus = mappedStatus;
        } else {
          unknownStatusesDetected.add(statusInput);
          errors.push(`Row ${rowNumber}: unrecognized status "${statusInput}". Map this status before importing.`);
          return;
        }
      }
      const importedIsRetired = parseImportBoolean(getMappedImportValue(row, 'is_retired', ['is_retired', 'retired'], normalizedColumnMappings, false), false)
        || importedStatus === 'Retired';
      const finalStatus = importedStatus === 'Retired' ? 'New' : importedStatus;

      const rowCleanupTagType = normalizeCleanupTagType(getMappedImportValue(row, 'cleanup_tag_type', ['cleanup_tag_type', 'cleanup_type'], normalizedColumnMappings, null), allowedCleanupTagTypes);
      const inferredCleanup = parseImportBoolean(getMappedImportValue(row, 'is_cleanup', ['is_cleanup', 'cleanup'], normalizedColumnMappings, false), false) || Boolean(rowCleanupTagType);
      // A report request is never a cleanup task, whatever a stray Cleanup column
      // in the sheet says — the two are different request types, not a flag.
      const isCleanupRow = importMode === 'cleanup' ? true : (isReportImport ? false : inferredCleanup);
      const requestedCleanupStatus = String(getMappedImportValue(row, 'cleanup_status', ['cleanup_status'], normalizedColumnMappings, '') || '').trim();
      const cleanupStatus = isCleanupRow
        ? (allowedCleanupStatuses.includes(requestedCleanupStatus) ? requestedCleanupStatus : 'Not Started')
        : null;
      const effectiveCleanupTagType = isCleanupRow
        ? (importMode === 'cleanup' ? 'cleanup_only' : (rowCleanupTagType || 'cleanup_only'))
        : null;

      let effectiveType = allowedSubmissionTypes.includes(requestedType) ? requestedType : 'defect';
      if (importMode === 'defect') {
        effectiveType = 'defect';
      } else if (importMode === 'enhancement') {
        effectiveType = 'enhancement';
      } else if (isReportImport) {
        effectiveType = SUBMISSION_TYPE_REPORT;
      } else if (isCleanupRow) {
        effectiveType = effectiveCleanupTagType === 'enhancement' ? 'enhancement' : 'defect';
      }

      const finalIsCleanup = importMode === 'cleanup' ? true : isCleanupRow;
      const finalCleanupTagType = finalIsCleanup ? effectiveCleanupTagType : null;
      const finalCleanupStatus = finalIsCleanup ? cleanupStatus : null;

      const applicationValue = String(getMappedImportValue(row, 'application_name', ['application_name', 'application'], normalizedColumnMappings, '') || '').trim();
      let applicationName = applicationValue;
      if (!applicationName) {
        applicationName = defaultApplicationName || 'Billing Center';
      }
      const createdAt = toIsoOrNow(getMappedImportValue(row, 'created_at', ['created_at', 'reported_at', 'submitted_at', 'date_submitted'], normalizedColumnMappings, null));
      const closedDateRaw = getMappedImportValue(row, 'closed_date', ['closed_date', 'closed_at', 'date_closed'], normalizedColumnMappings, null);
      const updatedAtRaw = getMappedImportValue(row, 'updated_at', ['updated_at', 'status_update_at', 'last_updated_at'], normalizedColumnMappings, null);
      const updatedAtSource = closedDateRaw || updatedAtRaw || createdAt;
      const updatedAt = toIsoOrNow(updatedAtSource);

      const dateTimeOfErrorRaw = getMappedImportValue(row, 'date_time_of_error', ['date_time_of_error', 'error_datetime', 'error_date_time', 'date_of_error'], normalizedColumnMappings, null);
      const dateTimeOfError = dateTimeOfErrorRaw ? toIsoOrNow(dateTimeOfErrorRaw) : createdAt;

      const enhancementRequestTypeRaw = getMappedImportValue(
        row,
        'enhancement_request_type',
        ['enhancement_request_type', 'request_type'],
        normalizedColumnMappings,
        null,
      );
      const enhancementRequestType = isBlank(enhancementRequestTypeRaw)
        ? null
        : String(enhancementRequestTypeRaw).trim();
      const priorityLevelRaw = getMappedImportValue(row, 'priority_level', ['priority_level', 'priority'], normalizedColumnMappings, null);
      const priorityLevel = isBlank(priorityLevelRaw)
        ? (effectiveType === 'enhancement' ? '3 - Medium' : null)
        : String(priorityLevelRaw).trim();

      preparedRows.push({
        rowNumber,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        created_by_email: String(getMappedImportValue(row, 'created_by_email', ['created_by_email', 'requester_email', 'email'], normalizedColumnMappings, '-') || '-').trim() || '-',
        type: effectiveType,
        application_name: applicationName,
        policy_num: identifiers.policyNum,
        account_num: identifiers.accountNum,
        transaction_num: isBlank(getMappedImportValue(row, 'transaction_num', ['transaction_num', 'transaction_number'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'transaction_num', ['transaction_num', 'transaction_number'], normalizedColumnMappings, '')).trim(),
        screen_title: String(getMappedImportValue(row, 'screen_title', ['screen_title', 'screen'], normalizedColumnMappings, '-') || '-').trim() || '-',
        summary_of_issue: summaryOfIssue,
        steps_to_reproduce: String(getMappedImportValue(row, 'steps_to_reproduce', ['steps_to_reproduce', 'steps'], normalizedColumnMappings, '-') || '-').trim() || '-',
        what_happened_exact_details: String(getMappedImportValue(row, 'what_happened_exact_details', ['what_happened_exact_details', 'description', 'details'], normalizedColumnMappings, '-') || '-').trim() || '-',
        request: String(getMappedImportValue(row, 'request', ['request', 'requested_change'], normalizedColumnMappings, '-') || '-').trim() || '-',
        date_time_of_error: dateTimeOfError,
        status: finalStatus,
        reviewer: isBlank(getMappedImportValue(row, 'reviewer', ['reviewer'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'reviewer', ['reviewer'], normalizedColumnMappings, '')).trim(),
        decision_notes: isBlank(getMappedImportValue(row, 'decision_notes', ['decision_notes'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'decision_notes', ['decision_notes'], normalizedColumnMappings, '')).trim(),
        desired_completion_date: isBlank(getMappedImportValue(row, 'desired_completion_date', ['desired_completion_date', 'target_date'], normalizedColumnMappings, null))
          ? null
          : toIsoOrNow(getMappedImportValue(row, 'desired_completion_date', ['desired_completion_date', 'target_date'], normalizedColumnMappings, null)),
        impact_details: isBlank(getMappedImportValue(row, 'impact_details', ['impact_details'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'impact_details', ['impact_details'], normalizedColumnMappings, '')).trim(),
        impact_notes: isBlank(getMappedImportValue(row, 'impact_notes', ['impact_notes'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'impact_notes', ['impact_notes'], normalizedColumnMappings, '')).trim(),
        policy_premium_impact: parseImportNumber(getMappedImportValue(row, 'policy_premium_impact', ['policy_premium_impact'], normalizedColumnMappings, null)),
        direct_dollar_impact: parseImportNumber(getMappedImportValue(row, 'direct_dollar_impact', ['direct_dollar_impact'], normalizedColumnMappings, null)),
        policies_affected_count: parseImportNumber(getMappedImportValue(row, 'policies_affected_count', ['policies_affected_count'], normalizedColumnMappings, null)),
        logged_defect: parseImportBoolean(getMappedImportValue(row, 'logged_defect', ['logged_defect', 'in_jira'], normalizedColumnMappings, false), false),
        enhancement_request_type: enhancementRequestType,
        priority_level: priorityLevel,
        jira_number: isBlank(getMappedImportValue(row, 'jira_number', ['jira_number', 'jira'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'jira_number', ['jira_number', 'jira'], normalizedColumnMappings, '')).trim(),
        release_number: isBlank(getMappedImportValue(row, 'release_number', ['release_number', 'release'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'release_number', ['release_number', 'release'], normalizedColumnMappings, '')).trim(),
        release_notes: isBlank(getMappedImportValue(row, 'release_notes', ['release_notes'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'release_notes', ['release_notes'], normalizedColumnMappings, '')).trim(),
        easyvista_ticket_id: isBlank(getMappedImportValue(row, 'easyvista_ticket_id', ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id'], normalizedColumnMappings, null))
          ? null
          : String(getMappedImportValue(row, 'easyvista_ticket_id', ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id'], normalizedColumnMappings, '')).trim(),
        is_cleanup: finalIsCleanup,
        cleanup_status: finalCleanupStatus,
        cleanup_tag_type: finalCleanupTagType,
        easyvista_submitted_by: String(getMappedImportValue(row, 'easyvista_submitted_by', ['easyvista_submitted_by', 'submitted_by_easyvista'], normalizedColumnMappings, 'Unknown') || 'Unknown').trim() || 'Unknown',
        // Public by default (mirrors resolveCreateVisibility): honor an explicitly
        // mapped is_public/public column, but when it is unmapped/blank default to
        // public — unless the imported row is a cleanup-only task, which stays private.
        is_public: parseImportBoolean(getMappedImportValue(row, 'is_public', ['is_public', 'public'], normalizedColumnMappings, null), !finalIsCleanup),
        is_retired: importedIsRetired,
        imported_status_label: importedStatus,
        // ── Report requests ─────────────────────────────────────────────────
        // Read for every row and written only for a report one (see the insert
        // below), so a mis-mapped column on a defect sheet loads nothing rather
        // than half a report request.
        //
        // `is_new_dashboard` stays TRI-STATE: a blank column means "the sheet
        // does not say", which is not the same answer as "a change to one that
        // exists". Boolean-ing it would invent the second.
        is_new_dashboard: parseImportBoolean(
          getMappedImportValue(row, 'is_new_dashboard', ['is_new_dashboard', 'new_dashboard_request', 'new_dashboard'], normalizedColumnMappings, null),
          null,
        ),
        needed_data: importedText(row, 'needed_data', ['needed_data', 'list_needed_data']),
        measures_and_sources: importedText(row, 'measures_and_sources', ['measures_and_sources', 'list_of_measures_data_sources']),
        primary_contact: importedText(row, 'primary_contact', ['primary_contact', 'primary_contact_for_dashboard']),
        existing_report_link: importedText(row, 'existing_report_link', ['existing_report_link', 'existing_report']),
        changes_requested: importedText(row, 'changes_requested', ['changes_requested', 'list_changes_requested']),
        // Refused rather than stored when the sheet says something outside the
        // scale — six answers must not become ten because a column was free text.
        report_usage_frequency: (() => {
          const value = importedText(row, 'report_usage_frequency', ['report_usage_frequency', 'how_often_will_this_be_used']);
          if (!value) return null;
          return REPORT_USAGE_FREQUENCIES.find(
            (frequency) => frequency.toLowerCase() === value.toLowerCase(),
          ) || null;
        })(),
        department: importedText(row, 'department', ['department', 'what_dept_is_this_for']),
        completed_at: (() => {
          const value = importedText(row, 'completed_at', ['completed_at', 'complete_date', 'completed_date']);
          return value ? toIsoOrNow(value) : null;
        })(),

        // ── The analyst's half ──────────────────────────────────────────────
        // Matched against the offered levels of effort by name; anything the list
        // does not have is dropped rather than invented, and reported below.
        level_of_effort: (() => {
          const value = importedText(row, 'level_of_effort', ['level_of_effort', 'loe', 'effort', 'complexity']);
          if (!value) return null;
          return levelsOfEffort.find((option) => option.toLowerCase() === value.toLowerCase()) || null;
        })(),
        level_of_effort_raw: importedText(row, 'level_of_effort', ['level_of_effort', 'loe', 'effort', 'complexity']),
        assigned_to_raw: importedText(row, 'assigned_to', ['assigned_to', 'assignee', 'analyst', 'owner']),
        hours_logged: parseImportNumber(
          getMappedImportValue(row, 'hours_logged', ['hours_logged', 'hours', 'duration', 'time_spent'], normalizedColumnMappings, null),
        ),
        approved_at: (() => {
          const value = importedText(row, 'approved_at', ['approved_at', 'approved_date', 'approval_date']);
          return value ? toIsoOrNow(value) : null;
        })(),
        approved_by_name: importedText(row, 'approved_by_name', ['approved_by_name', 'approved_by', 'report_dashboard_approval']),
      });
    });

    const responseBase = {
      importMode,
      sheet: sheetName,
      totalRows: rawRows.length,
      validRows: preparedRows.length,
      invalidRows: errors.length,
      insertedRows: 0,
      dryRun,
      errors: errors.slice(0, 100),
      unknownStatuses: Array.from(unknownStatusesDetected),
    };

    if (unknownStatusesDetected.size > 0) {
      return res.status(400).json({
        error: 'Some status values do not match available statuses. Please map them and retry.',
        mappingRequired: true,
        mappingField: 'statusValueMappings',
        unknownStatuses: Array.from(unknownStatusesDetected),
        allowedStatuses: allowedStatusesWithRetired,
      });
    }

    return withDb(async (db) => {
      const dbModels = dbApi.getModels() || {};
      const Submission = dbModels.Submission;
      const ExcelImportRun = dbModels.ExcelImportRun;
      const changedBy = req.session?.user?.username || 'admin';
      let insertedRows = 0;
      const insertedIds = [];
      const insertionErrors = [];
      // Fields a row asked for and did not get. Not errors — the row imported, and
      // saying nothing would leave an admin believing a column landed when it did
      // not. Reported per row, with the value that could not be placed.
      const insertionWarnings = [];
      // application id → the set of user ids that application may hand work to.
      // Cached because a sheet is usually one application, and resolving it per
      // row would be a query per row.
      const assignableByApplication = new Map();
      const assignableFor = async (applicationId) => {
        const key = Number(applicationId);
        if (!assignableByApplication.has(key)) {
          const users = await listAssignableUsers(key);
          assignableByApplication.set(key, new Set(users.map((user) => Number(user.id))));
        }
        return assignableByApplication.get(key);
      };

      if (!dryRun && preparedRows.length > 0) {
        for (const row of preparedRows) {
          try {
            const lookupIds = await resolveSubmissionLookupIds(db, {
              created_via: 'admin_excel_import',
              type: row.type,
              application_name: row.application_name,
              status: row.status,
              cleanup_status: row.cleanup_status,
              cleanup_tag_type: row.cleanup_tag_type,
              enhancement_request_type: row.enhancement_request_type,
              priority_level: row.priority_level,
            });
            const missingLookupFields = collectMissingLookupIds(lookupIds, [
              { idKey: 'created_via_id', label: 'Created Via', required: true },
              { idKey: 'type_id', label: 'Type', required: true },
              { idKey: 'application_id', label: 'Application', required: true },
              { idKey: 'status_id', label: 'Status', required: true },
              {
                idKey: 'cleanup_status_id',
                label: 'Cleanup Status',
                required: Boolean(row.is_cleanup) && !isBlank(row.cleanup_status),
              },
              {
                idKey: 'cleanup_tag_type_id',
                label: 'Cleanup Tag Type',
                required: Boolean(row.is_cleanup) && !isBlank(row.cleanup_tag_type),
              },
              {
                idKey: 'enhancement_request_type_id',
                label: 'Enhancement Request Type',
                required: !isBlank(row.enhancement_request_type),
              },
              {
                idKey: 'priority_level_id',
                label: 'Priority Level',
                required: row.type === 'enhancement' && !isBlank(row.priority_level),
              },
            ]);
            if (missingLookupFields.length > 0) {
              throw new Error(formatMissingLookupError(missingLookupFields));
            }
            // ── The analyst's half, resolved now that the row's application is ──
            // A name in a sheet becomes a user id here or not at all: unknown,
            // ambiguous, or no grant on this application all mean unassigned, with
            // the reason carried back to the admin.
            let assignedTo = null;
            if (isReportImport && row.assigned_to_raw) {
              const resolved = resolveImportedAssignee(row.assigned_to_raw, {
                people,
                assignable: await assignableFor(lookupIds.application_id),
              });
              assignedTo = resolved.id;
              if (!resolved.id) {
                insertionWarnings.push({
                  rowNumber: row.rowNumber,
                  message: `Assigned To left empty — ${resolved.reason}.`,
                });
              }
            }
            if (isReportImport && row.level_of_effort_raw && !row.level_of_effort) {
              insertionWarnings.push({
                rowNumber: row.rowNumber,
                message: `Level of Effort "${row.level_of_effort_raw}" is not one of the offered values — left unsized.`,
              });
            }
            const levelOfEffortId = isReportImport && row.level_of_effort
              ? await getLookupIdByName(db, 'levels_of_effort', row.level_of_effort)
              : null;

            const insertColumns = SUBMISSION_INSERT_COLUMNS;
            const insertValues = [
              row.created_at,
              row.updated_at,
              lookupIds.created_via_id,
              row.created_by,
              row.created_by_email,
              lookupIds.type_id,
              lookupIds.application_id,
              row.policy_num,
              row.account_num,
              row.transaction_num,
              row.screen_title,
              row.summary_of_issue,
              row.steps_to_reproduce,
              row.what_happened_exact_details,
              row.request,
              row.date_time_of_error,
              lookupIds.status_id,
              row.reviewer,
              row.decision_notes,
              null,
              null,
              row.easyvista_ticket_id,
              row.desired_completion_date,
              row.impact_details,
              lookupIds.enhancement_request_type_id,
              lookupIds.priority_level_id,
              row.jira_number,
              row.release_number,
              row.release_notes,
              toBooleanSql(row.is_cleanup),
              lookupIds.cleanup_status_id,
              lookupIds.cleanup_tag_type_id,
              row.easyvista_submitted_by,
              toBooleanSql(row.is_public),
              toBooleanSql(row.is_retired),
              toBooleanSql(row.logged_defect),
              // ── Report requests ───────────────────────────────────────────
              // Parallel to SUBMISSION_INSERT_COLUMNS, and only for the type that
              // has them: a spreadsheet's report columns on a defect row are a
              // mapping mistake, and writing them anyway would make the row lie.
              ...(row.type === SUBMISSION_TYPE_REPORT
                ? [
                  row.is_new_dashboard === null || row.is_new_dashboard === undefined
                    ? null
                    : toBooleanSql(row.is_new_dashboard),
                  row.needed_data,
                  row.measures_and_sources,
                  row.primary_contact,
                  row.existing_report_link,
                  row.changes_requested,
                  row.report_usage_frequency,
                  row.department,
                  // A row imported as Delivered is complete, whatever date column
                  // the sheet used — otherwise the throughput page cannot see the
                  // history that was just loaded into it.
                  row.completed_at
                    || (row.status === REPORT_DELIVERED_STATUS ? row.updated_at : null),
                ]
                : [null, null, null, null, null, null, null, null, null]),
              ...(row.type === SUBMISSION_TYPE_REPORT
                ? [levelOfEffortId, assignedTo, row.approved_at, row.approved_by_name]
                : [null, null, null, null]),
              // delivery_notes — last, matching SUBMISSION_INSERT_COLUMNS. Not a
              // sheet column: a delivery note is written on the Delivery pane
              // after the work, and an import is loading history that already
              // happened elsewhere. It stays null and is typed in afterwards.
              null,
            ];
            if (!Submission) {
              throw new Error('Submission model is not initialized');
            }
            const submissionId = Number((await Submission.create(
              buildInsertPayload(insertColumns, insertValues),
            )).id);
            await logStatusChange(db, submissionId, 'New', changedBy, row.created_at);
            if (row.status !== 'New') {
              await logStatusChange(db, submissionId, row.status, changedBy, row.updated_at);
            }
            if (row.is_retired) {
              await logStatusChange(db, submissionId, 'Retired', changedBy, row.updated_at);
            }

            // The handover trail starts at whoever the sheet says holds it. It
            // cannot be reconstructed later, so an imported assignee is written
            // into it now rather than on the first reassignment in the portal.
            if (assignedTo) {
              await recordAssignment(submissionId, {
                assignedTo,
                // Whoever ran the import is who assigned it, as far as the trail is
                // concerned — the sheet has no answer for that.
                assignedBy: Number(req.session?.user?.id) || null,
              });
            }

            // `Duration` becomes ONE time entry. Hours have to belong to a person
            // and a day — that is why they are a child table rather than a column —
            // so a sheet's single number is credited to the assignee on the day the
            // request completed. With nobody to credit it stays out of the ledger:
            // inventing an owner for somebody else's work is how throughput
            // reporting stops being trustworthy.
            if (isReportImport && Number(row.hours_logged) > 0) {
              const workedOn = dayOf(row.completed_at || row.updated_at || row.created_at);
              if (assignedTo && workedOn) {
                const logged = await addTimeEntry(submissionId, {
                  userId: assignedTo,
                  hours: row.hours_logged,
                  workedOn,
                  note: 'Imported from a spreadsheet',
                });
                if (logged?.error) {
                  insertionWarnings.push({
                    rowNumber: row.rowNumber,
                    message: `Hours Logged not recorded — ${logged.error}.`,
                  });
                }
              } else {
                insertionWarnings.push({
                  rowNumber: row.rowNumber,
                  message: `${row.hours_logged} hours not recorded — hours need somebody to credit them to, and this row has no assignee.`,
                });
              }
            }

            insertedRows += 1;
            insertedIds.push(submissionId);
          } catch (rowError) {
            const rawMessage = String(rowError?.message || 'Unable to import this row.');
            const normalizedMessage = rawMessage.toLowerCase();
            if (normalizedMessage.includes('values for') && normalizedMessage.includes('columns')) {
              insertionErrors.push(
                `Row ${row.rowNumber}: import template mismatch (field count vs value count). Please contact support; this row was skipped.`,
              );
              continue;
            }
            insertionErrors.push(
              `Row ${row.rowNumber}: ${rawMessage}`,
            );
          }
        }
      }

      if (!dryRun && insertedRows > 0) {
        emitAdminNotification('submissions:bulk-imported', {
          insertedRows,
          totalRows: rawRows.length,
        });
        // Index the imported tickets for AI search in the background (batched,
        // non-blocking). No-op when AI search isn't configured.
        scheduleBatchEmbeddingRefresh(insertedIds);
      }

      const combinedErrors = [...responseBase.errors, ...insertionErrors].slice(0, 100);
      const invalidRows = responseBase.invalidRows + insertionErrors.length;
      const status = dryRun
        ? (invalidRows > 0 ? 'partial' : 'success')
        : insertedRows === 0
          ? 'error'
          : invalidRows > 0
            ? 'partial'
            : 'success';
      const summaryMessage = dryRun
        ? `Dry run complete: ${responseBase.validRows} valid row(s), ${invalidRows} invalid row(s).`
        : `Import complete: ${insertedRows} of ${responseBase.totalRows} row(s) added.${invalidRows > 0 ? ` Skipped ${invalidRows} invalid row(s).` : ''}`;

      const historyPayload = {
        created_at: new Date().toISOString(),
        created_by: changedBy,
        file_name: String(uploadedFile.originalname || 'upload.xlsx'),
        sheet_name: sheetName,
        import_mode: importMode,
        total_rows: responseBase.totalRows,
        valid_rows: responseBase.validRows,
        invalid_rows: invalidRows,
        inserted_rows: insertedRows,
        dry_run: toBooleanSql(dryRun),
        status,
        summary_message: summaryMessage,
        errors_json: JSON.stringify(combinedErrors),
      };

      if (!ExcelImportRun) {
        throw new Error('ExcelImportRun model is not initialized');
      }
      const historyEntry = (await ExcelImportRun.create(historyPayload)).toJSON();

      return res.json({
        ...responseBase,
        invalidRows,
        insertedRows,
        errors: combinedErrors,
        // Rows that imported with something missing. Separate from `errors`, which
        // are rows that did NOT import: "the ticket is in, its assignee is not" and
        // "the ticket is not in" need different reactions from the admin.
        warnings: insertionWarnings.slice(0, 100),
        historyEntry: mapExcelImportRun(historyEntry),
      });
    });
  } finally {
    fs.rmSync(uploadedFile.path, { force: true });
  }
});

module.exports = router;
