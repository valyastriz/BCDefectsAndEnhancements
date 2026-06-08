const { test } = require('node:test');
const assert = require('node:assert');

const { SUBMISSION_INSERT_COLUMNS, buildInsertPayload } = require('../src/helpers/submissionInsert');

test('buildInsertPayload zips columns and values in order', () => {
  const payload = buildInsertPayload(['a', 'b', 'c'], [1, 2, 3]);
  assert.deepStrictEqual(payload, { a: 1, b: 2, c: 3 });
});

test('buildInsertPayload sets undefined for missing values', () => {
  const payload = buildInsertPayload(['a', 'b'], [1]);
  assert.strictEqual(payload.a, 1);
  assert.ok('b' in payload);
  assert.strictEqual(payload.b, undefined);
});

test('SUBMISSION_INSERT_COLUMNS has no duplicates', () => {
  const unique = new Set(SUBMISSION_INSERT_COLUMNS);
  assert.strictEqual(unique.size, SUBMISSION_INSERT_COLUMNS.length);
});

test('buildInsertPayload over the shared columns produces one key per column', () => {
  const values = SUBMISSION_INSERT_COLUMNS.map((_, i) => i);
  const payload = buildInsertPayload(SUBMISSION_INSERT_COLUMNS, values);
  assert.strictEqual(Object.keys(payload).length, SUBMISSION_INSERT_COLUMNS.length);
  assert.strictEqual(payload.created_at, 0);
  assert.strictEqual(payload[SUBMISSION_INSERT_COLUMNS.at(-1)], SUBMISSION_INSERT_COLUMNS.length - 1);
});
