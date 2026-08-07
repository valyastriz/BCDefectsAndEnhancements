const { test } = require('node:test');
const assert = require('node:assert');

const { canCreateReportApplication, NAME_MAX_LENGTH } = require('../src/services/reportApplicationService');

// A reporting analyst can add an application by typing a name in, and what they
// create is REPORTS-ONLY.
//
// Two rules are worth a net, and they fail in opposite directions:
//
//   1. Who may create one. The bar is a report grant somewhere — which has to be read
//      from the per-type detail, because the collapsed `applicationRoles` cannot tell
//      an analyst apart from a defect admin.
//   2. What a reports-only application refuses. A defect filed into one would sit in a
//      queue with no defect admins, visible to nobody who could work it — the exact
//      failure `Other` was invented to avoid.
//
// The refusal itself (`refuseTypeForApplication`) reads the database, so it is proved
// end to end by client/scripts/verify-submit-form.mjs rather than mocked here. What
// this file pins is the pure decision either side of it.

const viewer = (applicationTypeRoles, isSuperUser = false) => ({
  isAuthenticated: true, isSuperUser, applicationTypeRoles,
});

// ── Who may create one ───────────────────────────────────────────────────────
test('an analyst — a grant narrowed to report — may create one', () => {
  assert.strictEqual(canCreateReportApplication(viewer({ 1: { report: 'admin' } })), true);
});

test('an all-types grant covers report requests, so they may too', () => {
  // '' is the all-types grant. Stored as '' and not NULL on purpose — see
  // user_application_roles in db/models/index.js.
  assert.strictEqual(canCreateReportApplication(viewer({ 1: { '': 'admin' } })), true);
});

test('a manager may, being a rank above admin', () => {
  assert.strictEqual(canCreateReportApplication(viewer({ 2: { report: 'manager' } })), true);
});

test('a super user may, holding the one bypass', () => {
  assert.strictEqual(canCreateReportApplication(viewer({}, true)), true);
});

test('an admin for defects and enhancements only may NOT', () => {
  // The case the collapsed `applicationRoles` cannot express: this person is an
  // admin of application 1, and still works no report requests.
  assert.strictEqual(
    canCreateReportApplication(viewer({ 1: { defect: 'admin', enhancement: 'admin' } })),
    false,
  );
});

test('a viewer seat may NOT — it reads a queue and works nothing', () => {
  assert.strictEqual(canCreateReportApplication(viewer({ 1: { report: 'viewer' } })), false);
  assert.strictEqual(canCreateReportApplication(viewer({ 1: { '': 'viewer' } })), false);
});

test('somebody with no grants at all may NOT', () => {
  assert.strictEqual(canCreateReportApplication(viewer({})), false);
});

test('an anonymous caller may NOT — it fails closed on a missing viewer', () => {
  assert.strictEqual(canCreateReportApplication(null), false);
  assert.strictEqual(canCreateReportApplication(undefined), false);
  assert.strictEqual(canCreateReportApplication({}), false);
});

test('a grant type nothing recognises does not become a wildcard', () => {
  // An unknown value in request_type must NARROW access, never widen it — the same
  // rule normalizeGrantType follows.
  assert.strictEqual(canCreateReportApplication(viewer({ 1: { 'something-new': 'admin' } })), false);
});

test('one report grant among several applications is enough', () => {
  assert.strictEqual(
    canCreateReportApplication(viewer({
      1: { defect: 'admin', enhancement: 'admin' },
      2: { report: 'admin' },
    })),
    true,
  );
});

// ── The name rule ────────────────────────────────────────────────────────────
test('the name cap is stated as a constant, not repeated in a message', () => {
  // The route's error names this number. A literal in the copy and a literal in the
  // check drift, and the copy is the one nobody tests.
  assert.strictEqual(typeof NAME_MAX_LENGTH, 'number');
  assert.ok(NAME_MAX_LENGTH > 0);
});
