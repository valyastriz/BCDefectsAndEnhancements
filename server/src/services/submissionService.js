const dbApi = require('../../db');
const { CLEANUP_TO_SUBMISSION_STATUS } = require('../constants');
const {
  buildAllLookupMaps,
  hydrateRowFromMaps,
  getLookupIdByName,
  getLookupModelByTable,
} = require('../helpers/lookups');
const { mapSubmission } = require('../helpers/mappers');

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

async function listFilteredAdminSubmissions(db, query = {}) {
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
    retiredFilter,
    year,
    inJira,
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

  const createdViaFilter = createdVia ? String(createdVia || '').trim().toLowerCase() : '';
  const lookupCreatedViaId = createdViaFilter
    ? await getLookupIdByName(db, 'submission_sources', createdViaFilter, { lowercase: true })
    : null;

  const containsIgnoreCase = (value, needle) => String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
  const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
  const compareNum = (a, b) => Number(a || 0) - Number(b || 0);
  const compareBool = (a, b) => Number(Boolean(a)) - Number(Boolean(b));

  const rawRows = await Submission.findAll({ raw: true });

  // Augment each row with text names resolved from _id FK columns
  const maps = { statusIdToName, typeIdToName, cleanupTagTypeIdToName, cleanupStatusIdToName, applicationIdToName, enhancementRequestTypeIdToName, priorityLevelIdToName, createdViaIdToName, occurrenceTimeframeIdToName };
  const rows = rawRows.map((row) => hydrateRowFromMaps(row, maps));

  const filteredRows = rows.filter((row) => {
    const rowStatus = String(row.status || '').trim();
    const rowIsCleanup = Boolean(row.is_cleanup);
    const rowCleanupTagType = String(row.cleanup_tag_type || '').trim();

    if (retiredFilter !== 'retired_only' && statusList.length > 0) {
      const statusMatch = normalizedStatuses.includes(rowStatus) && !(rowIsCleanup && rowCleanupTagType === 'cleanup_only');
      const cleanupOnlyMatch = cleanupOnlySelected && rowIsCleanup && rowCleanupTagType === 'cleanup_only';
      const cleanupMarkedMatch = cleanupMarkedSelected && rowIsCleanup;
      if (!(statusMatch || cleanupOnlyMatch || cleanupMarkedMatch)) return false;
    } else if (retiredFilter !== 'retired_only' && normalizedStatus) {
      if (normalizedStatus === 'Cleanup Only') {
        if (!(rowIsCleanup && rowCleanupTagType === 'cleanup_only')) return false;
      } else if (normalizedStatus === 'Cleanup Marked') {
        if (!rowIsCleanup) return false;
      } else if (rowStatus !== normalizedStatus || (rowIsCleanup && rowCleanupTagType === 'cleanup_only')) {
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

    if (search) {
      const searchValue = String(search || '');
      const searchMatch = containsIgnoreCase(row.policy_num, searchValue)
        || containsIgnoreCase(row.account_num, searchValue)
        || containsIgnoreCase(row.summary_of_issue, searchValue);
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

module.exports = {
  SUBMISSION_LOOKUP_JOINS,
  SUBMISSION_LOOKUP_SELECT,
  getSubmissionByIdWithLookups,
  listFilteredAdminSubmissions,
  logStatusChange,
};
