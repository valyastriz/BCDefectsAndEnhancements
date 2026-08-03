const dbApi = require('../../db');
const {
  CLEANUP_TO_SUBMISSION_STATUS,
  SUBMISSION_TO_CLEANUP_STATUS,
  UNASSIGNED_APPLICATION,
} = require('../constants');
const {
  buildAllLookupMaps,
  hydrateRowFromMaps,
  getLookupIdByName,
  getLookupModelByTable,
  resolveSubmissionLookupIds,
  resolveExistingLookupFields,
  collectMissingLookupIds,
  formatMissingLookupError,
  getDefectEnhancementStatuses,
  getSubmissionTypes,
  getSubmissionSources,
  getCleanupStatuses,
  getCleanupTagTypes,
  getEnhancementRequestTypes,
} = require('../helpers/lookups');
const {
  toBooleanSql,
  toIsoOrNow,
  isBlank,
  normalizeCleanupTagType,
  calculateOccurrenceRate,
} = require('../helpers/utils');
const { SUBMISSION_INSERT_COLUMNS, buildInsertPayload } = require('../helpers/submissionInsert');
const { mapSubmission, mapPublicSubmission } = require('../helpers/mappers');
const { emitAdminNotification, emitPublicUpdate } = require('../socket');
const { canReadSubmissionRow, canMutateApplication } = require('./viewerService');
const { scheduleEmbeddingRefresh } = require('./embeddingIndexService');
const {
  submitToEasyVista,
  sendEasyVistaAttachments,
  easyVistaAttachmentsSupported,
  easyVistaIsLive,
  easyVistaDemoMode,
  EASYVISTA_MAX_ATTACHMENTS,
} = require('../easyvista');
const {
  buildDescriptionRows,
  buildDescriptionHtml,
  easyVistaCatalogStatus,
  resolveEasyVistaEffectiveType,
  defaultSendAsType,
  normalizeSendAsType,
} = require('../helpers/easyVistaPayload');

// Fields the admin dashboard's free-text search box matches against, in the
// order an admin is most likely to be searching by: identifiers first, then the
// people on the ticket, then its descriptive text. Each field is matched
// independently (substring, case-insensitive) rather than against one joined
// string, so a query can never match by straddling two unrelated fields.
//
// `application_name` is a hydrated lookup name, not a raw column — the rows are
// already hydrated by the time the search filter runs. Status/type names are
// deliberately absent: they have dedicated filters, and matching them here would
// make a query like "new" return the whole board. The internal-only notes
// (decision_notes, impact_details, reviewer, fingerprint) are also left out.
const ADMIN_SEARCH_FIELDS = [
  'id',
  'easyvista_ticket_id',
  'jira_number',
  'release_number',
  'policy_num',
  'account_num',
  'transaction_num',
  'created_by',
  'created_by_email',
  'easyvista_submitted_by',
  'summary_of_issue',
  'screen_title',
  'what_happened_exact_details',
  'request',
  'steps_to_reproduce',
  'application_name',
];

const SUBMISSION_LOOKUP_JOINS = `
  LEFT JOIN defect_enhancement_statuses st ON st.id = s.status_id
  LEFT JOIN submission_types ty ON ty.id = s.type_id
  LEFT JOIN cleanup_statuses cs ON cs.id = s.cleanup_status_id
  LEFT JOIN cleanup_tag_types ct ON ct.id = s.cleanup_tag_type_id
  LEFT JOIN applications app ON app.id = s.application_id
  LEFT JOIN enhancement_request_types ert ON ert.id = s.enhancement_request_type_id
  LEFT JOIN priority_levels pl ON pl.id = s.priority_level_id
  LEFT JOIN submission_sources src ON src.id = s.created_via_id
`;

const SUBMISSION_LOOKUP_SELECT = `
  st.name AS model_status_name,
  ty.name AS model_type_name,
  cs.name AS model_cleanup_status_name,
  ct.name AS model_cleanup_tag_type_name,
  app.name AS model_application_name,
  ert.name AS model_enhancement_request_type_name,
  pl.name AS model_priority_level_name,
  src.name AS model_created_via_name
`;

async function getSubmissionByIdWithLookups(db, submissionId, { publicOnly = false } = {}) {
  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  if (!Submission) {
    throw new Error('Submission model is not initialized');
  }

  const where = {
    id: Number(submissionId),
    ...(publicOnly ? { is_public: 1 } : {}),
  };
  const submission = await Submission.findOne({ where, raw: true });
  if (!submission) return null;

  const lookupConfigs = [
    {
      idColumn: 'status_id',
      table: 'defect_enhancement_statuses',
      targetKey: 'model_status_name',
    },
    {
      idColumn: 'type_id',
      table: 'submission_types',
      targetKey: 'model_type_name',
    },
    {
      idColumn: 'cleanup_status_id',
      table: 'cleanup_statuses',
      targetKey: 'model_cleanup_status_name',
    },
    {
      idColumn: 'cleanup_tag_type_id',
      table: 'cleanup_tag_types',
      targetKey: 'model_cleanup_tag_type_name',
    },
    {
      idColumn: 'application_id',
      table: 'applications',
      targetKey: 'model_application_name',
    },
    {
      idColumn: 'enhancement_request_type_id',
      table: 'enhancement_request_types',
      targetKey: 'model_enhancement_request_type_name',
    },
    {
      idColumn: 'priority_level_id',
      table: 'priority_levels',
      targetKey: 'model_priority_level_name',
    },
    {
      idColumn: 'created_via_id',
      table: 'submission_sources',
      targetKey: 'model_created_via_name',
    },
    {
      idColumn: 'occurrence_timeframe_id',
      table: 'occurrence_timeframes',
      targetKey: 'model_occurrence_timeframe_name',
    },
  ];

  const hydrated = { ...submission };
  for (const config of lookupConfigs) {
    const lookupId = hydrated[config.idColumn];
    if (lookupId == null) {
      hydrated[config.targetKey] = null;
      continue;
    }

    const LookupModel = getLookupModelByTable(config.table);
    if (!LookupModel) {
      throw new Error(`Lookup model not initialized for ${config.table}`);
    }
    const row = await LookupModel.findByPk(Number(lookupId), {
      attributes: ['name'],
      raw: true,
    });
    hydrated[config.targetKey] = row?.name || null;
  }

  return hydrated;
}

/**
 * The admin queue.
 *
 * `scope` comes from resolveAdminReadScope and is REQUIRED: omitting it returns
 * nothing rather than everything, so a new caller that forgets to resolve one
 * fails closed instead of leaking another team's queue.
 */
async function listFilteredAdminSubmissions(db, query = {}, scope) {
  const {
    status,
    statuses,
    type,
    types,
    cleanupRequired,
    cleanupStatuses,
    search,
    requester,
    submittedBy,
    createdVia,
    application,
    retiredFilter,
    year,
    inJira,
    workaround,
    jiraNumber,
    easyvistaNumber,
    releaseNumber,
    sort,
  } = query;

  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;

  if (!Submission) {
    throw new Error('Submission model is not available');
  }

  const {
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  } = await buildAllLookupMaps(dbModels);

  const statusList = String(statuses || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const cleanupOnlySelected = statusList.includes('Cleanup Only');
  const cleanupMarkedSelected = statusList.includes('Cleanup Marked');
  const normalizedStatuses = statusList
    .filter((value) => value !== 'Cleanup Only' && value !== 'Cleanup Marked')
    .map((value) => CLEANUP_TO_SUBMISSION_STATUS[value] || value);
  const normalizedStatus = CLEANUP_TO_SUBMISSION_STATUS[String(status || '').trim()] || status;

  // Trimmed so a pasted incident number with stray whitespace still matches, and
  // so an all-whitespace box is treated as no search at all.
  const searchValue = String(search || '').trim();

  const createdViaFilter = createdVia ? String(createdVia || '').trim().toLowerCase() : '';
  const lookupCreatedViaId = createdViaFilter
    ? await getLookupIdByName(db, 'submission_sources', createdViaFilter, { lowercase: true })
    : null;

  const containsIgnoreCase = (value, needle) => String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
  const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
  const compareNum = (a, b) => Number(a || 0) - Number(b || 0);
  const compareBool = (a, b) => Number(Boolean(a)) - Number(Boolean(b));

  const rawRows = await Submission.findAll({ raw: true });

  // Access scoping runs first and unconditionally. Everything below this line is
  // presentation filtering driven by the query string, and no query parameter
  // may widen what a caller is allowed to see.
  const visibleRows = rawRows.filter((row) => canReadSubmissionRow(scope, row));

  // Augment each row with text names resolved from _id FK columns
  const maps = { statusIdToName, typeIdToName, cleanupTagTypeIdToName, cleanupStatusIdToName, applicationIdToName, enhancementRequestTypeIdToName, priorityLevelIdToName, createdViaIdToName, occurrenceTimeframeIdToName };
  const rows = visibleRows.map((row) => hydrateRowFromMaps(row, maps));

  // Which application's queue to show. Purely a narrowing on top of the access
  // scope above — it can never widen what this returns, so an admin choosing an
  // application they do not hold simply gets nothing.
  const applicationFilter = String(application || '').trim();

  const filteredRows = rows.filter((row) => {
    if (applicationFilter) {
      const rowApplication = String(row.application_name || '').trim();
      if (applicationFilter === UNASSIGNED_APPLICATION) {
        if (rowApplication) return false;
      } else if (rowApplication !== applicationFilter) {
        return false;
      }
    }

    const rowStatus = String(row.status || '').trim();
    const rowIsCleanup = Boolean(row.is_cleanup);
    const rowCleanupTagType = String(row.cleanup_tag_type || '').trim();
    // Match on the status the row is displayed as. A cleanup-only item is shown
    // under the "Cleanup Only" status (not its underlying defect/enhancement
    // status), so it only matches that pseudo-status. A blank status shows as 'New'.
    const isCleanupOnly = rowIsCleanup && rowCleanupTagType === 'cleanup_only';
    const rowDisplayStatus = rowStatus || 'New';

    if (retiredFilter !== 'retired_only' && statusList.length > 0) {
      const statusMatch = !isCleanupOnly && normalizedStatuses.includes(rowDisplayStatus);
      const cleanupOnlyMatch = cleanupOnlySelected && isCleanupOnly;
      const cleanupMarkedMatch = cleanupMarkedSelected && rowIsCleanup;
      if (!(statusMatch || cleanupOnlyMatch || cleanupMarkedMatch)) return false;
    } else if (retiredFilter !== 'retired_only' && normalizedStatus) {
      if (normalizedStatus === 'Cleanup Only') {
        if (!isCleanupOnly) return false;
      } else if (normalizedStatus === 'Cleanup Marked') {
        if (!rowIsCleanup) return false;
      } else if (isCleanupOnly || rowDisplayStatus !== normalizedStatus) {
        return false;
      }
    }

    if (type) {
      if (String(type).toLowerCase() === 'cleanup') {
        if (!rowIsCleanup) return false;
      } else if (
        String(row.type || '') !== String(type) ||
        (rowIsCleanup && rowCleanupTagType === 'cleanup_only')
      ) {
        return false;
      }
    }

    const typesList = String(types || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (typesList.length > 0) {
      const cleanupOnlyTypeSelected = typesList.some((v) =>
        ['cleanup only', 'cleanup_only', 'cleanup'].includes(v.toLowerCase()));
      const regularTypes = typesList
        .filter((v) => !['cleanup only', 'cleanup_only', 'cleanup'].includes(v.toLowerCase()))
        .map((v) => v.toLowerCase());
      const matchesRegularType = regularTypes.length > 0 &&
        regularTypes.includes(String(row.type || '').toLowerCase()) &&
        !(rowIsCleanup && rowCleanupTagType === 'cleanup_only');
      const matchesCleanupOnly = cleanupOnlyTypeSelected && rowIsCleanup && rowCleanupTagType === 'cleanup_only';
      if (!(matchesRegularType || matchesCleanupOnly)) return false;
    }

    if (cleanupRequired === 'yes' && !rowIsCleanup) return false;
    if (cleanupRequired === 'no' && rowIsCleanup) return false;

    const cleanupStatusesList = String(cleanupStatuses || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (cleanupStatusesList.length > 0) {
      if (!rowIsCleanup) return false;
      if (!cleanupStatusesList.includes(String(row.cleanup_status || '').trim())) return false;
    }

    if (searchValue) {
      const searchMatch = ADMIN_SEARCH_FIELDS.some((field) => containsIgnoreCase(row[field], searchValue));
      if (!searchMatch) return false;
    }

    if (requester && !containsIgnoreCase(row.created_by, requester)) {
      return false;
    }

    if (submittedBy && !containsIgnoreCase(row.easyvista_submitted_by, submittedBy)) {
      return false;
    }

    if (createdViaFilter) {
      if (!lookupCreatedViaId) return false;
      if (Number(row.created_via_id) !== Number(lookupCreatedViaId)) return false;
    }

    if (retiredFilter === 'retired_only') {
      if (!(Boolean(row.is_retired) || rowStatus === 'Retired')) return false;
    } else if (retiredFilter === 'non_retired') {
      if (Boolean(row.is_retired) || rowStatus === 'Retired') return false;
    }

    if (year && String(row.created_at || '').slice(0, 4) !== String(year).trim()) {
      return false;
    }

    if (inJira === 'yes' && !Boolean(row.logged_defect)) return false;
    if (inJira === 'no' && Boolean(row.logged_defect)) return false;

    // Three states, not two: a ticket the rep never flagged is neither open nor
    // handled, so "handled" must not sweep it in.
    if (workaround) {
      const requested = Boolean(row.needs_workaround);
      const handled = Boolean(row.workaround_provided);
      if (workaround === 'open' && !(requested && !handled)) return false;
      if (workaround === 'handled' && !(requested && handled)) return false;
      if (workaround === 'any' && !requested) return false;
    }

    if (jiraNumber && !containsIgnoreCase(row.jira_number, jiraNumber)) return false;
    if (easyvistaNumber && !containsIgnoreCase(row.easyvista_ticket_id, easyvistaNumber)) return false;
    if (releaseNumber && !containsIgnoreCase(row.release_number, releaseNumber)) return false;

    return true;
  });

  const filteredIds = filteredRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const statusUpdateAtById = new Map();
  const latestStatusEventById = new Map();

  if (SubmissionStatusEvent && filteredIds.length > 0) {
    const events = await SubmissionStatusEvent.findAll({
      where: { submission_id: filteredIds },
      attributes: ['id', 'submission_id', 'status', 'changed_at'],
      raw: true,
    });

    const submissionById = new Map(filteredRows.map((row) => [Number(row.id), row]));
    for (const event of events) {
      const submissionId = Number(event.submission_id);
      const row = submissionById.get(submissionId);
      if (!row) continue;

      const statusValue = String(event.status || '');
      const currentStatus = String(row.status || '');
      const eligible = statusValue === 'Retired'
        || statusValue === 'Unretired'
        || statusValue === currentStatus
        || statusValue === `Defect/Enhancement Status: ${currentStatus}`;

      if (eligible) {
        const currentMax = statusUpdateAtById.get(submissionId);
        if (!currentMax || new Date(event.changed_at).getTime() > new Date(currentMax).getTime()) {
          statusUpdateAtById.set(submissionId, event.changed_at);
        }
      }

      const latest = latestStatusEventById.get(submissionId);
      const nextChangedAt = new Date(event.changed_at || 0).getTime();
      const latestChangedAt = new Date(latest?.changed_at || 0).getTime();
      if (!latest || nextChangedAt > latestChangedAt || (nextChangedAt === latestChangedAt && Number(event.id) > Number(latest.id || 0))) {
        latestStatusEventById.set(submissionId, event);
      }
    }
  }

  const enrichedRows = filteredRows.map((row) => {
    const rowId = Number(row.id);
    const statusUpdateAt = statusUpdateAtById.get(rowId) || row.updated_at;
    const latestStatusEvent = latestStatusEventById.get(rowId);
    return {
      ...row,
      status_update_at: statusUpdateAt,
      latest_status_update: latestStatusEvent?.status || row.status || '',
      latest_status_update_at: latestStatusEvent?.changed_at || statusUpdateAt,
    };
  });

  const sortKey = String(sort || 'updated_desc');
  const comparatorMap = {
    id_asc: (a, b) => compareNum(a.id, b.id),
    id_desc: (a, b) => compareNum(b.id, a.id),
    updated_desc: (a, b) => compareText(b.status_update_at, a.status_update_at),
    updated_asc: (a, b) => compareText(a.status_update_at, b.status_update_at),
    created_desc: (a, b) => compareText(b.created_at, a.created_at),
    created_asc: (a, b) => compareText(a.created_at, b.created_at),
    requester_asc: (a, b) => compareText(a.created_by, b.created_by),
    requester_desc: (a, b) => compareText(b.created_by, a.created_by),
    submitted_by_asc: (a, b) => compareText(a.easyvista_submitted_by, b.easyvista_submitted_by),
    submitted_by_desc: (a, b) => compareText(b.easyvista_submitted_by, a.easyvista_submitted_by),
    policy_premium_impact_desc: (a, b) => compareNum(b.policy_premium_impact, a.policy_premium_impact),
    policy_premium_impact_asc: (a, b) => compareNum(a.policy_premium_impact, b.policy_premium_impact),
    direct_dollar_impact_desc: (a, b) => compareNum(b.direct_dollar_impact, a.direct_dollar_impact),
    direct_dollar_impact_asc: (a, b) => compareNum(a.direct_dollar_impact, b.direct_dollar_impact),
    policies_affected_count_desc: (a, b) => compareNum(b.policies_affected_count, a.policies_affected_count),
    policies_affected_count_asc: (a, b) => compareNum(a.policies_affected_count, b.policies_affected_count),
    logged_defect_desc: (a, b) => compareBool(b.logged_defect, a.logged_defect),
    logged_defect_asc: (a, b) => compareBool(a.logged_defect, b.logged_defect),
    jira_number_asc: (a, b) => compareText(a.jira_number, b.jira_number),
    jira_number_desc: (a, b) => compareText(b.jira_number, a.jira_number),
    type_asc: (a, b) => compareText(a.type, b.type),
    type_desc: (a, b) => compareText(b.type, a.type),
    summary_asc: (a, b) => compareText(a.summary_of_issue, b.summary_of_issue),
    summary_desc: (a, b) => compareText(b.summary_of_issue, a.summary_of_issue),
    status_asc: (a, b) => compareText(a.status, b.status),
    status_desc: (a, b) => compareText(b.status, a.status),
    public_asc: (a, b) => compareBool(a.is_public, b.is_public),
    public_desc: (a, b) => compareBool(b.is_public, a.is_public),
    release_number_asc: (a, b) => compareText(a.release_number, b.release_number),
    release_number_desc: (a, b) => compareText(b.release_number, a.release_number),
    easyvista_asc: (a, b) => compareText(a.easyvista_ticket_id, b.easyvista_ticket_id),
    easyvista_desc: (a, b) => compareText(b.easyvista_ticket_id, a.easyvista_ticket_id),
    frequency_asc: (a, b) => compareNum(a.occurrence_rate, b.occurrence_rate),
    frequency_desc: (a, b) => compareNum(b.occurrence_rate, a.occurrence_rate),
  };

  const comparator = comparatorMap[sortKey] || comparatorMap.updated_desc;
  enrichedRows.sort(comparator);
  return enrichedRows.map(mapSubmission);
}

async function logStatusChange(db, submissionId, status, changedBy, changedAt) {
  const dbModels = dbApi.getModels() || {};
  const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
  if (!SubmissionStatusEvent) {
    throw new Error('SubmissionStatusEvent model is not initialized');
  }

  await SubmissionStatusEvent.create({
    submission_id: submissionId,
    status,
    changed_at: changedAt || new Date().toISOString(),
    changed_by: changedBy || null,
  });
}

// Visibility default for a newly created submission (INTEGER column: 1/0).
// Real defect/enhancement tickets are public by default so they surface on the
// public status board and in public AI search; internal cleanup-only tasks stay
// private unless an admin opts them in. An explicit boolean from the caller
// always wins, so an admin can still create a private ticket on purpose. Pure
// (no DB) so it can be unit-tested directly.
function resolveCreateVisibility({ isCleanup = false, is_public } = {}) {
  if (typeof is_public === 'boolean') return is_public ? 1 : 0;
  return isCleanup ? 0 : 1;
}

// Create a submission from the admin "create" form.
// Returns a tagged result: { error, status } for a failure response, or
// { status: 201, body } on success. Pre-DB field validation (created_by /
// summary_of_issue) stays in the route; everything below was moved verbatim
// from the POST handler so the order/conditions of every DB write,
// logStatusChange and emit are preserved exactly.
async function createAdminSubmission(db, { body, username, viewer }) {
  const requestedCreatedVia = String(body.created_via || '').trim().toLowerCase();

  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  if (!Submission) {
    return { error: 'Submission model is not available', status: 500 };
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
    return { error: 'Invalid submission type', status: 400 };
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
    return { error: formatMissingLookupError(missingLookupFields), status: 400 };
  }

  // Filing is a write, so it obeys the same ownership rule as editing: an admin
  // may only create a ticket in a queue they administer. Checked against the
  // resolved id rather than the submitted name, so the name that reaches the
  // lookup and the id that gets authorised are the same value.
  if (!canMutateApplication(viewer, lookupIds.application_id)) {
    return { error: 'You do not administer this application', status: 403 };
  }

  const insertColumns = SUBMISSION_INSERT_COLUMNS;
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
    resolveCreateVisibility({ isCleanup, is_public: body.is_public }),
    0,
    toBooleanSql(body.logged_defect),
  ];
  const payload = buildInsertPayload(insertColumns, insertValues);
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
      username || 'admin',
      createdAt,
    );
  }

  for (const ev of eventsToInsert) {
    await logStatusChange(db, subId, ev.status, username || 'admin', ev.changed_at);
  }

  // If final status isn't covered by provided events, log it now
  const coveredStatuses = new Set(eventsToInsert.map((e) => e.status));
  if (!coveredStatuses.has(finalStatus) && finalStatus !== 'New') {
    await logStatusChange(db, subId, finalStatus, username || 'admin', updatedAt);
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
    username || 'admin',
    updatedAt,
  );

  if (isCleanup) {
    await logStatusChange(
      db,
      subId,
      'Cleanup Task: Checked',
      username || 'admin',
      updatedAt,
    );
  }

  if (cleanupTagType) {
    await logStatusChange(
      db,
      subId,
      `Cleanup Tag: Added (${formatCleanupTagTypeLabel(cleanupTagType)})`,
      username || 'admin',
      updatedAt,
    );
  }

  const created = await getSubmissionByIdWithLookups(db, subId);
  emitAdminNotification('submission:new', mapSubmission(created));
  if (created.is_public) {
    // Public by default now includes admin-created tickets — let the public
    // status board live-update. Send only allow-listed fields (unauth watchers).
    emitPublicUpdate(mapPublicSubmission(created));
  }
  scheduleEmbeddingRefresh(subId);
  return { status: 201, body: mapSubmission(created) };
}

// Update a submission from the admin "edit" form.
// Returns { error, status } for a failure response, or { status: 200, body }
// on success. Moved verbatim from the PUT handler; the entire status /
// retired / cleanup / type reconciliation block and its logStatusChange
// ordering is preserved exactly.
async function updateAdminSubmission(db, { id, body, username, viewer }) {
  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
  const allowedSubmissionTypes = await getSubmissionTypes(db);
  const allowedCleanupStatuses = await getCleanupStatuses(db);
  const allowedCleanupTagTypes = await getCleanupTagTypes(db);

  const rawExisting = await Submission.findByPk(Number(id), { raw: true });
  if (!rawExisting) {
    return { error: 'Submission not found', status: 404 };
  }
  // Write access follows CURRENT ownership only. A redirected ticket belongs to
  // the receiving team the moment it moves, so the team that sent it keeps
  // reading it (resolveAdminReadScope) but stops being able to change it.
  // Checked before the conflict check below, so an unauthorised caller learns
  // nothing about the row's edit history.
  if (!canMutateApplication(viewer, rawExisting.application_id)) {
    return { error: 'You do not administer this application', status: 403 };
  }
  // Optimistic concurrency: if the caller sent the version it loaded and the row
  // has changed since, reject so one admin never silently overwrites another's work.
  if (body.base_updated_at && String(rawExisting.updated_at || '') !== String(body.base_updated_at)) {
    return {
      status: 409,
      error: 'This item was changed by someone else while you had it open.',
      body: { conflict: true, currentUpdatedAt: rawExisting.updated_at },
    };
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
    // The rep's ask stays editable (a triager may raise it on their behalf, or
    // clear one raised in error), but the pair is what matters: an open request
    // is needs_workaround without workaround_provided.
    needs_workaround:
      typeof body.needs_workaround === 'boolean'
        ? body.needs_workaround
        : Boolean(existing.needs_workaround),
    workaround_provided:
      typeof body.workaround_provided === 'boolean'
        ? body.workaround_provided
        : Boolean(existing.workaround_provided),
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
    return { error: 'Invalid status', status: 400 };
  }

  if (!allowedSubmissionTypes.includes(String(next.type || '').trim().toLowerCase())) {
    return { error: 'Invalid type', status: 400 };
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
      return { error: 'Invalid enhancement request type', status: 400 };
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
    return { error: formatMissingLookupError(missingLookupFields), status: 400 };
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
    needs_workaround: toBooleanSql(next.needs_workaround),
    workaround_provided: toBooleanSql(next.workaround_provided),
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

  // Repeat the optimistic-concurrency check inside the UPDATE's WHERE so two
  // admins who both passed the read-time check can't both write: whichever
  // update lands second matches 0 rows and gets the same 409 conflict.
  const updateWhere = body.base_updated_at
    ? { id: Number(id), updated_at: rawExisting.updated_at }
    : { id: Number(id) };
  const [changedRows] = await Submission.update(updatePayload, { where: updateWhere });
  if (body.base_updated_at && changedRows === 0) {
    const current = await Submission.findByPk(Number(id), { raw: true });
    return {
      status: 409,
      error: 'This item was changed by someone else while you had it open.',
      body: { conflict: true, currentUpdatedAt: current?.updated_at ?? null },
    };
  }

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
      Number(id),
      'Defect/Enhancement Status: Switched to Cleanup Only',
      username || null,
      updatedAt,
    );
  } else if (switchedFromCleanupOnly) {
    await logStatusChange(
      db,
      Number(id),
      switchedFromCleanupOnlyMessage,
      username || null,
      updatedAt,
    );
  } else if (statusChanged) {
    await logStatusChange(
      db,
      Number(id),
      `Defect/Enhancement Status: ${next.status}`,
      username || null,
      updatedAt,
    );
  }

  if (retiredStateChanged) {
    await logStatusChange(
      db,
      Number(id),
      next.is_retired ? 'Retired' : 'Unretired',
      username || null,
      updatedAt,
    );
  }

  // Who handled the rep's workaround request, and when. The request itself is
  // logged at submit time, so the two entries bracket how long the rep waited.
  if (Boolean(next.workaround_provided) !== Boolean(existing.workaround_provided)) {
    await logStatusChange(
      db,
      Number(id),
      next.workaround_provided
        ? 'Workaround: Marked handled'
        : 'Workaround: Reopened — still needed',
      username || null,
      updatedAt,
    );
  }

  // A triager raising or withdrawing the request itself, rather than the rep.
  if (Boolean(next.needs_workaround) !== Boolean(existing.needs_workaround)) {
    await logStatusChange(
      db,
      Number(id),
      next.needs_workaround
        ? 'Workaround: Requested'
        : 'Workaround: Request withdrawn',
      username || null,
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
        Number(id),
        `Cleanup Status: ${cleanupLabel}`,
        username || null,
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
      Number(id),
      `Type Changed: From (${previousTypeStateLabel}) to (${nextTypeStateLabel})`,
      username || null,
      updatedAt,
    );
  }

  const saved = await getSubmissionByIdWithLookups(db, id);
  emitAdminNotification('submission:updated', { ...mapSubmission(saved), updatedBy: username || null });
  if (saved.is_public) {
    // Public watchers include unauthenticated sockets — send only the
    // allow-listed fields, same as the public REST endpoints.
    emitPublicUpdate(mapPublicSubmission(saved));
  }

  scheduleEmbeddingRefresh(Number(id));
  return { status: 200, body: mapSubmission(saved) };
}

// Upper bound on ids per bulk request (visibility or retire). Guards the live
// Supabase prod data from an accidental mass mutation and bounds the per-row
// loop below.
const MAX_BULK_IDS = 1000;

// Boundary validation shared by the bulk endpoints. Pure (no DB) so it can be
// unit-tested directly. `flagKey` names the boolean field required on the body
// ('is_public' or 'is_retired'). Returns { error } on a 400-worthy violation,
// or { ids, value } with ids coerced to positive integers on success.
function validateBulkFlagInput(body, flagKey) {
  const source = body || {};
  if (!Array.isArray(source.ids)) {
    return { error: 'ids must be an array' };
  }
  if (source.ids.length === 0) {
    return { error: 'ids must not be empty' };
  }
  if (source.ids.length > MAX_BULK_IDS) {
    return { error: `ids must contain at most ${MAX_BULK_IDS} items` };
  }
  if (typeof source[flagKey] !== 'boolean') {
    return { error: `${flagKey} must be a boolean` };
  }
  const ids = [];
  for (const raw of source.ids) {
    // Accept integers and integer-valued numeric strings; reject everything else.
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : NaN;
    if (!Number.isInteger(value) || value <= 0) {
      return { error: 'ids must contain only positive integers' };
    }
    ids.push(value);
  }
  return { ids, value: source[flagKey] };
}

// Shared loop for bulk single-flag updates. Validates the request body, then
// loops the existing per-row updateAdminSubmission so socket emits,
// status-history logging, and embedding scheduling match the single-ticket
// action exactly. A single failing id is collected in `failed` and never aborts
// the batch. Returns { error, status } on validation failure or
// { status: 200, body } on success, mirroring updateAdminSubmission's shape.
// `updateOne` is injectable so the loop can be unit-tested without a DB.
async function bulkUpdateFlag(db, { body, username, viewer, flagKey, updateOne = updateAdminSubmission } = {}) {
  const validation = validateBulkFlagInput(body, flagKey);
  if (validation.error) {
    return { error: validation.error, status: 400 };
  }
  const { ids, value } = validation;

  const failed = [];
  let updated = 0;
  for (const id of ids) {
    try {
      // The viewer rides along so a batch cannot reach tickets the same admin
      // would be refused one at a time; an unauthorised id lands in `failed`.
      const result = await updateOne(db, { id, body: { [flagKey]: value }, username, viewer });
      if (result && result.error) {
        failed.push(id);
      } else {
        updated += 1;
      }
    } catch (err) {
      failed.push(id);
    }
  }

  return {
    status: 200,
    body: { ok: true, [flagKey]: value, requested: ids.length, updated, failed },
  };
}

// Bulk public-visibility toggle (POST bulk-visibility). Domain-named wrappers
// over the shared flag helpers; request/response shapes are unchanged.
function validateBulkVisibilityInput(body) {
  const result = validateBulkFlagInput(body, 'is_public');
  return result.error ? result : { ids: result.ids, isPublic: result.value };
}

async function bulkUpdateVisibility(db, opts = {}) {
  return bulkUpdateFlag(db, { ...opts, flagKey: 'is_public' });
}

// Bulk retire/unretire (POST bulk-retire). Same per-row parity guarantees; the
// per-row update logs "Retired"/"Unretired" into status history only when the
// flag actually changes, so re-retiring an already-retired ticket is a no-op.
function validateBulkRetiredInput(body) {
  const result = validateBulkFlagInput(body, 'is_retired');
  return result.error ? result : { ids: result.ids, isRetired: result.value };
}

async function bulkUpdateRetired(db, opts = {}) {
  return bulkUpdateFlag(db, { ...opts, flagKey: 'is_retired' });
}

// Submit (or resubmit) a submission to EasyVista.
// Returns { error, status } for a failure response, or { status: 200, body }
// on success. Moved verbatim from the easyvista route handler; the order of
// every Submission.update / Attachment write / logStatusChange and emit, plus
// the first-time-vs-resubmission branching and response bodies, is preserved.
async function submitSubmissionToEasyVista(db, { id, body, username, viewer, dryRun = false }) {
  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  const Attachment = dbModels.Attachment;
  if (!Submission || !Attachment) {
    return { error: 'Required models are not available', status: 500 };
  }
  const rawSubmission = await getSubmissionByIdWithLookups(db, Number(id));
  if (!rawSubmission) {
    return { error: 'Submission not found', status: 404 };
  }
  // Handing a ticket to EasyVista is the most consequential write there is — it
  // leaves the portal — so it takes the same ownership check as an edit. The
  // dry-run preview is gated too: it renders the ticket's real content.
  if (!canMutateApplication(viewer, rawSubmission.application_id)) {
    return { error: 'You do not administer this application', status: 403 };
  }
  const submission = mapSubmission(rawSubmission);

  const isResubmissionRequest = !isBlank(submission.easyvista_ticket_id);
  const draftPayload =
    body && typeof body.draft === 'object' && body.draft !== null ? body.draft : null;

  const source = {
    ...submission,
  };

  // A real first-time send ignores the draft because the client saves the row
  // first and then submits. A dry run happens BEFORE that save, so it has to
  // merge the draft itself or the preview would show stale values for exactly
  // the case the admin is trying to check.
  if ((isResubmissionRequest || dryRun) && draftPayload) {
    const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const allowedSubmissionTypes = await getSubmissionTypes(db);
    const allowedCleanupStatuses = await getCleanupStatuses(db);
    const allowedCleanupTagTypes = await getCleanupTagTypes(db);
    const hasCleanupTagType = Object.prototype.hasOwnProperty.call(draftPayload, 'cleanup_tag_type');
    const incomingCleanupTagType = normalizeCleanupTagType(draftPayload.cleanup_tag_type, allowedCleanupTagTypes);
    const existingCleanupTagType = normalizeCleanupTagType(submission.cleanup_tag_type, allowedCleanupTagTypes);
    const isCleanup =
      typeof draftPayload.is_cleanup === 'boolean'
        ? draftPayload.is_cleanup
        : Boolean(submission.is_cleanup);
    const requestedCleanupStatus = String(draftPayload.cleanup_status || '').trim();
    const nextCleanupStatus = isCleanup
      ? (allowedCleanupStatuses.includes(requestedCleanupStatus)
          ? requestedCleanupStatus
          : (submission.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[submission.status] || 'Not Started'))
      : null;
    const nextCleanupTagType = isCleanup
      ? (hasCleanupTagType ? incomingCleanupTagType : existingCleanupTagType)
      : null;
    const requestedType = String(draftPayload.type || '').trim().toLowerCase();
    const nextType = isCleanup
      ? (nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect')
      : (allowedSubmissionTypes.includes(requestedType) ? requestedType : submission.type);
    const requestedStatus = String(draftPayload.status || '').trim();
    const nextStatus = allowedStatuses.includes(requestedStatus) ? requestedStatus : submission.status;

    const policyPremiumImpact = isBlank(draftPayload.policy_premium_impact)
      ? null
      : Number(draftPayload.policy_premium_impact);
    const directDollarImpact = isBlank(draftPayload.direct_dollar_impact)
      ? null
      : Number(draftPayload.direct_dollar_impact);
    const policiesAffectedCount = isBlank(draftPayload.policies_affected_count)
      ? null
      : Number(draftPayload.policies_affected_count);

    source.type = nextType;
    source.status = nextStatus;
    source.is_cleanup = isCleanup;
    source.cleanup_status = nextCleanupStatus;
    source.cleanup_tag_type = nextCleanupTagType;
    source.application_name = draftPayload.application_name ?? submission.application_name;
    source.policy_num = draftPayload.policy_num ?? submission.policy_num;
    source.account_num = draftPayload.account_num ?? submission.account_num;
    source.transaction_num = draftPayload.transaction_num ?? submission.transaction_num;
    source.screen_title = draftPayload.screen_title ?? submission.screen_title;
    source.summary_of_issue = draftPayload.summary_of_issue ?? submission.summary_of_issue;
    source.steps_to_reproduce = draftPayload.steps_to_reproduce ?? submission.steps_to_reproduce;
    source.what_happened_exact_details =
      draftPayload.what_happened_exact_details ?? submission.what_happened_exact_details;
    source.request = draftPayload.request ?? submission.request;
    source.date_time_of_error = draftPayload.date_time_of_error
      ? toIsoOrNow(draftPayload.date_time_of_error)
      : (draftPayload.date_time_of_error === null ? null : submission.date_time_of_error);
    source.reviewer = draftPayload.reviewer ?? submission.reviewer;
    source.decision_notes = draftPayload.decision_notes ?? submission.decision_notes;
    source.fingerprint = draftPayload.fingerprint ?? submission.fingerprint;
    source.desired_completion_date = draftPayload.desired_completion_date === ''
      ? null
      : draftPayload.desired_completion_date
        ? toIsoOrNow(draftPayload.desired_completion_date)
        : submission.desired_completion_date;
    source.impact_details = draftPayload.impact_details ?? submission.impact_details;
    source.impact_notes = draftPayload.impact_notes ?? submission.impact_notes;
    source.policy_premium_impact = Number.isFinite(policyPremiumImpact)
      ? policyPremiumImpact
      : submission.policy_premium_impact;
    source.direct_dollar_impact = Number.isFinite(directDollarImpact)
      ? directDollarImpact
      : submission.direct_dollar_impact;
    source.policies_affected_count = Number.isFinite(policiesAffectedCount)
      ? Math.trunc(policiesAffectedCount)
      : submission.policies_affected_count;
    source.logged_defect =
      typeof draftPayload.logged_defect === 'boolean'
        ? draftPayload.logged_defect
        : Boolean(submission.logged_defect);
    source.enhancement_request_type = Object.prototype.hasOwnProperty.call(
      draftPayload,
      'enhancement_request_type',
    )
      ? (isBlank(draftPayload.enhancement_request_type)
          ? null
          : draftPayload.enhancement_request_type)
      : submission.enhancement_request_type;
    source.priority_level = draftPayload.priority_level ?? submission.priority_level;
    source.jira_number = draftPayload.jira_number ?? submission.jira_number;
    source.release_number = draftPayload.release_number ?? submission.release_number;
    source.release_notes = draftPayload.release_notes ?? submission.release_notes;
    source.duplicate_reference = draftPayload.duplicate_of ?? submission.duplicate_reference;
    source.is_public =
      typeof draftPayload.is_public === 'boolean'
        ? draftPayload.is_public
        : Boolean(submission.is_public);
    source.is_retired =
      typeof draftPayload.is_retired === 'boolean'
        ? draftPayload.is_retired
        : Boolean(submission.is_retired);

    if (source.type === 'enhancement' && isBlank(source.priority_level)) {
      source.priority_level = '3 - Medium';
    }
  }

  // EasyVista accepts a defect or an enhancement and nothing else, so the admin
  // picks which one this goes out as. For an ordinary ticket the choice is
  // pre-filled with its own type; a Cleanup Only task has no sensible default,
  // so it must be chosen — which is also how a cleanup task now reaches
  // EasyVista at all, without having to be reclassified first.
  const requestedSendAsType = normalizeSendAsType(body && body.sendAsType);

  // Which of this ticket's files go to EasyVista. Absent means "all of them,
  // up to the cap" so an older client that does not send a selection keeps
  // working.
  const submissionAttachments = await Attachment.findAll({
    where: { submission_id: Number(submission.id) },
    order: [['uploaded_at', 'ASC']],
    raw: true,
  });
  const requestedAttachmentIds = Array.isArray(body?.attachmentIds)
    ? body.attachmentIds.map(Number).filter((id) => Number.isInteger(id))
    : null;
  const selectedAttachments = requestedAttachmentIds
    // Filtering against the ticket's own rows is what stops an id from another
    // submission being attached to this one.
    ? submissionAttachments.filter((att) => requestedAttachmentIds.includes(Number(att.id)))
    : submissionAttachments.slice(0, EASYVISTA_MAX_ATTACHMENTS);

  if (selectedAttachments.length > EASYVISTA_MAX_ATTACHMENTS) {
    return {
      error: `EasyVista accepts at most ${EASYVISTA_MAX_ATTACHMENTS} files. Deselect ${selectedAttachments.length - EASYVISTA_MAX_ATTACHMENTS} to continue.`,
      status: 400,
    };
  }
  const effectiveType = resolveEasyVistaEffectiveType(source, requestedSendAsType);

  if (!effectiveType) {
    if (dryRun) {
      return {
        status: 200,
        preview: {
          isResubmission: isResubmissionRequest,
          currentTicketId: submission.easyvista_ticket_id || null,
          requiresChoice: true,
          sendAsType: null,
          defaultSendAsType: null,
          effectiveType: null,
          declaredType: source.type,
          missing: [],
          rows: [],
          raw: '',
          live: easyVistaIsLive(),
          demo: easyVistaDemoMode(),
        },
      };
    }
    return {
      error: 'Choose whether this Cleanup Only task goes to EasyVista as a Defect or an Enhancement.',
      status: 400,
    };
  }

  const missing = [];
  if (effectiveType === 'enhancement') {
    if (isBlank(source.impact_details)) {
      missing.push('Impact Details');
    }
    const allowedEnhancementRequestTypes = await getEnhancementRequestTypes(db);
    if (
      isBlank(source.enhancement_request_type) ||
      !allowedEnhancementRequestTypes.includes(source.enhancement_request_type)
    ) {
      missing.push('Request Type');
    }
  }

  if (effectiveType === 'defect') {
    if (isBlank(source.summary_of_issue)) {
      missing.push('Summary of Issue');
    }
    if (isBlank(source.screen_title)) {
      missing.push('Screen Title');
    }
    if (isBlank(source.what_happened_exact_details)) {
      missing.push('Description');
    }
  }

  // ── Dry run: report what a send would transmit, then stop ───────────────
  // Everything above this point is the real submit path, so the preview and the
  // request can never disagree about the payload, the effective type, or which
  // fields are blocking.
  if (dryRun) {
    const outgoing = { ...source, type: effectiveType };
    // Baseline for the diff: the saved record as it would go out under the same
    // chosen type, so a type change does not read as every field having changed.
    const saved = { ...submission, type: effectiveType };
    const savedRows = buildDescriptionRows(saved);
    const savedByKey = new Map(savedRows.map((row) => [row.key, row.value]));

    return {
      status: 200,
      preview: {
        isResubmission: isResubmissionRequest,
        currentTicketId: submission.easyvista_ticket_id || null,
        requiresChoice: false,
        sendAsType: requestedSendAsType,
        defaultSendAsType: defaultSendAsType(source),
        effectiveType,
        declaredType: source.type,
        missing,
        rows: buildDescriptionRows(outgoing).map((row) => ({
          ...row,
          changed: savedByKey.get(row.key) !== row.value,
          previous: savedByKey.get(row.key) ?? '',
        })),
        // The description EasyVista receives. Deliberately the HTML table and
        // not the whole request body: the body carries EasyVista's repurposed
        // field names, which are an internal translation detail and would only
        // confuse an admin reading this.
        raw: buildDescriptionHtml(outgoing),
        // False means a send records a placeholder id and transmits nothing.
        live: easyVistaIsLive(),
        // Whether THIS application has a catalog of its own. Reported even while
        // EasyVista is off, so the gap is visible in a walkthrough rather than
        // surfacing for the first time on the day the integration is switched on.
        catalog: await (async () => {
          const application = dbModels.Application
            ? await dbModels.Application.findOne({ where: { name: source.application_name }, raw: true })
            : null;
          const status = easyVistaCatalogStatus(application);
          return { configured: status.configured, reason: status.reason };
        })(),
        // ...and `demo` says whether that placeholder send is meant to be shown
        // as if it were real, which is how the pre-go-live walkthrough works.
        demo: easyVistaDemoMode(),
        maxAttachments: EASYVISTA_MAX_ATTACHMENTS,
        // Whether the files picked below would actually reach EasyVista on a
        // real send. False only when the integration is live and the upload
        // contract is still unwritten — the one case where a ticket is created
        // for real and its evidence is not. Said BEFORE the send, so the choice
        // to go ahead without the files is a decision rather than a surprise.
        attachmentsDeliverable: !easyVistaIsLive() || easyVistaAttachmentsSupported(),
        attachments: submissionAttachments.map((att) => ({
          id: att.id,
          filename: att.filename,
          mime_type: att.mime_type,
          // Needed so the picker can show a real thumbnail rather than a
          // filename. Already exposed on the admin detail response.
          file_path: att.file_path,
          selected: selectedAttachments.some((chosen) => chosen.id === att.id),
        })),
      },
    };
  }

  if (missing.length > 0) {
    const typeLabel = effectiveType === 'enhancement' ? 'Enhancement' : 'Defect';
    return {
      error: `${typeLabel} cannot be submitted. Missing required fields: ${missing.join(', ')}`,
      status: 400,
    };
  }

  const sentAsLabel = effectiveType === 'enhancement' ? 'Enhancement' : 'Defect';

  // A Cleanup Only task has no EasyVista-valid type, so the send-as choice is
  // resolving an incomplete classification rather than overriding a good one.
  // On a FIRST send — no existing ticket, so this record is updated in place
  // and nothing is forked — that resolution is persisted: the task becomes
  // cleanup work tagged with the type it was raised under. A ticket that
  // already has a valid type is never reclassified by sending it.
  const resolvesCleanupOnly = Boolean(source.is_cleanup)
    && (!source.cleanup_tag_type || source.cleanup_tag_type === 'cleanup_only');

  // Resolved BEFORE the outbound call: a missing lookup must not leave an
  // EasyVista ticket created against a record we then failed to tag.
  let cleanupRetagIds = {};
  if (!isResubmissionRequest && resolvesCleanupOnly) {
    const [retagTypeId, retagTagTypeId] = await Promise.all([
      getLookupIdByName(db, 'submission_types', effectiveType),
      getLookupIdByName(db, 'cleanup_tag_types', effectiveType),
    ]);
    if (!retagTypeId || !retagTagTypeId) {
      return {
        error: `Cannot tag this task as ${sentAsLabel}: that value is missing from Manage Metadata. Add it, then submit.`,
        status: 400,
      };
    }
    cleanupRetagIds = { type_id: retagTypeId, cleanup_tag_type_id: retagTagTypeId };
  }

  // Which application's catalog this goes into. Resolved from the ticket's
  // application rather than a single global setting, because the payload's
  // repurposed field names belong to one specific catalog.
  const outgoingApplication = dbModels.Application
    ? await dbModels.Application.findOne({ where: { name: source.application_name }, raw: true })
    : null;

  // Refuse a REAL send into a catalog that was never configured for this
  // application — it would land in whichever application owns the environment's
  // catalog, silently and under the wrong field names.
  //
  // Only on the live path. With EasyVista off, nothing is transmitted, so there
  // is no catalog to land in and nothing to protect: an unconfigured application
  // demonstrates end to end exactly like a configured one, which is what the
  // pre-go-live walkthrough depends on.
  if (easyVistaIsLive()) {
    const catalog = easyVistaCatalogStatus(outgoingApplication);
    if (!catalog.configured) {
      return { error: catalog.reason, status: 400 };
    }
  }

  // EasyVista's requestor/recipient is the admin who pressed send, not the
  // person who reported the ticket.
  const result = await submitToEasyVista(
    { ...source, type: effectiveType },
    { submitter: username, application: outgoingApplication },
  );

  // After the ticket exists, never before — and never fatal, because the ticket
  // is already created by this point.
  const attachmentResult = await sendEasyVistaAttachments(
    result.ticketId,
    selectedAttachments,
    { submitter: username },
  );

  const updatedAt = new Date().toISOString();
  const easyVistaReporter = username || 'Unknown';
  const easyVistaSubmittedBy = `Automatic (System API by ${easyVistaReporter})`;

  // ── First-time submission ──────────────────────────────────────────────
  if (!isResubmissionRequest) {
    const submittedStatusId = await getLookupIdByName(db, 'defect_enhancement_statuses', 'Submitted');
    await Submission.update({
      easyvista_ticket_id: result.ticketId,
      ...(submittedStatusId ? { status_id: submittedStatusId } : {}),
      ...cleanupRetagIds,
      updated_at: updatedAt,
      easyvista_submitted_by: easyVistaSubmittedBy,
    }, {
      where: { id: Number(submission.id) },
    });

    if (resolvesCleanupOnly) {
      await logStatusChange(
        db,
        submission.id,
        `Cleanup Status: Tagged as ${sentAsLabel} on first EasyVista submission (${result.ticketId})`,
        easyVistaSubmittedBy,
        updatedAt,
      );
    }

    if (submission.status !== 'Submitted') {
      await logStatusChange(db, submission.id, 'Submitted', easyVistaSubmittedBy, updatedAt);
    }

    const updated = await getSubmissionByIdWithLookups(db, submission.id);
    emitAdminNotification('submission:submitted-easyvista', mapSubmission(updated));
    scheduleEmbeddingRefresh(Number(submission.id));

    return {
      status: 200,
      body: {
        ticketId: result.ticketId,
        source: result.source,
        resubmission: false,
        attachments: attachmentResult,
        submission: mapSubmission(updated),
      },
    };
  }

  // ── Resubmission (creates a new submission, already set to 'Submitted') ──
  // Resolve and validate every lookup BEFORE inserting, so a missing lookup can
  // never leave behind an orphaned resubmission row with a null status.
  // The new record is what it was sent as. A Cleanup Only task sent as an
  // Enhancement becomes a cleanup tagged Enhancement — it stays cleanup work,
  // but it is no longer un-sendable, so a later re-submit needs no fresh choice.
  const resubmissionCleanupTagType = source.is_cleanup
    ? (source.cleanup_tag_type === 'cleanup_only' || !source.cleanup_tag_type
        ? effectiveType
        : source.cleanup_tag_type)
    : source.cleanup_tag_type;

  const createdLookupIds = await resolveSubmissionLookupIds(db, {
    created_via: 'admin_easyvista_resubmission',
    type: effectiveType,
    application_name: source.application_name,
    status: 'Submitted',
    cleanup_status: source.cleanup_status,
    cleanup_tag_type: resubmissionCleanupTagType,
    enhancement_request_type: source.enhancement_request_type,
    priority_level: source.priority_level,
  });
  const missingLookupFields = collectMissingLookupIds(createdLookupIds, [
    { idKey: 'created_via_id', label: 'Created Via', required: true },
    { idKey: 'type_id', label: 'Type', required: true },
    { idKey: 'application_id', label: 'Application', required: true },
    { idKey: 'status_id', label: 'Status', required: true },
    {
      idKey: 'cleanup_status_id',
      label: 'Cleanup Status',
      required: Boolean(source.is_cleanup) && !isBlank(source.cleanup_status),
    },
    {
      idKey: 'cleanup_tag_type_id',
      label: 'Cleanup Tag Type',
      required: Boolean(source.is_cleanup) && !isBlank(resubmissionCleanupTagType),
    },
    {
      idKey: 'enhancement_request_type_id',
      label: 'Enhancement Request Type',
      required: !isBlank(source.enhancement_request_type),
    },
    {
      idKey: 'priority_level_id',
      label: 'Priority Level',
      required: effectiveType === 'enhancement' && !isBlank(source.priority_level),
    },
  ]);
  if (missingLookupFields.length > 0) {
    return { error: formatMissingLookupError(missingLookupFields), status: 400 };
  }

  const resubmissionInsertColumns = [
    'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
    'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
    'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
    'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_reference', 'duplicate_of',
    'easyvista_ticket_id', 'desired_completion_date', 'impact_details', 'impact_notes',
    'policy_premium_impact', 'direct_dollar_impact', 'policies_affected_count', 'logged_defect',
    'enhancement_request_type_id', 'priority_level_id', 'jira_number', 'release_number', 'release_notes',
    'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id', 'easyvista_submitted_by',
    'is_resubmission', 'resubmission_of_submission_id', 'resubmission_of_easyvista_ticket_id',
    'has_resubmission', 'latest_resubmission_submission_id', 'latest_resubmission_easyvista_ticket_id',
    'is_public', 'is_retired',
  ];
  const resubmissionInsertValues = [
    updatedAt,
    updatedAt,
    createdLookupIds.created_via_id,
    source.created_by,
    source.created_by_email,
    createdLookupIds.type_id,
    createdLookupIds.application_id,
    source.policy_num,
    source.account_num,
    source.transaction_num,
    source.screen_title,
    source.summary_of_issue,
    source.steps_to_reproduce,
    source.what_happened_exact_details,
    source.request,
    source.date_time_of_error,
    createdLookupIds.status_id,
    source.reviewer,
    source.decision_notes,
    source.fingerprint,
    source.duplicate_reference,
    source.duplicate_of,
    result.ticketId,
    source.desired_completion_date,
    source.impact_details,
    source.impact_notes,
    source.policy_premium_impact,
    source.direct_dollar_impact,
    source.policies_affected_count,
    toBooleanSql(source.logged_defect),
    createdLookupIds.enhancement_request_type_id,
    createdLookupIds.priority_level_id,
    source.jira_number,
    source.release_number,
    source.release_notes,
    toBooleanSql(source.is_cleanup),
    createdLookupIds.cleanup_status_id,
    createdLookupIds.cleanup_tag_type_id,
    easyVistaSubmittedBy,
    1,
    submission.id,
    submission.easyvista_ticket_id,
    0,
    null,
    null,
    toBooleanSql(source.is_public),
    toBooleanSql(source.is_retired),
  ];
  const payload = buildInsertPayload(resubmissionInsertColumns, resubmissionInsertValues);
  const createdSubmission = await Submission.create(payload);
  const resubmissionId = Number(createdSubmission.id);

  const existingAttachments = await Attachment.findAll({
    where: { submission_id: Number(submission.id) },
    attributes: ['filename', 'mime_type', 'file_path', 'uploaded_by_role'],
    raw: true,
  });
  for (const attachment of existingAttachments) {
    await Attachment.create({
      submission_id: resubmissionId,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      file_path: attachment.file_path,
      uploaded_at: updatedAt,
      uploaded_by_role: attachment.uploaded_by_role,
    });
  }

  await Submission.update({
    has_resubmission: 1,
    latest_resubmission_submission_id: resubmissionId,
    latest_resubmission_easyvista_ticket_id: result.ticketId,
    updated_at: updatedAt,
  }, {
    where: { id: Number(submission.id) },
  });

  // The original is otherwise untouched by a resubmission — it keeps its own
  // classification, including Cleanup Only. Its history records what went out
  // and as which type; the fork carries the new classification.
  await logStatusChange(
    db,
    submission.id,
    `Resubmission: From (EasyVista ${submission.easyvista_ticket_id}) to (EasyVista ${result.ticketId}) as Submission #${resubmissionId}, sent as ${sentAsLabel}`,
    easyVistaSubmittedBy,
    updatedAt,
  );
  await logStatusChange(
    db,
    resubmissionId,
    `Resubmission: From (EasyVista ${submission.easyvista_ticket_id}) to (EasyVista ${result.ticketId}), Origin Submission #${submission.id}, sent as ${sentAsLabel}`,
    easyVistaSubmittedBy,
    updatedAt,
  );
  await logStatusChange(db, resubmissionId, 'Submitted', easyVistaSubmittedBy, updatedAt);

  const newSubmission = await getSubmissionByIdWithLookups(db, resubmissionId);
  const updatedOriginal = await getSubmissionByIdWithLookups(db, submission.id);

  emitAdminNotification('submission:resubmitted-easyvista', {
    original_submission: mapSubmission(updatedOriginal),
    resubmission: mapSubmission(newSubmission),
  });
  scheduleEmbeddingRefresh(Number(resubmissionId));
  scheduleEmbeddingRefresh(Number(submission.id));

  return {
    status: 200,
    body: {
      ticketId: result.ticketId,
      source: result.source,
      resubmission: true,
      attachments: attachmentResult,
      originalSubmissionId: submission.id,
      submission: mapSubmission(newSubmission),
    },
  };
}

module.exports = {
  ADMIN_SEARCH_FIELDS,
  SUBMISSION_LOOKUP_JOINS,
  SUBMISSION_LOOKUP_SELECT,
  getSubmissionByIdWithLookups,
  listFilteredAdminSubmissions,
  logStatusChange,
  createAdminSubmission,
  updateAdminSubmission,
  resolveCreateVisibility,
  validateBulkVisibilityInput,
  bulkUpdateVisibility,
  validateBulkRetiredInput,
  bulkUpdateRetired,
  submitSubmissionToEasyVista,
};
