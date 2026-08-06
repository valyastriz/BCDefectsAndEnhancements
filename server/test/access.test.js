const { test } = require('node:test');
const assert = require('node:assert');

const {
  listAccess,
  setUserGrants,
  bulkSetAccess,
  setUserSuperUser,
  addAdGroupMapping,
  removeAdGroupMapping,
} = require('../src/services/accessService');

// This service is the only place triage rights widen, so the tests are about the
// guards as much as the happy path: a grant can never point at an application
// that isn't there, and the portal can never end up with nobody able to grant.

const APPS = [
  { id: 7, name: 'Billing Center', sort_order: 1, is_active: 1 },
  { id: 9, name: 'Policy Center', sort_order: 2, is_active: 1 },
  { id: 4, name: 'Retired Center', sort_order: 3, is_active: 0 },
];

function makeModels({ apps = APPS, users = [], grants = [], adGroups = [] } = {}) {
  const store = {
    grants: [...grants],
    users: users.map((user) => ({ ...user })),
    adGroups: adGroups.map((row) => ({ ...row })),
    nextAdGroupId: 100,
  };

  const matches = (row, where = {}) => Object.entries(where).every(([key, expected]) => {
    if (Array.isArray(expected)) return expected.includes(row[key]);
    return row[key] === expected;
  });

  return {
    store,
    Application: {
      findAll: async ({ where } = {}) => apps
        .filter((app) => matches(app, where))
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order),
    },
    User: {
      findAll: async ({ where } = {}) => store.users
        .filter((user) => matches(user, where))
        .slice()
        .sort((a, b) => String(a.username).localeCompare(String(b.username))),
      findByPk: async (id) => store.users.find((user) => Number(user.id) === Number(id)) || null,
      count: async ({ where } = {}) => store.users.filter((user) => matches(user, where)).length,
      update: async (values, { where }) => {
        for (const user of store.users) {
          if (Number(user.id) === Number(where.id)) Object.assign(user, values);
        }
      },
    },
    UserApplicationRole: {
      findAll: async ({ where } = {}) => store.grants.filter((grant) => matches(grant, where)),
      destroy: async ({ where }) => {
        store.grants = store.grants.filter((grant) => !matches(grant, where));
      },
      bulkCreate: async (rows) => {
        store.grants.push(...rows);
      },
    },
    ApplicationAdGroup: {
      findAll: async ({ where } = {}) => store.adGroups.filter((row) => matches(row, where)),
      findOne: async ({ where } = {}) => store.adGroups.find((row) => matches(row, where)) || null,
      create: async (values) => {
        const row = { id: store.nextAdGroupId++, ...values };
        store.adGroups.push(row);
        return row;
      },
      destroy: async ({ where }) => {
        const before = store.adGroups.length;
        store.adGroups = store.adGroups.filter((row) => !matches(row, where));
        return before - store.adGroups.length;
      },
    },
  };
}

// Stands in for the grouped ticket-count read behind the per-application totals.
const makeCountingSequelize = (rows = []) => ({
  transaction: async (fn) => fn('tx'),
  query: async () => rows,
});

// Runs the callback the way a real transaction would, so the replace is exercised
// in the order the service commits it.
const makeSequelize = () => ({ transaction: async (fn) => fn('tx') });

// ── The page payload ─────────────────────────────────────────────────────────
test('listAccess reports each account with the applications it holds', async () => {
  const models = makeModels({
    users: [
      { id: 1, username: 'admin', display_name: 'Portal Admin', email: 'a@b.c', role: 'admin', is_super_user: 1 },
      { id: 2, username: 'lead_admin', display_name: null, email: null, role: 'admin', is_super_user: 0 },
    ],
    grants: [
      { user_id: 2, application_id: 9, role: 'viewer' },
      { user_id: 2, application_id: 7, role: 'admin' },
    ],
  });

  const access = await listAccess(models);

  // Only ACTIVE applications can be granted, so the retired one is not offered.
  // Asserted field by field rather than as a whole object: the row also carries
  // EasyVista catalog state, which depends on the environment and is covered by
  // easyVistaCatalog.test.js.
  assert.deepStrictEqual(
    access.applications.map((app) => ({ id: app.id, name: app.name, ticketCount: app.ticketCount })),
    [
      { id: 7, name: 'Billing Center', ticketCount: 0 },
      { id: 9, name: 'Policy Center', ticketCount: 0 },
    ],
  );

  const [admin, lead] = access.users;
  assert.strictEqual(admin.username, 'admin');
  assert.strictEqual(admin.isSuperUser, true);
  assert.deepStrictEqual(admin.grants, []);
  // A super user holds no rows — the bypass is the flag, not a pile of grants.

  assert.strictEqual(lead.isSuperUser, false);
  assert.deepStrictEqual(
    lead.grants,
    [
      { applicationId: 7, role: 'admin', requestType: '' },
      { applicationId: 9, role: 'viewer', requestType: '' },
    ],
    'sorted, so the page is stable',
  );
  assert.strictEqual(lead.displayName, 'lead_admin', 'falls back to the username');
});

test('listAccess reports how many tickets each application holds', async () => {
  const models = makeModels({ users: [{ id: 1, username: 'admin', is_super_user: 1 }] });
  const sequelize = makeCountingSequelize([
    { application_id: 7, n: 82 },
    { application_id: 9, n: 0 },
    // Tickets nobody has filed into an application yet.
    { application_id: null, n: 1 },
  ]);

  const access = await listAccess(models, sequelize);

  assert.deepStrictEqual(
    access.applications.map((app) => ({ id: app.id, name: app.name, ticketCount: app.ticketCount })),
    [
      { id: 7, name: 'Billing Center', ticketCount: 82 },
      { id: 9, name: 'Policy Center', ticketCount: 0 },
    ],
  );
  // Kept apart from the per-application totals: only a super user can see these.
  assert.strictEqual(access.unassignedTicketCount, 1);
});

test('listAccess reports zero counts rather than failing when the count read is unavailable', async () => {
  const models = makeModels({ users: [{ id: 1, username: 'admin', is_super_user: 1 }] });
  const access = await listAccess(models);
  assert.deepStrictEqual(access.applications.map((a) => a.ticketCount), [0, 0]);
  assert.strictEqual(access.unassignedTicketCount, 0);
});

test('listAccess collapses two rows for one pair to the stronger role', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin', is_super_user: 0 }],
    grants: [
      { user_id: 2, application_id: 7, role: 'viewer' },
      { user_id: 2, application_id: 7, role: 'admin' },
    ],
  });
  const access = await listAccess(models);
  assert.deepStrictEqual(access.users[0].grants, [{ applicationId: 7, role: 'admin', requestType: '' }]);
});

// ── Granting one person ──────────────────────────────────────────────────────
// '' is "every type". A grant is (application, role, requestType) — see the
// type-scope tests at the end of this file for why the third part is not
// optional in practice.
const grant = (applicationId, role, requestType = '') => ({ applicationId, role, requestType });

test('setUserGrants replaces the whole set rather than adding to it', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin', is_super_user: 0 }],
    grants: [{ user_id: 2, application_id: 7, role: 'admin' }],
  });

  const result = await setUserGrants(models, makeSequelize(), {
    userId: 2, grants: [grant(9, 'viewer')], grantedBy: 'admin',
  });

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.body.grants, [grant(9, 'viewer')]);
  assert.strictEqual(models.store.grants[0].request_type, '', 'written, never left to the column default');
  // 7 is gone, not kept alongside 9.
  assert.deepStrictEqual(models.store.grants.map((g) => [g.application_id, g.role]), [[9, 'viewer']]);
  assert.strictEqual(models.store.grants[0].granted_by, 'admin', 'the grant is attributable');
  assert.ok(models.store.grants[0].granted_at, 'and timestamped');
});

test('setUserGrants changes the role on an application already held', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin' }],
    grants: [{ user_id: 2, application_id: 7, role: 'admin' }],
  });

  await setUserGrants(models, makeSequelize(), { userId: 2, grants: [grant(7, 'viewer')] });

  // Demoted in place — one row, not an admin row beside a viewer row.
  assert.deepStrictEqual(models.store.grants.map((g) => [g.application_id, g.role]), [[7, 'viewer']]);
});

test('setUserGrants can revoke everything', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin', is_super_user: 0 }],
    grants: [{ user_id: 2, application_id: 7, role: 'admin' }],
  });

  const result = await setUserGrants(models, makeSequelize(), { userId: 2, grants: [] });

  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(models.store.grants, []);
});

test('setUserGrants leaves other people alone', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin' }, { id: 3, username: 'ops_admin' }],
    grants: [
      { user_id: 3, application_id: 7, role: 'admin' },
      { user_id: 2, application_id: 7, role: 'admin' },
    ],
  });

  await setUserGrants(models, makeSequelize(), { userId: 2, grants: [] });

  assert.deepStrictEqual(models.store.grants, [{ user_id: 3, application_id: 7, role: 'admin' }]);
});

test('setUserGrants refuses an inactive or unknown application', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin' }] });

  const inactive = await setUserGrants(models, makeSequelize(), { userId: 2, grants: [grant(4, 'admin')] });
  assert.strictEqual(inactive.status, 400);

  const unknown = await setUserGrants(models, makeSequelize(), { userId: 2, grants: [grant(999, 'admin')] });
  assert.strictEqual(unknown.status, 400);

  // Nothing was written on the way to either refusal.
  assert.deepStrictEqual(models.store.grants, []);
});

test('setUserGrants refuses a role the catalog does not know', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin' }] });
  const result = await setUserGrants(models, makeSequelize(), { userId: 2, grants: [grant(7, 'superadmin')] });
  assert.strictEqual(result.status, 400);
  assert.match(result.error, /unknown role/i);
  assert.deepStrictEqual(models.store.grants, []);
});

test('setUserGrants refuses malformed input rather than coercing it', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin' }] });
  const sequelize = makeSequelize();

  assert.strictEqual((await setUserGrants(models, sequelize, { userId: 2, grants: 'all' })).status, 400);
  assert.strictEqual((await setUserGrants(models, sequelize, { userId: 2, grants: [grant(0, 'admin')] })).status, 400);
  assert.strictEqual((await setUserGrants(models, sequelize, { userId: 2, grants: [grant(-7, 'admin')] })).status, 400);
  assert.strictEqual((await setUserGrants(models, sequelize, { userId: 2, grants: [grant('seven', 'admin')] })).status, 400);
  assert.strictEqual((await setUserGrants(models, sequelize, { userId: 'x', grants: [grant(7, 'admin')] })).status, 400);
  assert.deepStrictEqual(models.store.grants, []);
});

test('setUserGrants 404s on a user that does not exist', async () => {
  const models = makeModels({ users: [] });
  const result = await setUserGrants(models, makeSequelize(), { userId: 99, grants: [grant(7, 'admin')] });
  assert.strictEqual(result.status, 404);
});

test('setUserGrants collapses a repeated application to its stronger role', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin' }] });
  const result = await setUserGrants(models, makeSequelize(), {
    userId: 2, grants: [grant(7, 'viewer'), grant(7, 'admin'), grant(9, 'viewer')],
  });
  assert.deepStrictEqual(result.body.grants, [grant(7, 'admin'), grant(9, 'viewer')]);
  assert.strictEqual(models.store.grants.length, 2);
});

// ── Granting many people at once ─────────────────────────────────────────────
const bulkModels = () => makeModels({
  users: [
    { id: 2, username: 'lead_admin' },
    { id: 3, username: 'ops_admin' },
    { id: 5, username: 'audit' },
  ],
  grants: [{ user_id: 5, application_id: 7, role: 'admin' }],
});

test('bulkSetAccess grants one role across every selected pair', async () => {
  const models = bulkModels();

  const result = await bulkSetAccess(models, makeSequelize(), {
    userIds: [2, 3], applicationIds: [7, 9], role: 'viewer', action: 'grant', grantedBy: 'admin',
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.changed, 4, 'two people × two applications');
  const written = models.store.grants
    .filter((g) => g.user_id !== 5)
    .map((g) => [g.user_id, g.application_id, g.role])
    .sort();
  assert.deepStrictEqual(written, [[2, 7, 'viewer'], [2, 9, 'viewer'], [3, 7, 'viewer'], [3, 9, 'viewer']]);
  // Somebody who wasn't selected keeps what they had.
  assert.ok(models.store.grants.some((g) => g.user_id === 5 && g.role === 'admin'));
});

test('bulkSetAccess replaces an existing role on the same pair instead of stacking', async () => {
  const models = bulkModels();

  await bulkSetAccess(models, makeSequelize(), {
    userIds: [5], applicationIds: [7], role: 'viewer', action: 'grant',
  });

  const forFive = models.store.grants.filter((g) => g.user_id === 5);
  assert.strictEqual(forFive.length, 1, 'one row, not admin plus viewer');
  assert.strictEqual(forFive[0].role, 'viewer');
});

test('bulkSetAccess revokes only the selected pairs', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin' }, { id: 3, username: 'ops_admin' }],
    grants: [
      { user_id: 2, application_id: 7, role: 'admin' },
      { user_id: 2, application_id: 9, role: 'admin' },
      { user_id: 3, application_id: 7, role: 'admin' },
    ],
  });

  const result = await bulkSetAccess(models, makeSequelize(), {
    userIds: [2, 3], applicationIds: [7], action: 'revoke',
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.role, null, 'a revoke has no role');
  // Application 9 is untouched — this edits the named intersection only.
  assert.deepStrictEqual(
    models.store.grants.map((g) => [g.user_id, g.application_id]),
    [[2, 9]],
  );
});

test('bulkSetAccess writes nothing when any application in the batch is bad', async () => {
  const models = bulkModels();
  const before = models.store.grants.length;

  const result = await bulkSetAccess(models, makeSequelize(), {
    userIds: [2, 3], applicationIds: [7, 4], role: 'admin', action: 'grant',
  });

  assert.strictEqual(result.status, 400, 'application 4 is inactive');
  assert.strictEqual(models.store.grants.length, before, 'the valid half was not applied either');
});

test('bulkSetAccess writes nothing when any account in the batch is unknown', async () => {
  const models = bulkModels();
  const before = models.store.grants.length;

  const result = await bulkSetAccess(models, makeSequelize(), {
    userIds: [2, 404], applicationIds: [7], role: 'admin', action: 'grant',
  });

  assert.strictEqual(result.status, 400);
  assert.match(result.error, /unknown account/i);
  assert.strictEqual(models.store.grants.length, before);
});

test('bulkSetAccess refuses an empty selection on either axis', async () => {
  const models = bulkModels();
  const sequelize = makeSequelize();

  assert.strictEqual((await bulkSetAccess(models, sequelize, {
    userIds: [], applicationIds: [7], role: 'admin', action: 'grant',
  })).status, 400);

  assert.strictEqual((await bulkSetAccess(models, sequelize, {
    userIds: [2], applicationIds: [], role: 'admin', action: 'grant',
  })).status, 400);
});

test('bulkSetAccess refuses an unknown action or role', async () => {
  const models = bulkModels();
  const sequelize = makeSequelize();

  assert.strictEqual((await bulkSetAccess(models, sequelize, {
    userIds: [2], applicationIds: [7], role: 'admin', action: 'delete',
  })).status, 400);

  assert.strictEqual((await bulkSetAccess(models, sequelize, {
    userIds: [2], applicationIds: [7], role: 'superadmin', action: 'grant',
  })).status, 400);
});

test('bulkSetAccess de-duplicates a repeated selection', async () => {
  const models = bulkModels();

  const result = await bulkSetAccess(models, makeSequelize(), {
    userIds: [2, 2, 3], applicationIds: [7, 7], role: 'admin', action: 'grant',
  });

  assert.strictEqual(result.body.changed, 2, 'two distinct people × one distinct application');
  assert.strictEqual(models.store.grants.filter((g) => g.user_id === 2).length, 1);
});

// ── The last-super-user guard ────────────────────────────────────────────────
test('setUserSuperUser promotes and demotes', async () => {
  const models = makeModels({
    users: [
      { id: 1, username: 'admin', is_super_user: 1 },
      { id: 2, username: 'lead_admin', is_super_user: 0 },
    ],
  });

  assert.strictEqual((await setUserSuperUser(models, { userId: 2, isSuperUser: true })).status, 200);
  assert.strictEqual(models.store.users[1].is_super_user, 1);

  assert.strictEqual((await setUserSuperUser(models, { userId: 2, isSuperUser: false })).status, 200);
  assert.strictEqual(models.store.users[1].is_super_user, 0);
});

test('setUserSuperUser refuses to remove the last super user', async () => {
  // Nobody left to grant anything, and a fail-closed queue nobody can reopen.
  const models = makeModels({
    users: [
      { id: 1, username: 'admin', is_super_user: 1 },
      { id: 2, username: 'lead_admin', is_super_user: 0 },
    ],
  });

  const result = await setUserSuperUser(models, { userId: 1, isSuperUser: false });

  assert.strictEqual(result.status, 409);
  assert.match(result.error, /last portal super user/i);
  assert.strictEqual(models.store.users[0].is_super_user, 1, 'unchanged');
});

test('setUserSuperUser allows demotion once a second super user exists', async () => {
  const models = makeModels({
    users: [
      { id: 1, username: 'admin', is_super_user: 1 },
      { id: 2, username: 'lead_admin', is_super_user: 1 },
    ],
  });

  assert.strictEqual((await setUserSuperUser(models, { userId: 1, isSuperUser: false })).status, 200);
  assert.strictEqual(models.store.users[0].is_super_user, 0);
});

test('setUserSuperUser treats a no-op demotion as success without tripping the guard', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin', is_super_user: 0 }] });
  const result = await setUserSuperUser(models, { userId: 2, isSuperUser: false });
  assert.strictEqual(result.status, 200);
});

test('setUserSuperUser refuses a non-boolean rather than coercing it', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin', is_super_user: 0 }] });
  // 'false' and 0 would both flip the wrong way under a truthiness check.
  assert.strictEqual((await setUserSuperUser(models, { userId: 2, isSuperUser: 'true' })).status, 400);
  assert.strictEqual((await setUserSuperUser(models, { userId: 2, isSuperUser: 1 })).status, 400);
  assert.strictEqual(models.store.users[0].is_super_user, 0);
});

// ── Directory groups ─────────────────────────────────────────────────────────
// A mapping says which product a group's members work in. The tests that matter
// are the ones proving it stays that and never becomes an entitlement.
test('addAdGroupMapping stores the group against the application', async () => {
  const models = makeModels();

  const result = await addAdGroupMapping(models, {
    applicationId: 7, groupName: '  GG-GW-BillingCenter-Users  ',
  });

  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.body.groupName, 'GG-GW-BillingCenter-Users', 'trimmed');
  assert.strictEqual(models.store.adGroups[0].application_id, 7);
  assert.strictEqual(models.store.adGroups[0].is_active, 1);
});

test('addAdGroupMapping refuses a blank group name or a missing application', async () => {
  const models = makeModels();

  assert.strictEqual((await addAdGroupMapping(models, { applicationId: 7, groupName: '   ' })).status, 400);
  assert.strictEqual((await addAdGroupMapping(models, { applicationId: 7 })).status, 400);
  assert.strictEqual((await addAdGroupMapping(models, { groupName: 'GG-X' })).status, 400);
  assert.strictEqual(models.store.adGroups.length, 0);
});

test('addAdGroupMapping refuses an inactive or unknown application', async () => {
  const models = makeModels();
  assert.strictEqual((await addAdGroupMapping(models, { applicationId: 4, groupName: 'GG-X' })).status, 400);
  assert.strictEqual((await addAdGroupMapping(models, { applicationId: 999, groupName: 'GG-X' })).status, 400);
  assert.strictEqual(models.store.adGroups.length, 0);
});

test('addAdGroupMapping refuses a duplicate with a sentence rather than a database error', async () => {
  const models = makeModels({
    adGroups: [{ id: 1, application_id: 7, group_name: 'GG-X', role: 'admin', is_active: 1 }],
  });

  const result = await addAdGroupMapping(models, { applicationId: 7, groupName: 'GG-X' });

  assert.strictEqual(result.status, 409);
  assert.strictEqual(models.store.adGroups.length, 1);
});

test('the same group may feed two different applications', async () => {
  // Not a duplicate: someone in one group can legitimately work in both products.
  const models = makeModels({
    adGroups: [{ id: 1, application_id: 7, group_name: 'GG-X', role: 'admin', is_active: 1 }],
  });

  assert.strictEqual((await addAdGroupMapping(models, { applicationId: 9, groupName: 'GG-X' })).status, 201);
  assert.strictEqual(models.store.adGroups.length, 2);
});

test('a mapping appears in listAccess without granting anything', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'lead_admin', is_super_user: 0 }],
    adGroups: [{ id: 1, application_id: 7, group_name: 'GG-X', role: 'admin', is_active: 1 }],
  });

  const access = await listAccess(models);

  assert.deepStrictEqual(access.adGroups, [{ id: 1, applicationId: 7, groupName: 'GG-X' }]);
  // The person holds nothing, even though a mapping exists at role=admin.
  assert.deepStrictEqual(access.users[0].grants, []);
});

test('removeAdGroupMapping deletes the row and 404s the second time', async () => {
  const models = makeModels({
    adGroups: [{ id: 1, application_id: 7, group_name: 'GG-X', role: 'admin', is_active: 1 }],
  });

  assert.strictEqual((await removeAdGroupMapping(models, { id: 1 })).status, 200);
  assert.deepStrictEqual(models.store.adGroups, []);
  assert.strictEqual((await removeAdGroupMapping(models, { id: 1 })).status, 404);
});

test('removeAdGroupMapping refuses a malformed id', async () => {
  const models = makeModels();
  assert.strictEqual((await removeAdGroupMapping(models, { id: 'abc' })).status, 400);
  assert.strictEqual((await removeAdGroupMapping(models, { id: 0 })).status, 400);
});

// ── Type-scoped grants ───────────────────────────────────────────────────────
// An "analyst" is not a role: it is an admin grant narrowed to `request_type`.
// This service used to drop that column on every write, so re-saving anybody's
// row silently promoted their report-only grant to every type — a privilege
// escalation reachable from a dropdown, with no screen that would show it. These
// are the regression net for that.

const ANALYST = { user_id: 2, application_id: 7, role: 'admin', request_type: 'report' };

test('listAccess reports a narrowed grant as narrowed, not as every type', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'bc_report_analyst', is_super_user: 0 }],
    grants: [ANALYST],
  });

  const access = await listAccess(models);

  assert.deepStrictEqual(access.users[0].grants, [grant(7, 'admin', 'report')]);
});

test('listAccess keeps two type scopes on one application apart', async () => {
  // The application-admin shape: two rows, one per type, NOT one all-types row.
  const models = makeModels({
    users: [{ id: 2, username: 'bc_app_admin' }],
    grants: [
      { user_id: 2, application_id: 7, role: 'admin', request_type: 'enhancement' },
      { user_id: 2, application_id: 7, role: 'admin', request_type: 'defect' },
    ],
  });

  const access = await listAccess(models);

  assert.deepStrictEqual(
    access.users[0].grants,
    [grant(7, 'admin', 'defect'), grant(7, 'admin', 'enhancement')],
    'two grants, sorted — collapsing them to one would report wider rights than exist',
  );
});

test('setUserGrants keeps a report-only grant report-only', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'bc_report_analyst' }],
    grants: [ANALYST],
  });

  await setUserGrants(models, makeSequelize(), {
    userId: 2, grants: [grant(7, 'admin', 'report')],
  });

  assert.deepStrictEqual(
    models.store.grants.map((row) => [row.application_id, row.role, row.request_type]),
    [[7, 'admin', 'report']],
    'still narrowed — this is the escalation the old code performed here',
  );
});

test('editing another application does not widen an analyst grant', async () => {
  // The real-world path: a super user gives the analyst View on Policy Center.
  // The payload carries their whole set, so Billing Center's report-only grant
  // has to survive the round trip with its scope intact.
  const models = makeModels({
    users: [{ id: 2, username: 'bc_report_analyst' }],
    grants: [ANALYST],
  });

  await setUserGrants(models, makeSequelize(), {
    userId: 2,
    grants: [grant(7, 'admin', 'report'), grant(9, 'viewer')],
  });

  assert.deepStrictEqual(
    models.store.grants.map((row) => [row.application_id, row.role, row.request_type]),
    [[7, 'admin', 'report'], [9, 'viewer', '']],
  );
});

test('setUserGrants treats one application at two scopes as two grants', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'bc_owner_analyst' }] });

  const result = await setUserGrants(models, makeSequelize(), {
    userId: 2,
    grants: [grant(7, 'admin', 'defect'), grant(7, 'admin', 'enhancement')],
  });

  assert.strictEqual(models.store.grants.length, 2, 'not collapsed into one');
  assert.deepStrictEqual(result.body.grants, [grant(7, 'admin', 'defect'), grant(7, 'admin', 'enhancement')]);
});

test('setUserGrants still collapses a genuine duplicate — same application AND same scope', async () => {
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin' }] });

  await setUserGrants(models, makeSequelize(), {
    userId: 2, grants: [grant(7, 'viewer', 'report'), grant(7, 'admin', 'report')],
  });

  assert.deepStrictEqual(
    models.store.grants.map((row) => [row.role, row.request_type]),
    [['admin', 'report']],
  );
});

test('setUserGrants refuses a request type the catalog does not know', async () => {
  // Fails closed. A grant naming a non-existent type matches nothing today, and
  // would start matching something the day that name became a real type.
  const models = makeModels({ users: [{ id: 2, username: 'lead_admin' }] });

  const result = await setUserGrants(models, makeSequelize(), {
    userId: 2, grants: [grant(7, 'admin', 'invoice')],
  });

  assert.strictEqual(result.status, 400);
  assert.match(result.error, /Unknown request type/);
  assert.strictEqual(models.store.grants.length, 0, 'and wrote nothing');
});

test('bulkSetAccess granting one type leaves the other types alone', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'bc_app_admin' }],
    grants: [{ user_id: 2, application_id: 7, role: 'admin', request_type: 'defect' }],
  });

  await bulkSetAccess(models, makeSequelize(), {
    userIds: [2], applicationIds: [7], role: 'admin', action: 'grant', requestType: 'report',
  });

  assert.deepStrictEqual(
    models.store.grants.map((row) => row.request_type).sort(),
    ['defect', 'report'],
    'grants add up — a report grant must not revoke the defect one',
  );
});

test('bulkSetAccess granting every type supersedes the narrowed ones', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'bc_owner_analyst' }],
    grants: [
      { user_id: 2, application_id: 7, role: 'admin', request_type: 'report' },
      { user_id: 2, application_id: 7, role: 'admin', request_type: 'defect' },
    ],
  });

  await bulkSetAccess(models, makeSequelize(), {
    userIds: [2], applicationIds: [7], role: 'admin', action: 'grant', requestType: '',
  });

  assert.deepStrictEqual(
    models.store.grants.map((row) => row.request_type),
    [''],
    'one all-types row, not an all-types row stacked on two narrower ones',
  );
});

test('bulkSetAccess revoking one type leaves the other types alone', async () => {
  const models = makeModels({
    users: [{ id: 2, username: 'bc_owner_analyst' }],
    grants: [
      { user_id: 2, application_id: 7, role: 'admin', request_type: 'report' },
      { user_id: 2, application_id: 7, role: 'admin', request_type: 'defect' },
    ],
  });

  await bulkSetAccess(models, makeSequelize(), {
    userIds: [2], applicationIds: [7], action: 'revoke', requestType: 'report',
  });

  assert.deepStrictEqual(models.store.grants.map((row) => row.request_type), ['defect']);
});

test('bulkSetAccess refuses a request type the catalog does not know', async () => {
  const models = bulkModels();

  const result = await bulkSetAccess(models, makeSequelize(), {
    userIds: [2], applicationIds: [7], role: 'admin', action: 'grant', requestType: 'invoice',
  });

  assert.strictEqual(result.status, 400);
  assert.match(result.error, /Unknown request type/);
});
