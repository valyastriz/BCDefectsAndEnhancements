const { test } = require('node:test');
const assert = require('node:assert');

const { resolveAdminAudienceForRow } = require('../src/services/viewerService');

// Who is TOLD about a row, live.
//
// `emitAdminNotification` went to every admin, unscoped — so a reporting analyst's
// banner announced every new defect and every workaround request. The owner found
// it in the same sitting as the unscoped read: "since I don't work those, I
// shouldn't see anything related to defects, enhancements or cleanups if I don't
// have that role."
//
// This answers the same question as `canReadSubmissionRow` from the other end, so
// the two must agree — they read the same three things: the application, the soft
// association, and the hand-off ledger.

const TYPES = [{ id: 1, name: 'defect' }, { id: 2, name: 'enhancement' }, { id: 3, name: 'report' }];

// user 10 works reports on application 7; user 11 works defects there; user 12
// holds an all-types grant; user 99 is a super user with no grants at all.
const GRANTS = [
  { user_id: 10, application_id: 7, request_type: 'report' },
  { user_id: 11, application_id: 7, request_type: 'defect' },
  { user_id: 12, application_id: 7, request_type: '' },
  { user_id: 13, application_id: 8, request_type: 'report' },
];

function makeModels({ grants = GRANTS, routings = [] } = {}) {
  return {
    SubmissionType: {
      findAll: async () => TYPES.map((row) => ({ ...row })),
      findByPk: async (id) => TYPES.find((row) => row.id === Number(id)) || null,
    },
    UserApplicationRole: {
      findAll: async ({ where } = {}) => {
        const wanted = where?.application_id;
        const ids = Array.isArray(wanted) ? wanted : [wanted];
        return grants.filter((row) => ids.includes(row.application_id)).map((row) => ({ ...row }));
      },
    },
    User: { findAll: async () => [{ id: 99 }] },
    SubmissionRouting: {
      findAll: async ({ where } = {}) => routings
        .filter((row) => Number(row.submission_id) === Number(where?.submission_id))
        .map((row) => ({ from_application_id: row.from_application_id })),
    },
  };
}

const ids = (set) => [...set].sort((a, b) => a - b);

test('a defect is announced to the defect admins, not to the report analyst', async () => {
  const audience = await resolveAdminAudienceForRow(
    makeModels(),
    { id: 1, application_id: 7, type: 'defect' },
  );
  assert.deepStrictEqual(ids(audience), [11, 12, 99]);
});

test('a report request is announced to the analyst, not to the defect admin', async () => {
  const audience = await resolveAdminAudienceForRow(
    makeModels(),
    { id: 1, application_id: 7, type: 'report' },
  );
  assert.deepStrictEqual(ids(audience), [10, 12, 99]);
});

test('another application hears nothing', async () => {
  const audience = await resolveAdminAudienceForRow(
    makeModels(),
    { id: 1, application_id: 7, type: 'report' },
  );
  assert.strictEqual(audience.has(13), false);
});

test('a super user is always in the audience — the one bypass', async () => {
  const audience = await resolveAdminAudienceForRow(
    makeModels({ grants: [] }),
    { id: 1, application_id: 7, type: 'defect' },
  );
  assert.deepStrictEqual(ids(audience), [99]);
});

test('the type can be resolved from type_id when the payload carries no name', async () => {
  const audience = await resolveAdminAudienceForRow(
    makeModels(),
    { id: 1, application_id: 7, type_id: 3 },
  );
  assert.deepStrictEqual(ids(audience), [10, 12, 99]);
});

test('the soft association is heard by the queue the ticket also appears in', async () => {
  // In `Other` (99), also shown in 7. The people who work 7 are watching it.
  const audience = await resolveAdminAudienceForRow(
    makeModels(),
    { id: 1, application_id: 99, working_application_id: 7, type: 'report' },
  );
  assert.deepStrictEqual(ids(audience), [10, 12, 99]);
});

test('the team that handed a ticket on still hears about it', async () => {
  // It carries application 4 now, but it left 7 — and read scope keeps it visible
  // to the team that sent it, so the notification has to reach them too.
  const audience = await resolveAdminAudienceForRow(
    makeModels({ routings: [{ submission_id: 42, from_application_id: 7 }] }),
    { id: 42, application_id: 4, type: 'report' },
  );
  assert.strictEqual(audience.has(10), true);
});

test('a payload that identifies no submission answers null — tell everybody', async () => {
  // An import summary carries no application and no type. Silencing it would break
  // a working notification to close a gap it does not have. Null is "cannot tell".
  assert.strictEqual(
    await resolveAdminAudienceForRow(makeModels(), { imported: 12, skipped: 0 }),
    null,
  );
  assert.strictEqual(
    await resolveAdminAudienceForRow(makeModels(), { id: 1, application_id: 7 }),
    null,
    'an application with no resolvable type cannot be scoped either',
  );
});

test('missing models answer null rather than an empty audience', async () => {
  // An empty Set would silence every notification on a half-initialised server.
  assert.strictEqual(
    await resolveAdminAudienceForRow({}, { id: 1, application_id: 7, type: 'defect' }),
    null,
  );
});
