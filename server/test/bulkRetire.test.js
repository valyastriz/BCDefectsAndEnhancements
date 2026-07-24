const { test } = require('node:test');
const assert = require('node:assert');

const {
  validateBulkRetiredInput,
  bulkUpdateRetired,
} = require('../src/services/submissionService');

// ── Boundary validation (pure, no DB) ────────────────────────────────────────

test('validateBulkRetiredInput rejects a non-array ids', () => {
  assert.ok(validateBulkRetiredInput({ ids: 'nope', is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ ids: 5, is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ is_retired: true }).error);
});

test('validateBulkRetiredInput rejects an empty ids array', () => {
  const result = validateBulkRetiredInput({ ids: [], is_retired: true });
  assert.ok(result.error);
});

test('validateBulkRetiredInput rejects more than 1000 ids', () => {
  const ids = Array.from({ length: 1001 }, (_v, i) => i + 1);
  assert.ok(validateBulkRetiredInput({ ids, is_retired: false }).error);
  // Exactly 1000 is allowed.
  const okIds = Array.from({ length: 1000 }, (_v, i) => i + 1);
  assert.strictEqual(validateBulkRetiredInput({ ids: okIds, is_retired: false }).error, undefined);
});

test('validateBulkRetiredInput rejects a missing or non-boolean is_retired', () => {
  assert.ok(validateBulkRetiredInput({ ids: [1, 2] }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, 2], is_retired: 'true' }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, 2], is_retired: 1 }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, 2], is_retired: null }).error);
  // A stray is_public boolean must not satisfy the is_retired requirement.
  assert.ok(validateBulkRetiredInput({ ids: [1, 2], is_public: true }).error);
});

test('validateBulkRetiredInput rejects non-integer or non-positive ids', () => {
  assert.ok(validateBulkRetiredInput({ ids: [1, 0], is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, -3], is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, 2.5], is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, 'abc'], is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, ''], is_retired: true }).error);
  assert.ok(validateBulkRetiredInput({ ids: [1, null], is_retired: true }).error);
});

test('validateBulkRetiredInput coerces numeric strings to integers', () => {
  const result = validateBulkRetiredInput({ ids: [1, '2', ' 3 '], is_retired: true });
  assert.strictEqual(result.error, undefined);
  assert.deepStrictEqual(result.ids, [1, 2, 3]);
  assert.strictEqual(result.isRetired, true);
});

// ── Service loop (injected updater, no DB) ───────────────────────────────────

test('bulkUpdateRetired returns a 400 result on invalid input', async () => {
  const result = await bulkUpdateRetired({}, {
    body: { ids: [], is_retired: true },
    updateOne: async () => assert.fail('updater must not run on invalid input'),
  });
  assert.strictEqual(result.status, 400);
  assert.ok(result.error);
  assert.strictEqual(result.body, undefined);
});

test('bulkUpdateRetired updates every id on full success', async () => {
  const seen = [];
  const result = await bulkUpdateRetired({ fake: 'db' }, {
    body: { ids: [1, 2, 3], is_retired: true },
    username: 'admin-bob',
    updateOne: async (db, { id, body, username }) => {
      seen.push({ id, is_retired: body.is_retired, username });
      return { status: 200, body: { id } };
    },
  });

  assert.deepStrictEqual(result.body, {
    ok: true,
    is_retired: true,
    requested: 3,
    updated: 3,
    failed: [],
  });
  // Parity: each id is forwarded through the per-row path with only { is_retired }.
  assert.deepStrictEqual(seen, [
    { id: 1, is_retired: true, username: 'admin-bob' },
    { id: 2, is_retired: true, username: 'admin-bob' },
    { id: 3, is_retired: true, username: 'admin-bob' },
  ]);
});

test('bulkUpdateRetired collects per-id failures without aborting the batch', async () => {
  const result = await bulkUpdateRetired({}, {
    body: { ids: [1, 2, 3, 4], is_retired: false },
    updateOne: async (db, { id }) => {
      if (id === 2) return { error: 'Submission not found', status: 404 };
      if (id === 4) throw new Error('boom');
      return { status: 200, body: { id } };
    },
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.ok, true);
  assert.strictEqual(result.body.is_retired, false);
  assert.strictEqual(result.body.requested, 4);
  assert.strictEqual(result.body.updated, 2);
  assert.deepStrictEqual(result.body.failed, [2, 4]);
});
