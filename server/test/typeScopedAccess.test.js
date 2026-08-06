// Type-scoped grants and the manager rank.
//
// This is the half of Phase 1 where a miss leaks a ticket, so it gets its own
// file. The question every case here asks is the same one: does narrowing a
// grant to one request type actually narrow anything, and does it narrow ONLY
// what it should?
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveApplicationRoles,
  roleInApplication,
  canReadApplication,
  canMutateApplication,
  canManageApplication,
} = require('../src/services/viewerService');

const APPS = [{ id: 7, name: 'Billing Center' }, { id: 9, name: 'Policy Center' }];

function makeModels({ roles = [] } = {}) {
  return {
    UserApplicationRole: {
      findAll: async ({ where }) => roles.filter((row) => row.user_id === where.user_id),
    },
  };
}

/** The viewer envelope resolveViewer would build for these grant rows. */
async function viewerWith(rows, { isSuperUser = false } = {}) {
  const { roles, typeRoles } = await resolveApplicationRoles(makeModels({ roles: rows }), {
    userId: 1,
    isSuperUser,
    applications: APPS,
  });
  return {
    isAuthenticated: true,
    isSuperUser,
    applicationRoles: roles,
    applicationTypeRoles: typeRoles,
  };
}

const grant = (application_id, role, request_type = '') => ({
  user_id: 1, application_id, role, request_type,
});

// ── An analyst: an admin grant narrowed to one request type ──────────────────

test('an analyst may write their own type and NOT another', async () => {
  const viewer = await viewerWith([grant(7, 'admin', 'report')]);

  assert.equal(canMutateApplication(viewer, 7, 'report'), true, 'their own type');
  assert.equal(canMutateApplication(viewer, 7, 'defect'), false, 'a defect is not theirs');
  assert.equal(canMutateApplication(viewer, 7, 'enhancement'), false, 'nor an enhancement');
});

test('an unresolvable type satisfies no narrowed grant', async () => {
  const viewer = await viewerWith([grant(7, 'admin', 'report')]);
  // getSubmissionTypeNameById returns '' when a row's type_id resolves to
  // nothing. That must fail closed rather than matching the all-types slot,
  // which is also ''. This is the case a corrupt row would hit.
  assert.equal(canMutateApplication(viewer, 7, ''), false);
  assert.equal(canMutateApplication(viewer, 7, 'something-else'), false);
});

test('omitting the type asks the weaker question, and still answers it', async () => {
  const viewer = await viewerWith([grant(7, 'admin', 'report')]);
  // "May this person work in this queue at all" — yes. This is the right
  // question for a queue-level check and the WRONG one for a write, which is
  // why every write call site passes a type.
  assert.equal(canMutateApplication(viewer, 7), true);
  assert.equal(roleInApplication(viewer, 7), 'admin');
});

test('an all-types grant covers every type, including one nobody has heard of', async () => {
  const viewer = await viewerWith([grant(7, 'admin')]);
  for (const type of ['defect', 'enhancement', 'report', 'business-card']) {
    assert.equal(canMutateApplication(viewer, 7, type), true, type);
  }
});

test('two grants on one application compose: the stronger wins per type', async () => {
  const viewer = await viewerWith([
    grant(7, 'viewer'),            // read everything
    grant(7, 'admin', 'report'),   // write report requests
  ]);

  assert.equal(canReadApplication(viewer, 7, 'defect'), true, 'reads a defect');
  assert.equal(canMutateApplication(viewer, 7, 'defect'), false, 'but cannot change it');
  assert.equal(canMutateApplication(viewer, 7, 'report'), true, 'writes a report request');
});

test('a grant on one application says nothing about another', async () => {
  const viewer = await viewerWith([grant(7, 'admin', 'report')]);
  assert.equal(canMutateApplication(viewer, 9, 'report'), false);
  assert.equal(canReadApplication(viewer, 9, 'report'), false);
});

// ── The manager rank ─────────────────────────────────────────────────────────

test('manager outranks admin, and admin does not reach it', async () => {
  const manager = await viewerWith([grant(7, 'manager')]);
  const admin = await viewerWith([grant(7, 'admin')]);

  assert.equal(canManageApplication(manager, 7), true);
  assert.equal(canManageApplication(admin, 7), false, 'an admin sees their own numbers only');
  // A manager can still do everything an admin can — it is a ladder, not a
  // sideways role.
  assert.equal(canMutateApplication(admin, 7, 'report'), true);
  assert.equal(canMutateApplication(manager, 7, 'report'), true);
});

test('managing is per application, not global', async () => {
  const viewer = await viewerWith([grant(7, 'manager'), grant(9, 'admin')]);
  assert.equal(canManageApplication(viewer, 7), true);
  assert.equal(canManageApplication(viewer, 9), false);
});

test('a super user manages everywhere', async () => {
  const viewer = await viewerWith([], { isSuperUser: true });
  assert.equal(canManageApplication(viewer, 7), true);
  assert.equal(canManageApplication(viewer, 4242), true, 'even one with no grant row');
  assert.equal(canMutateApplication(viewer, 7, 'report'), true);
});

test('an unauthenticated caller manages nothing', () => {
  const anonymous = { isAuthenticated: false, applicationRoles: { 7: 'manager' }, applicationTypeRoles: { 7: { '': 'manager' } } };
  assert.equal(canManageApplication(anonymous, 7), false);
  assert.equal(canMutateApplication(anonymous, 7, 'report'), false);
  assert.equal(canReadApplication(anonymous, 7, 'report'), false);
});

// ── Nothing existing changed ─────────────────────────────────────────────────

test('every grant that predates type scoping still covers everything', async () => {
  // What the migration leaves behind: request_type defaulted to ''. Whatever an
  // admin could do yesterday they can do today.
  const viewer = await viewerWith([grant(7, 'admin', '')]);
  assert.equal(canMutateApplication(viewer, 7, 'defect'), true);
  assert.equal(canMutateApplication(viewer, 7, 'enhancement'), true);
  assert.equal(canMutateApplication(viewer, 7, 'report'), true);
  assert.equal(canManageApplication(viewer, 7), false, 'but it does not promote them');
});

test('an envelope from before type scoping falls back rather than locking everyone out', async () => {
  // A session cached before this shipped has applicationRoles and no
  // applicationTypeRoles. Refusing would lock out every admin mid-shift; on a
  // portal with no type-scoped grants the two answers are identical anyway.
  const stale = { isAuthenticated: true, isSuperUser: false, applicationRoles: { 7: 'admin' } };
  assert.equal(canMutateApplication(stale, 7, 'defect'), true);
  assert.equal(canMutateApplication(stale, 7, 'report'), true);
});

test('an unrecognised role is still not a grant, at any type', async () => {
  const viewer = await viewerWith([grant(7, 'supervisor', 'report')]);
  assert.equal(canMutateApplication(viewer, 7, 'report'), false);
  assert.equal(canReadApplication(viewer, 7, 'report'), false);
  assert.equal(canManageApplication(viewer, 7), false);
});
