// The soft association: which queue a ticket in `Other` also appears in.
//
// THE PROBLEM IT SOLVES. `Other` is the catch-all working list — for a system with
// no configured application to submit to the Service Desk, and for one nobody has
// identified yet (see UNKNOWN_APPLICATION in src/constants.js). Either way the work
// still has to be tracked and there is nowhere else to put it.
//
// An analyst who picks one up has had two bad options: move it into a configured
// application, which says the system IS one of those and makes the portal offer a
// hand-off that cannot work — or leave it in `Other`, where it never shows up in
// the queue they actually watch. So the work happened and the list did not say so.
//
// WHAT THIS IS. `submissions.working_application_id`, set when the status leaves
// `New` on a ticket in `Other`, to a queue the acting admin works in. The ticket
// stays in `Other` — so the hand-off stays correctly refused and the incident
// number stays something a human types in — and ALSO appears in that queue.
//
// WHAT IT IS NOT, and this is the line that keeps it safe to have two columns
// answering "whose queue is this":
//
//   * It never decides who may EDIT a ticket. `canMutateApplication` asks about
//     `application_id` and nothing else, so this cannot grant write access.
//   * It never widens what anybody may READ beyond a queue they already hold.
//     `canReadSubmissionRow` admits it only when the caller's own grants include
//     it, so an analyst can put a ticket on their own list and on nobody else's.
//   * It is only ever set on a ticket in `Other`. Every ticket in a configured
//     application already has exactly one answer, and a second one there would be
//     a genuine ambiguity rather than a useful one.
//
// WHY THE STATUS IS THE TRIGGER, in the owner's words: "once they change it from
// new status to something else — then it soft assigns it to their queue (they can
// select which of their queues list)". Moving a ticket off `New` is the moment
// somebody takes it on, and it is the one act that already means that.
const { UNKNOWN_APPLICATION } = require('../constants');
const { roleInApplication } = require('../services/viewerService');
const { getLookupIdByName } = require('./lookups');

const HANDOFF_STATUS = 'New';

/** Is this the catch-all working list — the queue nothing is wired up for? */
async function isUnknownApplication(db, applicationId) {
  const id = Number(applicationId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const unknownId = await getLookupIdByName(db, 'applications', UNKNOWN_APPLICATION);
  return Boolean(unknownId) && Number(unknownId) === id;
}

/**
 * What `working_application_id` should become on this save.
 *
 * Returns `{ value }` — the id, or null — or `{ error, status }` shaped like every
 * other refusal in this layer so a caller can hand it straight back.
 *
 * `value` is ALWAYS returned, including when nothing changes, because the caller
 * writes it into the update payload unconditionally. Returning "no change" as
 * `undefined` would blank the column on every ordinary save.
 *
 * PURE, and `isUnknownQueue` is passed in rather than looked up here: the lookup
 * needs the database, and a rule this consequential — it decides whose list a
 * ticket lands on — should be testable without one. `isUnknownApplication` above
 * is what the caller uses to answer it.
 */
function resolveSoftAssignment({
  body = {},
  existing = {},
  viewer = null,
  nextStatus,
  previousStatus,
  applicationId,
  requestType,
  isUnknownQueue = false,
}) {
  const current = Number(existing.working_application_id) || null;
  const supplied = Object.prototype.hasOwnProperty.call(body, 'working_application_id');

  // Not in `Other`: there is nothing to be soft about. Cleared rather than left,
  // so a ticket redirected OUT of `Other` does not keep pointing at the queue that
  // was watching it while its owner was unknown — that queue has its answer now.
  if (!isUnknownQueue) return { value: null };

  const requested = !supplied
    || body.working_application_id === null
    || body.working_application_id === ''
    ? null
    : Number(body.working_application_id);

  // An explicit CHANGE wins, including an explicit clear — null is a real
  // instruction here ("take this off my list"), not an absence.
  //
  // Compared against the current value rather than merely tested for presence,
  // because the detail modal sends its whole edit object on every save: the key is
  // always there, so "was it supplied?" is always true and would have made the
  // derivation below unreachable. What identifies a deliberate act is that the
  // value DIFFERS from what is stored.
  if (supplied && requested !== current) {
    if (requested === null) return { value: null };
    if (!Number.isInteger(requested) || requested <= 0) {
      return { error: 'That is not an application this ticket can be shown in', status: 400 };
    }
    if (requested === Number(applicationId)) {
      // Pointing it at `Other` itself would put the ticket in the same queue
      // twice, and then "shown in" and "lives in" would disagree about nothing.
      return { error: 'It is already in that queue', status: 400 };
    }
    // It must be one of THEIR queues. Without this, an admin could put work on
    // another team's list — the one thing a "soft" assign must not be able to do,
    // because the receiving team never agreed to it and cannot edit the ticket to
    // get rid of it. Type-scoped, so an analyst granted only report requests
    // cannot park a defect on a queue they hold for something else.
    const role = roleInApplication(viewer, requested, requestType);
    if (!role || role === 'viewer') {
      return { error: 'You can only show a ticket in a queue you work in', status: 403 };
    }
    return { value: requested };
  }

  // No deliberate change. The trigger: the status LEAVING `New`. Only then, and
  // only when nothing has been chosen yet — a save that happens to move the status
  // again must not overwrite the queue the analyst picked.
  const leavingNew = String(previousStatus || '').trim() === HANDOFF_STATUS
    && String(nextStatus || '').trim() !== HANDOFF_STATUS;
  if (!leavingNew || current) return { value: current };

  // Derived only when there is exactly one candidate. With two or more there is a
  // real choice to make and the analyst is the one to make it — guessing would put
  // the ticket on a list they did not pick, which is harder to notice than it not
  // appearing at all.
  const candidates = (Array.isArray(viewer?.adminApplicationIds) ? viewer.adminApplicationIds : [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id !== Number(applicationId))
    .filter((id) => {
      const role = roleInApplication(viewer, id, requestType);
      return Boolean(role) && role !== 'viewer';
    });
  return { value: candidates.length === 1 ? candidates[0] : null };
}

module.exports = { resolveSoftAssignment, isUnknownApplication, HANDOFF_STATUS };
