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
  assert.deepStrictEqual(
    sanitizeViewPreference(),
    { columns: [], filters: [], pinnedApplication: null },
  );
  assert.deepStrictEqual(
    sanitizeViewPreference({ columns: 'summary', filters: null }),
    { columns: [], filters: [], pinnedApplication: null },
  );
});

// ── The pinned queue scope ───────────────────────────────────────────────────
// An admin who owns one product pins it and lands there every session; looking
// at another team's queue stays a look. "No pin" and "pinned to everything" are
// deliberately different states — the first falls back to the home application,
// the second is a decision to see all of it.
test('sanitizeViewPreference keeps a pinned application name', () => {
  const result = sanitizeViewPreference({ pinnedApplication: 'Billing Center' });
  assert.strictEqual(result.pinnedApplication, 'Billing Center');
});

test('sanitizeViewPreference keeps the all-applications sentinel', () => {
  assert.strictEqual(sanitizeViewPreference({ pinnedApplication: '__all__' }).pinnedApplication, '__all__');
});

test('sanitizeViewPreference trims a pinned name', () => {
  assert.strictEqual(
    sanitizeViewPreference({ pinnedApplication: '  Policy Center  ' }).pinnedApplication,
    'Policy Center',
  );
});

test('sanitizeViewPreference treats blank and missing as no pin', () => {
  for (const value of [undefined, null, '', '   ']) {
    assert.strictEqual(sanitizeViewPreference({ pinnedApplication: value }).pinnedApplication, null);
  }
});

test('sanitizeViewPreference refuses a non-string or oversized pin', () => {
  // Falls back to null rather than 400: a bad pin should degrade to the home
  // application, never block someone saving their column layout.
  assert.strictEqual(sanitizeViewPreference({ pinnedApplication: 42 }).pinnedApplication, '42');
  assert.strictEqual(sanitizeViewPreference({ pinnedApplication: {} }).pinnedApplication, '[object Object]');
  assert.strictEqual(
    sanitizeViewPreference({ pinnedApplication: 'x'.repeat(200) }).pinnedApplication,
    null,
  );
});

test('a pin is independent of the column and filter lists', () => {
  // Saving a column layout must not drop the pin, and vice versa — the endpoint
  // replaces the whole row, so both travel together.
  const result = sanitizeViewPreference({
    columns: ['summary'],
    filters: ['search'],
    pinnedApplication: 'Billing Center',
  });
  assert.deepStrictEqual(result, {
    columns: ['summary'],
    filters: ['search'],
    pinnedApplication: 'Billing Center',
  });
});

test('sanitizeViewPreference ignores non-string and blank entries', () => {
  const result = sanitizeViewPreference({
    columns: ['summary', 42, '', '  ', null, 'status'],
    filters: [{}, 'search'],
  });
  assert.deepStrictEqual(result.columns, ['summary', 'status']);
  assert.deepStrictEqual(result.filters, ['search']);
});
