const express = require('express');
const dbApi = require('../../db');
const { withDb } = require('../helpers/db');
const { buildAllLookupMaps, hydrateRowFromMaps } = require('../helpers/lookups');
const { mapSubmission } = require('../helpers/mappers');
const { getSubmissionByIdWithLookups } = require('../services/submissionService');

const router = express.Router();

router.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/api/public/submissions', async (_req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
    if (!Submission) {
      return res.status(500).json({ error: 'Submission model is not initialized' });
    }

    const rawRows = await Submission.findAll({
      where: { is_public: 1 },
      raw: true,
    });

    // Hydrate text fields from FK IDs (DB stores only _id columns, no redundant text columns)
    const lookupMaps = await buildAllLookupMaps(dbModels);
    const rows = rawRows.map((row) => hydrateRowFromMaps(row, lookupMaps));

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const events = SubmissionStatusEvent
      ? await SubmissionStatusEvent.findAll({
        where: { submission_id: ids },
        attributes: ['submission_id', 'status', 'changed_at'],
        raw: true,
      })
      : [];
    const bySubmissionId = new Map();
    for (const event of events) {
      const submissionId = Number(event.submission_id);
      if (!bySubmissionId.has(submissionId)) bySubmissionId.set(submissionId, []);
      bySubmissionId.get(submissionId).push(event);
    }

    const enrichedRows = rows.map((row) => {
      const submissionEvents = bySubmissionId.get(Number(row.id)) || [];
      const sortedEvents = [...submissionEvents].sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
      const latest = sortedEvents[0] || null;
      const maxByStatus = (status) => {
        const matches = sortedEvents.filter((event) => String(event.status || '') === status);
        return matches.length > 0 ? matches.reduce((max, event) => (
          !max || new Date(event.changed_at) > new Date(max) ? event.changed_at : max
        ), null) : null;
      };

      return {
        ...row,
        latest_status_changed_at: latest?.changed_at || null,
        latest_status_value: latest?.status || null,
        submitted_status_at: maxByStatus('Submitted'),
        deployed_status_at: maxByStatus('Deployed'),
        duplicate_status_at: maxByStatus('Duplicate'),
        retired_status_at: maxByStatus('Retired'),
      };
    });

    enrichedRows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return res.json(enrichedRows.map(mapSubmission));
  });
});

router.get('/api/public/submissions/:id', async (req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Attachment = dbModels.Attachment;
    if (!Attachment) {
      return res.status(500).json({ error: 'Attachment model is not available' });
    }
    const submission = await getSubmissionByIdWithLookups(db, req.params.id, { publicOnly: true });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const attachments = await Attachment.findAll({
      where: { submission_id: Number(req.params.id) },
      order: [['uploaded_at', 'DESC']],
      raw: true,
    });

    return res.json({
      ...mapSubmission(submission),
      attachments,
    });
  });
});

module.exports = router;
