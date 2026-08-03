const express = require('express');
const dbApi = require('../../db');
const { withDb } = require('../helpers/db');
const { buildAllLookupMaps, hydrateRowFromMaps } = require('../helpers/lookups');
const { mapPublicSubmission } = require('../helpers/mappers');
const { getSubmissionByIdWithLookups } = require('../services/submissionService');
const { listRoutings } = require('../services/redirectService');

const router = express.Router();

router.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// A triager changing the status writes the event as
// "Defect/Enhancement Status: Deployed", while the create, EasyVista-send and
// retire paths write the bare name. The board's per-status timestamps matched
// only the bare form, so a status reached through the admin form — which is how
// Approved, Deployed and Duplicate are ALWAYS reached — never produced a date.
// Reading both shapes fixes the four existing timestamps as well as the new one.
const STATUS_EVENT_PREFIX = 'Defect/Enhancement Status: ';

function normalizeEventStatus(value) {
  const text = String(value || '').trim();
  return text.startsWith(STATUS_EVENT_PREFIX) ? text.slice(STATUS_EVENT_PREFIX.length) : text;
}

/**
 * Mark the rows this caller filed.
 *
 * Compared server-side against `reporter_user_id` and returned as a bare
 * boolean — the reporter id itself is an internal field and stays out of the
 * payload (mapPublicSubmission's allow-list is what enforces that). Always false
 * for an anonymous caller, who has no identity to match against.
 *
 * Attached AFTER mapping rather than inside the mapper because it is a fact
 * about the viewer, not about the row: the socket broadcast reaches every
 * watcher at once and so cannot carry it.
 */
function markOwnership(req) {
  const viewerUserId = Number(req?.session?.user?.id) || null;
  return (row) => ({
    ...mapPublicSubmission(row),
    is_mine: Boolean(viewerUserId) && Number(row.reporter_user_id) === viewerUserId,
  });
}

router.get('/api/public/submissions', async (req, res) => {
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
        const matches = sortedEvents.filter((event) => normalizeEventStatus(event.status) === status);
        return matches.length > 0 ? matches.reduce((max, event) => (
          !max || new Date(event.changed_at) > new Date(max) ? event.changed_at : max
        ), null) : null;
      };

      return {
        ...row,
        latest_status_changed_at: latest?.changed_at || null,
        latest_status_value: latest?.status || null,
        // The board draws a four-stop track — Reported, Approved, In EasyVista,
        // Deployed — and needs the date under each stop it has reached.
        approved_status_at: maxByStatus('Approved'),
        submitted_status_at: maxByStatus('Submitted'),
        deployed_status_at: maxByStatus('Deployed'),
        duplicate_status_at: maxByStatus('Duplicate'),
        retired_status_at: maxByStatus('Retired'),
      };
    });

    enrichedRows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return res.json(enrichedRows.map(markOwnership(req)));
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

    // The reporter follows their ticket across a hand-off, so they see THAT it
    // moved, when, and between which teams. `forPublic` strips the note — it is
    // triage talk between admins and can name colleagues or judge their work.
    const routings = await listRoutings(dbModels, Number(req.params.id), { forPublic: true });

    return res.json({
      ...markOwnership(req)(submission),
      attachments,
      routings,
    });
  });
});

module.exports = router;
