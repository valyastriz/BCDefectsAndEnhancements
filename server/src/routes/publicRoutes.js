const express = require('express');
const dbApi = require('../../db');
const { withDb } = require('../helpers/db');
const { buildAllLookupMaps, hydrateRowFromMaps } = require('../helpers/lookups');
const { mapPublicSubmission } = require('../helpers/mappers');
const { getSubmissionByIdWithLookups } = require('../services/submissionService');
const { listRoutings, listRoutingsBySubmissionIds } = require('../services/redirectService');
// The report-request rule, shared with the socket broadcast and the public
// semantic search so the four surfaces cannot drift apart.
const { boardVisibilityFor } = require('../helpers/reportVisibility');
// Shared with the AI search path, which renders the same rows through the same
// StatusBoardRow and needs the same dates under the same stops.
const { deriveStatusTimestamps, groupEventsBySubmissionId } = require('../helpers/statusTimestamps');

const router = express.Router();

router.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});


/**
 * Every submission this caller has said "it happened to me too" on.
 *
 * ONE query for the whole board, keyed on the index
 * `idx_submission_recurrences_reported_by` — not a lookup per row. Retracted
 * reports are excluded: withdrawing one should take the ticket out of your list
 * as well as out of the count.
 *
 * Returns an empty set for an anonymous caller, who has no identity to match.
 */
async function loadMyRecurrenceIds(models, viewerUserId) {
  if (!viewerUserId || !models?.SubmissionRecurrence) return new Set();
  const rows = await models.SubmissionRecurrence.findAll({
    where: { reported_by_user_id: viewerUserId, retracted_at: null },
    attributes: ['submission_id'],
    raw: true,
  }).catch(() => []);
  return new Set(rows.map((row) => Number(row.submission_id)));
}

/**
 * Mark the rows this caller has a stake in, and say WHICH KIND of stake.
 *
 * Two different relationships, kept as two flags rather than one:
 *
 *   is_mine            — I filed this. What it has always meant.
 *   i_reported_this_too — I did not file it, but I said it happened to me.
 *
 * Collapsing them into one `is_mine` would tell somebody they filed a ticket
 * they did not, and the board's row already says "reported by you". Keeping them
 * apart lets the board show a ticket you contributed to WITHOUT claiming it is
 * your report — which is the honest answer, and the one that stops a recurrence
 * disappearing from the reporter's view the moment they log it. That
 * disappearance is precisely what makes somebody file the duplicate next time.
 *
 * Compared server-side; the reporter id itself is an internal field and stays out
 * of the payload (mapPublicSubmission's allow-list is what enforces that).
 *
 * Attached AFTER mapping rather than inside the mapper because both are facts
 * about the VIEWER, not about the row: the socket broadcast reaches every watcher
 * at once and so cannot carry either.
 */
function markOwnership(req, myRecurrenceIds = new Set()) {
  const viewerUserId = Number(req?.session?.user?.id) || null;
  return (row) => ({
    ...mapPublicSubmission(row),
    is_mine: Boolean(viewerUserId) && Number(row.reporter_user_id) === viewerUserId,
    i_reported_this_too: myRecurrenceIds.has(Number(row.id)),
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
    // Filtered immediately after hydration and before anything else reads the
    // set: everything below works from `rows`, so a row dropped here cannot leak
    // through the status events, the hand-off trail, or even as an id.
    const rows = rawRows
      .map((row) => hydrateRowFromMaps(row, lookupMaps))
      .filter(boardVisibilityFor(req));

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const events = SubmissionStatusEvent
      ? await SubmissionStatusEvent.findAll({
        where: { submission_id: ids },
        attributes: ['submission_id', 'status', 'changed_at'],
        raw: true,
      })
      : [];
    const bySubmissionId = groupEventsBySubmissionId(events);

    // The hand-off trail, for the whole page in two queries. The board has
    // always had the markup for it but never the data — only the by-id endpoint
    // sent routings, so "Moved between teams" could not render on the list.
    // `forPublic` is what strips the internal note (mapPublicRouting).
    const routingsBySubmissionId = await listRoutingsBySubmissionIds(dbModels, ids, { forPublic: true });

    const enrichedRows = rows.map((row) => ({
      ...row,
      ...deriveStatusTimestamps(bySubmissionId.get(Number(row.id)) || []),
    }));

    enrichedRows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

    const withOwnership = markOwnership(
      req,
      await loadMyRecurrenceIds(dbModels, Number(req?.session?.user?.id) || null),
    );
    return res.json(enrichedRows.map((row) => {
      const mapped = withOwnership(row);
      // Attached after mapping for the same reason is_mine is: `routings` is not
      // in the allow-list, and a ticket that never moved carries no key at all
      // rather than an empty array.
      const routings = routingsBySubmissionId.get(Number(row.id));
      return routings ? { ...mapped, routings } : mapped;
    }));
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

    // Same rule as the list, and the same answer as a row that does not exist:
    // 404 rather than 403, so guessing ids cannot confirm that a report request
    // with that number is out there.
    if (!submission || !boardVisibilityFor(req)(submission)) {
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

    const myRecurrenceIds = await loadMyRecurrenceIds(
      dbModels,
      Number(req?.session?.user?.id) || null,
    );

    return res.json({
      ...markOwnership(req, myRecurrenceIds)(submission),
      attachments,
      routings,
    });
  });
});

module.exports = router;
