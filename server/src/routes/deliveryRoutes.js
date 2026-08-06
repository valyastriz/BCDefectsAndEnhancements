// Hours, and the throughput page's numbers.
//
// Hours get their own endpoints rather than riding on the submission save for a
// specific reason: an entry is its own row with its own author, and the ticket
// save carries an optimistic-concurrency token (`updated_at`, compared as a
// string) that logging time has no business bumping. Two analysts with the same
// request open would otherwise 409 each other over hours that do not conflict.
const express = require('express');
const dbApi = require('../../db');
const { ensureAdmin, attachViewer } = require('../auth');
const { withDb } = require('../helpers/db');
const {
  canMutateApplication,
  canManageApplication,
  canReadApplication,
} = require('../services/viewerService');
const { getLookupIdByName } = require('../helpers/lookups');
const {
  listTimeEntries,
  summarizeTimeEntries,
  addTimeEntry,
  deleteTimeEntry,
  getThroughput,
  dayOf,
} = require('../services/deliveryService');
const { SUBMISSION_TYPE_REPORT } = require('../constants');
const { emitAdminNotification } = require('../socket');

const router = express.Router();

/**
 * The ticket an hours entry hangs off, and whether this caller may touch it.
 *
 * Authorised against the SUBMISSION, never the entry id: the entry carries no
 * application of its own, and a missing parent is refused rather than treated as
 * unowned. Same rule and same shape as attachmentRoutes.
 */
async function loadWritableRequest(req, res) {
  const models = dbApi.getModels() || {};
  const Submission = models.Submission;
  if (!Submission) {
    res.status(500).json({ error: 'Submission model is not available' });
    return null;
  }
  const submission = await Submission.findByPk(Number(req.params.id), { raw: true });
  if (!submission) {
    res.status(404).json({ error: 'Submission not found' });
    return null;
  }
  const reportTypeId = await getLookupIdByName(null, 'submission_types', SUBMISSION_TYPE_REPORT, {
    lowercase: true,
  });
  // Hours belong to report requests. Offering them on a defect would create a
  // number the throughput page would then have to decide whether to count.
  if (Number(submission.type_id) !== Number(reportTypeId)) {
    res.status(400).json({ error: 'Hours are logged against report requests' });
    return null;
  }
  if (!canMutateApplication(req.viewer, submission.application_id, SUBMISSION_TYPE_REPORT)) {
    res.status(403).json({ error: 'You do not administer this application' });
    return null;
  }
  return submission;
}

router.post(
  '/api/admin/submissions/:id/time-entries',
  ensureAdmin,
  attachViewer,
  async (req, res) => withDb(async () => {
    const submission = await loadWritableRequest(req, res);
    if (!submission) return undefined;

    const result = await addTimeEntry(submission.id, {
      // The session's answer, never the payload's. Accepting a user id from the
      // body would let anyone log time against anybody — and this is the number
      // the throughput page reports on.
      userId: req.viewer?.user?.id,
      hours: req.body?.hours,
      workedOn: req.body?.worked_on,
      note: req.body?.note,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });

    const entries = await listTimeEntries(submission.id);
    // The queue shows a request's total, and two analysts with it open should see
    // each other's hours appear.
    emitAdminNotification('submission:time-entries', {
      submission_id: Number(submission.id),
      ...summarizeTimeEntries(entries),
    });
    return res.status(201).json({ entries, ...summarizeTimeEntries(entries) });
  }),
);

router.delete(
  '/api/admin/submissions/:id/time-entries/:entryId',
  ensureAdmin,
  attachViewer,
  async (req, res) => withDb(async () => {
    const submission = await loadWritableRequest(req, res);
    if (!submission) return undefined;

    const result = await deleteTimeEntry(req.params.entryId, {
      userId: req.viewer?.user?.id,
      isSuperUser: Boolean(req.viewer?.isSuperUser),
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    // An entry id from another ticket must not be deletable through this one's
    // authorisation. Checked after the load so the answer does not reveal which
    // ticket the entry belongs to.
    if (Number(result.submissionId) !== Number(submission.id)) {
      return res.status(404).json({ error: 'That entry is not on this request' });
    }

    const entries = await listTimeEntries(submission.id);
    emitAdminNotification('submission:time-entries', {
      submission_id: Number(submission.id),
      ...summarizeTimeEntries(entries),
    });
    return res.json({ entries, ...summarizeTimeEntries(entries) });
  }),
);

/**
 * The throughput page.
 *
 * The RESPONSE SHAPE depends on rank, and the server decides it. A caller who
 * does not manage the application gets their own numbers and nobody else's —
 * narrowed in the query, so a colleague's name never reaches the browser at all.
 */
router.get('/api/admin/throughput', ensureAdmin, attachViewer, async (req, res) => withDb(async () => {
  const from = dayOf(req.query.from);
  const to = dayOf(req.query.to);
  if (!from || !to) {
    return res.status(400).json({ error: 'Give a from and a to date, as YYYY-MM-DD' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'The window ends before it starts' });
  }

  const viewer = req.viewer;
  const requested = Number(req.query.application_id) || null;

  // Which applications this answer covers, and whether it names people.
  let scope;
  let isManager;
  if (requested) {
    if (!canReadApplication(viewer, requested)) {
      return res.status(403).json({ error: 'You do not have access to this application' });
    }
    scope = [requested];
    isManager = canManageApplication(viewer, requested);
  } else {
    // "All applications" is only coherent when the caller has the same rank
    // everywhere it would cover — otherwise the page would have to be two shapes
    // at once. Everyone else picks one application at a time.
    scope = Array.isArray(viewer?.readableApplicationIds) ? viewer.readableApplicationIds : [];
    isManager = scope.length > 0 && scope.every((id) => canManageApplication(viewer, id));
  }

  const reportTypeId = await getLookupIdByName(null, 'submission_types', SUBMISSION_TYPE_REPORT, {
    lowercase: true,
  });

  const data = await getThroughput({
    applicationIds: scope,
    from,
    to,
    // The one line that makes the whole page safe.
    onlyUserId: isManager ? null : (viewer?.user?.id || null),
    reportTypeId,
  });
  if (!data) return res.status(500).json({ error: 'Throughput is not available' });

  return res.json({
    ...data,
    // What the page is looking at, echoed back so it cannot draw a heading that
    // disagrees with the data underneath it.
    scope: isManager ? 'team' : 'self',
    from,
    to,
    application_id: requested,
    built_at: new Date().toISOString(),
  });
}));

module.exports = router;
