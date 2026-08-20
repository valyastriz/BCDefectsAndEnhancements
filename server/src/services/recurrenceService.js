// "It happened to me too" — reading the log, writing a row, keeping the
// aggregates honest.
//
// The depth decision itself is a pure function in helpers/recurrenceDepth.js so
// it can be tested without a database. This module is what talks to one.
//
// Security posture, because this is a public write path:
//   * the caller must have a session — an anonymous +1 is unattributable and
//     trivially scriptable, and the number feeds a priority decision
//   * the DEPTH is resolved server-side from the parent row; a client-supplied
//     depth would be a way to skip the questions
//   * fields outside the depth's allow-list are DROPPED, not stored
//   * only public submissions can be recurred against, the same gate the board
//     and the public search use — otherwise this endpoint confirms the existence
//     of private tickets by id

const dbApi = require('../../db');
const { getSubmissionByIdWithLookups } = require('./submissionService');
const { mapSubmission } = require('../helpers/mappers');
const { deriveStatusTimestamps } = require('../helpers/statusTimestamps');
const {
  DEPTH_ALREADY_FIXED,
  DEPTH_CHALLENGE,
  DEPTH_REGRESSION,
  resolveRecurrenceDepth,
  allowedFieldsForDepth,
  acceptsRecurrences,
} = require('../helpers/recurrenceDepth');

const MAX_NOTE_LENGTH = 2000;
const MAX_SHORT_LENGTH = 200;

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function text(value, max = MAX_NOTE_LENGTH) {
  if (isBlank(value)) return null;
  return String(value).trim().slice(0, max);
}

function wholeNumber(value) {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function money(value) {
  if (isBlank(value)) return null;
  // Strip the currency furniture a person types — "$3,180.00" is a number.
  const parsed = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * An ISO timestamp for "when it happened to me", refusing the future.
 *
 * A future date would silently turn a pre-release sighting into a regression,
 * because the depth gate compares this against the deploy date — so it is
 * clamped to now rather than trusted.
 */
function occurredAtIso(value, now = new Date()) {
  if (isBlank(value)) return now.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return now.toISOString();
  return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString();
}

/**
 * Load the ticket a recurrence should actually attach to.
 *
 * Follows a Duplicate to the ticket it duplicates, and that redirect is the
 * point: closing B as a duplicate of A means A is where the work is. Without
 * this the count fragments across every duplicate and no row shows the real
 * total. Bounded to a few hops so a duplicate cycle — which the data does not
 * forbid — cannot spin.
 */
async function resolveRecurrenceTarget(db, submissionId, { maxHops = 4 } = {}) {
  let current = await getSubmissionByIdWithLookups(db, Number(submissionId), { publicOnly: true });
  if (!current) return null;

  const seen = new Set([Number(current.id)]);
  let redirectedFrom = null;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const status = String(current.model_status_name || current.status || '').trim();
    const target = Number(current.duplicate_of);
    if (status !== 'Duplicate' || !Number.isFinite(target) || seen.has(target)) break;
    // eslint-disable-next-line no-await-in-loop
    const next = await getSubmissionByIdWithLookups(db, target, { publicOnly: true });
    // A duplicate pointing at a private or deleted ticket stays where it is
    // rather than failing: the reporter still gets to say it happened.
    if (!next) break;
    redirectedFrom = redirectedFrom ?? Number(current.id);
    seen.add(target);
    current = next;
  }
  return { submission: current, redirectedFrom };
}

/** Attach the derived per-status dates the depth gate reads. */
async function withStatusTimestamps(submission) {
  const dbModels = dbApi.getModels() || {};
  const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
  const events = SubmissionStatusEvent
    ? await SubmissionStatusEvent.findAll({
      where: { submission_id: Number(submission.id) },
      attributes: ['submission_id', 'status', 'changed_at'],
      raw: true,
    })
    : [];
  return { ...submission, ...deriveStatusTimestamps(events) };
}

/** The application's reference-number flags, defaulting to the Billing Center pair. */
async function referenceFieldsForApplication(applicationId) {
  const dbModels = dbApi.getModels() || {};
  const Application = dbModels.Application;
  const fallback = { policy: true, account: true, transaction: false };
  if (!Application || !applicationId) return fallback;
  const row = await Application.findByPk(Number(applicationId), { raw: true }).catch(() => null);
  if (!row) return fallback;
  return {
    // `?? 1` rather than Boolean(): a column added by a migration reads back
    // null on a row written before it existed, and null must mean the default,
    // not "off".
    policy: Boolean(row.uses_policy_num ?? 1),
    account: Boolean(row.uses_account_num ?? 1),
    transaction: Boolean(row.uses_transaction_num ?? 0),
  };
}

/**
 * Everything the sheet needs to draw itself, for one (ticket, date) pair.
 *
 * Public-safe: it returns the depth, what to ask, the release date the depth was
 * decided from, and the application's reference fields. No reporter names, no
 * notes, no internal fields — the caller may be an anonymous board visitor.
 */
async function getRecurrenceContext(db, submissionId, { occurredAt = null, viewerUserId = null } = {}) {
  const resolved = await resolveRecurrenceTarget(db, submissionId);
  if (!resolved) return null;
  const { submission, redirectedFrom } = resolved;

  // A report request takes no recurrences. Returned as an answer rather than a
  // 404, so the client can simply not draw the affordance instead of showing a
  // button that fails on press.
  if (!acceptsRecurrences({ type: submission.model_type_name || submission.type })) {
    return {
      submission_id: Number(submission.id),
      accepts: false,
      reason: 'type-not-eligible',
      depth: null,
    };
  }

  const withDates = await withStatusTimestamps({
    ...submission,
    status: submission.model_status_name || submission.status,
    rejection_reason: submission.model_rejection_reason_name || null,
  });
  const decision = resolveRecurrenceDepth(withDates, { occurredAt });

  const dbModels = dbApi.getModels() || {};
  const SubmissionRecurrence = dbModels.SubmissionRecurrence;
  // "You already reported this on the 11th" — shown instead of the button, so a
  // double-tap takes a deliberate second press. Never a hard block: the same
  // person hitting the same defect twice in a week is two real data points.
  let yourLast = null;
  if (SubmissionRecurrence && viewerUserId) {
    const mine = await SubmissionRecurrence.findOne({
      where: { submission_id: Number(submission.id), reported_by_user_id: Number(viewerUserId), retracted_at: null },
      order: [['occurred_at', 'DESC']],
      raw: true,
    }).catch(() => null);
    yourLast = mine?.occurred_at || null;
  }

  return {
    submission_id: Number(submission.id),
    // Non-null when a Duplicate sent us somewhere else, so the sheet can say
    // "#412 was folded into #388 — adding your report there".
    redirected_from: redirectedFrom,
    depth: decision.depth,
    ask: decision.ask,
    reason: decision.reason,
    released_at: decision.releasedAt,
    status: String(submission.model_status_name || submission.status || ''),
    rejection_reason: submission.model_rejection_reason_name || null,
    summary_of_issue: submission.summary_of_issue || '',
    application_name: submission.model_application_name || submission.application_name || '',
    reference_fields: await referenceFieldsForApplication(submission.application_id),
    recurrence_count: Number(submission.recurrence_count || 0),
    your_last_report_at: yourLast,
    // Depth 3 pre-fills the new report from the old one rather than handing over
    // a blank form. Public-safe fields only — this is the same content the board
    // already shows on the ticket.
    ...(decision.depth === DEPTH_REGRESSION ? {
      prefill: {
        type: submission.model_type_name || submission.type || 'defect',
        application_name: submission.model_application_name || submission.application_name || '',
        screen_title: submission.screen_title || '',
        summary_of_issue: submission.summary_of_issue || '',
        steps_to_reproduce: submission.steps_to_reproduce || '',
        what_happened_exact_details: submission.what_happened_exact_details || '',
        request: submission.request || '',
        release_number: submission.release_number || '',
        easyvista_ticket_id: submission.easyvista_ticket_id || '',
      },
    } : {}),
  };
}

/**
 * Recompute `recurrence_count`, `last_recurrence_at`, `recurrence_challenged`
 * and `open_workaround_requests` from the child rows.
 *
 * Always recomputed, never incremented. An increment cannot survive a
 * retraction, and these numbers drive which ticket gets worked next.
 */
async function recalculateRecurrenceAggregates(submissionId) {
  const dbModels = dbApi.getModels() || {};
  const { Submission, SubmissionRecurrence } = dbModels;
  if (!Submission || !SubmissionRecurrence) return null;

  const rows = await SubmissionRecurrence.findAll({
    where: { submission_id: Number(submissionId), retracted_at: null },
    attributes: ['occurred_at', 'depth', 'workaround_requested', 'workaround_provided_at'],
    raw: true,
  });

  const count = rows.length;
  const last = rows.reduce((max, row) => (
    !max || String(row.occurred_at) > String(max) ? row.occurred_at : max
  ), null);
  const challenged = rows.some((row) => Number(row.depth) === DEPTH_CHALLENGE) ? 1 : 0;
  const asked = rows.filter((row) => Number(row.workaround_requested) === 1);
  const openWorkarounds = asked.filter((row) => !row.workaround_provided_at).length;

  await Submission.update({
    recurrence_count: count,
    last_recurrence_at: last,
    recurrence_challenged: challenged,
    open_workaround_requests: openWorkarounds,
    // Serviced or not. Distinguishes "somebody asked and we helped" from "nobody
    // else ever asked", which `open_` alone cannot.
    workaround_requests_total: asked.length,
  }, { where: { id: Number(submissionId) } });

  return { count, last, challenged, openWorkarounds, askedTotal: asked.length };
}

/**
 * Record one "it happened to me".
 *
 * Returns { error, status } for a refusal, or { status, body } on success.
 * The depth is decided here and the payload is filtered to it, so a stale or
 * hostile client cannot store a field the sheet never showed.
 */
async function createRecurrence(db, {
  submissionId,
  body = {},
  reporterUserId,
  reporterName,
}) {
  const dbModels = dbApi.getModels() || {};
  const SubmissionRecurrence = dbModels.SubmissionRecurrence;
  if (!SubmissionRecurrence) return { error: 'Recurrences are not available', status: 500 };

  const resolved = await resolveRecurrenceTarget(db, submissionId);
  // 404 rather than 403 for a private or missing ticket — the same answer, so
  // guessing ids cannot confirm that a private one exists.
  if (!resolved) return { error: 'Ticket not found', status: 404 };
  const { submission, redirectedFrom } = resolved;

  // Refused server-side as well as hidden client-side. The UI not offering the
  // button is a courtesy; this is the rule.
  if (!acceptsRecurrences({ type: submission.model_type_name || submission.type })) {
    return {
      error: 'A report request cannot be reported as happening again.',
      status: 400,
    };
  }

  const occurred = occurredAtIso(body.occurred_at);
  const withDates = await withStatusTimestamps({
    ...submission,
    status: submission.model_status_name || submission.status,
    rejection_reason: submission.model_rejection_reason_name || null,
  });
  const decision = resolveRecurrenceDepth(withDates, { occurredAt: occurred });

  // Depth 0 means they are describing something from before the fix shipped.
  // Refused as a recurrence with the release date attached, so the client can say
  // "this was fixed on the 18th — try again". Not an error the user caused.
  if (decision.depth === DEPTH_ALREADY_FIXED) {
    return {
      status: 409,
      error: 'This was already fixed before the date you gave.',
      body: {
        depth: DEPTH_ALREADY_FIXED,
        reason: decision.reason,
        released_at: decision.releasedAt,
        submission_id: Number(submission.id),
      },
    };
  }

  const allowed = new Set(allowedFieldsForDepth(decision));

  // The application's own reference fields narrow the allow-list further.
  //
  // Enforced here and not only in the sheet: "which numbers identify a case in
  // this system" is the application's answer, and a client that posts a
  // transaction number to an application that does not use one would store a
  // value no screen will ever show — a field that silently accumulates data
  // nobody reads is worse than one that refuses it.
  const references = await referenceFieldsForApplication(submission.application_id);
  if (!references.policy) allowed.delete('policy_num');
  if (!references.account) allowed.delete('account_num');
  if (!references.transaction) allowed.delete('transaction_num');

  const pick = (field, transform) => (allowed.has(field) ? transform(body[field]) : null);

  const wantsWorkaround = Boolean(body.workaround_requested);
  const row = await SubmissionRecurrence.create({
    submission_id: Number(submission.id),
    reported_by_user_id: reporterUserId || null,
    reported_by_name: String(reporterName || '').trim() || 'Unknown',
    occurred_at: occurred,
    created_at: new Date().toISOString(),
    depth: decision.depth,
    policy_num: pick('policy_num', (v) => text(v, MAX_SHORT_LENGTH)),
    account_num: pick('account_num', (v) => text(v, MAX_SHORT_LENGTH)),
    transaction_num: pick('transaction_num', (v) => text(v, MAX_SHORT_LENGTH)),
    note: pick('note', (v) => text(v)),
    steps_to_reproduce: pick('steps_to_reproduce', (v) => text(v)),
    expected_behaviour: pick('expected_behaviour', (v) => text(v)),
    workaround_cost: pick('workaround_cost', (v) => text(v, MAX_SHORT_LENGTH)),
    frequency_count: pick('frequency_count', wholeNumber),
    frequency_timeframe_id: pick('frequency_timeframe_id', wholeNumber),
    policies_affected_count: pick('policies_affected_count', wholeNumber),
    direct_dollar_impact: pick('direct_dollar_impact', money),
    workaround_requested: wantsWorkaround ? 1 : 0,
    workaround_blocked_on: wantsWorkaround ? text(body.workaround_blocked_on) : null,
  });

  const aggregates = await recalculateRecurrenceAggregates(submission.id);

  return {
    status: 201,
    body: {
      recurrence_id: Number(row.id),
      submission_id: Number(submission.id),
      redirected_from: redirectedFrom,
      depth: decision.depth,
      reason: decision.reason,
      released_at: decision.releasedAt,
      workaround_requested: wantsWorkaround,
      recurrence_count: aggregates?.count ?? null,
      // Depth 3 logs the recurrence FIRST and then hands the client the context
      // for the report that follows. If they abandon that form, the evidence that
      // the fix broke still exists.
      needs_report: decision.depth === DEPTH_REGRESSION,
    },
  };
}

/** The full log for one ticket. ADMIN ONLY — the rows carry names and notes. */
async function listRecurrences(db, submissionId, { includeRetracted = false } = {}) {
  const dbModels = dbApi.getModels() || {};
  const { SubmissionRecurrence, OccurrenceTimeframe } = dbModels;
  if (!SubmissionRecurrence) return [];

  const rows = await SubmissionRecurrence.findAll({
    where: {
      submission_id: Number(submissionId),
      ...(includeRetracted ? {} : { retracted_at: null }),
    },
    order: [['occurred_at', 'DESC'], ['id', 'DESC']],
    raw: true,
  });

  const timeframeIds = [...new Set(rows.map((r) => Number(r.frequency_timeframe_id)).filter(Boolean))];
  const timeframes = timeframeIds.length && OccurrenceTimeframe
    ? await OccurrenceTimeframe.findAll({ where: { id: timeframeIds }, raw: true })
    : [];
  const timeframeById = new Map(timeframes.map((t) => [Number(t.id), t.name]));

  return rows.map((row) => ({
    ...row,
    workaround_requested: Boolean(row.workaround_requested),
    frequency_timeframe: timeframeById.get(Number(row.frequency_timeframe_id)) || null,
    // DECIMAL comes back a string on Postgres and a number on SQLite — same
    // coercion the submission mapper does, for the same reason.
    direct_dollar_impact: row.direct_dollar_impact === null || row.direct_dollar_impact === undefined
      ? null
      : Number(row.direct_dollar_impact),
  }));
}

/** Close out ONE person's workaround request, leaving everyone else's alone. */
async function markRecurrenceWorkaroundHandled(db, recurrenceId, { handledBy, handled = true }) {
  const dbModels = dbApi.getModels() || {};
  const SubmissionRecurrence = dbModels.SubmissionRecurrence;
  if (!SubmissionRecurrence) return { error: 'Recurrences are not available', status: 500 };

  const row = await SubmissionRecurrence.findByPk(Number(recurrenceId), { raw: true });
  if (!row) return { error: 'Recurrence not found', status: 404 };
  if (!row.workaround_requested) {
    return { error: 'That report did not ask for a workaround', status: 400 };
  }

  await SubmissionRecurrence.update({
    workaround_provided_at: handled ? new Date().toISOString() : null,
    workaround_provided_by: handled ? (handledBy || null) : null,
  }, { where: { id: Number(recurrenceId) } });

  const aggregates = await recalculateRecurrenceAggregates(row.submission_id);
  return { status: 200, body: { submission_id: Number(row.submission_id), ...aggregates } };
}

/** Withdraw a recurrence. Soft — the row stays, the count drops. */
async function retractRecurrence(db, recurrenceId, { retractedBy }) {
  const dbModels = dbApi.getModels() || {};
  const SubmissionRecurrence = dbModels.SubmissionRecurrence;
  if (!SubmissionRecurrence) return { error: 'Recurrences are not available', status: 500 };

  const row = await SubmissionRecurrence.findByPk(Number(recurrenceId), { raw: true });
  if (!row) return { error: 'Recurrence not found', status: 404 };

  await SubmissionRecurrence.update({
    retracted_at: new Date().toISOString(),
    retracted_by: retractedBy || null,
  }, { where: { id: Number(recurrenceId) } });

  const aggregates = await recalculateRecurrenceAggregates(row.submission_id);
  return { status: 200, body: { submission_id: Number(row.submission_id), ...aggregates } };
}

/**
 * Rule on a reporter's regression claim.
 *
 * `confirmed` is 1 (yes, the fix broke) or -1 (no, different issue). The link is
 * never cleared: that somebody believed it was a regression is itself worth
 * keeping, and clearing it would invite the same claim again next week.
 */
async function setRegressionClaim(db, submissionId, { confirmed, reviewedBy }) {
  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  if (!Submission) return { error: 'Submission model is not available', status: 500 };

  const row = await Submission.findByPk(Number(submissionId), { raw: true });
  if (!row) return { error: 'Ticket not found', status: 404 };
  if (!row.regression_of_submission_id) {
    return { error: 'This ticket is not tagged as a regression', status: 400 };
  }

  const verdict = Number(confirmed) >= 1 ? 1 : -1;
  await Submission.update({ regression_claim_confirmed: verdict }, { where: { id: Number(submissionId) } });

  // The parent's forward pointer follows the ruling: a rejected claim must stop
  // advertising "reported again after the fix" on a ticket that was fine.
  const parentId = Number(row.regression_of_submission_id);
  if (verdict === 1) {
    await Submission.update(
      { has_regression: 1, latest_regression_submission_id: Number(submissionId) },
      { where: { id: parentId } },
    );
  } else {
    const others = await Submission.findAll({
      where: { regression_of_submission_id: parentId, regression_claim_confirmed: 1 },
      attributes: ['id'],
      order: [['id', 'DESC']],
      raw: true,
    });
    await Submission.update({
      has_regression: others.length ? 1 : 0,
      latest_regression_submission_id: others.length ? Number(others[0].id) : null,
    }, { where: { id: parentId } });
  }

  const updated = await getSubmissionByIdWithLookups(db, Number(submissionId));
  const parent = await getSubmissionByIdWithLookups(db, parentId);
  return {
    status: 200,
    body: {
      submission: mapSubmission(updated),
      parent: parent ? mapSubmission(parent) : null,
      reviewed_by: reviewedBy || null,
    },
  };
}

module.exports = {
  resolveRecurrenceTarget,
  getRecurrenceContext,
  createRecurrence,
  listRecurrences,
  recalculateRecurrenceAggregates,
  markRecurrenceWorkaroundHandled,
  retractRecurrence,
  setRegressionClaim,
  occurredAtIso,
};
