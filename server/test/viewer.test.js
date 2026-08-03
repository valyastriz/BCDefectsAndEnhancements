const { test } = require('node:test');
const assert = require('node:assert');

const {
  resolveSessionIdentity,
  resolveHomeApplicationId,
  resolveApplicationRoles,
  resolveMemberApplicationIds,
  applicationIdsWithRole,
  buildApplicationScopeWhere,
  canReadApplication,
  canMutateApplication,
  resolveViewer,
} = require('../src/services/viewerService');

// ── Fakes ────────────────────────────────────────────────────────────────────
// The service takes `models` and `sequelize` as parameters precisely so it can be
// tested without a database, matching this suite's existing style.
const APPS = [
  { id: 7, name: 'Billing Center', sort_order: 1, is_active: 1 },
  { id: 9, name: 'Policy Center', sort_order: 2, is_active: 1 },
  { id: 4, name: 'Claim Center', sort_order: 3, is_active: 1 },
];

function makeModels({ apps = APPS, roles = [], adGroups = [], users = [] } = {}) {
  const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });

  return {
    Application: {
      findAll: async ({ where } = {}) => apps
        .filter((app) => matches(app, where))
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    },
    UserApplicationRole: {
      findAll: async ({ where } = {}) => roles.filter((role) => matches(role, where)),
    },
    ApplicationAdGroup: {
      findOne: async ({ where } = {}) => adGroups.filter((g) => matches(g, where))
        .sort((a, b) => a.id - b.id)[0] || null,
      findAll: async ({ where } = {}) => adGroups.filter((g) => matches(g, where)),
    },
    User: {
      findByPk: async (id) => users.find((user) => Number(user.id) === Number(id)) || null,
    },
  };
}

// Stands in for the raw most-filed-application aggregate.
function makeSequelize(rows = []) {
  return { query: async () => rows };
}

// ── The fail-closed guarantee ────────────────────────────────────────────────
// This is the single most important behaviour in the access model: an admin with
// no grants must see NOTHING, never everything. `{ application_id: [] }` renders
// as IN (NULL) and matches no rows, so the failure mode is empty rather than open.
test('buildApplicationScopeWhere fails closed for an admin with no grants', () => {
  assert.deepStrictEqual(
    buildApplicationScopeWhere({ isSuperUser: false, readableApplicationIds: [] }),
    { application_id: [] },
  );
});

test('buildApplicationScopeWhere fails closed for a missing or malformed viewer', () => {
  assert.deepStrictEqual(buildApplicationScopeWhere(undefined), { application_id: [] });
  assert.deepStrictEqual(buildApplicationScopeWhere(null), { application_id: [] });
  assert.deepStrictEqual(buildApplicationScopeWhere({}), { application_id: [] });
  // A non-array must not become an unfiltered query.
  assert.deepStrictEqual(
    buildApplicationScopeWhere({ readableApplicationIds: 'all' }),
    { application_id: [] },
  );
});

test('buildApplicationScopeWhere scopes to what the caller may READ', () => {
  // A viewer seat is in here as well as an admin one — reading is the question.
  assert.deepStrictEqual(
    buildApplicationScopeWhere({ isSuperUser: false, readableApplicationIds: [7, 9] }),
    { application_id: [7, 9] },
  );
});

test('buildApplicationScopeWhere is unfiltered ONLY for a super user', () => {
  assert.deepStrictEqual(
    buildApplicationScopeWhere({ isSuperUser: true, readableApplicationIds: [] }),
    {},
  );
});

// ── Roles: what each seat may do ─────────────────────────────────────────────
const seat = (applicationRoles) => ({ isAuthenticated: true, isSuperUser: false, applicationRoles });

test('a viewer may read its application and change nothing', () => {
  const viewer = seat({ 7: 'viewer' });
  assert.strictEqual(canReadApplication(viewer, 7), true);
  assert.strictEqual(canMutateApplication(viewer, 7), false, 'read-only means read-only');
});

test('an admin may both read and change its application', () => {
  const viewer = seat({ 7: 'admin' });
  assert.strictEqual(canReadApplication(viewer, 7), true);
  assert.strictEqual(canMutateApplication(viewer, 7), true);
});

test('a role in one application says nothing about another', () => {
  const viewer = seat({ 7: 'admin', 9: 'viewer' });
  assert.strictEqual(canMutateApplication(viewer, 9), false);
  assert.strictEqual(canReadApplication(viewer, 4), false);
  assert.strictEqual(canMutateApplication(viewer, 4), false);
});

test('an unrecognised role grants nothing rather than something', () => {
  // A row someone hand-edited to a role the catalog does not know must not be
  // read as "some access" — it is no access.
  const viewer = seat({ 7: 'superadmin', 9: '', 4: null });
  assert.strictEqual(canReadApplication(viewer, 7), false);
  assert.strictEqual(canMutateApplication(viewer, 7), false);
  assert.strictEqual(canReadApplication(viewer, 9), false);
  assert.strictEqual(canReadApplication(viewer, 4), false);
});

test('canMutateApplication refuses an unauthenticated caller', () => {
  assert.strictEqual(canMutateApplication({ isAuthenticated: false, applicationRoles: { 7: 'admin' } }, 7), false);
  assert.strictEqual(canReadApplication({ isAuthenticated: false, applicationRoles: { 7: 'admin' } }, 7), false);
});

test('canMutateApplication refuses a missing or unparseable application id', () => {
  const viewer = seat({ 7: 'admin' });
  assert.strictEqual(canMutateApplication(viewer, null), false);
  assert.strictEqual(canMutateApplication(viewer, undefined), false);
  assert.strictEqual(canMutateApplication(viewer, 'seven'), false);
  assert.strictEqual(canMutateApplication(viewer, 0), false);
});

test('canMutateApplication allows a super user anywhere', () => {
  const viewer = { isAuthenticated: true, isSuperUser: true, applicationRoles: {} };
  assert.strictEqual(canMutateApplication(viewer, 4), true);
  assert.strictEqual(canReadApplication(viewer, 4), true);
});

test('applicationIdsWithRole splits the seats by capability', () => {
  const roles = { 7: 'admin', 9: 'viewer', 4: 'admin' };
  assert.deepStrictEqual(applicationIdsWithRole(roles, 'admin'), [4, 7]);
  assert.deepStrictEqual(applicationIdsWithRole(roles, 'viewer'), [4, 7, 9], 'admin outranks viewer');
});

// ── The SSO seam ─────────────────────────────────────────────────────────────
test('resolveSessionIdentity returns null when there is no session user', () => {
  assert.strictEqual(resolveSessionIdentity({}), null);
  assert.strictEqual(resolveSessionIdentity({ session: {} }), null);
});

test('resolveSessionIdentity defaults groups to an empty list and drops blanks', () => {
  const withoutGroups = resolveSessionIdentity({ session: { user: { id: 1, username: 'a', role: 'admin' } } });
  assert.deepStrictEqual(withoutGroups.groups, []);

  const withGroups = resolveSessionIdentity({
    session: { user: { id: 1, username: 'a', role: 'admin', groups: ['GG-BC-Triage', '', null] } },
  });
  assert.deepStrictEqual(withGroups.groups, ['GG-BC-Triage']);
});

// ── Which applications may be triaged ────────────────────────────────────────
test('resolveApplicationRoles makes a super user admin of every active application', async () => {
  const roles = await resolveApplicationRoles(makeModels(), {
    userId: 1, isSuperUser: true, applications: APPS.map((a) => ({ id: a.id, name: a.name })),
  });
  assert.deepStrictEqual(roles, { 7: 'admin', 9: 'admin', 4: 'admin' });
});

test('resolveApplicationRoles returns nothing when nothing is granted', async () => {
  const roles = await resolveApplicationRoles(makeModels(), {
    userId: 1, isSuperUser: false, applications: [],
  });
  assert.deepStrictEqual(roles, {});
});

test('resolveApplicationRoles reads hand-set grants and keeps each role', async () => {
  const models = makeModels({
    roles: [
      { user_id: 1, application_id: 9, role: 'viewer' },
      { user_id: 1, application_id: 7, role: 'admin' },
      { user_id: 2, application_id: 4, role: 'admin' },
    ],
  });
  const roles = await resolveApplicationRoles(models, {
    userId: 1, isSuperUser: false, applications: [],
  });
  // Another user's grant is not leaked in.
  assert.deepStrictEqual(roles, { 7: 'admin', 9: 'viewer' });
});

test('resolveApplicationRoles keeps the stronger role when two rows disagree', async () => {
  const models = makeModels({
    roles: [
      { user_id: 1, application_id: 7, role: 'viewer' },
      { user_id: 1, application_id: 7, role: 'admin' },
    ],
  });
  const roles = await resolveApplicationRoles(models, { userId: 1, isSuperUser: false, applications: [] });
  assert.deepStrictEqual(roles, { 7: 'admin' });
});

test('resolveApplicationRoles drops a role the catalog does not recognise', async () => {
  const models = makeModels({
    roles: [
      { user_id: 1, application_id: 7, role: 'superadmin' },
      { user_id: 1, application_id: 9, role: 'admin' },
    ],
  });
  const roles = await resolveApplicationRoles(models, { userId: 1, isSuperUser: false, applications: [] });
  assert.deepStrictEqual(roles, { 9: 'admin' }, 'an unknown role is not a grant');
});

// ── Active Directory decides WHICH APPLICATIONS someone works in, not what ────
// they may triage. Being added to a group must never confer the ability to
// change another team's tickets — a super user grants that, deliberately.
test('an AD group grants no triage rights at all', async () => {
  const models = makeModels({
    adGroups: [
      { id: 1, application_id: 7, group_name: 'GG-BC-Triage', role: 'admin', is_active: 1 },
      { id: 2, application_id: 4, group_name: 'GG-CC-Triage', role: 'admin', is_active: 1 },
    ],
  });

  const roles = await resolveApplicationRoles(models, {
    userId: 1, isSuperUser: false, applications: [],
  });
  assert.deepStrictEqual(roles, {}, 'group membership is not a grant, even at role=admin');
});

test('resolveMemberApplicationIds reports the applications the groups map to', async () => {
  const models = makeModels({
    adGroups: [
      { id: 1, application_id: 7, group_name: 'GG-BC', role: 'admin', is_active: 1 },
      { id: 2, application_id: 4, group_name: 'GG-CC', role: 'admin', is_active: 1 },
    ],
  });
  const ids = await resolveMemberApplicationIds(models, { groups: ['GG-BC', 'GG-CC'] });
  assert.deepStrictEqual(ids, [4, 7]);
});

test('resolveMemberApplicationIds ignores an inactive mapping', async () => {
  const models = makeModels({
    adGroups: [{ id: 1, application_id: 4, group_name: 'GG-Old', role: 'admin', is_active: 0 }],
  });
  const ids = await resolveMemberApplicationIds(models, { groups: ['GG-Old'] });
  assert.deepStrictEqual(ids, []);
});

// ── Home application, in priority order ──────────────────────────────────────
test('home application prefers a mapped AD group over ticket history', async () => {
  const models = makeModels({
    adGroups: [{ id: 1, application_id: 4, group_name: 'GG-CC', role: 'admin', is_active: 1 }],
  });
  // History says 9; the group says 4. The group wins.
  const id = await resolveHomeApplicationId(models, makeSequelize([{ application_id: 9, n: 12 }]), {
    userId: 1, groups: ['GG-CC'],
  });
  assert.strictEqual(id, 4);
});

test('home application falls back to the most-filed application', async () => {
  const id = await resolveHomeApplicationId(makeModels(), makeSequelize([{ application_id: 9, n: 12 }]), {
    userId: 1, groups: [],
  });
  assert.strictEqual(id, 9);
});

test('home application falls back to the first active application', async () => {
  // No groups, no filing history at all.
  const id = await resolveHomeApplicationId(makeModels(), makeSequelize([]), { userId: 1, groups: [] });
  assert.strictEqual(id, 7, 'lowest sort_order wins');
});

test('home application is null when the portal has no active applications', async () => {
  const id = await resolveHomeApplicationId(makeModels({ apps: [] }), makeSequelize([]), {
    userId: null, groups: [],
  });
  assert.strictEqual(id, null);
});

test('home application ignores a history row with a null application', async () => {
  const id = await resolveHomeApplicationId(makeModels(), makeSequelize([{ application_id: null, n: 3 }]), {
    userId: 1, groups: [],
  });
  assert.strictEqual(id, 7, 'falls through to the default rather than returning null');
});

// ── The envelope ─────────────────────────────────────────────────────────────
test('resolveViewer returns the anonymous shape without throwing', async () => {
  const viewer = await resolveViewer({ session: {} }, {
    models: makeModels(), sequelize: makeSequelize([]),
  });
  assert.strictEqual(viewer.isAuthenticated, false);
  assert.strictEqual(viewer.user, null);
  assert.strictEqual(viewer.isSuperUser, false);
  assert.deepStrictEqual(viewer.adminApplicationIds, []);
  assert.strictEqual(viewer.canAdminAnyApplication, false);
  // Still prefilled, so the board is never unscoped on a first anonymous load.
  assert.strictEqual(viewer.homeApplicationId, 7);
  assert.strictEqual(viewer.applications.length, 3);
});

test('resolveViewer reads rights from the users row, not the session copy', async () => {
  // The session claims role=admin. The row says is_super_user = 0 and there are
  // no grants — so this caller administers nothing. A stale session must not be
  // able to assert access it no longer has.
  const models = makeModels({
    users: [{ id: 5, username: 'ops_admin', role: 'admin', is_super_user: 0, display_name: null, email: null }],
  });
  const viewer = await resolveViewer(
    { session: { user: { id: 5, username: 'ops_admin', role: 'admin' } } },
    { models, sequelize: makeSequelize([]) },
  );
  assert.strictEqual(viewer.isAuthenticated, true);
  assert.strictEqual(viewer.isSuperUser, false);
  assert.deepStrictEqual(viewer.adminApplicationIds, []);
  assert.strictEqual(viewer.canAdminAnyApplication, false);
  // Display name falls back to the username so the UI always has something.
  assert.strictEqual(viewer.user.displayName, 'ops_admin');
});

test('resolveViewer promotes a super user from the row', async () => {
  const models = makeModels({
    users: [{ id: 1, username: 'admin', role: 'admin', is_super_user: 1, display_name: 'Portal Admin', email: 'a@b.c' }],
  });
  const viewer = await resolveViewer(
    { session: { user: { id: 1, username: 'admin', role: 'admin' } } },
    { models, sequelize: makeSequelize([]) },
  );
  assert.strictEqual(viewer.isSuperUser, true);
  // Ascending by id, the same ordering every seat gets — these lists are used
  // for IN (...) scoping and membership tests, never for display.
  assert.deepStrictEqual(viewer.adminApplicationIds, [4, 7, 9]);
  assert.deepStrictEqual(viewer.readableApplicationIds, [4, 7, 9]);
  assert.strictEqual(viewer.canAdminAnyApplication, true);
  assert.strictEqual(viewer.user.displayName, 'Portal Admin');
});

test('resolveViewer fails closed when the session points at a deleted user', async () => {
  const viewer = await resolveViewer(
    { session: { user: { id: 999, username: 'ghost', role: 'admin' } } },
    { models: makeModels(), sequelize: makeSequelize([]) },
  );
  assert.strictEqual(viewer.isAuthenticated, false);
  assert.strictEqual(viewer.isSuperUser, false);
  assert.deepStrictEqual(viewer.adminApplicationIds, []);
});

test('resolveViewer separates what a viewer seat may read from what it may administer', async () => {
  const models = makeModels({
    users: [{ id: 5, username: 'audit', role: 'admin', is_super_user: 0 }],
    roles: [
      { user_id: 5, application_id: 7, role: 'viewer' },
      { user_id: 5, application_id: 9, role: 'admin' },
    ],
  });
  const viewer = await resolveViewer(
    { session: { user: { id: 5, username: 'audit', role: 'admin' } } },
    { models, sequelize: makeSequelize([]) },
  );

  assert.deepStrictEqual(viewer.applicationRoles, { 7: 'viewer', 9: 'admin' });
  assert.deepStrictEqual(viewer.readableApplicationIds, [7, 9]);
  assert.deepStrictEqual(viewer.adminApplicationIds, [9], 'the viewer seat is not an admin seat');
  assert.strictEqual(viewer.canAdminAnyApplication, true);
});

test('resolveViewer reports a viewer-only seat as administering nothing', async () => {
  const models = makeModels({
    users: [{ id: 5, username: 'audit', role: 'admin', is_super_user: 0 }],
    roles: [{ user_id: 5, application_id: 7, role: 'viewer' }],
  });
  const viewer = await resolveViewer(
    { session: { user: { id: 5, username: 'audit', role: 'admin' } } },
    { models, sequelize: makeSequelize([]) },
  );

  assert.deepStrictEqual(viewer.readableApplicationIds, [7]);
  assert.deepStrictEqual(viewer.adminApplicationIds, []);
  assert.strictEqual(viewer.canAdminAnyApplication, false, 'read-only is not "can administer"');
});

test('resolveViewer reports AD membership without turning it into a grant', async () => {
  const models = makeModels({
    users: [{ id: 5, username: 'rep', role: 'admin', is_super_user: 0 }],
    adGroups: [{ id: 1, application_id: 4, group_name: 'GG-CC', role: 'admin', is_active: 1 }],
  });
  const viewer = await resolveViewer(
    { session: { user: { id: 5, username: 'rep', role: 'admin', groups: ['GG-CC'] } } },
    { models, sequelize: makeSequelize([]) },
  );

  // The group says which product this person works in...
  assert.deepStrictEqual(viewer.memberApplicationIds, [4]);
  assert.strictEqual(viewer.homeApplicationId, 4);
  // ...and gives them nothing to triage.
  assert.deepStrictEqual(viewer.applicationRoles, {});
  assert.deepStrictEqual(viewer.readableApplicationIds, []);
  assert.strictEqual(viewer.canAdminAnyApplication, false);
});

test('resolveViewer reports an impersonated session as impersonating', async () => {
  const models = makeModels({
    users: [{ id: 1, username: 'admin', role: 'admin', is_super_user: 1 }],
  });
  const viewer = await resolveViewer(
    { session: { user: { id: 1, username: 'admin', role: 'admin' }, impersonating: true } },
    { models, sequelize: makeSequelize([]) },
  );
  assert.strictEqual(viewer.impersonating, true);
});
