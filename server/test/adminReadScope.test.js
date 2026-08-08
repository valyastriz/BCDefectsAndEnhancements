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
const TYPES = [{ id: 1, name: 'defect' }, { id: 2, name: 'enhancement' }, { id: 3, name: 'report' }];
const DEFECT = 1;
const REPORT = 3;

function makeModels(routings = []) {
  return {
    SubmissionType: { findAll: async () => TYPES.map((row) => ({ ...row })) },
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

// A grant is (user, application, role, request_type), and read used to check only
// the first two. `applicationTypeRoles` is the envelope's per-type detail.
const analyst = (readableApplicationIds, typeRoles) => ({
  isAuthenticated: true,
  isSuperUser: false,
  readableApplicationIds,
  applicationTypeRoles: typeRoles,
});

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

// ── The TYPE scope, which read ignored until the owner found it ──────────────
//
// "I signed in as pc_report_analyst and should only have access to view report
// requests on the admin side, and yet I can see all the defects and enhancements."
//
// `readableApplicationIds` collapses a caller's grants to the applications they
// touch and loses the request type each was narrowed to. Read was built from that
// list alone, so an analyst granted `report` on an application could read its
// defects — in the queue, through the detail endpoint, and in the Excel export.
test('an analyst granted report on an application cannot read its defects', async () => {
  const scope = await resolveAdminReadScope(
    makeModels(),
    analyst([7], { 7: { report: 'admin' } }),
  );
  assert.strictEqual(
    canReadSubmissionRow(scope, { id: 1, application_id: 7, type_id: REPORT }),
    true,
    'the reports they work are still readable',
  );
  assert.strictEqual(
    canReadSubmissionRow(scope, { id: 2, application_id: 7, type_id: DEFECT }),
    false,
    'this is the leak',
  );
});

test('and it holds the other way — a defect admin cannot read report requests', async () => {
  // Symmetric on purpose. A report request is only ever visible to the person who
  // filed it and the people who work them; a defect admin is neither.
  const scope = await resolveAdminReadScope(
    makeModels(),
    analyst([7], { 7: { defect: 'admin', enhancement: 'admin' } }),
  );
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7, type_id: DEFECT }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2, application_id: 7, type_id: REPORT }), false);
});

test('an all-types grant still reads everything in its application', async () => {
  // '' is the all-types grant, and it must not be narrowed to nothing by the
  // lookup — that would blank a lead admin's whole queue.
  const scope = await resolveAdminReadScope(makeModels(), analyst([7], { 7: { '': 'admin' } }));
  assert.strictEqual(scope.typeIdsByApplication.get(7), null);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7, type_id: DEFECT }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2, application_id: 7, type_id: REPORT }), true);
});

test('the type scope is per application, not pooled across them', async () => {
  // Report on 7, defects on 9. Neither grant may lend its type to the other.
  const scope = await resolveAdminReadScope(
    makeModels(),
    analyst([7, 9], { 7: { report: 'admin' }, 9: { defect: 'admin' } }),
  );
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7, type_id: REPORT }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2, application_id: 7, type_id: DEFECT }), false);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 3, application_id: 9, type_id: DEFECT }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 4, application_id: 9, type_id: REPORT }), false);
});

test('a grant naming a type this database does not have narrows to nothing', async () => {
  // An unknown request_type must NARROW access, never widen it — the same rule
  // normalizeGrantType follows.
  const scope = await resolveAdminReadScope(
    makeModels(),
    analyst([7], { 7: { 'something-new': 'admin' } }),
  );
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7, type_id: DEFECT }), false);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 2, application_id: 7, type_id: REPORT }), false);
});

test('a row with no type is admitted only by an all-types grant', async () => {
  const narrowed = await resolveAdminReadScope(makeModels(), analyst([7], { 7: { report: 'admin' } }));
  assert.strictEqual(canReadSubmissionRow(narrowed, { id: 1, application_id: 7 }), false);
  const everything = await resolveAdminReadScope(makeModels(), analyst([7], { 7: { '': 'admin' } }));
  assert.strictEqual(canReadSubmissionRow(everything, { id: 1, application_id: 7 }), true);
});

test('an envelope with no per-type detail keeps the old behaviour', async () => {
  // A cached or older envelope must not blank somebody's queue. Widening on a
  // missing map is the pre-narrowing behaviour, not a new hole: the map is built
  // server-side from the same grants on every request.
  const scope = await resolveAdminReadScope(makeModels(), admin([7]));
  assert.strictEqual(canReadSubmissionRow(scope, { id: 1, application_id: 7, type_id: DEFECT }), true);
});

test('the hand-off widening is type-scoped too', async () => {
  // Ticket 42 was handed out of application 7 by a team whose grant there covers
  // report requests only. A DEFECT they redirected is not theirs to read either.
  const scope = await resolveAdminReadScope(
    makeModels([
      { submission_id: 42, from_application_id: 7 },
      { submission_id: 43, from_application_id: 7 },
    ]),
    analyst([7], { 7: { report: 'admin' } }),
  );
  assert.strictEqual(canReadSubmissionRow(scope, { id: 42, application_id: 4, type_id: REPORT }), true);
  assert.strictEqual(canReadSubmissionRow(scope, { id: 43, application_id: 4, type_id: DEFECT }), false);
});

test('the soft association is type-scoped as well', async () => {
  // A ticket in `Other` shown in application 7. The analyst may see it only if
  // their grant on 7 covers its type — the second column answers no more than the
  // first one does.
  const scope = await resolveAdminReadScope(
    makeModels(),
    analyst([7], { 7: { report: 'admin' } }),
  );
  assert.strictEqual(
    canReadSubmissionRow(scope, { id: 1, application_id: 99, working_application_id: 7, type_id: REPORT }),
    true,
  );
  assert.strictEqual(
    canReadSubmissionRow(scope, { id: 2, application_id: 99, working_application_id: 7, type_id: DEFECT }),
    false,
  );
});
