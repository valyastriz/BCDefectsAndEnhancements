const { test } = require('node:test');
const assert = require('node:assert');

const { resolveSoftAssignment } = require('../src/helpers/softAssignment');

// The soft association: which queue a ticket in `Other` ALSO appears in.
//
// `Other` means "nobody has worked out whose system this is yet". An analyst who
// picks one up could either move it out — a claim about whose data it is that
// nobody can make yet — or leave it where they never see it again. This is the
// third option, and the rules worth a net are the ones that keep TWO columns
// answering "whose queue is this" from becoming an ambiguity:
//
//   1. It is only ever set on a ticket in `Other`.
//   2. It must be a queue the ACTING admin works in, so nobody can put work on
//      another team's list.
//   3. The derivation only fires on the status leaving `New`, only when nothing
//      is chosen yet, and only when there is exactly one candidate.
//
// The read consequences (`canReadSubmissionRow`, and the queue filter matching on
// either column) are proved in the browser by verify-admin-data-entry.mjs; what
// this file pins is the decision.

const OTHER_ID = 7;
const BILLING_ID = 1;
const POLICY_ID = 2;

// No database and no mocking: `resolveSoftAssignment` takes `isUnknownQueue` as a
// value precisely so this rule — which decides whose list a ticket lands on — can
// be pinned without one. `isUnknownApplication` does the lookup at the call site.
const viewerWith = (typeRoles, adminIds, isSuperUser = false) => ({
  isAuthenticated: true,
  isSuperUser,
  applicationTypeRoles: typeRoles,
  adminApplicationIds: adminIds,
  applicationRoles: Object.fromEntries(
    Object.entries(typeRoles).map(([id, perType]) => [id, Object.values(perType)[0]]),
  ),
});

const ANALYST_ONE_QUEUE = viewerWith(
  { [BILLING_ID]: { report: 'admin' }, [OTHER_ID]: { report: 'admin' } },
  [BILLING_ID, OTHER_ID],
);
const ANALYST_TWO_QUEUES = viewerWith(
  {
    [BILLING_ID]: { report: 'admin' },
    [POLICY_ID]: { report: 'admin' },
    [OTHER_ID]: { report: 'admin' },
  },
  [BILLING_ID, POLICY_ID, OTHER_ID],
);

const base = {
  body: {},
  existing: {},
  viewer: ANALYST_ONE_QUEUE,
  nextStatus: 'New',
  previousStatus: 'New',
  applicationId: OTHER_ID,
  requestType: 'report',
  isUnknownQueue: true,
};

const resolve = (overrides = {}) => resolveSoftAssignment({ ...base, ...overrides });

// ── Rule 1: only in `Other` ──────────────────────────────────────────────────
test('a ticket in a real application is never softly assigned', async () => {
  // Every ticket with a real application already answers "whose queue is this"
  // exactly once. A second answer there would be an ambiguity, not a feature.
  const result = await resolve({
    applicationId: BILLING_ID,
    isUnknownQueue: false,
    body: { working_application_id: POLICY_ID },
    viewer: ANALYST_TWO_QUEUES,
  });
  assert.strictEqual(result.value, null);
});

test('and one redirected OUT of Other loses the association it had', async () => {
  // The queue that was watching it while its owner was unknown has its answer now.
  const result = await resolve({
    applicationId: BILLING_ID,
    isUnknownQueue: false,
    existing: { working_application_id: POLICY_ID },
  });
  assert.strictEqual(result.value, null);
});

// ── Rule 2: it must be one of THEIR queues ───────────────────────────────────
test('an explicit pick is kept when the admin works in that queue', async () => {
  const result = await resolve({ body: { working_application_id: BILLING_ID } });
  assert.strictEqual(result.value, BILLING_ID);
});

test('a queue the admin does NOT work in is refused', async () => {
  // The one thing a soft assign must not be able to do: the receiving team never
  // agreed to it and cannot edit the ticket to get rid of it.
  const result = await resolve({ body: { working_application_id: POLICY_ID } });
  assert.strictEqual(result.value, undefined);
  assert.strictEqual(result.status, 403);
  assert.match(result.error, /queue you work in/i);
});

test('a viewer seat cannot show a ticket in its own queue either', async () => {
  const readOnly = viewerWith({ [BILLING_ID]: { report: 'viewer' } }, [BILLING_ID]);
  const result = await resolve({ viewer: readOnly, body: { working_application_id: BILLING_ID } });
  assert.strictEqual(result.status, 403);
});

test('the grant must cover THIS request type', async () => {
  // An analyst granted only report requests must not be able to park a defect on
  // a queue they hold for something else.
  const reportOnly = viewerWith({ [BILLING_ID]: { report: 'admin' } }, [BILLING_ID]);
  const result = await resolve({
    viewer: reportOnly,
    requestType: 'defect',
    body: { working_application_id: BILLING_ID },
  });
  assert.strictEqual(result.status, 403);
});

test('pointing it at Other itself is refused', async () => {
  const result = await resolve({ body: { working_application_id: OTHER_ID } });
  assert.strictEqual(result.status, 400);
  assert.match(result.error, /already in that queue/i);
});

// ── Clearing ─────────────────────────────────────────────────────────────────
test('an explicit null takes it off the list', async () => {
  const result = await resolve({
    existing: { working_application_id: BILLING_ID },
    body: { working_application_id: null },
  });
  assert.strictEqual(result.value, null);
});

// ── Rule 3: the derivation, and what must not trigger it ─────────────────────
test('moving the status off New assigns the admin their one queue', async () => {
  // The owner's words: "once they change it from new status to something else —
  // then it soft assigns it to their queue".
  const result = await resolve({ previousStatus: 'New', nextStatus: 'In progress' });
  assert.strictEqual(result.value, BILLING_ID);
});

test('a save that does NOT move the status off New assigns nothing', async () => {
  const result = await resolve({ previousStatus: 'New', nextStatus: 'New' });
  assert.strictEqual(result.value, null);
});

test('with two queues to choose from it waits to be told', async () => {
  // Guessing would put the ticket on a list the analyst did not pick, which is
  // harder to notice than it not appearing at all.
  const result = await resolve({
    viewer: ANALYST_TWO_QUEUES,
    previousStatus: 'New',
    nextStatus: 'In progress',
  });
  assert.strictEqual(result.value, null);
});

test('a later status change does not overwrite the queue already chosen', async () => {
  const result = await resolve({
    viewer: ANALYST_TWO_QUEUES,
    existing: { working_application_id: POLICY_ID },
    previousStatus: 'In progress',
    nextStatus: 'Delivered',
  });
  assert.strictEqual(result.value, POLICY_ID);
});

test('an ordinary save keeps what is there, because the modal echoes every field', async () => {
  // The detail modal sends its whole edit object on every save, so the key is
  // ALWAYS present. Treating presence as a deliberate act would have cleared the
  // association on the next unrelated save — and made the derivation unreachable.
  const result = await resolve({
    existing: { working_application_id: BILLING_ID },
    body: { working_application_id: BILLING_ID },
    previousStatus: 'In progress',
    nextStatus: 'In progress',
  });
  assert.strictEqual(result.value, BILLING_ID);
});

test('and an echoed null on a New ticket still lets the trigger fire', async () => {
  const result = await resolve({
    body: { working_application_id: null },
    previousStatus: 'New',
    nextStatus: 'In progress',
  });
  assert.strictEqual(result.value, BILLING_ID);
});

test('a super user with no explicit grants is not given somebody else queue by guess', async () => {
  // adminApplicationIds is the candidate list; a super user's is whatever they
  // hold. With none listed there is nothing to derive, and inventing one would
  // put the ticket on a queue nobody asked for.
  const superUser = viewerWith({}, [], true);
  const result = await resolve({
    viewer: superUser,
    previousStatus: 'New',
    nextStatus: 'In progress',
  });
  assert.strictEqual(result.value, null);
});
