const { test } = require('node:test');
const assert = require('node:assert');

const { sanitizeViewPreference } = require('../src/services/adminViewPreferenceService');

test('sanitizeViewPreference keeps known keys and preserves column order', () => {
  const result = sanitizeViewPreference({
    columns: ['summary', 'reportedDate', 'status'],
    filters: ['search', 'statuses'],
  });
  assert.deepStrictEqual(result.columns, ['summary', 'reportedDate', 'status']);
  assert.deepStrictEqual(result.filters, ['search', 'statuses']);
});

test('sanitizeViewPreference drops unknown keys', () => {
  const result = sanitizeViewPreference({
    columns: ['summary', 'bogusColumn', 'status'],
    filters: ['search', 'notAFilter'],
  });
  assert.deepStrictEqual(result.columns, ['summary', 'status']);
  assert.deepStrictEqual(result.filters, ['search']);
});

test('sanitizeViewPreference dedupes repeated keys', () => {
  const result = sanitizeViewPreference({
    columns: ['summary', 'summary', 'status'],
    filters: ['search', 'search'],
  });
  assert.deepStrictEqual(result.columns, ['summary', 'status']);
  assert.deepStrictEqual(result.filters, ['search']);
});

test('sanitizeViewPreference coerces non-array / missing input to empty arrays', () => {
  assert.deepStrictEqual(sanitizeViewPreference(), { columns: [], filters: [] });
  assert.deepStrictEqual(
    sanitizeViewPreference({ columns: 'summary', filters: null }),
    { columns: [], filters: [] },
  );
});

test('sanitizeViewPreference ignores non-string and blank entries', () => {
  const result = sanitizeViewPreference({
    columns: ['summary', 42, '', '  ', null, 'status'],
    filters: [{}, 'search'],
  });
  assert.deepStrictEqual(result.columns, ['summary', 'status']);
  assert.deepStrictEqual(result.filters, ['search']);
});
