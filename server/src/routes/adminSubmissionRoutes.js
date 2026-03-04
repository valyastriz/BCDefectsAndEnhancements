const express = require('express');
const XLSX = require('xlsx');
const dbApi = require('../../db');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const {
  toBooleanSql,
  toIsoOrNow,
  isBlank,
  normalizeCleanupTagType,
  calculateOccurrenceRate,
} = require('../helpers/utils');
const {
  resolveSubmissionLookupIds,
  resolveExistingLookupFields,
  collectMissingLookupIds,
  formatMissingLookupError,
  getLookupIdByName,
  getDefectEnhancementStatuses,
  getSubmissionTypes,
  getCleanupStatuses,
  getCleanupTagTypes,
  getEnhancementRequestTypes,
  getSubmissionSources,
} = require('../helpers/lookups');
const { mapSubmission, toExportCellValue } = require('../helpers/mappers');
const { ADMIN_EXPORT_FIELDS, ADMIN_EXPORT_FIELDS_BY_KEY } = require('../helpers/export');
const { buildStatusTimeline } = require('../helpers/timeline');
const {
  listFilteredAdminSubmissions,
  getSubmissionByIdWithLookups,
  logStatusChange,
} = require('../services/submissionService');
const { emitAdminNotification, emitPublicUpdate } = require('../socket');
const {
  CLEANUP_TO_SUBMISSION_STATUS,
  SUBMISSION_TO_CLEANUP_STATUS,
} = require('../constants');

const router = express.Router();

router.get('/api/admin/submissions', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const rows = await listFilteredAdminSubmissions(db, req.query);
    return res.json(rows);
  });
});

router.get('/api/admin/submissions/export-xlsx', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const rows = await listFilteredAdminSubmissions(db, req.query);
    const requestedFieldKeys = String(req.query.fields || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const selectedFields = requestedFieldKeys.length > 0
      ? requestedFieldKeys.map((key) => ADMIN_EXPORT_FIELDS_BY_KEY.get(key)).filter(Boolean)
      : ADMIN_EXPORT_FIELDS;

    if (selectedFields.length === 0) {
      return res.status(400).json({ error: 'No valid export fields were selected.' });
    }

    const headerRow = selectedFields.map((field) => field.label);
    const bodyRows = rows.map((row) => selectedFields.map((field) => toExportCellValue(field.value(row))));
    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...bodyRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Admin Submissions');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `admin-submissions-export-${stamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buffer);
  });
});

router.get('/api/admin/submissions/export-fields', ensureAdmin, async (_req, res) => {
  return res.json({
    fields: ADMIN_EXPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  });
});

router.get('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const submissionId = Number.parseInt(String(req.params.id || ''), 10);
    if (!Number.isFinite(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }

    const dbModels = dbApi.getModels() || {};
    const Attachment = dbModels.Attachment;
    const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
    if (!Attachment || !SubmissionStatusEvent) {
      return res.status(500).json({ error: 'Required models are not available' });
    }
    const submission = await getSubmissionByIdWithLookups(db, submissionId);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const attachments = await Attachment.findAll({
      where: { submission_id: submissionId },
      order: [['uploaded_at', 'DESC']],
      raw: true,
    });

    const status_events = await SubmissionStatusEvent.findAll({
      where: { submission_id: submissionId },
      attributes: ['id', 'submission_id', 'status', 'changed_at', 'changed_by'],
      order: [['changed_at', 'DESC'], ['id', 'DESC']],
      raw: true,
    });

    const timeline = buildStatusTimeline(submission, status_events);

    return res.json({
      ...mapSubmission(submission),
      attachments,
      status_events: timeline,
    });
  });
});

router.post('/api/admin/submissions', ensureAdmin, async (req, res) => {
  const body = req.body || {};
  const requestedCreatedVia = String(body.created_via || '').trim().toLowerCase();
  if (isBlank(body.created_by)) {
    return res.status(400).json({ error: 'Requester Name is required' });
  }
  if (isBlank(body.summary_of_issue)) {
    return res.status(400).json({ error: 'Summary of Issue is required' });
  }

  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    if (!Submission) {
      return res.status(500).json({ error: 'Submission model is not available' });
    }
    const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const historicalStatuses = await getDefectEnhancementStatuses(db, { includeRetired: true });
    const allowedSubmissionTypes = await getSubmissionTypes(db);
    const allowedSubmissionSources = await getSubmissionSources(db);
    const allowedCleanupStatuses = await getCleanupStatuses(db);
    const allowedCleanupTagTypes = await getCleanupTagTypes(db);
    const createdVia = allowedSubmissionSources.includes(requestedCreatedVia)
      ? requestedCreatedVia
      : (allowedSubmissionSources.includes('admin_manual') ? 'admin_manual' : (allowedSubmissionSources[0] || 'admin_manual'));

    const isCleanup = Boolean(body.is_cleanup);
    const cleanupTagType = normalizeCleanupTagType(body.cleanup_tag_type, allowedCleanupTagTypes);
    const requestedType = String(body.type || '').trim().toLowerCase();
    const normalizedRequestedType = allowedSubmissionTypes.includes(requestedType) ? requestedType : null;
    const effectiveType = isCleanup
      ? (cleanupTagType === 'enhancement' ? 'enhancement' : (normalizedRequestedType || 'defect'))
      : normalizedRequestedType;

    if (!allowedSubmissionTypes.includes(String(effectiveType || '').trim().toLowerCase())) {
      return res.status(400).json({ error: 'Invalid submission type' });
    }

    const requestedCleanupStatus = String(body.cleanup_status || '').trim();
    const cleanupStatus = isCleanup
      ? (allowedCleanupStatuses.includes(requestedCleanupStatus) ? requestedCleanupStatus : 'New')
      : null;
    const requestedFinalStatus = String(body.status || '').trim();
    const finalStatus = allowedStatuses.includes(requestedFinalStatus) ? requestedFinalStatus : 'New';

    const createdAt = body.created_at ? toIsoOrNow(body.created_at) : new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const rawEvents = Array.isArray(body.status_events) ? body.status_events : [];
    const resolvedApplicationName = String(body.application_name || 'Billing Center').trim() || 'Billing Center';
    const resolvedEnhancementRequestType = body.enhancement_request_type || null;
    const resolvedPriorityLevel = body.priority_level || (effectiveType === 'enhancement' ? '3 - Medium' : null);
    const lookupIds = await resolveSubmissionLookupIds(db, {
      created_via: createdVia,
      type: effectiveType,
      application_name: resolvedApplicationName,
      status: finalStatus,
      cleanup_status: cleanupStatus,
      cleanup_tag_type: cleanupTagType,
      enhancement_request_type: resolvedEnhancementRequestType,
      priority_level: resolvedPriorityLevel,
    });
    const missingLookupFields = collectMissingLookupIds(lookupIds, [
      { idKey: 'created_via_id', label: 'Created Via', required: true },
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      { idKey: 'cleanup_status_id', label: 'Cleanup Status', required: isCleanup && !isBlank(cleanupStatus) },
      { idKey: 'cleanup_tag_type_id', label: 'Cleanup Tag Type', required: isCleanup && !isBlank(cleanupTagType) },
      {
        idKey: 'enhancement_request_type_id',
        label: 'Enhancement Request Type',
        required: !isBlank(resolvedEnhancementRequestType),
      },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: effectiveType === 'enhancement' && !isBlank(resolvedPriorityLevel),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }

    const insertColumns = [
      'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
      'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
      'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
      'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_of', 'easyvista_ticket_id',
      'desired_completion_date', 'impact_details', 'enhancement_request_type_id', 'priority_level_id',
      'jira_number', 'release_number', 'release_notes', 'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id',
      'easyvista_submitted_by', 'is_public', 'is_retired', 'logged_defect',
    ];
    const insertValues = [
      createdAt,
      updatedAt,
      lookupIds.created_via_id,
      String(body.created_by).trim(),
      String(body.created_by_email || '-').trim() || '-',
      lookupIds.type_id,
      lookupIds.application_id,
      body.policy_num || null,
      body.account_num || null,
      body.transaction_num || null,
      String(body.screen_title || '-').trim() || '-',
      String(body.summary_of_issue).trim(),
      String(body.steps_to_reproduce || '-').trim() || '-',
      String(body.what_happened_exact_details || '-').trim() || '-',
      String(body.request || '-').trim() || '-',
      body.date_time_of_error ? toIsoOrNow(body.date_time_of_error) : createdAt,
      lookupIds.status_id,
      body.reviewer || null,
      body.decision_notes || null,
      null,
      null,
      body.easyvista_ticket_id ? String(body.easyvista_ticket_id).trim() : null,
      body.desired_completion_date ? toIsoOrNow(body.desired_completion_date) : null,
      body.impact_details || null,
      lookupIds.enhancement_request_type_id,
      lookupIds.priority_level_id,
      body.jira_number ? String(body.jira_number).trim() : null,
      body.release_number ? String(body.release_number).trim() : null,
      body.release_notes || null,
      toBooleanSql(isCleanup),
      lookupIds.cleanup_status_id,
      lookupIds.cleanup_tag_type_id,
      String(body.easyvista_submitted_by || '').trim() || 'Unknown',
      toBooleanSql(body.is_public),
      0,
      toBooleanSql(body.logged_defect),
    ];
    const payload = insertColumns.reduce((acc, column, index) => {
      acc[column] = insertValues[index];
      return acc;
    }, {});
    const createdSubmission = await Submission.create(payload);
    const subId = Number(createdSubmission.id);

    // Insert backdated status events in chronological order
    const eventsToInsert = rawEvents
      .filter((e) => e?.status && e?.changed_at)
      .map((e) => {
        const statusInput = String(e.status || '').trim();
        const mappedStatus = isCleanup
          ? (CLEANUP_TO_SUBMISSION_STATUS[statusInput] || statusInput)
          : statusInput;
        return {
          status: mappedStatus,
          changed_at: toIsoOrNow(e.changed_at),
        };
      })
      .filter((e) => historicalStatuses.includes(e.status))
      .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

    // Always ensure the "created" / initial New event is present at the start
    const shouldUseCleanupCreatedEvent = isCleanup
      && cleanupTagType === 'cleanup_only'
      && cleanupStatus === 'Not Started';

    if (eventsToInsert.length === 0 || eventsToInsert[0].status !== 'New') {
      await logStatusChange(
        db,
        subId,
        shouldUseCleanupCreatedEvent ? 'Cleanup Status: New Cleanup item created' : 'New',
        req.session?.user?.username || 'admin',
        createdAt,
      );
    }

    for (const ev of eventsToInsert) {
      await logStatusChange(db, subId, ev.status, req.session?.user?.username || 'admin', ev.changed_at);
    }

    // If final status isn't covered by provided events, log it now
    const coveredStatuses = new Set(eventsToInsert.map((e) => e.status));
    if (!coveredStatuses.has(finalStatus) && finalStatus !== 'New') {
      await logStatusChange(db, subId, finalStatus, req.session?.user?.username || 'admin', updatedAt);
    }

    const formatTypeLabel = (value) => (String(value || '').trim().toLowerCase() === 'enhancement'
      ? 'Enhancement'
      : 'Defect');
    const formatCleanupTagTypeLabel = (value) => {
      const normalizedValue = String(value || '').trim().toLowerCase();
      if (normalizedValue === 'cleanup_only') return 'Cleanup Only';
      if (normalizedValue === 'enhancement') return 'Enhancement + Cleanup';
      if (normalizedValue === 'defect') return 'Defect + Cleanup';
      return 'None';
    };

    await logStatusChange(
      db,
      subId,
      `Type: ${formatTypeLabel(effectiveType)}`,
      req.session?.user?.username || 'admin',
      updatedAt,
    );

    if (isCleanup) {
      await logStatusChange(
        db,
        subId,
        'Cleanup Task: Checked',
        req.session?.user?.username || 'admin',
        updatedAt,
      );
    }

    if (cleanupTagType) {
      await logStatusChange(
        db,
        subId,
        `Cleanup Tag: Added (${formatCleanupTagTypeLabel(cleanupTagType)})`,
        req.session?.user?.username || 'admin',
        updatedAt,
      );
    }

    const created = await getSubmissionByIdWithLookups(db, subId);
    emitAdminNotification('submission:new', mapSubmission(created));
    return res.status(201).json(mapSubmission(created));
  });
});

router.put('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  const body = req.body || {};

  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const allowedSubmissionTypes = await getSubmissionTypes(db);
    const allowedCleanupStatuses = await getCleanupStatuses(db);
    const allowedCleanupTagTypes = await getCleanupTagTypes(db);

    const rawExisting = await Submission.findByPk(Number(req.params.id), { raw: true });
    if (!rawExisting) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    // Hydrate text fields from FK IDs (DB stores only _id columns, no redundant text columns)
    const existing = await resolveExistingLookupFields(rawExisting);

    const incomingDuplicateReference =
      body.duplicate_reference ?? body.duplicate_of ?? existing.duplicate_reference ?? existing.duplicate_of;
    const duplicateReference = isBlank(incomingDuplicateReference)
      ? null
      : String(incomingDuplicateReference).trim();
    const duplicateOfNumeric =
      duplicateReference && /^\d+$/.test(duplicateReference) ? Number(duplicateReference) : null;
    const policyPremiumImpact = isBlank(body.policy_premium_impact)
      ? null
      : Number(body.policy_premium_impact);
    const directDollarImpact = isBlank(body.direct_dollar_impact)
      ? null
      : Number(body.direct_dollar_impact);
    const policiesAffectedCount = isBlank(body.policies_affected_count)
      ? null
      : Number(body.policies_affected_count);
    const occurrenceCount = isBlank(body.occurrence_count)
      ? null
      : Number(body.occurrence_count);
    const occurrenceTimeframeCount = isBlank(body.occurrence_timeframe_count)
      ? null
      : Number(body.occurrence_timeframe_count);

    const isCleanup =
      typeof body.is_cleanup === 'boolean' ? body.is_cleanup : Boolean(existing.is_cleanup);

    const hasCleanupTagType = Object.prototype.hasOwnProperty.call(body, 'cleanup_tag_type');
    const incomingCleanupTagType = normalizeCleanupTagType(body.cleanup_tag_type, allowedCleanupTagTypes);
    const existingCleanupTagType = normalizeCleanupTagType(existing.cleanup_tag_type, allowedCleanupTagTypes);

    const requestedCleanupStatus = String(body.cleanup_status || '').trim();
    const nextCleanupStatus = isCleanup
        ? (allowedCleanupStatuses.includes(requestedCleanupStatus)
          ? requestedCleanupStatus
          : (existing.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[existing.status] || 'New'))
      : null;

    const nextCleanupTagType = isCleanup
      ? (hasCleanupTagType ? incomingCleanupTagType : existingCleanupTagType)
      : null;

    const nextType = isCleanup
      ? (nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect')
      : (body.type ?? existing.type);
    const normalizedExistingStatus = allowedStatuses.includes(String(existing.status || '').trim())
      ? String(existing.status || '').trim()
      : 'New';
    const existingRetired = Boolean(existing.is_retired) || String(existing.status || '') === 'Retired';
    const nextIsRetired =
      typeof body.is_retired === 'boolean' ? body.is_retired : existingRetired;

    const next = {
      type: nextType,
      application_name: body.application_name ?? existing.application_name,
      policy_num: body.policy_num ?? existing.policy_num,
      account_num: body.account_num ?? existing.account_num,
      transaction_num: body.transaction_num ?? existing.transaction_num,
      screen_title: body.screen_title ?? existing.screen_title,
      summary_of_issue: body.summary_of_issue ?? existing.summary_of_issue,
      steps_to_reproduce: body.steps_to_reproduce ?? existing.steps_to_reproduce,
      what_happened_exact_details:
        body.what_happened_exact_details ?? existing.what_happened_exact_details,
      request: body.request ?? existing.request,
      date_time_of_error: body.date_time_of_error
        ? toIsoOrNow(body.date_time_of_error)
        : existing.date_time_of_error,
      status: String(body.status ?? normalizedExistingStatus).trim() || normalizedExistingStatus,
      reviewer: body.reviewer ?? existing.reviewer,
      decision_notes: body.decision_notes ?? existing.decision_notes,
      fingerprint: body.fingerprint ?? existing.fingerprint,
      desired_completion_date:
        body.desired_completion_date === ''
          ? null
          : body.desired_completion_date
            ? toIsoOrNow(body.desired_completion_date)
            : existing.desired_completion_date,
      impact_details: body.impact_details ?? existing.impact_details,
      impact_notes: body.impact_notes ?? existing.impact_notes,
      policy_premium_impact:
        Number.isFinite(policyPremiumImpact) ? policyPremiumImpact : existing.policy_premium_impact,
      direct_dollar_impact:
        Number.isFinite(directDollarImpact) ? directDollarImpact : existing.direct_dollar_impact,
      policies_affected_count:
        Number.isFinite(policiesAffectedCount)
          ? Math.trunc(policiesAffectedCount)
          : existing.policies_affected_count,
      logged_defect:
        typeof body.logged_defect === 'boolean' ? body.logged_defect : Boolean(existing.logged_defect),
      enhancement_request_type:
        body.enhancement_request_type ?? existing.enhancement_request_type,
      priority_level: body.priority_level ?? existing.priority_level,
      jira_number: body.jira_number ?? existing.jira_number,
      release_number: body.release_number ?? existing.release_number,
      release_notes: body.release_notes ?? existing.release_notes,
      is_cleanup: isCleanup,
      cleanup_status: nextCleanupStatus,
      cleanup_tag_type: nextCleanupTagType,
      is_retired: nextIsRetired,
      duplicate_reference: duplicateReference,
      duplicate_of: duplicateOfNumeric,
      is_public:
        typeof body.is_public === 'boolean' ? body.is_public : Boolean(existing.is_public),
      easyvista_submitted_by:
        body.easyvista_submitted_by ?? existing.easyvista_submitted_by,
      occurrence_count:
        Object.prototype.hasOwnProperty.call(body, 'occurrence_count')
          ? (Number.isFinite(occurrenceCount) && occurrenceCount > 0 ? Math.trunc(occurrenceCount) : null)
          : existing.occurrence_count,
      occurrence_timeframe_count:
        Object.prototype.hasOwnProperty.call(body, 'occurrence_timeframe_count')
          ? (Number.isFinite(occurrenceTimeframeCount) && occurrenceTimeframeCount > 0 ? Math.trunc(occurrenceTimeframeCount) : null)
          : existing.occurrence_timeframe_count,
      occurrence_timeframe:
        body.occurrence_timeframe ?? existing.occurrence_timeframe ?? null,
    };

    const normalizedExistingStatusValue = String(existing.status || '').trim() || 'New';
    const normalizedNextStatus = String(next.status || '').trim() || normalizedExistingStatusValue;
    next.status = normalizedNextStatus;

    if (!allowedStatuses.includes(normalizedNextStatus) && normalizedNextStatus !== normalizedExistingStatusValue) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!allowedSubmissionTypes.includes(String(next.type || '').trim().toLowerCase())) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const isEditingEnhancementRequestType = Object.prototype.hasOwnProperty.call(
      body,
      'enhancement_request_type',
    );
    if (
      next.type === 'enhancement' &&
      isEditingEnhancementRequestType &&
      next.enhancement_request_type
    ) {
      const allowedEnhancementRequestTypes = await getEnhancementRequestTypes(db);
      if (!allowedEnhancementRequestTypes.includes(next.enhancement_request_type)) {
        return res.status(400).json({ error: 'Invalid enhancement request type' });
      }
    }

    if (next.type === 'enhancement' && isBlank(next.priority_level)) {
      next.priority_level = '3 - Medium';
    }

    const lookupIds = await resolveSubmissionLookupIds(db, {
      created_via: existing.created_via,
      type: next.type,
      application_name: next.application_name,
      status: next.status,
      cleanup_status: next.cleanup_status,
      cleanup_tag_type: next.cleanup_tag_type,
      enhancement_request_type: next.enhancement_request_type,
      priority_level: next.priority_level,
    });
    const missingLookupFields = collectMissingLookupIds(lookupIds, [
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      { idKey: 'cleanup_status_id', label: 'Cleanup Status', required: next.is_cleanup && !isBlank(next.cleanup_status) },
      { idKey: 'cleanup_tag_type_id', label: 'Cleanup Tag Type', required: next.is_cleanup && !isBlank(next.cleanup_tag_type) },
      {
        idKey: 'enhancement_request_type_id',
        label: 'Enhancement Request Type',
        required: !isBlank(next.enhancement_request_type),
      },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: next.type === 'enhancement' && !isBlank(next.priority_level),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }

    const updatedAt = new Date().toISOString();
    const updatePayload = {
      updated_at: updatedAt,
      type_id: lookupIds.type_id,
      application_id: lookupIds.application_id,
      policy_num: next.policy_num,
      account_num: next.account_num,
      transaction_num: next.transaction_num,
      screen_title: next.screen_title,
      summary_of_issue: next.summary_of_issue,
      steps_to_reproduce: next.steps_to_reproduce,
      what_happened_exact_details: next.what_happened_exact_details,
      request: next.request,
      date_time_of_error: next.date_time_of_error,
      status_id: lookupIds.status_id,
      reviewer: next.reviewer,
      decision_notes: next.decision_notes,
      fingerprint: next.fingerprint,
      desired_completion_date: next.desired_completion_date,
      impact_details: next.impact_details,
      impact_notes: next.impact_notes,
      policy_premium_impact: next.policy_premium_impact,
      direct_dollar_impact: next.direct_dollar_impact,
      policies_affected_count: next.policies_affected_count,
      logged_defect: toBooleanSql(next.logged_defect),
      enhancement_request_type_id: lookupIds.enhancement_request_type_id,
      priority_level_id: lookupIds.priority_level_id,
      jira_number: next.jira_number,
      release_number: next.release_number,
      release_notes: next.release_notes,
      is_cleanup: toBooleanSql(next.is_cleanup),
      // When is_cleanup=false preserve the existing ID so it can be restored if re-checked later
      cleanup_status_id: isCleanup ? lookupIds.cleanup_status_id : (existing.cleanup_status_id ?? null),
      cleanup_tag_type_id: lookupIds.cleanup_tag_type_id,
      is_retired: toBooleanSql(next.is_retired),
      duplicate_reference: next.duplicate_reference,
      duplicate_of: next.duplicate_of,
      is_public: toBooleanSql(next.is_public),
      easyvista_submitted_by: next.easyvista_submitted_by,
      occurrence_count: next.occurrence_count,
      occurrence_timeframe_count: next.occurrence_timeframe_count,
      occurrence_timeframe_id: await getLookupIdByName(db, 'occurrence_timeframes', next.occurrence_timeframe),
      occurrence_rate: calculateOccurrenceRate(next.occurrence_count, next.occurrence_timeframe_count, next.occurrence_timeframe),
    };

    await Submission.update(updatePayload, {
      where: { id: Number(req.params.id) },
    });

    const statusChanged = String(next.status || '') !== String(existing.status || '');
    const retiredStateChanged = Boolean(next.is_retired) !== Boolean(existing.is_retired);
    const cleanupStatusChanged =
      Boolean(next.is_cleanup) !== Boolean(existing.is_cleanup)
      || String(next.cleanup_status || '') !== String(existing.cleanup_status || '');
    const wasCleanupOnly =
      Boolean(existing.is_cleanup) && String(existing.cleanup_tag_type || '') === 'cleanup_only';
    const isCleanupOnlyNow = Boolean(next.is_cleanup) && String(next.cleanup_tag_type || '') === 'cleanup_only';
    const switchedToCleanupOnly =
      isCleanupOnlyNow
      && !wasCleanupOnly;
    const transitionCleanupTagType = String(next.cleanup_tag_type || '').trim();
    const transitionType = String(next.type || '').trim();
    const switchedFromCleanupOnly =
      wasCleanupOnly
      && !isCleanupOnlyNow
      && (
        (Boolean(next.is_cleanup) && ['defect', 'enhancement'].includes(transitionCleanupTagType))
        || (!Boolean(next.is_cleanup) && ['defect', 'enhancement'].includes(transitionType))
      );
    const switchedFromCleanupOnlyTarget = Boolean(next.is_cleanup)
      ? transitionCleanupTagType
      : transitionType;
    const switchedFromCleanupOnlyLabel = switchedFromCleanupOnlyTarget === 'enhancement'
      ? 'Enhancement'
      : 'Defect';
    const switchedFromCleanupOnlyMessage = Boolean(next.is_cleanup)
      ? `Defect/Enhancement Status: Switched to ${switchedFromCleanupOnlyLabel} and Cleanup type`
      : `Defect/Enhancement Status: Switched to ${switchedFromCleanupOnlyLabel} only`;
    const resolveEffectiveType = (typeValue, isCleanupValue, cleanupTagTypeValue) => {
      if (Boolean(isCleanupValue)) {
        return String(cleanupTagTypeValue || '').trim().toLowerCase() === 'enhancement'
          ? 'enhancement'
          : 'defect';
      }
      return String(typeValue || '').trim().toLowerCase() === 'enhancement'
        ? 'enhancement'
        : 'defect';
    };
    const existingEffectiveType = resolveEffectiveType(
      existing.type,
      existing.is_cleanup,
      existingCleanupTagType,
    );
    const nextEffectiveType = resolveEffectiveType(
      next.type,
      next.is_cleanup,
      nextCleanupTagType,
    );
    const typeChanged = nextEffectiveType !== existingEffectiveType;
    const formatTypeLabel = (value) => (String(value || '').trim().toLowerCase() === 'enhancement'
      ? 'Enhancement'
      : 'Defect');
    const formatTypeStateLabel = (effectiveTypeValue, isCleanupValue, cleanupTagTypeValue) => {
      const normalizedCleanupTagType = String(cleanupTagTypeValue || '').trim().toLowerCase();
      if (Boolean(isCleanupValue)) {
        if (normalizedCleanupTagType === 'cleanup_only') return 'Cleanup Only';
        return String(effectiveTypeValue || '').trim().toLowerCase() === 'enhancement'
          ? 'Enhancement + Cleanup'
          : 'Defect + Cleanup';
      }
      return formatTypeLabel(effectiveTypeValue);
    };
    const cleanupOnlyStatusReset =
      isCleanupOnlyNow
      && statusChanged
      && String(next.status || '') === 'New';
    const logCleanupOnlyTransition = switchedToCleanupOnly || cleanupOnlyStatusReset;

    if (logCleanupOnlyTransition) {
      await logStatusChange(
        db,
        Number(req.params.id),
        'Defect/Enhancement Status: Switched to Cleanup Only',
        req.session?.user?.username || null,
        updatedAt,
      );
    } else if (switchedFromCleanupOnly) {
      await logStatusChange(
        db,
        Number(req.params.id),
        switchedFromCleanupOnlyMessage,
        req.session?.user?.username || null,
        updatedAt,
      );
    } else if (statusChanged) {
      await logStatusChange(
        db,
        Number(req.params.id),
        `Defect/Enhancement Status: ${next.status}`,
        req.session?.user?.username || null,
        updatedAt,
      );
    }

    if (retiredStateChanged) {
      await logStatusChange(
        db,
        Number(req.params.id),
        next.is_retired ? 'Retired' : 'Unretired',
        req.session?.user?.username || null,
        updatedAt,
      );
    }

    if (cleanupStatusChanged) {
      const cleanupLabel = next.is_cleanup ? (next.cleanup_status || 'Not Started') : 'No Cleanup';
      const skipRedundantCleanupNotStarted =
        logCleanupOnlyTransition && cleanupLabel === 'Not Started';
      if (!skipRedundantCleanupNotStarted) {
        await logStatusChange(
          db,
          Number(req.params.id),
          `Cleanup Status: ${cleanupLabel}`,
          req.session?.user?.username || null,
          updatedAt,
        );
      }
    }

    if (typeChanged) {
      const previousTypeStateLabel = formatTypeStateLabel(
        existingEffectiveType,
        existing.is_cleanup,
        existingCleanupTagType,
      );
      const nextTypeStateLabel = formatTypeStateLabel(
        nextEffectiveType,
        next.is_cleanup,
        nextCleanupTagType,
      );
      await logStatusChange(
        db,
        Number(req.params.id),
        `Type Changed: From (${previousTypeStateLabel}) to (${nextTypeStateLabel})`,
        req.session?.user?.username || null,
        updatedAt,
      );
    }

    const saved = await getSubmissionByIdWithLookups(db, req.params.id);
    emitAdminNotification('submission:updated', mapSubmission(saved));
    if (saved.is_public) {
      emitPublicUpdate(mapSubmission(saved));
    }

    return res.json(mapSubmission(saved));
  });
});

module.exports = router;
