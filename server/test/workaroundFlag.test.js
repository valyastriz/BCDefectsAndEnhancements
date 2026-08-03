const { test } = require('node:test');
const assert = require('node:assert');

const { parseBooleanFlag } = require('../src/helpers/utils');
const { mapSubmission, mapPublicSubmission } = require('../src/helpers/mappers');

// ── Flag parsing ──────────────────────────────────────────────────────────
// The submit form posts multipart, so the checkbox crosses the wire as a
// STRING. `toBooleanSql` alone would read "false" as true, which would flag
// every defect as blocking.

test('the affirmative spellings all read as on', () => {
  for (const value of [true, 1, 'true', 'TRUE', '1', 'yes', 'on', ' true ']) {
    assert.equal(parseBooleanFlag(value), true, `${JSON.stringify(value)} should be on`);
  }
});

test('the string "false" reads as off, not as a non-empty string', () => {
  // The regression this helper exists for.
  assert.equal(parseBooleanFlag('false'), false);
  assert.equal(Boolean('false'), true, 'which is why the plain cast is wrong');
});

test('everything unrecognised reads as off', () => {
  for (const value of [false, 0, '0', 'no', 'off', '', '   ', null, undefined, 'maybe', {}]) {
    assert.equal(parseBooleanFlag(value), false, `${JSON.stringify(value)} should be off`);
  }
});

// ── Exposure ──────────────────────────────────────────────────────────────

const row = (overrides = {}) => ({
  id: 7,
  model_type_name: 'defect',
  model_status_name: 'New',
  summary_of_issue: 'Renewal invoice shows the prior term amount',
  created_by: 'Jane Rep',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

test('the admin mapper exposes both flags as real booleans', () => {
  // They are stored 1/0, and the client checks them with plain truthiness.
  const mapped = mapSubmission(row({ needs_workaround: 1, workaround_provided: 0 }));
  assert.strictEqual(mapped.needs_workaround, true);
  assert.strictEqual(mapped.workaround_provided, false);
});

test('a ticket nobody flagged reads false rather than undefined', () => {
  const mapped = mapSubmission(row());
  assert.strictEqual(mapped.needs_workaround, false);
  assert.strictEqual(mapped.workaround_provided, false);
});

test('neither flag reaches the public status board', () => {
  // Who is blocked internally is triage information, not something to publish.
  const published = mapPublicSubmission(row({ needs_workaround: 1, workaround_provided: 1 }));
  assert.equal(Object.prototype.hasOwnProperty.call(published, 'needs_workaround'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(published, 'workaround_provided'), false);
});

// ── The open/handled/any split ────────────────────────────────────────────
// Mirrors the filter in listFilteredAdminSubmissions. Three states, because a
// ticket nobody flagged is neither open nor handled.

function matchesWorkaroundFilter(workaround, r) {
  if (!workaround) return true;
  const requested = Boolean(r.needs_workaround);
  const handled = Boolean(r.workaround_provided);
  if (workaround === 'open' && !(requested && !handled)) return false;
  if (workaround === 'handled' && !(requested && handled)) return false;
  if (workaround === 'any' && !requested) return false;
  return true;
}

test('open means asked and not yet handled', () => {
  const never = { needs_workaround: 0, workaround_provided: 0 };
  const open = { needs_workaround: 1, workaround_provided: 0 };
  const done = { needs_workaround: 1, workaround_provided: 1 };

  assert.deepEqual(
    [never, open, done].map((r) => matchesWorkaroundFilter('open', r)),
    [false, true, false],
  );
  assert.deepEqual(
    [never, open, done].map((r) => matchesWorkaroundFilter('handled', r)),
    [false, false, true],
    'a ticket nobody flagged must not count as handled',
  );
  assert.deepEqual(
    [never, open, done].map((r) => matchesWorkaroundFilter('any', r)),
    [false, true, true],
  );
  assert.deepEqual(
    [never, open, done].map((r) => matchesWorkaroundFilter('', r)),
    [true, true, true],
    'no filter selected must not narrow anything',
  );
});
