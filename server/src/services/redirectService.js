// Handing a ticket to another application's queue.
//
// The ticket MOVES. It is not copied and not mirrored: a copy would give the
// reporter two tickets for one problem and leave two teams each assuming the
// other owned it. `submissions.application_id` changes, and submission_routings
// records who held it before.
//
// Three consequences of the move, all deliberate:
//
//   1. It lands as New. The receiving team has not triaged it, so its status
//      cannot claim they have — but the history travels with it, so they can see
//      it was Approved when it was sent (status_at_handoff, plus the events).
//
//   2. The sending team keeps READING it and stops WRITING it, the instant it
//      moves. Read comes from the ledger (viewerService.resolveAdminReadScope);
//      write is refused because canMutateApplication asks about the ticket's
//      CURRENT application, which is no longer theirs.
//
//   3. The note is internal. It can name colleagues or judge someone else's
//      work, so it never reaches the reporter — see mapPublicRouting.
const { canMutateApplication } = require('./viewerService');
const { logStatusChange } = require('./submissionService');
const { refuseTypeForApplication } = require('../helpers/applicationScope');
const { getLookupIdByName, getSubmissionTypeNameById } = require('../helpers/lookups');

const HANDOFF_STATUS = 'New';
const NOTE_MAX_LENGTH = 4000;

/**
 * The routing ledger as the REPORTER may see it.
 *
 * Allow-listed the same way mapPublicSubmission is, and for the same reason: the
 * note is triage talk between admins. The reporter gets to see that their ticket
 * moved, when, and between which teams — never what was said about it.
 */
function mapPublicRouting(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    from_application_name: row.from_application_name || null,
    to_application_name: row.to_application_name || null,
    routed_at: row.routed_at,
  };
}

/**
 * Move a ticket to another application's queue.
 *
 * Returns `{ status, body }` or `{ error, status }`. Everything is validated
 * before anything is written, and the ledger row plus the ticket update share
 * one transaction — a ticket that moved without a ledger row would be invisible
 * to the team that sent it.
 */
async function redirectSubmission(db, {
  id,
  toApplicationId,
  note,
  viewer,
  username,
  models,
  sequelize,
}) {
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return { error: 'Invalid submission id', status: 400 };
  }

  const Submission = models?.Submission;
  const SubmissionRouting = models?.SubmissionRouting;
  const Application = models?.Application;
  if (!Submission || !SubmissionRouting || !Application) {
    return { error: 'Required models are not available', status: 500 };
  }

  const submission = await Submission.findByPk(submissionId, { raw: true });
  if (!submission) {
    return { error: 'Submission not found', status: 404 };
  }

  const requestType = await getSubmissionTypeNameById(submission.type_id);

  // You may only hand on a ticket you currently administer, of a type your grant
  // covers. A viewer seat, an admin of the RECEIVING application, or an analyst
  // scoped to a different request type cannot pull a ticket across.
  if (!canMutateApplication(viewer, submission.application_id, requestType)) {
    return { error: 'You do not administer this application', status: 403 };
  }

  const targetId = Number(toApplicationId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return { error: 'Choose an application to redirect to', status: 400 };
  }
  if (targetId === Number(submission.application_id)) {
    return { error: 'That ticket is already in this application', status: 400 };
  }

  // Named attributes — see the note in viewerService.listActiveApplications. Only
  // the id and the name are used, and an implicit SELECT of every model column
  // breaks against a database missing one.
  const target = await Application.findOne({
    where: { id: targetId, is_active: 1 },
    attributes: ['id', 'name'],
    raw: true,
  });
  if (!target) {
    return { error: 'Unknown or inactive application', status: 400 };
  }

  // A redirect is the FIFTH path that sets `submissions.application_id` — the
  // public submit, the admin create, the admin update and the Excel import were
  // the four `helpers/applicationScope.js` was written for, and this one was
  // missed. It is the same rule and the same consequence: a reports-only
  // application is granted to the people who work report requests and to nobody
  // else, so a DEFECT redirected into it lands in a queue with no defect admins.
  // Fail-closed read scoping makes that invisible rather than merely unassigned —
  // the exact failure `Other` exists to avoid — and the sending team has already
  // lost write access by then, so nobody can move it back.
  const wrongQueue = await refuseTypeForApplication(targetId, requestType, target.name);
  if (wrongQueue) return wrongQueue;

  const trimmedNote = String(note || '').trim();
  if (trimmedNote.length > NOTE_MAX_LENGTH) {
    return { error: `Keep the note under ${NOTE_MAX_LENGTH} characters`, status: 400 };
  }

  const fromApplicationId = Number(submission.application_id) || null;
  const from = fromApplicationId
    ? await Application.findByPk(fromApplicationId, { attributes: ['id', 'name'], raw: true })
    : null;

  // What it was when it left. The move resets the live status, so without this
  // the sending team loses the fact that they had already approved it.
  //
  // Resolved from status_id, NOT from a `status` text column: the row stores
  // only the FK (the legacy text columns were dropped), so reading `.status`
  // here silently recorded every hand-off as New.
  const priorStatus = submission.status_id && models.DefectEnhancementStatus
    ? await models.DefectEnhancementStatus.findByPk(Number(submission.status_id), { raw: true })
    : null;
  const statusAtHandoff = String(priorStatus?.name || submission.status || '').trim() || HANDOFF_STATUS;
  const handoffStatusId = await getLookupIdByName(db, 'defect_enhancement_statuses', HANDOFF_STATUS);
  if (!handoffStatusId) {
    return { error: `The "${HANDOFF_STATUS}" status is missing from the portal's metadata`, status: 500 };
  }

  const routedAt = new Date().toISOString();
  const routedBy = String(username || '').trim() || 'admin';

  await sequelize.transaction(async (transaction) => {
    await SubmissionRouting.create({
      submission_id: submissionId,
      from_application_id: fromApplicationId,
      to_application_id: targetId,
      status_at_handoff: statusAtHandoff,
      // Empty stays null rather than an empty string: the note is optional, and
      // a row with '' reads as "they wrote nothing" instead of "they wrote none".
      note: trimmedNote || null,
      routed_at: routedAt,
      routed_by: routedBy,
    }, { transaction });

    await Submission.update({
      application_id: targetId,
      status_id: handoffStatusId,
      updated_at: routedAt,
      status_update_at: routedAt,
    }, { where: { id: submissionId }, transaction });
  });

  // Two entries, in the order they happened, so the receiving admin opens a
  // ticket whose history explains itself: where it came from and what it was
  // when it left, then the New it now sits in. Logged after the commit, matching
  // how the create path records its own first event.
  await logStatusChange(db, submissionId, `Redirected to ${target.name}`, routedBy, routedAt);
  await logStatusChange(db, submissionId, HANDOFF_STATUS, routedBy, routedAt);

  return {
    status: 200,
    body: {
      id: submissionId,
      from_application_id: fromApplicationId,
      from_application_name: from ? String(from.name) : null,
      to_application_id: targetId,
      to_application_name: String(target.name),
      status_at_handoff: statusAtHandoff,
      routed_at: routedAt,
      routed_by: routedBy,
      note: trimmedNote || null,
    },
  };
}

/**
 * The custody chain for one ticket, oldest first, with application names
 * resolved. `forPublic` strips it down to what the reporter may see.
 */
async function listRoutings(models, submissionId, { forPublic = false } = {}) {
  const bySubmission = await listRoutingsBySubmissionIds(models, [submissionId], { forPublic });
  return bySubmission.get(Number(submissionId)) || [];
}

/**
 * The same custody chains, for many tickets at once.
 *
 * Two queries total, whatever the ticket count. The status board asks for the
 * whole public list in one request, so the per-ticket `listRoutings` would have
 * been two queries PER ROW there — the routing read plus a full Application
 * scan each time.
 *
 * Returns a Map keyed by submission id; a ticket that never moved is absent
 * rather than mapped to an empty array, so callers can skip attaching anything.
 */
async function listRoutingsBySubmissionIds(models, submissionIds, { forPublic = false } = {}) {
  const byId = new Map();
  if (!models?.SubmissionRouting) return byId;

  // Positive integers only. `Number(null)` is 0, which is finite — a looser
  // guard would send an id of 0 to the database on every null in the list.
  const ids = [...new Set((submissionIds || []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return byId;

  const rows = await models.SubmissionRouting.findAll({
    where: { submission_id: ids },
    order: [['routed_at', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  if (rows.length === 0) return byId;

  const applications = await models.Application.findAll({ attributes: ['id', 'name'], raw: true });
  const nameById = new Map(applications.map((row) => [Number(row.id), String(row.name)]));

  for (const row of rows) {
    const named = {
      ...row,
      from_application_name: nameById.get(Number(row.from_application_id)) || null,
      to_application_name: nameById.get(Number(row.to_application_id)) || null,
    };
    const submissionId = Number(row.submission_id);
    if (!byId.has(submissionId)) byId.set(submissionId, []);
    byId.get(submissionId).push(forPublic ? mapPublicRouting(named) : named);
  }

  return byId;
}

module.exports = {
  redirectSubmission,
  listRoutings,
  listRoutingsBySubmissionIds,
  mapPublicRouting,
  HANDOFF_STATUS,
  NOTE_MAX_LENGTH,
};
