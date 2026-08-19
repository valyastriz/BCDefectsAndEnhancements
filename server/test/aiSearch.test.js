const { test } = require('node:test');
const assert = require('node:assert');

const {
  cosineSimilarity,
  cosineTopK,
  buildAdminDoc,
  buildPublicDoc,
  buildKeywordDoc,
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
  extractIdentifierTerms,
  applicationInQuery,
  findKeywordHits,
  findIdentifierHits,
  composeKeywordMatches,
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
test('keyword hit outside the vector top-K rides to the LLM and lands in its own section', () => {
  const topK = [
    { id: 1, match: 0.9, score: 0.95 },
    { id: 2, match: 0.8, score: 0.85 },
  ];
  const keywordHits = [{ id: 42, match: 0.2, score: 0.23 }]; // outside the K cut
  const llmCandidates = unionKeywordHits(topK, keywordHits, 30);
  assert.deepEqual(llmCandidates.map((c) => c.id), [1, 2, 42]); // rides along to the LLM
  const aiMatches = [{ submission_id: 1, relevance: 'high', why: 'on topic' }];
  const semantic = composeFinalResults({ candidates: llmCandidates, aiMatches, limit: 20 });
  // The semantic section is the endorsed set only — the unendorsed keyword hit
  // (42) and the unendorsed non-keyword candidate (2) are both out of it.
  assert.deepEqual(semantic.map((c) => c.id), [1]);
  // ...but the keyword hit is still guaranteed a spot, in its own section.
  const keywordSection = composeKeywordMatches({
    keywordHits,
    excludeIds: semantic.map((c) => c.id),
    limit: 20,
  });
  assert.deepEqual(keywordSection.map((c) => c.id), [42]);
});

test('a ticket endorsed by the LLM is not repeated in the keyword section', () => {
  const hits = [{ id: 7, match: 0.6, score: 0.65 }, { id: 8, match: 0.3, score: 0.31 }];
  const section = composeKeywordMatches({ keywordHits: hits, excludeIds: [7], limit: 20 });
  assert.deepEqual(section.map((c) => c.id), [8]);
});

test('the two sections are disjoint: a ticket lands in the keyword list ONLY if it missed the AI list', () => {
  // Mirrors the exact wiring in runAiSearch, under the worst overlap available:
  // ticket 1 is a top-K semantic candidate AND an identifier hit AND endorsed;
  // ticket 7 is both an identifier hit and a keyword hit AND endorsed; ticket 9
  // is a literal hit that the LLM ignored. Only 9 may appear below.
  const topK = [
    { id: 1, match: 0.9, score: 0.95 },
    { id: 2, match: 0.8, score: 0.85 },
  ];
  const identifierHits = [
    { id: 1, match: 0.9, score: 0.95, matchedOn: ['policy_num'] },
    { id: 7, match: 0.2, score: 0.24, matchedOn: ['easyvista_ticket_id'] },
  ];
  const keywordHits = [
    { id: 7, match: 0.2, score: 0.24 }, // same ticket, reached by both paths
    { id: 9, match: 0.1, score: 0.13 },
  ];
  const llmCandidates = unionKeywordHits(topK, [...identifierHits, ...keywordHits], 30);
  const aiMatches = [
    { submission_id: 1, relevance: 'high', why: '' },
    { submission_id: 7, relevance: 'medium', why: '' },
  ];

  const semantic = composeFinalResults({ candidates: llmCandidates, aiMatches, limit: 20 });
  const keyword = composeKeywordMatches({
    identifierHits,
    keywordHits,
    excludeIds: semantic.map((c) => c.id),
    limit: 20,
  });

  assert.deepEqual(semantic.map((c) => c.id), [1, 7], 'endorsed tickets stay in the AI section');
  assert.deepEqual(keyword.map((c) => c.id), [9], 'only the unendorsed literal hit falls through');

  const semanticIds = new Set(semantic.map((c) => c.id));
  const overlap = keyword.filter((c) => semanticIds.has(c.id)).map((c) => c.id);
  assert.deepEqual(overlap, [], `a ticket appeared in both sections: ${overlap.join(', ')}`);
  // Reaching the keyword list by two paths must not list it twice either.
  assert.equal(new Set(keyword.map((c) => c.id)).size, keyword.length, 'keyword section has duplicates');
  assert.equal(new Set(semantic.map((c) => c.id)).size, semantic.length, 'AI section has duplicates');
});

test('composeKeywordMatches puts identifier hits first and respects the limit', () => {
  const identifierHits = [{ id: 5, match: 0, score: 0.02, matchedOn: ['easyvista_ticket_id'] }];
  const keywordHits = [
    { id: 6, match: 0.4, score: 0.44 },
    { id: 7, match: 0.5, score: 0.51 },
  ];
  // An exact incident-number hit outranks better-scoring text hits...
  const all = composeKeywordMatches({ identifierHits, keywordHits, limit: 20 });
  assert.deepEqual(all.map((c) => c.id), [5, 7, 6]); // then text hits by blended score
  // ...and survives the cap rather than being crowded out by them.
  const capped = composeKeywordMatches({ identifierHits, keywordHits, limit: 1 });
  assert.deepEqual(capped.map((c) => c.id), [5]);
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
  const final = composeFinalResults({ candidates, aiMatches, limit: 2 });
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

// Every row in this portal is a request, and most of them are a defect, an
// enhancement or a report — so those words say nothing about WHICH one, and a
// requester whose report request says "report" was being handed the whole report
// queue as candidate duplicates.
test('the portal\'s own vocabulary cannot be a keyword hit — including "report"', () => {
  const terms = extractKeywordTerms('A report of unapplied cash, reported monthly');
  assert.ok(!terms.includes('report'));
  assert.ok(!terms.includes('reports'));
  assert.ok(!terms.includes('reported'));
  assert.ok(terms.includes('unapplied'), 'the words that DO distinguish it survive');
  assert.ok(terms.includes('cash'));
  assert.deepEqual(extractKeywordTerms('a report on the tickets and defects'), []);
});

// An application is a TAG. Matching its NAME as text made every ticket in an
// application a literal hit for the application's own name — which, on a
// duplicate check, is every ticket in the queue being filed into.
test('applicationInQuery lifts an application name out of the words and into the scope', () => {
  const applications = [
    { id: 1, name: 'Billing Center' },
    { id: 2, name: 'Policy Center' },
    { id: 3, name: 'Other' },
  ];

  const named = applicationInQuery('Billing Center invoice shows the wrong amount', applications);
  assert.equal(named.scope.id, 1);
  assert.equal(named.scope.name, 'Billing Center');
  const terms = extractKeywordTerms(
    'Billing Center invoice shows the wrong amount',
    { excluded: named.excluded },
  );
  assert.ok(!terms.includes('billing'));
  // "center" belongs to Policy Center too, so it is excluded whichever one won.
  assert.ok(!terms.includes('center'));
  assert.ok(terms.includes('invoice'));
  assert.ok(terms.includes('amount'));

  // The longest name wins, so a shared word cannot decide the scope.
  assert.equal(applicationInQuery('policy center renewal quote fails', applications).scope.name, 'Policy Center');

  // No application named, no scope — and the exclusions still apply, because a
  // description that happens to say "billing" is not thereby a duplicate.
  const unnamed = applicationInQuery('the invoice total is wrong', applications);
  assert.equal(unnamed.scope, null);

  // `Other` is a real application whose only word is a stopword. It must never
  // swallow a search that merely contains the word "other".
  assert.equal(applicationInQuery('this and other invoices', applications).scope, null);
  assert.ok(!applicationInQuery('this and other invoices', applications).excluded.has('other'));
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

// ── Identifier lookup (paste an incident number into the AI box) ─────────────
const IDENTIFIABLE_ROW = {
  id: 42,
  application_name: 'Billing Center',
  type: 'defect',
  status: 'New',
  summary_of_issue: 'invoice totals differ',
  easyvista_ticket_id: 'INC0012345',
  jira_number: 'BC-4471',
  release_number: 'R2026.3',
  policy_num: '981234567',
  account_num: '55501',
  transaction_num: 'TXN-9090',
  created_by: 'Dana Reporter',
  created_by_email: 'dana@example.com',
  easyvista_submitted_by: 'Sam Submitter',
  is_public: 1,
};

function candidateFor(row, overrides = {}) {
  return { id: Number(row.id), row, match: 0, score: 0, ...overrides };
}

test('the keyword doc adds identifiers and people WITHOUT changing the embedded doc', () => {
  // The whole point of a separate lookup doc: the embedded text (and therefore
  // every content_hash and every stored vector) is untouched, so adding
  // identifier search does not re-index the corpus.
  const embedded = buildAdminDoc(IDENTIFIABLE_ROW);
  assert.ok(!embedded.includes('INC0012345'), 'identifiers must stay out of the embedded doc');
  assert.ok(!embedded.includes('Dana Reporter'), 'people must stay out of the embedded doc');

  const lookup = buildKeywordDoc(IDENTIFIABLE_ROW, 'admin');
  assert.ok(lookup.includes('invoice totals differ'), 'the lookup doc carries the ticket prose');
  for (const value of ['#42', 'INC0012345', 'BC-4471', 'R2026.3', '981234567', 'TXN-9090', 'Dana Reporter', 'dana@example.com', 'Sam Submitter']) {
    assert.ok(lookup.includes(value), `lookup doc is missing ${value}`);
  }
});

// The two ways this document used to make a ticket match a word that says
// nothing about it. Both are facts about the SHAPE of the row, not its content:
// a ticket is not about billing because it is filed under Billing Center, and it
// is not about screens because the form has a field called Screen.
test('the keyword doc carries neither the facets nor the field labels', () => {
  for (const scope of ['admin', 'public']) {
    const lookup = buildKeywordDoc({ ...IDENTIFIABLE_ROW, status: 'Deployed' }, scope);
    assert.ok(!/Billing Center/i.test(lookup), `${scope}: the application is a tag, not a word`);
    assert.ok(!/\bdefect\b/i.test(lookup), `${scope}: the type is a tag, not a word`);
    assert.ok(!/\bDeployed\b/i.test(lookup), `${scope}: the status is a tag, not a word`);
    assert.ok(!/^Summary:/m.test(lookup), `${scope}: field labels are not content`);
    assert.ok(!/^Policy:/m.test(lookup), `${scope}: field labels are not content`);
  }

  // And the EMBEDDED docs still carry all of it, in the same order — a changed
  // embedded doc changes its content_hash and re-embeds the whole corpus.
  const embedded = buildAdminDoc({ ...IDENTIFIABLE_ROW, status: 'Deployed' });
  assert.ok(embedded.startsWith('Application: Billing Center\nType: defect\nStatus: Deployed\n'));
  assert.ok(embedded.includes('Summary: invoice totals differ'));
});

test('the public keyword doc withholds email and submitted-by', () => {
  const lookup = buildKeywordDoc(IDENTIFIABLE_ROW, 'public');
  assert.ok(lookup.includes('INC0012345'), 'public lookup keeps the allow-listed incident number');
  assert.ok(lookup.includes('Dana Reporter'), 'created_by is on the public allow-list');
  assert.ok(!lookup.includes('dana@example.com'), 'public lookup must not include the reporter email');
  assert.ok(!lookup.includes('Sam Submitter'), 'public lookup must not include easyvista_submitted_by');
  assert.ok(!lookup.includes('TXN-9090'), 'transaction_num is not on the public allow-list');
  assert.ok(!lookup.includes('R2026.3'), 'release_number is not on the public allow-list');
});

test('extractIdentifierTerms keeps numbers a prose tokenizer would throw away', () => {
  assert.deepEqual(extractIdentifierTerms('#42'), ['42']); // under the 3-char prose floor
  assert.deepEqual(extractIdentifierTerms('anything on INC0012345?'), ['inc0012345']);
  assert.deepEqual(extractIdentifierTerms('BC-4471 and 981234567'), ['bc-4471', '981234567']);
  assert.deepEqual(extractIdentifierTerms('double charged on renewal'), []); // no digits, no terms
});

test('an incident number finds its ticket; a ticket id matches exactly, not as a substring', () => {
  const other = { ...IDENTIFIABLE_ROW, id: 1420, easyvista_ticket_id: 'INC0099999', policy_num: '', jira_number: '', transaction_num: '', account_num: '' };
  const candidates = [candidateFor(IDENTIFIABLE_ROW), candidateFor(other)];

  const byIncident = findIdentifierHits(candidates, extractIdentifierTerms('INC0012345'), { scope: 'admin' });
  assert.deepEqual(byIncident.map((c) => c.id), [42]);
  assert.deepEqual(byIncident[0].matchedOn, ['easyvista_ticket_id']);

  // "#42" must not also drag in #1420 — the numeric id is equality-only.
  const byTicketId = findIdentifierHits(candidates, extractIdentifierTerms('#42'), { scope: 'admin' });
  assert.deepEqual(byTicketId.map((c) => c.id), [42]);
  assert.deepEqual(byTicketId[0].matchedOn, ['id']);
});

test('a bare year cannot substring-match a policy number', () => {
  // "2026" appears inside no identifier here by equality, and a 4-digit
  // all-numeric term is not distinctive enough to match inside one.
  const row = { ...IDENTIFIABLE_ROW, policy_num: '920261111' };
  const hits = findIdentifierHits([candidateFor(row)], extractIdentifierTerms('errors in 2026'), { scope: 'admin' });
  assert.deepEqual(hits, []);
  // A distinctive term still matches inside a longer identifier.
  const partial = findIdentifierHits([candidateFor(row)], ['920261'], { scope: 'admin' });
  assert.deepEqual(partial.map((c) => c.id), [42]);
});

test('public identifier lookup fails closed on private rows and internal fields', () => {
  const privateRow = { ...IDENTIFIABLE_ROW, id: 43, is_public: 0 };
  const hits = findIdentifierHits([candidateFor(privateRow)], ['inc0012345'], { scope: 'public' });
  assert.deepEqual(hits, [], 'a private ticket must never be found by its incident number publicly');

  // transaction_num is off the public allow-list, so it cannot produce a hit.
  const publicHits = findIdentifierHits([candidateFor(IDENTIFIABLE_ROW)], ['txn-9090'], { scope: 'public' });
  assert.deepEqual(publicHits, []);
  const adminHits = findIdentifierHits([candidateFor(IDENTIFIABLE_ROW)], ['txn-9090'], { scope: 'admin' });
  assert.deepEqual(adminHits.map((c) => c.matchedOn), [['transaction_num']]);
});

test('a reporter name is a keyword hit for admins, and public keyword hits stay public-safe', () => {
  const candidates = [candidateFor(IDENTIFIABLE_ROW)];
  assert.deepEqual(findKeywordHits(candidates, ['reporter'], { scope: 'admin' }).map((c) => c.id), [42]);
  // The reporter's email is admin-only text: it can create an admin hit, never a public one.
  assert.deepEqual(findKeywordHits(candidates, ['dana@example.com'], { scope: 'admin' }).map((c) => c.id), [42]);
  assert.deepEqual(findKeywordHits(candidates, ['dana@example.com'], { scope: 'public' }), []);
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
