const dbApi = require('../../db');
const {
  DEFAULT_DEFECT_ENHANCEMENT_STATUSES,
  DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED,
  RETIRED_STATUS,
  DEFAULT_SUBMISSION_TYPES,
  DEFAULT_APPLICATIONS,
  DEFAULT_ENHANCEMENT_REQUEST_TYPES,
  DEFAULT_PRIORITY_LEVELS,
  DEFAULT_SUBMISSION_SOURCES,
  DEFAULT_CLEANUP_STATUSES,
  DEFAULT_CLEANUP_TAG_TYPES,
  LOOKUP_TABLES,
} = require('../constants');

// Build a single id→name map from a lookup model
async function buildIdNameMap(Model) {
  if (!Model) return new Map();
  try {
    const lookupRows = await Model.findAll({ attributes: ['id', 'name'], raw: true });
    return new Map(lookupRows.map((r) => [Number(r.id), String(r.name || '').trim()]));
  } catch { return new Map(); }
}

// Load all lookup id→name maps in parallel from DB models
async function buildAllLookupMaps(dbModels) {
  const [
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  ] = await Promise.all([
    buildIdNameMap(dbModels.DefectEnhancementStatus),
    buildIdNameMap(dbModels.SubmissionType),
    buildIdNameMap(dbModels.CleanupTagType),
    buildIdNameMap(dbModels.CleanupStatus),
    buildIdNameMap(dbModels.Application),
    buildIdNameMap(dbModels.EnhancementRequestType),
    buildIdNameMap(dbModels.PriorityLevel),
    buildIdNameMap(dbModels.SubmissionSource),
    buildIdNameMap(dbModels.OccurrenceTimeframe),
  ]);
  return {
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  };
}

// Augment a raw Submission row with text names resolved from FK _id columns
function hydrateRowFromMaps(row, maps) {
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
  } = maps;
  return {
    ...row,
    status: statusIdToName.get(Number(row.status_id)) || '',
    type: typeIdToName.get(Number(row.type_id)) || '',
    cleanup_tag_type: cleanupTagTypeIdToName.get(Number(row.cleanup_tag_type_id)) || '',
    cleanup_status: cleanupStatusIdToName.get(Number(row.cleanup_status_id)) || '',
    application_name: applicationIdToName.get(Number(row.application_id)) || '',
    enhancement_request_type: enhancementRequestTypeIdToName.get(Number(row.enhancement_request_type_id)) || '',
    priority_level: priorityLevelIdToName.get(Number(row.priority_level_id)) || '',
    created_via: createdViaIdToName.get(Number(row.created_via_id)) || '',
    occurrence_timeframe: occurrenceTimeframeIdToName.get(Number(row.occurrence_timeframe_id)) || '',
  };
}

async function getLookupIdByName(db, table, value, { lowercase = false } = {}) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;

  const dbModels = dbApi.getModels() || {};
  const tableToModel = {
    submission_sources: dbModels.SubmissionSource,
    submission_types: dbModels.SubmissionType,
    applications: dbModels.Application,
    defect_enhancement_statuses: dbModels.DefectEnhancementStatus,
    cleanup_statuses: dbModels.CleanupStatus,
    cleanup_tag_types: dbModels.CleanupTagType,
    enhancement_request_types: dbModels.EnhancementRequestType,
    priority_levels: dbModels.PriorityLevel,
    occurrence_timeframes: dbModels.OccurrenceTimeframe,
  };

  const model = tableToModel[table];
  if (!model) {
    throw new Error(`Lookup model not initialized for ${table}`);
  }
  const rows = await model.findAll({ attributes: ['id', 'name'], raw: true });
  const target = lowercase ? normalizedValue.toLowerCase() : normalizedValue;
  const match = rows.find((row) => {
    const candidate = String(row.name || '').trim();
    return lowercase ? candidate.toLowerCase() === target : candidate === target;
  });
  return match?.id ? Number(match.id) : null;
}

function getLookupModelByTable(table) {
  const dbModels = dbApi.getModels() || {};
  const tableToModel = {
    submission_sources: dbModels.SubmissionSource,
    submission_types: dbModels.SubmissionType,
    applications: dbModels.Application,
    defect_enhancement_statuses: dbModels.DefectEnhancementStatus,
    cleanup_statuses: dbModels.CleanupStatus,
    cleanup_tag_types: dbModels.CleanupTagType,
    enhancement_request_types: dbModels.EnhancementRequestType,
    priority_levels: dbModels.PriorityLevel,
    occurrence_timeframes: dbModels.OccurrenceTimeframe,
  };
  return tableToModel[table] || null;
}

async function resolveSubmissionLookupIds(db, payload) {
  return {
    created_via_id: await getLookupIdByName(db, 'submission_sources', payload.created_via, { lowercase: true }),
    type_id: await getLookupIdByName(db, 'submission_types', payload.type, { lowercase: true }),
    application_id: await getLookupIdByName(db, 'applications', payload.application_name),
    status_id: await getLookupIdByName(db, 'defect_enhancement_statuses', payload.status),
    cleanup_status_id: await getLookupIdByName(db, 'cleanup_statuses', payload.cleanup_status),
    cleanup_tag_type_id: await getLookupIdByName(db, 'cleanup_tag_types', payload.cleanup_tag_type, { lowercase: true }),
    enhancement_request_type_id: await getLookupIdByName(db, 'enhancement_request_types', payload.enhancement_request_type),
    priority_level_id: await getLookupIdByName(db, 'priority_levels', payload.priority_level),
  };
}

// Hydrate text fields from FK IDs — the DB stores only _id columns, no redundant text columns.
async function resolveExistingLookupFields(existing) {
  const dbModels = dbApi.getModels() || {};

  async function getNameById(model, id, { lowercase = false } = {}) {
    if (!id || !model) return null;
    const row = await model.findByPk(Number(id), { attributes: ['name'], raw: true });
    const name = row?.name ? String(row.name).trim() : null;
    return name && lowercase ? name.toLowerCase() : name;
  }

  const [type, status, cleanupStatus, cleanupTagType, createdVia, applicationName, enhancementRequestType, priorityLevel, occurrenceTimeframe] = await Promise.all([
    getNameById(dbModels.SubmissionType, existing.type_id, { lowercase: true }),
    getNameById(dbModels.DefectEnhancementStatus, existing.status_id),
    getNameById(dbModels.CleanupStatus, existing.cleanup_status_id),
    getNameById(dbModels.CleanupTagType, existing.cleanup_tag_type_id, { lowercase: true }),
    getNameById(dbModels.SubmissionSource, existing.created_via_id, { lowercase: true }),
    getNameById(dbModels.Application, existing.application_id),
    getNameById(dbModels.EnhancementRequestType, existing.enhancement_request_type_id),
    getNameById(dbModels.PriorityLevel, existing.priority_level_id),
    getNameById(dbModels.OccurrenceTimeframe, existing.occurrence_timeframe_id),
  ]);

  return {
    ...existing,
    type: type ?? null,
    status: status ?? null,
    cleanup_status: cleanupStatus ?? null,
    cleanup_tag_type: cleanupTagType ?? null,
    created_via: createdVia ?? null,
    application_name: applicationName ?? null,
    enhancement_request_type: enhancementRequestType ?? null,
    priority_level: priorityLevel ?? null,
    occurrence_timeframe: occurrenceTimeframe ?? null,
  };
}

function collectMissingLookupIds(lookupIds, checks = []) {
  return checks
    .filter((check) => check?.required)
    .filter((check) => !lookupIds?.[check.idKey])
    .map((check) => check.label);
}

function formatMissingLookupError(missingFields) {
  return `Unresolved metadata values for: ${missingFields.join(', ')}. Update metadata options and retry.`;
}

function resolveLookupCategory(categoryParam) {
  const key = String(categoryParam || '').trim().toLowerCase();
  return LOOKUP_TABLES[key] ? { key, ...LOOKUP_TABLES[key] } : null;
}

function resolveLookupModel(category) {
  if (!category?.modelName) return null;
  const dbModels = dbApi.getModels() || {};
  return dbModels[category.modelName] || null;
}

async function getDefectEnhancementStatuses(db, { includeRetired = false } = {}) {
  try {
    const dbModels = dbApi.getModels() || {};
    const DefectEnhancementStatus = dbModels.DefectEnhancementStatus;
    if (!DefectEnhancementStatus) throw new Error('DefectEnhancementStatus model is not initialized');
    const rows = await DefectEnhancementStatus.findAll({
      where: { is_active: 1 },
      attributes: ['name', 'is_retired'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    if (names.length === 0) {
      return includeRetired
        ? [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED]
        : [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES];
    }
    if (includeRetired) {
      return names;
    }
    return (rows || [])
      .filter((row) => !Boolean(row.is_retired) && String(row.name || '').trim().toLowerCase() !== RETIRED_STATUS.toLowerCase())
      .map((row) => String(row.name || '').trim())
      .filter(Boolean);
  } catch {
    return includeRetired
      ? [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED]
      : [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES];
  }
}

async function getSubmissionTypes(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const SubmissionType = dbModels.SubmissionType;
    if (!SubmissionType) throw new Error('SubmissionType model is not initialized');
    const rows = await SubmissionType.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_SUBMISSION_TYPES];
  } catch {
    return [...DEFAULT_SUBMISSION_TYPES];
  }
}

async function getCleanupStatuses(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const CleanupStatus = dbModels.CleanupStatus;
    if (!CleanupStatus) throw new Error('CleanupStatus model is not initialized');
    const rows = await CleanupStatus.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_CLEANUP_STATUSES];
  } catch {
    return [...DEFAULT_CLEANUP_STATUSES];
  }
}

async function getCleanupTagTypes(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const CleanupTagType = dbModels.CleanupTagType;
    if (!CleanupTagType) throw new Error('CleanupTagType model is not initialized');
    const rows = await CleanupTagType.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_CLEANUP_TAG_TYPES];
  } catch {
    return [...DEFAULT_CLEANUP_TAG_TYPES];
  }
}

async function getApplications(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const Application = dbModels.Application;
    if (!Application) throw new Error('Application model is not initialized');
    const rows = await Application.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_APPLICATIONS];
  } catch {
    return [...DEFAULT_APPLICATIONS];
  }
}

async function getEnhancementRequestTypes(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const EnhancementRequestType = dbModels.EnhancementRequestType;
    if (!EnhancementRequestType) throw new Error('EnhancementRequestType model is not initialized');
    const rows = await EnhancementRequestType.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_ENHANCEMENT_REQUEST_TYPES];
  } catch {
    return [...DEFAULT_ENHANCEMENT_REQUEST_TYPES];
  }
}

async function getPriorityLevels(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const PriorityLevel = dbModels.PriorityLevel;
    if (!PriorityLevel) throw new Error('PriorityLevel model is not initialized');
    const rows = await PriorityLevel.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_PRIORITY_LEVELS];
  } catch {
    return [...DEFAULT_PRIORITY_LEVELS];
  }
}

async function getSubmissionSources(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const SubmissionSource = dbModels.SubmissionSource;
    if (!SubmissionSource) throw new Error('SubmissionSource model is not initialized');
    const rows = await SubmissionSource.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_SUBMISSION_SOURCES];
  } catch {
    return [...DEFAULT_SUBMISSION_SOURCES];
  }
}

module.exports = {
  buildIdNameMap,
  buildAllLookupMaps,
  hydrateRowFromMaps,
  getLookupIdByName,
  getLookupModelByTable,
  resolveSubmissionLookupIds,
  resolveExistingLookupFields,
  collectMissingLookupIds,
  formatMissingLookupError,
  resolveLookupCategory,
  resolveLookupModel,
  getDefectEnhancementStatuses,
  getSubmissionTypes,
  getCleanupStatuses,
  getCleanupTagTypes,
  getApplications,
  getEnhancementRequestTypes,
  getPriorityLevels,
  getSubmissionSources,
};
