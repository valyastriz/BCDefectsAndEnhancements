// AI semantic ticket search: retrieve -> rank -> summarize.
//
// Flow (per search):
//   1. Cheap DB pre-filter -> candidate rows (application, time window, scope).
//   2. Ensure candidate embeddings exist (bounded self-heal for fresh tickets).
//   3. Embed the query, rank candidates by cosine similarity, take top-K.
//   4. Claude (Haiku) ranks/explains those <=K and writes the grounded summary.
//   5. Return the summary + the REAL hydrated ticket rows (never Claude's text)
//      in ranked order.
//
// Scope safety: for scope='public' we hard-force is_public=1, retrieve with the
// public vectors, build Claude cards from public-safe fields only, and map every
// result through mapPublicSubmission — so no internal field can leak.

const { Op } = require('sequelize');
const dbApi = require('../../db');
const { getLookupIdByName } = require('../helpers/lookups');
const { mapSubmission, mapPublicSubmission } = require('../helpers/mappers');
const { embedText, isEmbeddingConfigured } = require('../embeddings');
const { summarizeMatches, isAiConfigured } = require('../aiSummary');
const {
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
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

  // Blend semantic match with recency so recent strong matches rank first:
  // score = similarity + weight * recency. A much-better older match still beats
  // a weak recent one; near-ties go to the newer ticket.
  const nowTs = Date.now();
  const ranked = withVectors
    .map(({ id, vector, row }) => {
      const match = cosineSimilarity(queryVector, vector);
      const recency = recencyScore(row.created_at, nowTs);
      return { id: Number(id), row, match, recency, score: match + AI_SEARCH_RECENCY_WEIGHT * recency };
    })
    .sort((a, b) => b.score - a.score);
  // Similarity floor first (on the raw match), then take the top-K, so
  // near-zero-relevance tickets never pad out the result set.
  const topK = applySimilarityFloor(ranked, AI_SEARCH_MIN_SIMILARITY).slice(0, AI_SEARCH_TOP_K);

  // 4. Summary over the top-K (Claude or OpenAI, best-effort).
  const cards = topK.map(({ row }) => buildCard(row, {
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

  // 5. Final results ordered newer+higher-match first (topK is already blended-
  // sorted). When the summary ran, show only the tickets it judged relevant;
  // otherwise show all top matches. Ticket DATA always comes from the DB row.
  const aiById = new Map(aiMatches.map((m) => [Number(m.submission_id), m]));
  const relevantIds = new Set(
    [...aiById.keys()].filter((id) => topK.some((c) => c.id === id)),
  );
  const finalTopK = isAiConfigured()
    ? topK.filter((c) => relevantIds.has(c.id))
    : topK;

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
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
};
