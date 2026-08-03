const { test } = require('node:test');
const assert = require('node:assert');

const { mapSubmission, mapPublicSubmission } = require('../src/helpers/mappers');

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
