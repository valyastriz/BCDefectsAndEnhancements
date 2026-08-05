const { test } = require('node:test');
const assert = require('node:assert');

const { mapSubmission, mapPublicSubmission, toMoneyNumber } = require('../src/helpers/mappers');

// Fields that must NEVER appear on the public status board.
const SENSITIVE_FIELDS = [
  'created_by_email',
  'reviewer',
  'decision_notes',
  'impact_notes',
  'policy_premium_impact',
  'direct_dollar_impact',
  'policies_affected_count',
  'fingerprint',
  // Ownership reaches the board as the boolean `is_mine`, computed per caller in
  // routes/publicRoutes.js. The id it is computed FROM must never ship — it
  // would let any watcher correlate which reports belong to the same person.
  'reporter_user_id',
];

function fullInternalRow(overrides = {}) {
  return {
    id: 42,
    model_type_name: 'defect',
    model_status_name: 'Submitted',
    model_application_name: 'Billing Center',
    summary_of_issue: 'Something broke',
    what_happened_exact_details: 'details',
    request: '',
    created_by: 'Jane Rep',
    created_by_email: 'jane@example.com',
    reviewer: 'Admin Bob',
    decision_notes: 'internal only',
    impact_notes: 'internal impact',
    policy_premium_impact: 1234.5,
    direct_dollar_impact: 999,
    policies_affected_count: 7,
    fingerprint: 'abc123',
    reporter_user_id: 5,
    policy_num: 'P1',
    account_num: 'A1',
    easyvista_ticket_id: 'EV-1',
    jira_number: 'JIRA-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    is_public: 1,
    ...overrides,
  };
}

test('mapPublicSubmission exposes only allow-listed fields', () => {
  const result = mapPublicSubmission(fullInternalRow());
  // Allowed display fields are present
  for (const field of ['id', 'type', 'status', 'summary_of_issue', 'created_by', 'application_name', 'easyvista_ticket_id']) {
    assert.ok(field in result, `expected public field "${field}" to be present`);
  }
});

test('mapPublicSubmission withholds every sensitive field', () => {
  const result = mapPublicSubmission(fullInternalRow());
  for (const field of SENSITIVE_FIELDS) {
    assert.ok(!(field in result), `sensitive field "${field}" must NOT be exposed publicly`);
  }
});

test('mapPublicSubmission returns null for a null row', () => {
  assert.strictEqual(mapPublicSubmission(null), null);
});

test('mapSubmission maps a Retired cleanup item to Completed (client/server parity)', () => {
  const row = mapSubmission({
    id: 1,
    model_status_name: 'Retired',
    is_cleanup: 1,
    is_retired: 1,
  });
  assert.strictEqual(row.cleanup_status_display, 'Completed');
});

test('mapSubmission falls back to "Not Started" for an unmapped cleanup status', () => {
  const row = mapSubmission({
    id: 2,
    model_status_name: 'Rejected', // not in SUBMISSION_TO_CLEANUP_STATUS
    is_cleanup: 1,
  });
  assert.strictEqual(row.cleanup_status_display, 'Not Started');
});

test('mapSubmission gates cleanup display off when not a cleanup item', () => {
  const row = mapSubmission({ id: 3, model_status_name: 'New', is_cleanup: 0 });
  assert.strictEqual(row.cleanup_status_display, 'No Cleanup');
});

// ── Money columns ────────────────────────────────────────────────────────────
// The impact figures are DECIMAL, which `pg` returns as a STRING while SQLite
// returns a number. mapSubmission is the one boundary that reconciles the two, so
// the JSON contract does not depend on which database is behind it.

test('toMoneyNumber converts the Postgres DECIMAL string to a number', () => {
  assert.strictEqual(toMoneyNumber('1250.00'), 1250);
  assert.strictEqual(toMoneyNumber('0.07'), 0.07);
});

test('toMoneyNumber passes a SQLite number through unchanged', () => {
  assert.strictEqual(toMoneyNumber(1250), 1250);
  assert.strictEqual(toMoneyNumber(0.07), 0.07);
});

test('toMoneyNumber keeps "no figure given" as null rather than 0', () => {
  // These are different answers: a ticket nobody costed must not be summed into
  // the queue's impact totals as a zero-dollar impact.
  assert.strictEqual(toMoneyNumber(null), null);
  assert.strictEqual(toMoneyNumber(undefined), null);
  assert.strictEqual(toMoneyNumber(''), null);
});

test('toMoneyNumber refuses a non-numeric value rather than yielding NaN', () => {
  assert.strictEqual(toMoneyNumber('not money'), null);
  assert.strictEqual(toMoneyNumber({}), null);
});

test('toMoneyNumber preserves a value float4 would have mangled', () => {
  // The defect this replaced: REAL is single-precision on Postgres, so this
  // figure was stored as ~1234568. DECIMAL round-trips it exactly.
  assert.strictEqual(toMoneyNumber('1234567.89'), 1234567.89);
});

test('mapSubmission exposes money as numbers whichever dialect supplied them', () => {
  const fromPostgres = mapSubmission(fullInternalRow({
    policy_premium_impact: '1234.50',
    direct_dollar_impact: '999.00',
  }));
  assert.strictEqual(typeof fromPostgres.policy_premium_impact, 'number');
  assert.strictEqual(fromPostgres.policy_premium_impact, 1234.5);
  assert.strictEqual(fromPostgres.direct_dollar_impact, 999);

  const fromSqlite = mapSubmission(fullInternalRow({
    policy_premium_impact: 1234.5,
    direct_dollar_impact: 999,
  }));
  assert.deepStrictEqual(
    [fromSqlite.policy_premium_impact, fromSqlite.direct_dollar_impact],
    [fromPostgres.policy_premium_impact, fromPostgres.direct_dollar_impact],
    'the two dialects must produce an identical payload',
  );
});

test('mapSubmission reports an uncosted ticket as null, not 0', () => {
  const row = mapSubmission(fullInternalRow({
    policy_premium_impact: null,
    direct_dollar_impact: null,
  }));
  assert.strictEqual(row.policy_premium_impact, null);
  assert.strictEqual(row.direct_dollar_impact, null);
});
