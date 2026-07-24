const { test } = require('node:test');
const assert = require('node:assert');

const { resolveCreateVisibility } = require('../src/services/submissionService');

// Real defect/enhancement tickets default to public (1).
test('resolveCreateVisibility defaults a non-cleanup ticket to public', () => {
  assert.strictEqual(resolveCreateVisibility({ isCleanup: false }), 1);
  assert.strictEqual(resolveCreateVisibility({}), 1);
  assert.strictEqual(resolveCreateVisibility(), 1);
});

// Internal cleanup-only tasks default to private (0).
test('resolveCreateVisibility defaults a cleanup-only task to private', () => {
  assert.strictEqual(resolveCreateVisibility({ isCleanup: true }), 0);
});

// An explicit boolean from the caller always wins, in either direction.
test('resolveCreateVisibility honours an explicit is_public boolean', () => {
  assert.strictEqual(resolveCreateVisibility({ isCleanup: false, is_public: false }), 0);
  assert.strictEqual(resolveCreateVisibility({ isCleanup: true, is_public: true }), 1);
});

// Non-boolean is_public (e.g. undefined from the create modals) falls through
// to the cleanup-based default rather than being coerced.
test('resolveCreateVisibility ignores a non-boolean is_public', () => {
  assert.strictEqual(resolveCreateVisibility({ isCleanup: true, is_public: undefined }), 0);
  assert.strictEqual(resolveCreateVisibility({ isCleanup: false, is_public: 'yes' }), 1);
});
