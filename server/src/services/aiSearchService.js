// AI semantic ticket search: retrieve -> rank -> summarize.
//
// Flow (per search):
//   1. Cheap DB pre-filter -> candidate rows (application, time window, scope).
//   2. Ensure candidate embeddings exist (bounded self-heal for fresh tickets).
//   3. Embed the query, rank candidates by cosine similarity. Top-K SELECTION
//      is by the RAW cosine match (post-floor); the recency-blended score only
//      tiebreaks display order. Keyword hits from the query terms ride along
//      as a safety net.
//   4. Claude (Haiku) ranks/explains those candidates and writes the grounded
//      summary.
//   5. Return the summary + the REAL hydrated ticket rows (never Claude's
//      text): endorsed tickets by relevance tier, unendorsed keyword hits last.
//
// Scope safety: for scope='public' we hard-force is_public=1, retrieve with the
// public vectors, build Claude cards from public-safe fields only, match
// keyword terms against the public-safe doc only, and map every result through
// mapPublicSubmission — so no internal field can leak.

const { Op } = require('sequelize');
const dbApi = require('../../db');
const { getLookupIdByName } = require('../helpers/lookups');
const { mapSubmission, mapPublicSubmission } = require('../helpers/mappers');
const { embedText, isEmbeddingConfigured } = require('../embeddings');
const { summarizeMatches, isAiConfigured } = require('../aiSummary');
const {
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
  buildAdminDoc,
  buildPublicDoc,
  hydrateRows,
  ensureEmbeddingsForHydratedRows,
  loadVectors,
  cosineSimilarity,
} = require('./embeddingIndexService');
const {
  AI_SEARCH_TOP_K,
  AI_SEARCH_MAX_INLINE_EMBED,
  AI_SEARCH_MAX_QUERY_LENGTH,
  AI_SEARCH_PUBLIC_ENABLED,
  AI_SEARCH_RECENCY_WEIGHT,
  AI_SEARCH_RECENCY_HALFLIFE_DAYS,
  AI_SEARCH_MIN_SIMILARITY,
} = require('../config');

const RECENCY_HALFLIFE_MS = AI_SEARCH_RECENCY_HALFLIFE_DAYS * 86400000;

// 1 for a brand-new ticket, halving every RECENCY_HALFLIFE_DAYS, → 0 for old.
function recencyScore(createdAt, now) {
  const t = parseTime(createdAt);
  if (t == null) return 0;
  const ageMs = Math.max(0, now - t);
  return Math.exp(-(ageMs * Math.LN2) / RECENCY_HALFLIFE_MS);
}

// Statuses that mean a ticket is "resolved / closed" for the time-window answer.
const TERMINAL_STATUSES = new Set(['deployed', 'retired', 'rejected', 'duplicate']);
// Safety cap on how many candidate rows we load into memory for cosine ranking.
const MAX_CANDIDATES = 5000;

function isFeatureEnabled(scope) {
  // Needs retrieval (embeddings) AND a summary model. Local embeddings are
  // always "configured", so in practice this means: a chat key (Claude/OpenAI)
  // is set — which also prevents the feature from silently turning on (and
  // triggering a local model download) before the user has opted in.
  if (!isEmbeddingConfigured()) return false;
  if (!isAiConfigured()) return false;
  if (scope === SCOPE_PUBLIC && !AI_SEARCH_PUBLIC_ENABLED) return false;
  return true;
}

function toDateOnly(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function trim(text, max = 400) {
  const s = String(text == null ? '' : text).trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function normalizeWindowDays(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// Reported/resolved time-window filter (JS-side, robust to legacy non-ISO date
// strings). Returns the surviving rows plus how many candidates the window
// alone excluded — independent of similarity (feeds the `windowExcluded` field).
function applyTimeWindow(rows, { reportedDays = null, resolvedDays = null, resolvedMap = new Map(), now = Date.now() } = {}) {
  const reportedCutoff = reportedDays ? now - reportedDays * 86400000 : null;
  const resolvedCutoff = resolvedDays ? now - resolvedDays * 86400000 : null;
  const kept = rows.filter((row) => {
    if (reportedCutoff != null) {
      const t = parseTime(row.created_at);
      if (t == null || t < reportedCutoff) return false;
    }
    if (resolvedCutoff != null) {
      const resolved = resolvedMap.get(Number(row.id));
      if (!resolved || resolved.t < resolvedCutoff) return false;
    }
    return true;
  });
  return { kept, excluded: rows.length - kept.length };
}

// Drop candidates below the similarity floor using the RAW cosine `match`,
// never the recency-blended `score` — recency must not rescue an irrelevant
// ticket past the floor. A non-finite or <= 0 floor disables the check.
function applySimilarityFloor(ranked, minSimilarity) {
  const floor = Number(minSimilarity);
  if (!Number.isFinite(floor) || floor <= 0) return ranked;
  return ranked.filter((candidate) => candidate.match >= floor);
}

// SELECT the top-K by RAW cosine `match` (post-floor). The recency-blended
// `score` is a display-order tiebreak only — it must never eject a higher-raw-
// similarity candidate from the K (the recency boost was evicting the best
// semantic match; see the ticket #22 dropout).
function selectTopK(ranked, { minSimilarity = AI_SEARCH_MIN_SIMILARITY, limit = AI_SEARCH_TOP_K } = {}) {
  return applySimilarityFloor(ranked, minSimilarity)
    .slice()
    .sort((a, b) => b.match - a.match)
    .slice(0, Math.max(0, limit));
}

// Filler words that would otherwise turn nearly every ticket into a keyword
// hit (includes portal boilerplate like ticket/defect that appears in every
// doc's Type line). Terms shorter than 3 chars are dropped before this check.
const KEYWORD_STOPWORDS = new Set([
  'about', 'after', 'all', 'and', 'any', 'anything', 'are', 'because', 'been',
  'before', 'being', 'between', 'but', 'can', 'could', 'defect', 'defects',
  'did', 'does', 'doing', 'else', 'enhancement', 'enhancements', 'ever', 'for',
  'from', 'get', 'gets', 'got', 'had', 'has', 'have', 'having', 'her', 'him',
  'his', 'how', 'into', 'issue', 'issues', 'its', 'just', 'like', 'may',
  'might', 'more', 'most', 'not', 'once', 'only', 'other', 'our', 'out',
  'over', 'own', 'per', 'related', 'she', 'should', 'some', 'something',
  'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'ticket', 'tickets', 'too', 'under', 'until',
  'very', 'want', 'wants', 'was', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'whose', 'why', 'will', 'with', 'would', 'you', 'your',
]);

// Salient keyword terms from the query: lowercase, punctuation stripped,
// stopwords and <3-char terms dropped. Each term also contributes a trailing-
// 's'-trimmed variant so "invoices" hits "invoice".
function extractKeywordTerms(query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const terms = new Set();
  for (const word of words) {
    if (word.length < 3 || KEYWORD_STOPWORDS.has(word)) continue;
    terms.add(word);
    const trimmed = word.endsWith('s') ? word.slice(0, -1) : '';
    if (trimmed.length >= 3 && !KEYWORD_STOPWORDS.has(trimmed)) terms.add(trimmed);
  }
  return [...terms];
}

// Keyword safety net: window-surviving candidates whose SCOPE-SAFE text
// contains a query term, ordered by raw match. Public scope fails closed
// twice — only public rows can hit, and matching runs on the public-safe doc,
// so internal fields (decision notes, reviewer, email) can never create a hit.
function findKeywordHits(candidates, terms, { scope } = {}) {
  if (!Array.isArray(terms) || !terms.length) return [];
  return candidates
    .filter(({ row }) => {
      if (scope === SCOPE_PUBLIC && !row?.is_public) return false;
      const doc = (scope === SCOPE_PUBLIC ? buildPublicDoc(row) : buildAdminDoc(row)).toLowerCase();
      return terms.some((term) => doc.includes(term));
    })
    .sort((a, b) => b.match - a.match);
}

// Union keyword hits into the LLM candidate set — top-K first, then keyword
// hits by raw match — capped at `cap` so the summary call stays bounded.
function unionKeywordHits(topK, keywordHits, cap) {
  const union = [...topK];
  const seen = new Set(topK.map((c) => c.id));
  for (const hit of keywordHits) {
    if (union.length >= cap) break;
    if (seen.has(hit.id)) continue;
    union.push(hit);
    seen.add(hit.id);
  }
  return union;
}

const RELEVANCE_RANK = { high: 3, medium: 2, low: 1 };

// Final display order: LLM-endorsed candidates by relevance tier (high >
// medium > low), tie-broken by the recency-blended score — then unendorsed
// keyword hits (blended-score order) GUARANTEED a spot after them, with the
// total capped at `limit`. aiMatches === null means no summary ran: every
// candidate counts as endorsed (blended order, as before).
function composeFinalResults({ candidates, keywordHits = [], aiMatches, limit }) {
  const aiById = aiMatches == null ? null : new Map(aiMatches.map((m) => [Number(m.submission_id), m]));
  const endorsed = aiById ? candidates.filter((c) => aiById.has(c.id)) : [...candidates];
  const tier = (c) => RELEVANCE_RANK[aiById?.get(c.id)?.relevance] || 0;
  endorsed.sort((a, b) => (tier(b) - tier(a)) || (b.score - a.score));
  const results = endorsed.slice(0, Math.max(0, limit));
  const seen = new Set(results.map((c) => c.id));
  const pending = keywordHits.filter((c) => !seen.has(c.id)).sort((a, b) => b.score - a.score);
  for (const hit of pending) {
    if (results.length >= limit) break;
    results.push(hit);
    seen.add(hit.id);
  }
  return results;
}

// Latest terminal-status change per submission, from the status-event timeline.
function buildResolvedAtMap(events) {
  const map = new Map();
  for (const ev of events) {
    if (!TERMINAL_STATUSES.has(String(ev.status || '').trim().toLowerCase())) continue;
    const t = parseTime(ev.changed_at);
    if (t == null) continue;
    const id = Number(ev.submission_id);
    if (!map.has(id) || t > map.get(id).t) map.set(id, { t, at: ev.changed_at });
  }
  return map;
}

function buildLatestChangeMap(events) {
  const map = new Map();
  for (const ev of events) {
    const t = parseTime(ev.changed_at);
    if (t == null) continue;
    const id = Number(ev.submission_id);
    if (!map.has(id) || t > map.get(id).t) map.set(id, { t, at: ev.changed_at });
  }
  return map;
}

async function loadCandidates({ scope, applicationId }) {
  const { Submission } = dbApi.getModels() || {};
  if (!Submission) return [];
  const where = {};
  if (scope === SCOPE_PUBLIC) where.is_public = 1;
  if (applicationId) where.application_id = applicationId;
  const rows = await Submission.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: MAX_CANDIDATES + 1,
    raw: true,
  });
  if (rows.length > MAX_CANDIDATES) {
    console.warn(`[ai-search] candidate set exceeded ${MAX_CANDIDATES}; ranking the most recent only. Consider the pgvector upgrade.`);
    return rows.slice(0, MAX_CANDIDATES);
  }
  return rows;
}

async function loadStatusEvents(submissionIds) {
  const { SubmissionStatusEvent } = dbApi.getModels() || {};
  if (!SubmissionStatusEvent || !submissionIds.length) return [];
  return SubmissionStatusEvent.findAll({
    where: { submission_id: { [Op.in]: submissionIds } },
    attributes: ['submission_id', 'status', 'changed_at'],
    raw: true,
  });
}

function buildCard(row, { scope, resolvedAt, lastChangeAt }) {
  const card = {
    id: Number(row.id),
    ref: row.easyvista_ticket_id ? String(row.easyvista_ticket_id) : `#${row.id}`,
    application: row.application_name || '',
    type: row.type || '',
    status: row.status || '',
    created_at: toDateOnly(row.created_at),
    last_status_change: lastChangeAt ? toDateOnly(lastChangeAt) : null,
    resolved_at: resolvedAt ? toDateOnly(resolvedAt) : null,
    summary: trim(row.summary_of_issue, 300),
    details: trim(row.what_happened_exact_details, 400),
    request: trim(row.request, 300),
  };
  // Admin cards may include internal signal so the summary can explain outcomes.
  if (scope === SCOPE_ADMIN) {
    const notes = trim(row.decision_notes, 300);
    if (notes) card.decision_notes = notes;
  }
  return card;
}

// query, scope ('admin'|'public'), applicationName/applicationId, window days.
async function runAiSearch(db, {
  query,
  scope = SCOPE_ADMIN,
  applicationId = null,
  applicationName = '',
  reportedWithinDays = null,
  resolvedWithinDays = null,
} = {}) {
  const safeScope = scope === SCOPE_PUBLIC ? SCOPE_PUBLIC : SCOPE_ADMIN;

  if (!isFeatureEnabled(safeScope)) {
    return { enabled: false, reason: 'AI search is not configured.' };
  }

  const cleanQuery = String(query || '').trim().slice(0, AI_SEARCH_MAX_QUERY_LENGTH);
  if (!cleanQuery) {
    return { enabled: true, query: '', summary: emptySummary(), matches: [], window: {}, windowExcluded: 0, meta: emptyMeta() };
  }

  const reportedDays = normalizeWindowDays(reportedWithinDays);
  const resolvedDays = normalizeWindowDays(resolvedWithinDays);

  // Resolve application scope (id wins; else resolve the name unless "all").
  let appId = Number(applicationId) || null;
  if (!appId) {
    const name = String(applicationName || '').trim();
    if (name && name.toLowerCase() !== 'all') {
      appId = await getLookupIdByName(db, 'applications', name);
    }
  }

  // 1. Candidate pre-filter (DB) + hydrate.
  const rawCandidates = await loadCandidates({ scope: safeScope, applicationId: appId });
  if (!rawCandidates.length) {
    return { enabled: true, query: cleanQuery, summary: emptySummary(), matches: [], window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays }, windowExcluded: 0, meta: emptyMeta() };
  }
  const hydrated = await hydrateRows(rawCandidates);

  // Status-event-derived dates (resolved_at, last change) for cards + window filter.
  const candidateIds = hydrated.map((r) => Number(r.id));
  const events = await loadStatusEvents(candidateIds);
  const resolvedMap = buildResolvedAtMap(events);
  const lastChangeMap = buildLatestChangeMap(events);

  // Apply time windows in JS; windowExcluded counts candidates the window
  // alone dropped (0 when no window params were sent).
  const { kept: filtered, excluded: windowExcluded } = applyTimeWindow(hydrated, {
    reportedDays,
    resolvedDays,
    resolvedMap,
  });
  if (!filtered.length) {
    return { enabled: true, query: cleanQuery, summary: emptySummary(), matches: [], window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays }, windowExcluded, meta: { candidateCount: hydrated.length, rankedCount: 0, embeddedInline: 0, skippedEmbed: 0 } };
  }

  // 2. Self-heal: ensure candidate embeddings exist (bounded per search).
  const ensureReport = await ensureEmbeddingsForHydratedRows(filtered, { maxEmbed: AI_SEARCH_MAX_INLINE_EMBED });

  // 3. Load vectors for this scope, embed query, cosine top-K.
  const filteredIds = filtered.map((r) => Number(r.id));
  const vectors = await loadVectors(filteredIds, safeScope);
  const withVectors = filtered
    .filter((r) => vectors.has(Number(r.id)))
    .map((r) => ({ id: Number(r.id), vector: vectors.get(Number(r.id)), row: r }));

  if (!withVectors.length) {
    return { enabled: true, query: cleanQuery, summary: emptySummary(), matches: [], window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays }, windowExcluded, meta: { candidateCount: filtered.length, rankedCount: 0, embeddedInline: ensureReport.embedded, skippedEmbed: ensureReport.skipped } };
  }

  const queryVector = await embedText(cleanQuery, { inputType: 'query' });

  // Score each candidate: the raw cosine `match` drives SELECTION; the
  // recency-blended `score` is only a display-order tiebreak later on.
  const nowTs = Date.now();
  const ranked = withVectors.map(({ id, vector, row }) => {
    const match = cosineSimilarity(queryVector, vector);
    const recency = recencyScore(row.created_at, nowTs);
    return { id: Number(id), row, match, recency, score: match + AI_SEARCH_RECENCY_WEIGHT * recency };
  });
  // Similarity floor first (on the raw match), then top-K by raw match, so
  // near-zero-relevance tickets never pad out the result set and recency never
  // ejects a better semantic match.
  const topK = selectTopK(ranked, { minSimilarity: AI_SEARCH_MIN_SIMILARITY, limit: AI_SEARCH_TOP_K });

  // Keyword safety net: window-surviving candidates whose scope-safe text
  // contains a query term ride along to the LLM and are guaranteed a spot in
  // the final results even when the LLM does not endorse them.
  const keywordTerms = extractKeywordTerms(cleanQuery);
  const keywordHits = findKeywordHits(ranked, keywordTerms, { scope: safeScope });
  const keywordIds = new Set(keywordHits.map((c) => c.id));
  const llmCandidates = unionKeywordHits(topK, keywordHits, AI_SEARCH_TOP_K + 10);

  // 4. Summary over the top-K + keyword hits (Claude or OpenAI, best-effort).
  const cards = llmCandidates.map(({ row }) => buildCard(row, {
    scope: safeScope,
    resolvedAt: resolvedMap.get(Number(row.id))?.at || null,
    lastChangeAt: lastChangeMap.get(Number(row.id))?.at || null,
  }));

  let summary = emptySummary();
  let aiMatches = [];
  if (isAiConfigured()) {
    const window = { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays };
    const result = await summarizeMatches({ query: cleanQuery, tickets: cards, window });
    summary = {
      answer_summary: result.answer_summary,
      reported_in_window: result.reported_in_window,
      resolved_in_window: result.resolved_in_window,
      // Optional (C4): clients must tolerate its absence.
      ...(typeof result.has_relevant_match === 'boolean' ? { has_relevant_match: result.has_relevant_match } : {}),
    };
    aiMatches = Array.isArray(result.matches) ? result.matches : [];
  }

  // 5. Final results: LLM-endorsed tickets by relevance tier (blended-score
  // tiebreak), unendorsed keyword hits appended after, total capped at top-K.
  // Without a summary, show all top matches. Ticket DATA always comes from
  // the DB row.
  const aiById = new Map(aiMatches.map((m) => [Number(m.submission_id), m]));
  const finalTopK = isAiConfigured()
    ? composeFinalResults({ candidates: llmCandidates, keywordHits, aiMatches, limit: AI_SEARCH_TOP_K })
    : composeFinalResults({ candidates: topK, keywordHits, aiMatches: null, limit: AI_SEARCH_TOP_K });

  const matches = finalTopK.map((cand) => {
    const mapped = safeScope === SCOPE_PUBLIC ? mapPublicSubmission(cand.row) : mapSubmission(cand.row);
    const ai = aiById.get(cand.id);
    return {
      ...mapped,
      ai: {
        relevance: ai?.relevance || null,
        why: ai?.why || '',
        match: Number(cand.match.toFixed(4)),
        score: Number(cand.score.toFixed(4)),
        // Additive/optional: present only when the ticket text contains a
        // query keyword (the D7 safety net) — clients must tolerate absence.
        ...(keywordIds.has(cand.id) ? { keyword_match: true } : {}),
      },
    };
  });

  return {
    enabled: true,
    query: cleanQuery,
    window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays },
    windowExcluded,
    summary,
    matches,
    meta: {
      candidateCount: filtered.length,
      rankedCount: topK.length,
      embeddedInline: ensureReport.embedded,
      skippedEmbed: ensureReport.skipped,
    },
  };
}

function emptySummary() {
  return { answer_summary: '', reported_in_window: false, resolved_in_window: false };
}
function emptyMeta() {
  return { candidateCount: 0, rankedCount: 0, embeddedInline: 0, skippedEmbed: 0 };
}

module.exports = {
  runAiSearch,
  isFeatureEnabled,
  applyTimeWindow,
  applySimilarityFloor,
  selectTopK,
  extractKeywordTerms,
  findKeywordHits,
  unionKeywordHits,
  composeFinalResults,
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
};
