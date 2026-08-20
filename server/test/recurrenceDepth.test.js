const { test } = require('node:test');
const assert = require('node:assert');

const {
  acceptsRecurrences,
  DEPTH_ALREADY_FIXED,
  DEPTH_ADD_WEIGHT,
  DEPTH_CHALLENGE,
  DEPTH_REGRESSION,
  ASK_REPRO,
  ASK_EXPECTATION,
  ASK_IMPACT,
  ASK_FULL,
  resolveRecurrenceDepth,
  allowedFieldsForDepth,
} = require('../src/helpers/recurrenceDepth');

// The depth decides what a person is asked when they say an already-reported
// issue happened to them. It is resolved on the server from the parent ticket
// alone, never from anything the client sends, so these are the whole contract.

const JUNE_18 = '2026-06-18T12:00:00.000Z';
const AUG_18 = '2026-08-18T12:00:00.000Z';
const JUNE_02 = '2026-06-02T12:00:00.000Z';

// ── Which tickets take a recurrence at all ──────────────────────────────────

test('a report request takes no recurrences', () => {
  // Not distaste for the idea — visibility. A report request is visible only to
  // the person who filed it, so nobody else can ever see one to say it happened
  // to them, and the only reachable case is somebody reporting on their own
  // request.
  assert.equal(acceptsRecurrences({ type: 'report' }), false);
  assert.equal(acceptsRecurrences({ type: 'Report' }), false, 'case does not matter');
  assert.equal(acceptsRecurrences({ type: '  report  ' }), false, 'nor does whitespace');
});

test('defects and enhancements do', () => {
  assert.equal(acceptsRecurrences({ type: 'defect' }), true);
  assert.equal(acceptsRecurrences({ type: 'enhancement' }), true);
});

test('a missing type is allowed rather than refused', () => {
  // The exclusion is one named type, not an allow-list. A row whose type failed
  // to hydrate should not silently lose the feature.
  assert.equal(acceptsRecurrences({}), true);
  assert.equal(acceptsRecurrences({ type: null }), true);
});

// ── Depth 1: still in flight ────────────────────────────────────────────────

test('a ticket somebody is already working takes the light sheet', () => {
  for (const status of ['New', 'Approved', 'Submitted', 'In progress', 'Redirected']) {
    const result = resolveRecurrenceDepth({ status }, { occurredAt: AUG_18 });
    assert.equal(result.depth, DEPTH_ADD_WEIGHT, `${status} should add weight`);
    assert.equal(result.reason, 'in-flight');
  }
});

test('parked-but-planned is still in flight — the work is coming', () => {
  for (const status of ['Future Consideration', 'Deferred – Not in Current Scope', 'On hold']) {
    assert.equal(resolveRecurrenceDepth({ status }).depth, DEPTH_ADD_WEIGHT, status);
  }
});

test('a status nobody has heard of falls back to depth 1, never throws', () => {
  // Statuses are a Metadata-managed lookup, so an admin can add one at any time.
  // The real hosted data already has "Pending Management Approval" and
  // "Requires Additional Review", neither of which is in any code-level list.
  for (const status of ['Pending Management Approval', 'Requires Additional Review', '', null, undefined]) {
    const result = resolveRecurrenceDepth({ status });
    assert.equal(result.depth, DEPTH_ADD_WEIGHT, `${status} should be the safe default`);
  }
});

// ── Depth 2: a decision already went the other way ──────────────────────────

test('why it was closed decides what would change the answer', () => {
  const cases = [
    ['Could not reproduce', ASK_REPRO],
    ['Insufficient detail to investigate', ASK_REPRO],
    ['Working as designed', ASK_EXPECTATION],
    ['Not cost-effective to fix', ASK_IMPACT],
    ['Vendor limitation', ASK_IMPACT],
  ];
  for (const [reason, expected] of cases) {
    const result = resolveRecurrenceDepth({ status: 'Rejected', rejection_reason: reason });
    assert.equal(result.depth, DEPTH_CHALLENGE, reason);
    assert.equal(result.ask, expected, `${reason} should ask for ${expected}`);
  }
});

test('an unrecognised rejection reason asks for everything rather than the wrong thing', () => {
  // The Metadata page can add a reason at any time. Degrading to a longer form is
  // acceptable; asking the one question that cannot help is not.
  for (const reason of ['Some new reason an admin typed', '', null]) {
    const result = resolveRecurrenceDepth({ status: 'Rejected', rejection_reason: reason });
    assert.equal(result.depth, DEPTH_CHALLENGE);
    assert.equal(result.ask, ASK_FULL);
  }
});

test('reason matching ignores case and surrounding space', () => {
  const result = resolveRecurrenceDepth({ status: 'Rejected', rejection_reason: '  COULD NOT REPRODUCE  ' });
  assert.equal(result.ask, ASK_REPRO);
});

test('Monitoring Impact asks for impact — it is the thing that status waits on', () => {
  const result = resolveRecurrenceDepth({ status: 'Backlog - Monitoring Impact' });
  assert.equal(result.depth, DEPTH_CHALLENGE);
  assert.equal(result.ask, ASK_IMPACT);
  assert.equal(result.reason, 'monitoring-impact');
});

test('Retired is a challenge too — reporting it again disputes the retirement', () => {
  assert.equal(resolveRecurrenceDepth({ status: 'Retired' }).depth, DEPTH_CHALLENGE);
});

// ── Depth 3 and the guard: released ─────────────────────────────────────────

test('happened AFTER the deploy is a regression', () => {
  const result = resolveRecurrenceDepth(
    { status: 'Deployed', deployed_status_at: JUNE_18 },
    { occurredAt: AUG_18 },
  );
  assert.equal(result.depth, DEPTH_REGRESSION);
  assert.equal(result.reason, 'recurred-after-release');
  assert.equal(result.releasedAt, JUNE_18);
});

test('happened BEFORE the deploy is not a regression — this is the post-release wave', () => {
  const result = resolveRecurrenceDepth(
    { status: 'Deployed', deployed_status_at: JUNE_18 },
    { occurredAt: JUNE_02 },
  );
  assert.equal(result.depth, DEPTH_ALREADY_FIXED);
  assert.equal(result.reason, 'predates-release');
  assert.equal(result.releasedAt, JUNE_18);
});

test('exactly on the deploy timestamp is NOT a regression', () => {
  // The boundary goes to "already fixed": the fix and the sighting in the same
  // instant is not evidence the fix failed.
  const result = resolveRecurrenceDepth(
    { status: 'Deployed', deployed_status_at: JUNE_18 },
    { occurredAt: JUNE_18 },
  );
  assert.equal(result.depth, DEPTH_ALREADY_FIXED);
});

test('a delivered report request is released too', () => {
  const result = resolveRecurrenceDepth(
    { status: 'Delivered', delivered_status_at: JUNE_18 },
    { occurredAt: AUG_18 },
  );
  assert.equal(result.depth, DEPTH_REGRESSION);
});

test('release is read from the TIMESTAMP, not the current status word', () => {
  // A ticket that deployed and was later reopened, redirected or retired still
  // shipped a fix. Something happening after that ship date is still the fix
  // not holding, whatever the status says today.
  const result = resolveRecurrenceDepth(
    { status: 'New', deployed_status_at: JUNE_18 },
    { occurredAt: AUG_18 },
  );
  assert.equal(result.depth, DEPTH_REGRESSION);
});

test('released beats closed-without-fix — a shipped fix that came back is new work', () => {
  const result = resolveRecurrenceDepth(
    { status: 'Rejected', rejection_reason: 'Could not reproduce', deployed_status_at: JUNE_18 },
    { occurredAt: AUG_18 },
  );
  assert.equal(result.depth, DEPTH_REGRESSION);
});

test('an unparseable occurred_at is treated as now, not as the epoch', () => {
  // Date('nonsense') is NaN; if that fell through as 0 every report would land
  // before every deploy and depth 3 could never fire.
  const result = resolveRecurrenceDepth(
    { status: 'Deployed', deployed_status_at: JUNE_18 },
    { occurredAt: 'not a date', now: new Date(AUG_18).getTime() },
  );
  assert.equal(result.depth, DEPTH_REGRESSION);
});

// ── The field allow-list ────────────────────────────────────────────────────

test('depth 1 accepts the base fields and the blocked ask, nothing else', () => {
  const fields = allowedFieldsForDepth({ depth: DEPTH_ADD_WEIGHT, ask: null });
  assert.ok(fields.includes('note'));
  assert.ok(fields.includes('policy_num'));
  assert.ok(fields.includes('workaround_requested'), 'blocked ask rides on every depth');
  assert.ok(!fields.includes('steps_to_reproduce'), 'depth 1 never asks for steps');
  assert.ok(!fields.includes('direct_dollar_impact'), 'depth 1 never asks for money');
});

test('a repro sheet takes steps but not the impact figures', () => {
  const fields = allowedFieldsForDepth({ depth: DEPTH_CHALLENGE, ask: ASK_REPRO });
  assert.ok(fields.includes('steps_to_reproduce'));
  assert.ok(!fields.includes('direct_dollar_impact'));
});

test('an impact sheet takes the figures but not steps', () => {
  const fields = allowedFieldsForDepth({ depth: DEPTH_CHALLENGE, ask: ASK_IMPACT });
  assert.ok(fields.includes('direct_dollar_impact'));
  assert.ok(fields.includes('policies_affected_count'));
  assert.ok(!fields.includes('steps_to_reproduce'));
});

test('the blocked ask is available at every depth', () => {
  for (const depth of [DEPTH_ADD_WEIGHT, DEPTH_CHALLENGE, DEPTH_REGRESSION]) {
    const fields = allowedFieldsForDepth({ depth, ask: ASK_FULL });
    assert.ok(fields.includes('workaround_requested'), `depth ${depth}`);
    assert.ok(fields.includes('workaround_blocked_on'), `depth ${depth}`);
  }
});
