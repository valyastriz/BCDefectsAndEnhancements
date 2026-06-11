const express = require('express');
const XLSX = require('xlsx');
const dbApi = require('../../db');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { isBlank } = require('../helpers/utils');
const { mapSubmission, toExportCellValue } = require('../helpers/mappers');
const { ADMIN_EXPORT_FIELDS, ADMIN_EXPORT_FIELDS_BY_KEY } = require('../helpers/export');
const { buildStatusTimeline } = require('../helpers/timeline');
const {
  listFilteredAdminSubmissions,
  getSubmissionByIdWithLookups,
  createAdminSubmission,
  updateAdminSubmission,
} = require('../services/submissionService');

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
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(result.status).json(result.body);
  });
});

router.put('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  const body = req.body || {};

  return withDb(async (db) => {
    const result = await updateAdminSubmission(db, {
      id: req.params.id,
      body,
      username: req.session?.user?.username,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error, ...(result.body || {}) });
    }
    return res.status(result.status).json(result.body);
  });
});

module.exports = router;
