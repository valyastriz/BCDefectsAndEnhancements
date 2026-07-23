const { test } = require('node:test');
const assert = require('node:assert');

const {
  validateBulkVisibilityInput,
  bulkUpdateVisibility,
} = require('../src/services/submissionService');

// ── Boundary validation (pure, no DB) ────────────────────────────────────────

test('validateBulkVisibilityInput rejects a non-array ids', () => {
  assert.ok(validateBulkVisibilityInput({ ids: 'nope', is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ ids: 5, is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ is_public: true }).error);
});

test('validateBulkVisibilityInput rejects an empty ids array', () => {
  const result = validateBulkVisibilityInput({ ids: [], is_public: true });
  assert.ok(result.error);
});

test('validateBulkVisibilityInput rejects more than 1000 ids', () => {
  const ids = Array.from({ length: 1001 }, (_v, i) => i + 1);
  assert.ok(validateBulkVisibilityInput({ ids, is_public: false }).error);
  // Exactly 1000 is allowed.
  const okIds = Array.from({ length: 1000 }, (_v, i) => i + 1);
  assert.strictEqual(validateBulkVisibilityInput({ ids: okIds, is_public: false }).error, undefined);
});

test('validateBulkVisibilityInput rejects a missing or non-boolean is_public', () => {
  assert.ok(validateBulkVisibilityInput({ ids: [1, 2] }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, 2], is_public: 'true' }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, 2], is_public: 1 }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, 2], is_public: null }).error);
});

test('validateBulkVisibilityInput rejects non-integer or non-positive ids', () => {
  assert.ok(validateBulkVisibilityInput({ ids: [1, 0], is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, -3], is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, 2.5], is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, 'abc'], is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, ''], is_public: true }).error);
  assert.ok(validateBulkVisibilityInput({ ids: [1, null], is_public: true }).error);
});

test('validateBulkVisibilityInput coerces numeric strings to integers', () => {
  const result = validateBulkVisibilityInput({ ids: [1, '2', ' 3 '], is_public: true });
  assert.strictEqual(result.error, undefined);
  assert.deepStrictEqual(result.ids, [1, 2, 3]);
  assert.strictEqual(result.isPublic, true);
});

// ── Service loop (injected updater, no DB) ───────────────────────────────────

test('bulkUpdateVisibility returns a 400 result on invalid input', async () => {
  const result = await bulkUpdateVisibility({}, {
    body: { ids: [], is_public: true },
    updateOne: async () => assert.fail('updater must not run on invalid input'),
  });
  assert.strictEqual(result.status, 400);
  assert.ok(result.error);
  assert.strictEqual(result.body, undefined);
});

test('bulkUpdateVisibility updates every id on full success', async () => {
  const seen = [];
  const result = await bulkUpdateVisibility({ fake: 'db' }, {
    body: { ids: [1, 2, 3], is_public: true },
    username: 'admin-bob',
    updateOne: async (db, { id, body, username }) => {
      seen.push({ id, is_public: body.is_public, username });
      return { status: 200, body: { id } };
    },
  });

  assert.deepStrictEqual(result.body, {
    ok: true,
    is_public: true,
    requested: 3,
    updated: 3,
    failed: [],
  });
  // Parity: each id is forwarded through the per-row path with only { is_public }.
  assert.deepStrictEqual(seen, [
    { id: 1, is_public: true, username: 'admin-bob' },
    { id: 2, is_public: true, username: 'admin-bob' },
    { id: 3, is_public: true, username: 'admin-bob' },
  ]);
});

test('bulkUpdateVisibility collects per-id failures without aborting the batch', async () => {
  const result = await bulkUpdateVisibility({}, {
    body: { ids: [1, 2, 3, 4], is_public: false },
    updateOne: async (db, { id }) => {
      if (id === 2) return { error: 'Submission not found', status: 404 };
      if (id === 4) throw new Error('boom');
      return { status: 200, body: { id } };
    },
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.ok, true);
  assert.strictEqual(result.body.is_public, false);
  assert.strictEqual(result.body.requested, 4);
  assert.strictEqual(result.body.updated, 2);
  assert.deepStrictEqual(result.body.failed, [2, 4]);
});
