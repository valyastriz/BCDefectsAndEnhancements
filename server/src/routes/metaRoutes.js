const express = require('express');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { toBooleanSql } = require('../helpers/utils');
const {
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
} = require('../helpers/lookups');

const router = express.Router();

router.get('/api/meta/options', async (_req, res) => {
  return withDb(async (db) => {
    const submissionTypes = await getSubmissionTypes(db);
    const defectEnhancementStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const defectEnhancementStatusesWithRetired = await getDefectEnhancementStatuses(db, { includeRetired: true });
    const cleanupStatuses = await getCleanupStatuses(db);
    const cleanupTagTypes = await getCleanupTagTypes(db);
    const applications = await getApplications(db);
    const enhancementRequestTypes = await getEnhancementRequestTypes(db);
    const priorityLevels = await getPriorityLevels(db);
    const submissionSources = await getSubmissionSources(db);

    return res.json({
      submissionTypes,
      defectEnhancementStatuses,
      defectEnhancementStatusesWithRetired,
      cleanupStatuses,
      cleanupTagTypes,
      applications,
      enhancementRequestTypes,
      priorityLevels,
      submissionSources,
    });
  });
});

router.get('/api/admin/meta/options', ensureAdmin, async (_req, res) => {
  return withDb(async (db) => {
    const mapRow = (row, hasRetiredFlag) => ({
      id: Number(row.id),
      name: String(row.name || ''),
      sortOrder: Number(row.sort_order || 0),
      isActive: Boolean(row.is_active),
      ...(hasRetiredFlag ? { isRetired: Boolean(row.is_retired) } : {}),
    });

    const fetchRows = async (categoryKey) => {
      const category = resolveLookupCategory(categoryKey);
      if (!category) return [];
      const LookupModel = resolveLookupModel(category);
      if (!LookupModel) {
        throw new Error(`Lookup model is not initialized for ${category.key}`);
      }
      const rows = await LookupModel.findAll({
        attributes: ['id', 'name', 'sort_order', 'is_active', ...(category.hasRetiredFlag ? ['is_retired'] : [])],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
        raw: true,
      });
      return (rows || []).map((row) => ({
        ...mapRow(row, category.hasRetiredFlag),
      }));
    };

    return res.json({
      statuses: await fetchRows('statuses'),
      types: await fetchRows('types'),
      cleanupStatuses: await fetchRows('cleanup-statuses'),
      cleanupTagTypes: await fetchRows('cleanup-tag-types'),
      applications: await fetchRows('applications'),
      enhancementRequestTypes: await fetchRows('enhancement-request-types'),
      priorityLevels: await fetchRows('priority-levels'),
      submissionSources: await fetchRows('submission-sources'),
      occurrenceTimeframes: await fetchRows('occurrence-timeframes'),
    });
  });
});

router.post('/api/admin/meta/:category', ensureAdmin, async (req, res) => {
  const category = resolveLookupCategory(req.params.category);
  if (!category) {
    return res.status(400).json({ error: 'Invalid metadata category' });
  }

  return withDb(async (db) => {
    const LookupModel = resolveLookupModel(category);
    if (!LookupModel) {
      return res.status(500).json({ error: `Lookup model is not initialized for ${category.key}` });
    }
    const normalizedName = category.normalize(req.body?.name);
    if (!normalizedName) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const existing = (await LookupModel.findAll({ attributes: ['id', 'name'], raw: true })).find(
      (row) => String(row.name || '').trim().toLowerCase() === normalizedName.toLowerCase(),
    );
    if (existing) {
      return res.status(409).json({ error: 'Value already exists' });
    }

    const nextSort = ((await LookupModel.findAll({ attributes: ['sort_order'], raw: true }))
      .reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0) + 1);
    const isRetired = category.hasRetiredFlag && Boolean(req.body?.isRetired);

    const created = (await LookupModel.create({
      name: normalizedName,
      sort_order: nextSort,
      is_active: 1,
      ...(category.hasRetiredFlag ? { is_retired: toBooleanSql(isRetired) } : {}),
    })).toJSON();

    return res.status(201).json({
      id: Number(created.id),
      name: String(created.name || ''),
      sortOrder: Number(created.sort_order || 0),
      isActive: Boolean(created.is_active),
      ...(category.hasRetiredFlag ? { isRetired: Boolean(created.is_retired) } : {}),
    });
  });
});

router.put('/api/admin/meta/:category/:id', ensureAdmin, async (req, res) => {
  const category = resolveLookupCategory(req.params.category);
  if (!category) {
    return res.status(400).json({ error: 'Invalid metadata category' });
  }

  const recordId = Number.parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(recordId) || recordId <= 0) {
    return res.status(400).json({ error: 'Invalid metadata id' });
  }

  return withDb(async (db) => {
    const LookupModel = resolveLookupModel(category);
    if (!LookupModel) {
      return res.status(500).json({ error: `Lookup model is not initialized for ${category.key}` });
    }
    const existing = await LookupModel.findByPk(recordId, { raw: true });
    if (!existing) {
      return res.status(404).json({ error: 'Metadata entry not found' });
    }

    const isProtectedRetiredStatus = category.key === 'statuses'
      && (Boolean(existing.is_retired) || String(existing.name || '').trim().toLowerCase() === 'retired');
    if (isProtectedRetiredStatus) {
      return res.status(400).json({ error: 'Retired status is system-protected and cannot be modified' });
    }

    const nextNameRaw = Object.prototype.hasOwnProperty.call(req.body || {}, 'name')
      ? category.normalize(req.body?.name)
      : String(existing.name || '');
    if (!nextNameRaw) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const duplicate = (await LookupModel.findAll({ attributes: ['id', 'name'], raw: true })).find(
      (row) => Number(row.id) !== recordId
        && String(row.name || '').trim().toLowerCase() === nextNameRaw.toLowerCase(),
    );
    if (duplicate) {
      return res.status(409).json({ error: 'Value already exists' });
    }

    const nextIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'isActive')
      ? toBooleanSql(Boolean(req.body?.isActive))
      : toBooleanSql(Boolean(existing.is_active));
    const nextSortOrder = Object.prototype.hasOwnProperty.call(req.body || {}, 'sortOrder')
      ? Number(req.body?.sortOrder || 0)
      : Number(existing.sort_order || 0);
    const nextIsRetired = category.hasRetiredFlag
      ? (Object.prototype.hasOwnProperty.call(req.body || {}, 'isRetired')
        ? toBooleanSql(Boolean(req.body?.isRetired))
        : toBooleanSql(Boolean(existing.is_retired)))
      : null;

    const updatePayload = {
      name: nextNameRaw,
      sort_order: nextSortOrder,
      is_active: nextIsActive,
      ...(category.hasRetiredFlag ? { is_retired: nextIsRetired } : {}),
    };

    await LookupModel.update(updatePayload, { where: { id: recordId } });

    const updated = await LookupModel.findByPk(recordId, {
      attributes: ['id', 'name', 'sort_order', 'is_active', ...(category.hasRetiredFlag ? ['is_retired'] : [])],
      raw: true,
    });

    return res.json({
      id: Number(updated.id),
      name: String(updated.name || ''),
      sortOrder: Number(updated.sort_order || 0),
      isActive: Boolean(updated.is_active),
      ...(category.hasRetiredFlag ? { isRetired: Boolean(updated.is_retired) } : {}),
    });
  });
});

router.post('/api/admin/meta/:category/reorder', ensureAdmin, async (req, res) => {
  const category = resolveLookupCategory(req.params.category);
  if (!category) {
    return res.status(400).json({ error: 'Invalid metadata category' });
  }

  const orderedIds = Array.isArray(req.body?.orderedIds)
    ? req.body.orderedIds.map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isFinite(value) && value > 0)
    : [];

  if (orderedIds.length === 0) {
    return res.status(400).json({ error: 'orderedIds is required' });
  }

  return withDb(async (db) => {
    const LookupModel = resolveLookupModel(category);
    if (!LookupModel) {
      return res.status(500).json({ error: `Lookup model is not initialized for ${category.key}` });
    }
    const rows = await LookupModel.findAll({
      attributes: ['id'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const existingIds = rows.map((row) => Number(row.id));
    const existingSet = new Set(existingIds);

    for (const idValue of orderedIds) {
      if (!existingSet.has(idValue)) {
        return res.status(400).json({ error: `Unknown metadata id: ${idValue}` });
      }
    }

    const remaining = existingIds.filter((idValue) => !orderedIds.includes(idValue));
    const finalOrder = [...orderedIds, ...remaining];

    for (let index = 0; index < finalOrder.length; index += 1) {
      await LookupModel.update({ sort_order: index + 1 }, { where: { id: finalOrder[index] } });
    }

    const refreshed = await LookupModel.findAll({
      attributes: ['id', 'name', 'sort_order', 'is_active', ...(category.hasRetiredFlag ? ['is_retired'] : [])],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });

    return res.json(
      refreshed.map((row) => ({
        id: Number(row.id),
        name: String(row.name || ''),
        sortOrder: Number(row.sort_order || 0),
        isActive: Boolean(row.is_active),
        ...(category.hasRetiredFlag ? { isRetired: Boolean(row.is_retired) } : {}),
      })),
    );
  });
});

module.exports = router;
