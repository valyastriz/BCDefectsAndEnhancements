const { test } = require('node:test');
const assert = require('node:assert');

const {
  cosineSimilarity,
  cosineTopK,
  buildAdminDoc,
  buildPublicDoc,
  contentHash,
} = require('../src/services/embeddingIndexService');
const { embedTexts } = require('../src/embeddings');
const { summarizeMatches } = require('../src/aiSummary');
const {
  isFeatureEnabled,
  runAiSearch,
  applyTimeWindow,
  applySimilarityFloor,
} = require('../src/services/aiSearchService');

// ── Cosine ranking ───────────────────────────────────────────────────────────
test('cosineSimilarity: identical/orthogonal/opposite', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [2, 0, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0]) - 0) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [-1, 0, 0]) + 1) < 1e-9);
  assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0); // zero vector -> 0, no NaN
});

test('cosineTopK: ranks by similarity, respects k, attaches score', () => {
  const candidates = [
    { id: 1, vector: [1, 0, 0] },
    { id: 2, vector: [0, 1, 0] },
    { id: 3, vector: [0.9, 0.1, 0] },
  ];
  const top = cosineTopK([1, 0, 0], candidates, 2);
  assert.equal(top.length, 2);
  assert.deepEqual(top.map((t) => t.id), [1, 3]); // exact match first, near match second
  assert.ok(top[0].score >= top[1].score);
  assert.ok(typeof top[0].score === 'number');
});

// ── Scope-safe search documents (leak guard at the embedding-input level) ──────
test('buildPublicDoc excludes internal fields; buildAdminDoc includes them', () => {
  const row = {
    id: 1,
    application_name: 'Billing Center',
    type: 'defect',
    status: 'Rejected',
    screen_title: 'Invoice',
    summary_of_issue: 'customer double charged',
    what_happened_exact_details: 'charged twice on renewal',
    request: 'refund the duplicate charge',
    steps_to_reproduce: 'open the invoice screen',
    decision_notes: 'SECRETNOTE rejected as duplicate of 12',
    impact_details: 'IMPACTSECRET high dollar impact',
    reviewer: 'Bob Reviewer',
    created_by_email: 'jane@example.com',
    is_public: 1,
  };

  const pub = buildPublicDoc(row);
  assert.ok(pub.includes('customer double charged'), 'public doc keeps public summary');
  assert.ok(!pub.includes('SECRETNOTE'), 'public doc must not include decision notes');
  assert.ok(!pub.includes('IMPACTSECRET'), 'public doc must not include impact details');
  assert.ok(!pub.includes('Bob Reviewer'), 'public doc must not include reviewer');
  assert.ok(!pub.includes('jane@example.com'), 'public doc must not include email');
  assert.ok(!pub.includes('open the invoice screen'), 'public doc must not include steps to reproduce');

  const adm = buildAdminDoc(row);
  assert.ok(adm.includes('SECRETNOTE'), 'admin doc includes decision notes');
  assert.ok(adm.includes('IMPACTSECRET'), 'admin doc includes impact');
  assert.ok(adm.includes('open the invoice screen'), 'admin doc includes steps');
});

// ── content_hash: stable, and only changes when text changes ───────────────────
test('contentHash is deterministic and text-sensitive', () => {
  const a = contentHash('hello world');
  const b = contentHash('hello world');
  const c = contentHash('hello worlds');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(contentHash(''), contentHash(''));
});

// ── Similarity floor (drops weak candidates on the RAW match, not blended score) ──
test('applySimilarityFloor drops candidates below the raw-match floor', () => {
  const ranked = [
    { id: 1, match: 0.9, score: 0.95 },
    { id: 2, match: 0.25, score: 0.26 }, // exactly at the floor -> kept
    { id: 3, match: 0.1, score: 0.8 },   // high blended score must NOT rescue it
    { id: 4, match: 0.05, score: 0.06 },
  ];
  const kept = applySimilarityFloor(ranked, 0.25);
  assert.deepEqual(kept.map((c) => c.id), [1, 2]);
});

test('applySimilarityFloor is disabled for zero or non-finite floors', () => {
  const ranked = [
    { id: 1, match: 0.9, score: 0.95 },
    { id: 2, match: -0.2, score: -0.1 },
  ];
  assert.equal(applySimilarityFloor(ranked, 0).length, 2);
  assert.equal(applySimilarityFloor(ranked, -1).length, 2);
  assert.equal(applySimilarityFloor(ranked, NaN).length, 2);
  assert.equal(applySimilarityFloor(ranked, undefined).length, 2);
});

// ── Time-window filter + windowExcluded count ─────────────────────────────────
test('applyTimeWindow keeps everything and excludes 0 without window params', () => {
  const now = Date.parse('2026-07-01T00:00:00Z');
  const day = 86400000;
  const rows = [
    { id: 1, created_at: new Date(now - 10 * day).toISOString() },
    { id: 2, created_at: new Date(now - 400 * day).toISOString() },
  ];
  const { kept, excluded } = applyTimeWindow(rows, { now });
  assert.equal(kept.length, 2);
  assert.equal(excluded, 0);
});

test('applyTimeWindow reported window drops older tickets and counts them', () => {
  const now = Date.parse('2026-07-01T00:00:00Z');
  const day = 86400000;
  const rows = [
    { id: 1, created_at: new Date(now - 10 * day).toISOString() },
    { id: 2, created_at: new Date(now - 100 * day).toISOString() },
    { id: 3, created_at: new Date(now - 400 * day).toISOString() },
    { id: 4, created_at: 'not-a-date' }, // unparseable -> excluded when a window is set
  ];
  const { kept, excluded } = applyTimeWindow(rows, { reportedDays: 30, now });
  assert.deepEqual(kept.map((r) => r.id), [1]);
  assert.equal(excluded, 3);
});

test('applyTimeWindow resolved window uses the resolvedMap', () => {
  const now = Date.parse('2026-07-01T00:00:00Z');
  const day = 86400000;
  const rows = [
    { id: 1, created_at: new Date(now - 50 * day).toISOString() },
    { id: 2, created_at: new Date(now - 50 * day).toISOString() },
    { id: 3, created_at: new Date(now - 50 * day).toISOString() },
  ];
  const resolvedMap = new Map([
    [1, { t: now - 5 * day, at: new Date(now - 5 * day).toISOString() }],   // in window
    [2, { t: now - 90 * day, at: new Date(now - 90 * day).toISOString() }], // too old
    // id 3 never resolved -> excluded
  ]);
  const { kept, excluded } = applyTimeWindow(rows, { resolvedDays: 30, resolvedMap, now });
  assert.deepEqual(kept.map((r) => r.id), [1]);
  assert.equal(excluded, 2);
});

// ── Graceful degradation ───────────────────────────────────────────────────────
test('embedTexts([]) returns [] without a provider', async () => {
  const out = await embedTexts([]);
  assert.deepEqual(out, []);
});

test('summarizeMatches returns an empty (non-throwing) result for empty input', async () => {
  const r1 = await summarizeMatches({ query: 'anything', tickets: [] });
  assert.equal(r1.answer_summary, '');
  assert.deepEqual(r1.matches, []);
  assert.equal(r1.has_relevant_match, false);
  const r2 = await summarizeMatches({ query: '', tickets: [{ id: 1 }] });
  assert.deepEqual(r2.matches, []);
  assert.equal(r2.has_relevant_match, false);
});

test('runAiSearch reports disabled when the feature is not configured', async () => {
  // Deterministic in both environments: only assert the disabled path when the
  // feature genuinely isn't configured (no embeddings key in this env).
  if (!isFeatureEnabled('public')) {
    const res = await runAiSearch(null, { query: 'hello', scope: 'public' });
    assert.equal(res.enabled, false);
    assert.ok(res.reason);
  } else {
    assert.ok(true, 'AI search configured in this environment; disabled-path assertion skipped');
  }
});

test('runAiSearch responses carry windowExcluded: 0 when nothing was filtered', async () => {
  // Only runs when the feature is configured; with no DB initialized the
  // candidate set is empty, so the response must still expose windowExcluded.
  if (isFeatureEnabled('public')) {
    const res = await runAiSearch(null, { query: 'hello', scope: 'public' });
    assert.equal(res.enabled, true);
    assert.equal(res.windowExcluded, 0);
    const empty = await runAiSearch(null, { query: '', scope: 'public' });
    assert.equal(empty.windowExcluded, 0);
  } else {
    assert.ok(true, 'AI search not configured in this environment; shape assertion skipped');
  }
});
