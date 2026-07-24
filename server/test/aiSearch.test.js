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
const { summarizeMatches, normalizeSummaryResult } = require('../src/aiSummary');
const {
  isFeatureEnabled,
  runAiSearch,
  applyTimeWindow,
  applySimilarityFloor,
  selectTopK,
  extractKeywordTerms,
  findKeywordHits,
  unionKeywordHits,
  composeFinalResults,
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

// ── Round 2 (D5): top-K SELECTION is by raw match, never the blended score ────
test('selectTopK: a high-blended/low-raw candidate cannot eject a high-raw one', () => {
  const ranked = [
    { id: 22, match: 0.44, score: 0.446 },  // old ticket: best raw, worst blended
    { id: 101, match: 0.42, score: 0.55 },  // recent junk: best blended
    { id: 102, match: 0.40, score: 0.52 },  // recent junk
    { id: 103, match: 0.10, score: 0.90 },  // below floor: blended must not rescue it
  ];
  const top = selectTopK(ranked, { minSimilarity: 0.25, limit: 2 });
  assert.deepEqual(top.map((c) => c.id), [22, 101]);
});

// ── Round 2 (D6): self-consistency guard on the summary ───────────────────────
test('normalizeSummaryResult: has_relevant_match=false forces matches=[]', () => {
  const out = normalizeSummaryResult({
    answer_summary: 'Nothing about this topic was found.',
    reported_in_window: false,
    resolved_in_window: false,
    has_relevant_match: false,
    matches: [{ submission_id: 79, relevance: 'high', why: 'pattern-matched junk' }],
  });
  assert.deepEqual(out.matches, []);
  assert.equal(out.has_relevant_match, false);
});

test('normalizeSummaryResult keeps matches when has_relevant_match is true or absent', () => {
  const listed = [{ submission_id: 22, relevance: 'high', why: 'same topic' }];
  const explicit = normalizeSummaryResult({ answer_summary: 'x', has_relevant_match: true, matches: listed });
  assert.equal(explicit.matches.length, 1);
  assert.equal(explicit.has_relevant_match, true);
  const absent = normalizeSummaryResult({ answer_summary: 'x', matches: listed });
  assert.equal(absent.matches.length, 1);
  assert.equal(absent.has_relevant_match, true); // falls back to matches.length > 0
});

// ── Round 2 (D7): keyword safety net ──────────────────────────────────────────
test('keyword hit outside the vector top-K still appears in final results', () => {
  const topK = [
    { id: 1, match: 0.9, score: 0.95 },
    { id: 2, match: 0.8, score: 0.85 },
  ];
  const keywordHits = [{ id: 42, match: 0.2, score: 0.23 }]; // outside the K cut
  const llmCandidates = unionKeywordHits(topK, keywordHits, 30);
  assert.deepEqual(llmCandidates.map((c) => c.id), [1, 2, 42]); // rides along to the LLM
  const aiMatches = [{ submission_id: 1, relevance: 'high', why: 'on topic' }];
  const final = composeFinalResults({ candidates: llmCandidates, keywordHits, aiMatches, limit: 20 });
  // Endorsed first, unendorsed keyword hit guaranteed after; unendorsed
  // non-keyword candidate (id 2) is dropped.
  assert.deepEqual(final.map((c) => c.id), [1, 42]);
});

test('composeFinalResults orders by relevance tier then blended score, capped at limit', () => {
  const candidates = [
    { id: 1, match: 0.5, score: 0.50 },
    { id: 2, match: 0.6, score: 0.70 },
    { id: 3, match: 0.7, score: 0.60 },
  ];
  const aiMatches = [
    { submission_id: 1, relevance: 'high', why: '' },
    { submission_id: 2, relevance: 'medium', why: '' },
    { submission_id: 3, relevance: 'high', why: '' },
  ];
  const final = composeFinalResults({ candidates, keywordHits: [], aiMatches, limit: 2 });
  // Both high-tier tickets first (blended tiebreak: 3 over 1); medium cut by the cap.
  assert.deepEqual(final.map((c) => c.id), [3, 1]);
});

test('unionKeywordHits caps the LLM candidate set', () => {
  const topK = [
    { id: 1, match: 0.9, score: 0.9 },
    { id: 2, match: 0.8, score: 0.8 },
  ];
  const keywordHits = [
    { id: 2, match: 0.8, score: 0.8 },  // already in top-K -> not duplicated
    { id: 3, match: 0.4, score: 0.4 },
    { id: 4, match: 0.3, score: 0.3 },
  ];
  assert.deepEqual(unionKeywordHits(topK, keywordHits, 3).map((c) => c.id), [1, 2, 3]);
});

test('extractKeywordTerms: "invoices" also matches "invoice"; stopwords and short terms drop', () => {
  const terms = extractKeywordTerms('Anything on invoices?');
  assert.ok(terms.includes('invoices'));
  assert.ok(terms.includes('invoice')); // trailing-'s'-trimmed variant
  assert.ok(!terms.includes('anything')); // stopword
  assert.ok(!terms.includes('on')); // < 3 chars
  assert.deepEqual(extractKeywordTerms('any of the'), []);
});

test('public scope: keyword hits cannot come from non-public rows or internal text', () => {
  const base = { application_name: 'Billing Center', type: 'defect', status: 'New' };
  const candidates = [
    { id: 1, match: 0.3, score: 0.3, row: { ...base, id: 1, is_public: 1, summary_of_issue: 'invoice preview totals differ' } },
    { id: 2, match: 0.5, score: 0.5, row: { ...base, id: 2, is_public: 0, summary_of_issue: 'invoice rounding bug' } }, // private ticket
    { id: 3, match: 0.4, score: 0.4, row: { ...base, id: 3, is_public: 1, summary_of_issue: 'unrelated topic', decision_notes: 'invoice secret note' } }, // term only in an internal field
  ];
  const publicHits = findKeywordHits(candidates, ['invoice'], { scope: 'public' });
  assert.deepEqual(publicHits.map((c) => c.id), [1]);
  // Admin scope may match internal text and non-public rows (ordered by raw match).
  const adminHits = findKeywordHits(candidates, ['invoice'], { scope: 'admin' });
  assert.deepEqual(adminHits.map((c) => c.id), [2, 3, 1]);
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
