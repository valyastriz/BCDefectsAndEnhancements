const { test } = require('node:test');
const assert = require('node:assert');

const { filingRequiresSignIn, SUBMISSION_TYPE_REPORT } = require('../src/constants');
const { SUBMIT_REQUIRES_AUTH } = require('../src/config');

// FILING REQUIRES A SIGNED-IN PERSON, for every request type.
//
// This flipped on 2026-08-07. It had defaulted to `AUTH_MODE === 'sso'` because
// the local login was admin-only, so arming it earlier would have left the submit
// form reachable by nobody. The `rep` account role removed that constraint — a
// requester signs in through the local login today — and the owner's call was to
// take the anonymous door off.
//
// Two claims are worth a net, and they fail in opposite directions:
//
//   1. The DEFAULT is on. Left as `AUTH_MODE === 'sso'`, the deployed app would go
//      on accepting anonymous defects and enhancements while the documentation
//      said it did not.
//   2. The report request's requirement SURVIVES the global switch being turned
//      off. `SUBMIT_REQUIRES_AUTH=false` exists as an escape hatch, and it must
//      not silently re-open the anonymous path for the one type whose whole
//      visibility rule depends on having a reporter.
//
// resolveReporter's own behaviour under `requireAuthenticated` is pinned in
// test/reporter.test.js; this file is about which types get that treatment.

// ── The default ──────────────────────────────────────────────────────────────
test('SUBMIT_REQUIRES_AUTH defaults ON', () => {
  // Read from config as the app reads it. If a local `.env` sets it to false this
  // fails — which is correct: it means this machine is not running the behaviour
  // the rest of this file describes.
  assert.strictEqual(
    SUBMIT_REQUIRES_AUTH,
    true,
    'filing anonymously is closed by default; SUBMIT_REQUIRES_AUTH=false in the environment is the only way to re-open it',
  );
});

// ── With the switch on: every type needs a session ────────────────────────────
for (const type of ['defect', 'enhancement', SUBMISSION_TYPE_REPORT]) {
  test(`a ${type} requires signing in when the switch is on`, () => {
    assert.strictEqual(filingRequiresSignIn(type, true), true);
  });
}

test('an unrecognised type requires signing in too — it fails closed', () => {
  assert.strictEqual(filingRequiresSignIn('something-new', true), true);
  assert.strictEqual(filingRequiresSignIn('', true), true);
  assert.strictEqual(filingRequiresSignIn(undefined, true), true);
});

// ── With the switch off: only the report request keeps the requirement ────────
test('a report request STILL requires signing in when the switch is off', () => {
  // The clause this pins is the one a tidy-up would delete as redundant. It is
  // not: a report request is visible only to the person who filed it, so an
  // anonymous one is a row nobody can ever read.
  assert.strictEqual(filingRequiresSignIn(SUBMISSION_TYPE_REPORT, false), true);
});

test('and it is matched case- and space-insensitively, like every other type read', () => {
  assert.strictEqual(filingRequiresSignIn('  Report  ', false), true);
  assert.strictEqual(filingRequiresSignIn('REPORT', false), true);
});

test('a defect and an enhancement are open again when the switch is off', () => {
  // The escape hatch has to actually work, or it is not an escape hatch.
  assert.strictEqual(filingRequiresSignIn('defect', false), false);
  assert.strictEqual(filingRequiresSignIn('enhancement', false), false);
});
