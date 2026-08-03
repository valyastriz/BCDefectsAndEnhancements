const { test } = require('node:test');
const assert = require('node:assert');

const {
  resolveAdminReadScope,
  canReadSubmissionRow,
} = require('../src/services/viewerService');

// Read scope is deliberately WIDER than write access: a team that redirected a
// ticket away keeps seeing it. These tests pin both halves of that — the widening
// is real, and it never becomes a way to see a queue you were never part of.

// Stands in for the routing ledger. `submission_routings` rows record a hand-off
// from one application to another; only from_application_id matters here.
function makeModels(routings = []) {
  return {
    SubmissionRouting: {
      findAll: async ({ where } = {}) => {
        const wanted = where?.from_application_id;
        const ids = Array.isArray(wanted) ? wanted : [wanted];
        return routings
          .filter((row) => ids.includes(row.from_application_id))
          .map((row) => ({ submission_id: row.submission_id }));
      },
    },
  };
}

// Read scope is keyed off what a seat may SEE, so a viewer seat belongs here
// exactly as much as an admin one.
const admin = (readableApplicationIds) => ({
  isAuthenticated: true, isSuperUser: false, readableApplicationIds,
});

// ── Who gets an unrestricted scope ───────────────────────────────────────────
test('a super user reads unrestricted', async () => {
  const scope = await resolveAdminReadScope(makeModels(), {
    isAuthenticated: true, isSuperUser: true, readableApplicationIds: [],
  });
  assert.strictEqual(scope.unrestricted, true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 99 }), true);
  // Including a legacy ticket that predates applications entirely.
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2, application_id: null }), true);
});

test('an admin with no grants reads nothing, not everything', async () => {
  const scope = await resolveAdminReadScope(makeModels(), admin([]));
  assert.strictEqual(scope.unrestricted, false);
  assert.deepStrictEqual(scope.applicationIds, []);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7 }), false);
});

test('an unauthenticated caller reads nothing even if ids are attached', async () => {
  // A hand-built envelope must not be able to assert rights the session never gave.
  const scope = await resolveAdminReadScope(makeModels(), {
    isAuthenticated: false, isSuperUser: false, readableApplicationIds: [7, 9],
  });
  assert.deepStrictEqual(scope.applicationIds, []);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7 }), false);
});

// ── The hand-off widening ────────────────────────────────────────────────────
test('a scoped admin reads their own applications', async () => {
  const scope = await resolveAdminReadScope(makeModels(), admin([7, 9]));
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7 }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2, application_id: 9 }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 3, application_id: 4 }), false);
});

test('a ticket redirected away stays readable to the team that sent it', async () => {
  // Ticket 42 left application 7 for application 4, so it now carries
  // application_id 4 — outside the scope by application, inside it by id.
  const scope = await resolveAdminReadScope(
    makeModels([{ submission_id: 42, from_application_id: 7 }]),
    admin([7]),
  );
  assert.strictEqual(canReadSubmissionRow(scope, { id: 42, application_id: 4 }), true);
  // Another ticket in that same foreign application is still invisible.
  assert.strictEqual(canReadSubmissionRow(scope, { id: 43, application_id: 4 }), false);
});

test('a hand-off between two other teams does not widen the scope', async () => {
  const scope = await resolveAdminReadScope(
    makeModels([{ submission_id: 42, from_application_id: 9 }]),
    admin([7]),
  );
  assert.strictEqual(canReadSubmissionRow(scope, { id: 42, application_id: 4 }), false);
});

// ── Fail-closed edges ────────────────────────────────────────────────────────
test('a missing scope admits nothing', () => {
  // The shape a caller gets by forgetting to resolve one. Empty beats open.
  assert.strictEqual(canReadSubmissionRow(undefined, { id: 1, application_id: 7 }), false);
  assert.strictEqual(canReadSubmissionRow(null, { id: 1, application_id: 7 }), false);
});

test('a ticket with no application is not readable by a scoped admin', async () => {
  const scope = await resolveAdminReadScope(makeModels(), admin([7]));
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: null }), false);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2 }), false);
});

test('a missing routing ledger narrows the scope rather than widening it', async () => {
  const scope = await resolveAdminReadScope({}, admin([7]));
  assert.deepStrictEqual(scope.applicationIds, [7]);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7 }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 42, application_id: 4 }), false);
});

test('non-numeric grant ids are dropped rather than matched loosely', async () => {
  const scope = await resolveAdminReadScope(makeModels(), admin(['seven', null, 9]));
  assert.deepStrictEqual(scope.applicationIds, [9]);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 9 }), true);
});
