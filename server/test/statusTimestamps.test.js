const { test } = require('node:test');
const assert = require('node:assert');

const {
  normalizeEventStatus,
  deriveStatusTimestamps,
  attachStatusTimestamps,
} = require('../src/helpers/statusTimestamps');
const { mapPublicSubmission } = require('../src/helpers/mappers');

// These timestamps were derived inline in publicRoutes.js and nowhere else, so
// the AI search path returned matches with NONE of them — StatusBoardRow drew
// "—" under every stop on every match, and the recurrence depth check had no
// deploy date to compare against. The shared helper is the fix; this is the net.

const event = (status, changed_at, submission_id = 1) => ({ submission_id, status, changed_at });

test('both event spellings are read', () => {
  // A triager writes "Defect/Enhancement Status: Deployed"; the create,
  // EasyVista-send and retire paths write the bare word.
  assert.equal(normalizeEventStatus('Deployed'), 'Deployed');
  assert.equal(normalizeEventStatus('Defect/Enhancement Status: Deployed'), 'Deployed');
  assert.equal(normalizeEventStatus('  Defect/Enhancement Status: Approved  '), 'Approved');
});

test('a prefixed status still produces its date', () => {
  const stamps = deriveStatusTimestamps([
    event('Defect/Enhancement Status: Deployed', '2026-06-18T12:00:00.000Z'),
  ]);
  assert.equal(stamps.deployed_status_at, '2026-06-18T12:00:00.000Z');
});

test('every key is present even when the ticket never got there', () => {
  // mapPublicSubmission drops undefined, so an absent key and "not reached yet"
  // would be indistinguishable on the wire — which is the bug being fixed.
  const stamps = deriveStatusTimestamps([]);
  for (const key of [
    'latest_status_changed_at', 'latest_status_value',
    'approved_status_at', 'submitted_status_at', 'deployed_status_at',
    'in_progress_status_at', 'delivered_status_at',
    'duplicate_status_at', 'retired_status_at',
  ]) {
    assert.ok(key in stamps, `${key} must be present`);
    assert.equal(stamps[key], null, `${key} should be null, not undefined`);
  }
});

test('the LATEST occurrence of a repeated status wins', () => {
  const stamps = deriveStatusTimestamps([
    event('Approved', '2026-01-01T00:00:00.000Z'),
    event('Approved', '2026-05-05T00:00:00.000Z'),
    event('Approved', '2026-03-03T00:00:00.000Z'),
  ]);
  assert.equal(stamps.approved_status_at, '2026-05-05T00:00:00.000Z');
});

test('latest_status_* is the most recent event of any kind', () => {
  const stamps = deriveStatusTimestamps([
    event('Approved', '2026-01-01T00:00:00.000Z'),
    event('Deployed', '2026-06-18T00:00:00.000Z'),
    event('Submitted', '2026-03-01T00:00:00.000Z'),
  ]);
  assert.equal(stamps.latest_status_value, 'Deployed');
  assert.equal(stamps.latest_status_changed_at, '2026-06-18T00:00:00.000Z');
});

test('attachStatusTimestamps groups a flat ledger across rows', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const events = [
    event('Deployed', '2026-06-18T00:00:00.000Z', 1),
    event('Approved', '2026-02-02T00:00:00.000Z', 2),
  ];
  const [one, two, three] = attachStatusTimestamps(rows, events);
  assert.equal(one.deployed_status_at, '2026-06-18T00:00:00.000Z');
  assert.equal(two.approved_status_at, '2026-02-02T00:00:00.000Z');
  assert.equal(two.deployed_status_at, null);
  assert.equal(three.deployed_status_at, null, 'a row with no events still gets the keys');
});

test('the timestamps survive the public allow-list', () => {
  // The whole point: they have to reach StatusBoardRow on a search result, and
  // mapPublicSubmission is what search results go through.
  const row = {
    id: 7, type: 'defect', status: 'Deployed', summary_of_issue: 's',
    screen_title: 't', steps_to_reproduce: 'x', what_happened_exact_details: 'y',
    request: 'z', date_time_of_error: 'now', created_by: 'someone',
    ...deriveStatusTimestamps([event('Deployed', '2026-06-18T00:00:00.000Z', 7)]),
  };
  const mapped = mapPublicSubmission(row);
  assert.equal(mapped.deployed_status_at, '2026-06-18T00:00:00.000Z');
  assert.ok('approved_status_at' in mapped, 'a null stop is still carried');
});

test('the recurrence LOG never reaches a public payload', () => {
  // The count is public; the rows are not. Guard for the allow-list.
  const mapped = mapPublicSubmission({
    id: 9, type: 'defect', status: 'New', summary_of_issue: 's',
    screen_title: 't', steps_to_reproduce: 'x', what_happened_exact_details: 'y',
    request: 'z', date_time_of_error: 'now', created_by: 'someone',
    recurrence_count: 4,
    last_recurrence_at: '2026-08-18T00:00:00.000Z',
    open_workaround_requests: 2,
    recurrence_challenged: 1,
    regression_of_submission_id: 3,
    latest_regression_submission_id: 5,
    rejection_reason: 'Could not reproduce',
  });
  assert.equal(mapped.recurrence_count, 4, 'the count is the whole point of publishing it');
  assert.equal(mapped.last_recurrence_at, '2026-08-18T00:00:00.000Z');
  for (const leaked of [
    'open_workaround_requests', 'recurrence_challenged',
    'regression_of_submission_id', 'latest_regression_submission_id', 'rejection_reason',
  ]) {
    assert.ok(!(leaked in mapped), `${leaked} must not be public`);
  }
});
