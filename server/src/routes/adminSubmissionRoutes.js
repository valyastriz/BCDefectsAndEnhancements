const express = require('express');
const XLSX = require('xlsx');
const dbApi = require('../../db');
const { ensureAdmin, attachViewer } = require('../auth');
const {
  resolveAdminReadScope,
  canReadSubmissionRow,
  canMutateApplication,
} = require('../services/viewerService');
const { redirectSubmission, listRoutings } = require('../services/redirectService');
const {
  listTimeEntries,
  summarizeTimeEntries,
  listAssignments,
  listAssignableUsers,
} = require('../services/deliveryService');
const { SUBMISSION_TYPE_REPORT } = require('../constants');
const { withDb } = require('../helpers/db');
const { isBlank } = require('../helpers/utils');
const { mapSubmission, mapPublicSubmission, toExportCellValue } = require('../helpers/mappers');
const { emitAdminNotification, emitPublicUpdate, publicAudienceFor } = require('../socket');
const { scheduleEmbeddingRefresh } = require('../services/embeddingIndexService');
const { ADMIN_EXPORT_FIELDS, ADMIN_EXPORT_FIELDS_BY_KEY, EXPORT_FIELD_GROUPS } = require('../helpers/export');
const { buildStatusTimeline } = require('../helpers/timeline');
const { easyVistaCatalogStatus } = require('../helpers/easyVistaPayload');
const { loadApplicationRowById } = require('../helpers/lookups');
const {
  listFilteredAdminSubmissions,
  getSubmissionByIdWithLookups,
  createAdminSubmission,
  updateAdminSubmission,
  bulkUpdateVisibility,
  bulkUpdateRetired,
} = require('../services/submissionService');

const router = express.Router();

// The queue and its export read through the same scope, so what an admin can
// download is exactly what they can see on screen.
router.get('/api/admin/submissions', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const scope = await resolveAdminReadScope(dbApi.getModels() || {}, req.viewer);
    const rows = await listFilteredAdminSubmissions(db, req.query, scope);
    return res.json(rows);
  });
});

router.get('/api/admin/submissions/export-xlsx', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const scope = await resolveAdminReadScope(dbApi.getModels() || {}, req.viewer);
    const rows = await listFilteredAdminSubmissions(db, req.query, scope);
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
    fields: ADMIN_EXPORT_FIELDS.map(({ key, label, group }) => ({ key, label, group })),
    // The groups the dialog draws, in the order it draws them. Sent with the
    // fields so the two cannot disagree about which groups exist.
    groups: EXPORT_FIELD_GROUPS.map(({ key, label }) => ({ key, label })),
  });
});

router.get('/api/admin/submissions/:id', ensureAdmin, attachViewer, async (req, res) => {
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
    // A ticket outside the caller's scope reads as absent rather than forbidden,
    // so the queue cannot be walked by id to learn what other teams are handling.
    const scope = await resolveAdminReadScope(dbModels, req.viewer);
    if (!submission || !canReadSubmissionRow(scope, submission)) {
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
    // The custody chain, notes included — this side of the boundary is admins
    // only. The public detail route gets the stripped version.
    const routings = await listRoutings(dbModels, submissionId);

    // The Delivery pane's three lists. Only fetched for a report request: on a
    // defect they would be three empty arrays and three pointless queries.
    const isReportRequest = String(submission.model_type_name || '').toLowerCase()
      === SUBMISSION_TYPE_REPORT;
    const timeEntries = isReportRequest ? await listTimeEntries(submissionId) : [];
    const assignments = isReportRequest ? await listAssignments(submissionId) : [];
    const assignableUsers = isReportRequest
      ? await listAssignableUsers(submission.application_id)
      : [];

    // Whether this ticket can be handed to the Service Desk at all, answered HERE
    // rather than when the send is previewed.
    //
    // The preview already reported it, but the preview only runs once the admin has
    // pressed the button — so an application nothing is wired up to offered a live
    // Send that failed on click. The button is disabled with this reason instead.
    // Skipped for a report request, which is never handed off and has no button.
    //
    // Same `easyVistaCatalogStatus` call the send itself makes, so the affordance
    // and the refusal cannot drift apart. `loadApplicationRowById` tolerates a
    // database without the catalog columns (see helpers/lookups.js), which reads as
    // "not configured" — fail closed, matching the send.
    let easyvista_catalog = null;
    if (!isReportRequest) {
      const applicationRow = await loadApplicationRowById(
        dbModels.Application,
        submission.application_id,
      );
      const status = easyVistaCatalogStatus(applicationRow);
      easyvista_catalog = {
        configured: status.configured,
        demoOnly: status.demoOnly,
        reason: status.reason,
      };
    }

    return res.json({
      ...mapSubmission(submission),
      attachments,
      status_events: timeline,
      routings,
      time_entries: timeEntries,
      // SUM(hours) and the per-person split, computed here and stored nowhere.
      ...summarizeTimeEntries(timeEntries),
      assignments,
      assignable_users: assignableUsers,
      // Null for a report request, which has no hand-off button to describe.
      easyvista_catalog,
      // Whether THIS caller may still change it. A ticket they handed on stays
      // readable and must render read-only rather than offering dead controls.
      // Type-scoped: an analyst granted only report requests reads a defect and
      // gets the same read-only form as a past owner.
      can_edit: canMutateApplication(
        req.viewer,
        submission.application_id,
        submission.model_type_name || submission.type,
      ),
    });
  });
});

router.post('/api/admin/submissions', ensureAdmin, attachViewer, async (req, res) => {
  const body = req.body || {};
  if (isBlank(body.created_by)) {
    return res.status(400).json({ error: 'Requester Name is required' });
  }
  if (isBlank(body.summary_of_issue)) {
    return res.status(400).json({ error: 'Summary of Issue is required' });
  }

  return withDb(async (db) => {
    const result = await createAdminSubmission(db, {
      body,
      username: req.session?.user?.username,
      viewer: req.viewer,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(result.status).json(result.body);
  });
});

// Static path — registered before the PUT `/:id` param route (different method, so
// it can't be captured either way) so an admin can toggle visibility on many
// tickets at once. Reuses the per-row update path for socket + embedding parity.
router.post('/api/admin/submissions/bulk-visibility', ensureAdmin, attachViewer, async (req, res) => {
  const body = req.body || {};

  return withDb(async (db) => {
    const result = await bulkUpdateVisibility(db, {
      body,
      username: req.session?.user?.username,
      viewer: req.viewer,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(result.status).json(result.body);
  });
});

// Same registration story as bulk-visibility above. Retires or unretires many
// tickets at once via the per-row update path, so status-history logging
// ("Retired"/"Unretired"), socket emits, and embedding scheduling match the
// single-ticket retire action exactly.
router.post('/api/admin/submissions/bulk-retire', ensureAdmin, attachViewer, async (req, res) => {
  const body = req.body || {};

  return withDb(async (db) => {
    const result = await bulkUpdateRetired(db, {
      body,
      username: req.session?.user?.username,
      viewer: req.viewer,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(result.status).json(result.body);
  });
});

// Hand a ticket to another application's queue. The ticket moves, lands as New,
// and the sending team keeps reading it while losing the ability to change it —
// see services/redirectService.js for why each of those is the case.
router.post('/api/admin/submissions/:id/redirect', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const result = await redirectSubmission(db, {
      id: req.params.id,
      toApplicationId: req.body?.toApplicationId,
      note: req.body?.note,
      viewer: req.viewer,
      username: req.session?.user?.username,
      models: dbModels,
      sequelize: dbModels.Submission?.sequelize,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    // Both queues need to see it move: it leaves one board and appears on the
    // other, and neither admin should have to refresh to find out.
    const moved = await getSubmissionByIdWithLookups(db, Number(req.params.id));
    emitAdminNotification('submission:redirected', mapSubmission(moved));
    if (moved?.is_public) {
      // The reporter follows their own ticket across the hand-off. The note is
      // not part of this payload and must never become part of it.
      emitPublicUpdate(mapPublicSubmission(moved), publicAudienceFor(moved));
    }
    scheduleEmbeddingRefresh(Number(req.params.id));

    return res.status(result.status).json(result.body);
  });
});

router.put('/api/admin/submissions/:id', ensureAdmin, attachViewer, async (req, res) => {
  const body = req.body || {};

  return withDb(async (db) => {
    const result = await updateAdminSubmission(db, {
      id: req.params.id,
      body,
      username: req.session?.user?.username,
      viewer: req.viewer,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error, ...(result.body || {}) });
    }
    return res.status(result.status).json(result.body);
  });
});

module.exports = router;
