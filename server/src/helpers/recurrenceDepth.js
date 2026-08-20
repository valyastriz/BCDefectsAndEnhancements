// How much to ask somebody who says an already-reported issue happened to them.
//
// One gesture on every match; the DEPTH is decided here, from the parent ticket's
// own state, and never from anything the client sends. The requester is the
// person least equipped to classify their own report — that is a triage decision
// — and a client-supplied depth would also be a way to skip the questions.
//
// The three depths, and the question each answers:
//
//   1  add weight     Not released yet. Someone is already going to fix this, so
//                     the only useful additions are evidence and frequency.
//   2  challenge      Closed without a fix, or explicitly being measured. A
//                     decision went the other way; ask for the ONE thing that
//                     would overturn it, chosen from why it was closed.
//   3  regression     Released, and it happened AFTER the release. Nobody is
//                     watching this ticket. Needs a real report of its own.
//
// And one non-depth:
//
//   0  already fixed  Released, and they are describing something from BEFORE the
//                     release. Not a regression. The week after any deploy this is
//                     the common case, and treating it as depth 3 would bury the
//                     real ones.

const DEPTH_ADD_WEIGHT = 1;
const DEPTH_CHALLENGE = 2;
const DEPTH_REGRESSION = 3;
const DEPTH_ALREADY_FIXED = 0;

// A ticket is RELEASED when it reached one of these. Both vocabularies: a defect
// deploys, a report request is delivered, and neither word appears on the other's
// track (src/constants.js).
const RELEASED_STATUSES = new Set(['Deployed', 'Delivered']);

// Closed without a change, or parked while somebody counts the cost. Grouped
// because they share a shape: the team has already formed a view, so a bare "+1"
// changes nothing and the sheet has to ask for the thing that would move them.
const CHALLENGE_STATUSES = new Set([
  'Rejected',
  'Retired',
  'Backlog - Monitoring Impact',
]);

// What the depth-2 sheet asks for, on top of the depth-1 fields.
const ASK_REPRO = 'repro';           // steps + identifiers — "we could not make it happen"
const ASK_EXPECTATION = 'expectation'; // what you expected + what it costs — "it works as designed"
const ASK_IMPACT = 'impact';         // frequency + policies + money — "we are measuring it"
const ASK_FULL = 'full';             // all of the above, for a reason we do not recognise

// Why it was closed -> what would actually change the answer.
//
// Matched on the lookup's own words, lower-cased and trimmed. A reason an admin
// adds on the Metadata page will not be in here, and that is handled rather than
// guessed: `ASK_FULL` asks for everything, which is more work for the reporter but
// is never the WRONG question. Never throw on an unrecognised value — the
// Metadata page can create one at any time.
const ASK_BY_REJECTION_REASON = new Map([
  ['could not reproduce', ASK_REPRO],
  ['insufficient detail to investigate', ASK_REPRO],
  ['working as designed', ASK_EXPECTATION],
  ['not cost-effective to fix', ASK_IMPACT],
  ['vendor limitation', ASK_IMPACT],
]);

function normalize(value) {
  return String(value || '').trim();
}

/**
 * May this ticket take a recurrence at all?
 *
 * Report requests cannot, and the reason is visibility rather than distaste for
 * the idea: a report request is visible ONLY to the person who filed it
 * (helpers/reportVisibility.js), so nobody else can ever see one to say it
 * happened to them. The only reachable case is somebody reporting a recurrence on
 * their own request, which is a person telling themselves something.
 *
 * Enforced here rather than left as a note, because it WAS left as a note: the
 * feature's declared scope said "not report requests" while nothing in the code
 * said so, and the screenshot run promptly attached one to a report request. A
 * scope boundary that only exists in prose is not a boundary.
 */
function acceptsRecurrences(submission) {
  return normalize(submission?.type).toLowerCase() !== 'report';
}

function parseTime(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The date this ticket's fix reached people, or null if it has not.
 *
 * Reads the derived status timestamps rather than the status alone, because a
 * ticket can be Deployed and then moved on to something else — the deploy still
 * happened, and a recurrence after it is still a regression.
 */
function releasedAt(submission) {
  return submission?.deployed_status_at || submission?.delivered_status_at || null;
}

/**
 * Decide the depth for one (submission, when-it-happened) pair.
 *
 * `occurredAt` is when it happened TO THE REPORTER. Absent, it is treated as now,
 * which is the honest reading of "it happened to me" with no date given.
 *
 * Returns { depth, ask, releasedAt, reason } where `reason` is a short machine
 * key the client turns into the sheet's wording. Never throws: an unknown status
 * is depth 1, the least presumptuous of the three.
 */
function resolveRecurrenceDepth(submission, { occurredAt = null, now = Date.now() } = {}) {
  const status = normalize(submission?.status);
  const released = releasedAt(submission);
  const releasedTime = parseTime(released);
  const occurredTime = parseTime(occurredAt) ?? now;

  // Released is checked FIRST and on the timestamp, not the status word. A ticket
  // that deployed and was later reopened, redirected or retired still shipped a
  // fix, and something happening after that ship date is still the fix not
  // holding.
  if (releasedTime != null) {
    if (occurredTime > releasedTime) {
      return {
        depth: DEPTH_REGRESSION,
        ask: null,
        releasedAt: released,
        reason: 'recurred-after-release',
      };
    }
    return {
      depth: DEPTH_ALREADY_FIXED,
      ask: null,
      releasedAt: released,
      reason: 'predates-release',
    };
  }

  if (CHALLENGE_STATUSES.has(status)) {
    const reasonName = normalize(submission?.rejection_reason).toLowerCase();
    // Monitoring impact is not a rejection and has no reason row — what it is
    // waiting for IS the impact, so it asks for that directly.
    const ask = status === 'Backlog - Monitoring Impact'
      ? ASK_IMPACT
      : (ASK_BY_REJECTION_REASON.get(reasonName) || ASK_FULL);
    return {
      depth: DEPTH_CHALLENGE,
      ask,
      releasedAt: null,
      reason: status === 'Backlog - Monitoring Impact' ? 'monitoring-impact' : 'closed-without-fix',
    };
  }

  // Everything else — New, Approved, Submitted, In progress, Redirected, the
  // parked-but-planned statuses, and any status an admin adds on the Metadata
  // page. Someone is going to work it; add weight and evidence.
  return {
    depth: DEPTH_ADD_WEIGHT,
    ask: null,
    releasedAt: null,
    reason: 'in-flight',
  };
}

/**
 * Which fields the sheet at this depth may write.
 *
 * The server validates against this rather than trusting the payload: a depth-1
 * sheet posting a `direct_dollar_impact` is either a stale client or someone
 * poking the endpoint, and either way the field is dropped rather than stored.
 */
const BASE_FIELDS = ['occurred_at', 'policy_num', 'account_num', 'transaction_num', 'note'];
const ASK_FIELDS = {
  [ASK_REPRO]: ['steps_to_reproduce'],
  [ASK_EXPECTATION]: ['expected_behaviour', 'workaround_cost', 'frequency_count', 'frequency_timeframe_id'],
  [ASK_IMPACT]: ['frequency_count', 'frequency_timeframe_id', 'policies_affected_count', 'direct_dollar_impact', 'workaround_cost'],
  [ASK_FULL]: [
    'steps_to_reproduce', 'expected_behaviour', 'workaround_cost',
    'frequency_count', 'frequency_timeframe_id', 'policies_affected_count', 'direct_dollar_impact',
  ],
};

function allowedFieldsForDepth({ depth, ask }) {
  // The blocked ask rides on every depth — being stuck today has nothing to do
  // with where the ticket sits in somebody else's queue.
  const workaround = ['workaround_requested', 'workaround_blocked_on'];
  if (depth === DEPTH_CHALLENGE) {
    return [...BASE_FIELDS, ...(ASK_FIELDS[ask] || ASK_FIELDS[ASK_FULL]), ...workaround];
  }
  return [...BASE_FIELDS, ...workaround];
}

module.exports = {
  DEPTH_ALREADY_FIXED,
  DEPTH_ADD_WEIGHT,
  DEPTH_CHALLENGE,
  DEPTH_REGRESSION,
  RELEASED_STATUSES,
  CHALLENGE_STATUSES,
  ASK_REPRO,
  ASK_EXPECTATION,
  ASK_IMPACT,
  ASK_FULL,
  releasedAt,
  acceptsRecurrences,
  resolveRecurrenceDepth,
  allowedFieldsForDepth,
};
