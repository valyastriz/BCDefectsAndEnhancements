const { test } = require('node:test');
const assert = require('node:assert');

const { mapPublicRouting, NOTE_MAX_LENGTH } = require('../src/services/redirectService');

// The hand-off note is internal triage talk: it can name colleagues, other
// accounts, or a judgement about someone else's work. The reporter sees THAT
// their ticket moved and when — never what was said about it. This is the
// easiest thing in the feature to regress silently, so it is pinned here
// alongside the existing public-leak guard in mappers.test.js.

const FULL_ROUTING_ROW = {
  id: 3,
  submission_id: 42,
  from_application_id: 1,
  to_application_id: 2,
  from_application_name: 'Billing Center',
  to_application_name: 'Policy Center',
  status_at_handoff: 'Approved',
  note: 'Spoke to Marcus in Policy - he agrees it is theirs. Do not re-run the rating check, I already did.',
  routed_at: '2026-08-03T18:00:00.000Z',
  routed_by: 'lead_admin',
};

test('mapPublicRouting never exposes the hand-off note', () => {
  const result = mapPublicRouting(FULL_ROUTING_ROW);

  assert.ok(!('note' in result), 'the note must NOT reach the reporter');
  // Nor the things that would let them infer the internal conversation.
  assert.ok(!('routed_by' in result), 'who moved it is internal');
  assert.ok(!('status_at_handoff' in result), 'the sending team\'s status is internal');
  assert.ok(!('submission_id' in result));
});

test('mapPublicRouting keeps what the reporter legitimately needs', () => {
  const result = mapPublicRouting(FULL_ROUTING_ROW);

  assert.deepStrictEqual(result, {
    id: 3,
    from_application_name: 'Billing Center',
    to_application_name: 'Policy Center',
    routed_at: '2026-08-03T18:00:00.000Z',
  });
});

test('mapPublicRouting does not leak the note text under any key', () => {
  // Belt and braces: a future field added to the mapper must not smuggle it.
  const serialized = JSON.stringify(mapPublicRouting(FULL_ROUTING_ROW));
  assert.ok(!serialized.includes('Marcus'), 'note content appeared in the payload');
  assert.ok(!serialized.includes('rating check'), 'note content appeared in the payload');
  assert.ok(!serialized.includes('lead_admin'), 'the routing admin appeared in the payload');
});

test('mapPublicRouting handles the original filing, which has no source', () => {
  // from_application_id is null for the first row of a custody chain.
  const result = mapPublicRouting({
    id: 1, from_application_name: null, to_application_name: 'Billing Center',
    routed_at: '2026-08-01T00:00:00.000Z',
  });
  assert.strictEqual(result.from_application_name, null);
  assert.strictEqual(result.to_application_name, 'Billing Center');
});

test('mapPublicRouting returns null for a null row', () => {
  assert.strictEqual(mapPublicRouting(null), null);
});

test('the note has a bounded length', () => {
  // A free-text field on a write endpoint with no ceiling is an easy way to
  // bloat a row until reads slow down.
  assert.ok(Number.isInteger(NOTE_MAX_LENGTH) && NOTE_MAX_LENGTH > 0);
});
