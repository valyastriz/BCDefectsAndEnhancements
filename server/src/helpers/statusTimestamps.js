// Per-status timestamps, derived from the status-event ledger.
//
// The public board's four-stop track needs a date under each stop a ticket has
// reached, and so does every surface that renders a ticket with StatusBoardRow —
// which now includes the AI search results, the pre-submit duplicate check, and
// the recurrence sheets that read `deployed_status_at` to decide whether a fix
// has come back.
//
// This lived inline in publicRoutes.js and nowhere else, which is why the AI
// search path returned matches with NONE of these fields: the search hands the
// hydrated row straight to `mapPublicSubmission`, and the allow-list drops a key
// that is `undefined`. StatusBoardRow then drew "—" under every stop and fell
// back to `updated_at` for "when", on every match on every public surface.
// One derivation, used by both, so the two cannot drift again.

// A triager changing the status writes the event as
// "Defect/Enhancement Status: Deployed", while the create, EasyVista-send and
// retire paths write the bare name. Matching only the bare form means a status
// reached through the admin form — which is how Approved, Deployed and Duplicate
// are ALWAYS reached — never produces a date. Both shapes are read.
const STATUS_EVENT_PREFIX = 'Defect/Enhancement Status: ';

function normalizeEventStatus(value) {
  const text = String(value || '').trim();
  return text.startsWith(STATUS_EVENT_PREFIX) ? text.slice(STATUS_EVENT_PREFIX.length) : text;
}

/** Group a flat status-event list by submission id. */
function groupEventsBySubmissionId(events) {
  const bySubmissionId = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const submissionId = Number(event?.submission_id);
    if (!Number.isFinite(submissionId)) continue;
    if (!bySubmissionId.has(submissionId)) bySubmissionId.set(submissionId, []);
    bySubmissionId.get(submissionId).push(event);
  }
  return bySubmissionId;
}

/**
 * The status timestamps for ONE submission, from that submission's events.
 *
 * Returns every key the board and the recurrence depth check read, always — a
 * status never reached is `null`, never absent, because `mapPublicSubmission`
 * silently drops `undefined` and an absent key is indistinguishable from a
 * ticket that has not got there yet.
 */
function deriveStatusTimestamps(submissionEvents) {
  const sorted = [...(Array.isArray(submissionEvents) ? submissionEvents : [])]
    .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  const latest = sorted[0] || null;

  const maxByStatus = (status) => {
    const matches = sorted.filter((event) => normalizeEventStatus(event.status) === status);
    return matches.length > 0 ? matches.reduce((max, event) => (
      !max || new Date(event.changed_at) > new Date(max) ? event.changed_at : max
    ), null) : null;
  };

  return {
    latest_status_changed_at: latest?.changed_at || null,
    latest_status_value: latest?.status || null,
    // The defect track: Reported, Approved, With the Service Desk, Deployed.
    approved_status_at: maxByStatus('Approved'),
    submitted_status_at: maxByStatus('Submitted'),
    deployed_status_at: maxByStatus('Deployed'),
    // The report-request track's own last two stops. Same shape, same source.
    in_progress_status_at: maxByStatus('In progress'),
    delivered_status_at: maxByStatus('Delivered'),
    // Outcomes that end a ticket somewhere other than Deployed.
    duplicate_status_at: maxByStatus('Duplicate'),
    retired_status_at: maxByStatus('Retired'),
  };
}

/**
 * Attach the timestamps to every row in one pass.
 *
 * `events` is the flat ledger for all of `rows`; grouping happens here so a
 * caller only ever runs one query.
 */
function attachStatusTimestamps(rows, events) {
  const bySubmissionId = groupEventsBySubmissionId(events);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    ...deriveStatusTimestamps(bySubmissionId.get(Number(row.id)) || []),
  }));
}

module.exports = {
  STATUS_EVENT_PREFIX,
  normalizeEventStatus,
  groupEventsBySubmissionId,
  deriveStatusTimestamps,
  attachStatusTimestamps,
};
