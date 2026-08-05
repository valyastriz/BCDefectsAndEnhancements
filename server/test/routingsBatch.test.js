const { test } = require('node:test');
const assert = require('node:assert');

const { listRoutings, listRoutingsBySubmissionIds } = require('../src/services/redirectService');

// The status board asks for every public ticket in one request and then draws a
// hand-off trail on each one. Reading the trail per ticket would have been two
// queries PER ROW — the routing read plus a full Application scan each time — so
// the batched read is pinned here: two queries whatever the row count, the note
// still stripped, and each chain still oldest-first.

const ROUTING_ROWS = [
  { id: 5, submission_id: 42, from_application_id: 1, to_application_id: 2, routed_at: '2026-07-02T10:00:00.000Z', note: 'Marcus in Policy agrees it is theirs.', routed_by: 'lead_admin', status_at_handoff: 'Approved' },
  { id: 3, submission_id: 42, from_application_id: null, to_application_id: 1, routed_at: '2026-06-28T09:00:00.000Z', note: null, routed_by: 'triager', status_at_handoff: 'New' },
  { id: 9, submission_id: 77, from_application_id: 2, to_application_id: 3, routed_at: '2026-07-11T14:00:00.000Z', note: 'Do not re-run the rating check.', routed_by: 'lead_admin', status_at_handoff: 'New' },
];

const APPLICATIONS = [
  { id: 1, name: 'Billing Center' },
  { id: 2, name: 'Policy Center' },
  { id: 3, name: 'Claim Center' },
];

/** A models double that counts queries and honours the id list / order. */
function makeModels(rows = ROUTING_ROWS) {
  const calls = { routings: 0, applications: 0, lastWhere: null };
  return {
    calls,
    SubmissionRouting: {
      async findAll({ where, order }) {
        calls.routings += 1;
        calls.lastWhere = where;
        const wanted = Array.isArray(where.submission_id) ? where.submission_id : [where.submission_id];
        const matched = rows.filter((row) => wanted.includes(row.submission_id));
        // Mirror order: [['routed_at', 'ASC'], ['id', 'ASC']]
        const [[firstField]] = order;
        assert.strictEqual(firstField, 'routed_at');
        return [...matched].sort((a, b) => (
          String(a.routed_at).localeCompare(String(b.routed_at)) || a.id - b.id
        ));
      },
    },
    Application: {
      async findAll() {
        calls.applications += 1;
        return APPLICATIONS;
      },
    },
  };
}

test('listRoutingsBySubmissionIds reads every chain in two queries', async () => {
  const models = makeModels();

  await listRoutingsBySubmissionIds(models, [42, 77, 1204], { forPublic: true });

  assert.strictEqual(models.calls.routings, 1, 'one routing query for the whole page');
  assert.strictEqual(models.calls.applications, 1, 'one application query for the whole page');
  assert.deepStrictEqual(models.calls.lastWhere.submission_id, [42, 77, 1204]);
});

test('each chain comes back oldest-first with application names resolved', async () => {
  const byId = await listRoutingsBySubmissionIds(makeModels(), [42, 77], { forPublic: true });

  assert.deepStrictEqual(byId.get(42), [
    { id: 3, from_application_name: null, to_application_name: 'Billing Center', routed_at: '2026-06-28T09:00:00.000Z' },
    { id: 5, from_application_name: 'Billing Center', to_application_name: 'Policy Center', routed_at: '2026-07-02T10:00:00.000Z' },
  ]);
  assert.deepStrictEqual(byId.get(77), [
    { id: 9, from_application_name: 'Policy Center', to_application_name: 'Claim Center', routed_at: '2026-07-11T14:00:00.000Z' },
  ]);
});

test('a ticket that never moved is absent from the map, not an empty array', async () => {
  const byId = await listRoutingsBySubmissionIds(makeModels(), [42, 1204], { forPublic: true });

  assert.strictEqual(byId.has(1204), false);
  assert.strictEqual(byId.get(1204), undefined);
});

test('the batched read strips the internal note exactly as the per-ticket read does', async () => {
  const byId = await listRoutingsBySubmissionIds(makeModels(), [42, 77], { forPublic: true });

  const serialized = JSON.stringify([...byId.values()]);
  assert.ok(!serialized.includes('Marcus'), 'note content reached the reporter');
  assert.ok(!serialized.includes('rating check'), 'note content reached the reporter');
  assert.ok(!serialized.includes('lead_admin'), 'the routing admin reached the reporter');
  assert.ok(!serialized.includes('status_at_handoff'), 'the sending team\'s status is internal');
});

test('the internal (non-public) shape keeps the note for admins', async () => {
  const byId = await listRoutingsBySubmissionIds(makeModels(), [42], { forPublic: false });

  const [, handoff] = byId.get(42);
  assert.strictEqual(handoff.note, 'Marcus in Policy agrees it is theirs.');
  assert.strictEqual(handoff.from_application_name, 'Billing Center');
});

test('listRoutings still answers for one ticket, through the batched read', async () => {
  const models = makeModels();

  const chain = await listRoutings(models, 77, { forPublic: true });

  assert.strictEqual(models.calls.routings, 1);
  assert.deepStrictEqual(chain, [
    { id: 9, from_application_name: 'Policy Center', to_application_name: 'Claim Center', routed_at: '2026-07-11T14:00:00.000Z' },
  ]);
});

test('listRoutings returns an empty array for a ticket that never moved', async () => {
  const chain = await listRoutings(makeModels(), 1204, { forPublic: true });
  assert.deepStrictEqual(chain, []);
});

test('no ids and no model both short-circuit before any query', async () => {
  const models = makeModels();
  assert.strictEqual((await listRoutingsBySubmissionIds(models, [])).size, 0);
  // Number(null) is 0 — finite, but not a submission id.
  assert.strictEqual((await listRoutingsBySubmissionIds(models, [NaN, null, 'x', 0, -3])).size, 0);
  assert.strictEqual(models.calls.routings, 0, 'an empty id list must not hit the database');

  assert.strictEqual((await listRoutingsBySubmissionIds({}, [42])).size, 0);
});
