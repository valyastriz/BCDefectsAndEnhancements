// "It happened to me too" — the endpoints.
//
// Thin: every decision lives in services/recurrenceService.js and the pure depth
// resolver it calls. These handlers do auth, shape the request, and hand over.
//
// Two audiences, two guarantees:
//   * the REP routes take a session and return aggregates. They never return a
//     recurrence row, because the rows carry names, notes and policy numbers.
//   * the ADMIN routes return the log, behind ensureAdmin AND the caller's
//     application scope — an admin who cannot read the ticket cannot read who
//     has been hitting it.

const express = require('express');
const dbApi = require('../../db');
const { ensureAdmin, attachViewer } = require('../auth');
const { withDb } = require('../helpers/db');
const { createRateLimiter } = require('../middleware/rateLimit');
const { resolveAdminReadScope, canReadSubmissionRow, canMutateApplication } = require('../services/viewerService');
const { getSubmissionByIdWithLookups } = require('../services/submissionService');
const { mapSubmission, mapPublicSubmission } = require('../helpers/mappers');
const { emitAdminNotification, emitPublicUpdate, publicAudienceFor } = require('../socket');
const {
  getRecurrenceContext,
  createRecurrence,
  listRecurrences,
  markRecurrenceWorkaroundHandled,
  retractRecurrence,
  setRegressionClaim,
} = require('../services/recurrenceService');

const router = express.Router();

// Generous enough for somebody genuinely having a bad morning, tight enough that
// the count cannot be inflated by a script. Same posture as the public search.
const recurrenceWriteLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'You have reported several issues in a short time. Please wait a few minutes and try again.',
});

/** The signed-in caller, or null. Recurrences are never anonymous. */
async function sessionReporter(req) {
  const userId = Number(req?.session?.user?.id) || null;
  if (!userId) return null;
  const models = dbApi.getModels() || {};
  if (!models.User) return null;
  const user = await models.User.findByPk(userId, { raw: true });
  if (!user) return null;
  return {
    id: Number(user.id),
    name: String(user.display_name || user.username || '').trim() || 'Unknown',
  };
}

// ── Rep: what should the sheet ask? ─────────────────────────────────────────
//
// GET, so it is safe to call while the reporter edits the date — the answer
// changes when they do, which is the whole point of the depth-3 gate.
router.get('/api/submissions/:id/recurrence-context', async (req, res) => {
  return withDb(async (db) => {
    const reporter = await sessionReporter(req);
    const context = await getRecurrenceContext(db, req.params.id, {
      occurredAt: req.query.occurredAt || null,
      viewerUserId: reporter?.id || null,
    });
    if (!context) return res.status(404).json({ error: 'Ticket not found' });
    // Whether they may actually POST. Returned rather than inferred client-side
    // so one answer governs the button and the endpoint.
    return res.json({ ...context, can_report: Boolean(reporter) });
  });
});

// ── Rep: record it ──────────────────────────────────────────────────────────
router.post('/api/submissions/:id/recurrences', recurrenceWriteLimiter, async (req, res) => {
  return withDb(async (db) => {
    const reporter = await sessionReporter(req);
    if (!reporter) {
      return res.status(401).json({
        error: 'Sign in to report that this happened to you.',
        authRequired: true,
      });
    }

    const result = await createRecurrence(db, {
      submissionId: req.params.id,
      body: req.body || {},
      reporterUserId: reporter.id,
      reporterName: reporter.name,
    });

    // Depth 0 — they are describing something from before the fix shipped. Not an
    // error they made; the body carries the release date so the client can say so.
    if (result.status === 409) {
      return res.status(409).json({ error: result.error, ...result.body });
    }
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    const updated = await getSubmissionByIdWithLookups(db, result.body.submission_id);
    if (updated) {
      const mapped = mapSubmission(updated);
      emitAdminNotification('submission:recurrence', {
        submission: mapped,
        recurrence_count: mapped.recurrence_count,
        reported_by: reporter.name,
        depth: result.body.depth,
      });
      // Somebody is blocked. Its own event, because it is the only thing here that
      // creates an obligation for a person rather than a number on a row — the
      // admin hook raises a toast and a browser notification for this one.
      if (result.body.workaround_requested) {
        emitAdminNotification('submission:workaround-requested', {
          submission: mapped,
          reported_by: reporter.name,
          blocked_on: String(req.body?.workaround_blocked_on || '').trim().slice(0, 500),
        });
      }
      // The public count changes, so the board and any open search results should
      // move without a reload. Allow-listed, like every public broadcast.
      emitPublicUpdate(mapPublicSubmission(updated), publicAudienceFor(updated));
    }

    return res.status(201).json(result.body);
  });
});

// ── Admin: the log ──────────────────────────────────────────────────────────
router.get('/api/admin/submissions/:id/recurrences', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const submission = await getSubmissionByIdWithLookups(db, req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });

    // Same gate the queue and the detail endpoint use. An admin outside this
    // ticket's application gets the same answer as a stranger.
    const scope = await resolveAdminReadScope(dbApi.getModels() || {}, req.viewer);
    if (!canReadSubmissionRow(scope, submission)) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const rows = await listRecurrences(db, req.params.id, {
      includeRetracted: String(req.query.includeRetracted || '') === 'true',
    });
    return res.json(rows);
  });
});

// ── Admin: close out ONE person's workaround request ────────────────────────
router.patch('/api/admin/recurrences/:id/workaround', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const models = dbApi.getModels() || {};
    const row = models.SubmissionRecurrence
      ? await models.SubmissionRecurrence.findByPk(Number(req.params.id), { raw: true })
      : null;
    if (!row) return res.status(404).json({ error: 'Recurrence not found' });

    const submission = await getSubmissionByIdWithLookups(db, row.submission_id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (!canMutateApplication(req.viewer, submission.application_id, submission.model_type_name || submission.type)) {
      return res.status(403).json({ error: 'You do not administer this application' });
    }

    const result = await markRecurrenceWorkaroundHandled(db, req.params.id, {
      handledBy: req.session?.user?.username || 'admin',
      handled: req.body?.handled !== false,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    const updated = await getSubmissionByIdWithLookups(db, row.submission_id);
    if (updated) emitAdminNotification('submission:recurrence', { submission: mapSubmission(updated) });
    return res.json(result.body);
  });
});

// ── Admin: strike a recurrence (soft) ───────────────────────────────────────
router.patch('/api/admin/recurrences/:id/retract', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const models = dbApi.getModels() || {};
    const row = models.SubmissionRecurrence
      ? await models.SubmissionRecurrence.findByPk(Number(req.params.id), { raw: true })
      : null;
    if (!row) return res.status(404).json({ error: 'Recurrence not found' });

    const submission = await getSubmissionByIdWithLookups(db, row.submission_id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (!canMutateApplication(req.viewer, submission.application_id, submission.model_type_name || submission.type)) {
      return res.status(403).json({ error: 'You do not administer this application' });
    }

    const result = await retractRecurrence(db, req.params.id, {
      retractedBy: req.session?.user?.username || 'admin',
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    const updated = await getSubmissionByIdWithLookups(db, row.submission_id);
    if (updated) {
      emitAdminNotification('submission:recurrence', { submission: mapSubmission(updated) });
      emitPublicUpdate(mapPublicSubmission(updated), publicAudienceFor(updated));
    }
    return res.json(result.body);
  });
});

// ── Admin: rule on a reporter's regression claim ────────────────────────────
router.patch('/api/admin/submissions/:id/regression', ensureAdmin, attachViewer, async (req, res) => {
  return withDb(async (db) => {
    const submission = await getSubmissionByIdWithLookups(db, req.params.id);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    if (!canMutateApplication(req.viewer, submission.application_id, submission.model_type_name || submission.type)) {
      return res.status(403).json({ error: 'You do not administer this application' });
    }

    const result = await setRegressionClaim(db, req.params.id, {
      confirmed: req.body?.confirmed,
      reviewedBy: req.session?.user?.username || 'admin',
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    emitAdminNotification('submission:regression', result.body);
    // The parent's board row says "reported again after the fix", so the public
    // side moves too — and must move when a claim is REJECTED as well, or a
    // withdrawn claim keeps advertising a regression that is not one.
    for (const id of [Number(req.params.id), Number(submission.regression_of_submission_id)]) {
      if (!Number.isFinite(id)) continue;
      // eslint-disable-next-line no-await-in-loop
      const row = await getSubmissionByIdWithLookups(db, id);
      if (row) emitPublicUpdate(mapPublicSubmission(row), publicAudienceFor(row));
    }
    return res.json(result.body);
  });
});

module.exports = router;
