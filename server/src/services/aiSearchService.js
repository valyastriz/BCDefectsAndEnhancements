// AI semantic ticket search: retrieve -> rank -> summarize.
//
// Flow (per search):
//   1. Cheap DB pre-filter -> candidate rows (application, time window, scope).
//   2. Ensure candidate embeddings exist (bounded self-heal for fresh tickets).
//   3. Embed the query, rank candidates by cosine similarity. Top-K SELECTION
//      is by the RAW cosine match (post-floor); the recency-blended score only
//      tiebreaks display order. Keyword and identifier hits ride along as a
//      literal-match safety net (see below).
//   4. Claude (Haiku) ranks/explains those candidates and writes the grounded
//      summary.
//   5. Return the summary + the REAL hydrated ticket rows (never Claude's
//      text) in TWO sections: `matches` = tickets the LLM endorsed, by
//      relevance tier; `keywordMatches` = literal hits it did not endorse.
//
// The two sections exist because they answer different questions. Semantic
// search answers "has anyone reported this problem before"; a pasted incident
// number, policy, or reporter name is a lookup, which cosine similarity is
// structurally bad at. Literal matching covers the lookup WITHOUT touching the
// embeddings — see buildKeywordDoc in embeddingIndexService for why identifiers
// stay out of the embedded text.
//
// Scope safety: for scope='public' we hard-force is_public=1, retrieve with the
// public vectors, build Claude cards from public-safe fields only, match
// keyword terms and identifiers against public-safe fields only, and map every
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
  buildKeywordDoc,
  identifierFieldsForScope,
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
const { SUBMISSION_TYPE_REPORT } = require('../constants');
const { maySeeReportRequest } = require('../helpers/reportVisibility');

const RECENCY_HALFLIFE_MS = AI_SEARCH_RECENCY_HALFLIFE_DAYS * 86400000;

// How much a ticket of the SAME kind as the one being filed is preferred, in the
// display-order blend. Deliberately smaller than the recency weight (0.15): a
// defect that is clearly the same problem should still outrank an enhancement
// that merely shares a word, so this settles ties rather than deciding them.
const AI_SEARCH_SAME_TYPE_WEIGHT = 0.05;

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

// Identifier-shaped tokens from the query: anything containing a digit, with a
// leading '#' and trailing punctuation stripped — "#1234" → "1234",
// "INC0012345", "BC-4471". These deliberately skip the stopword and 3-char
// rules that prose terms go through (a ticket really can be "#42"), because
// they are matched against identifier FIELDS rather than the free text.
function extractIdentifierTerms(query) {
  const terms = new Set();
  for (const raw of String(query || '').toLowerCase().split(/\s+/)) {
    const token = raw.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
    if (!token || !/\d/.test(token)) continue;
    terms.add(token);
  }
  return [...terms];
}

// A term may match *inside* an identifier only when it is distinctive enough to
// not collide by accident: 5+ characters, or 3+ mixing letters and digits
// ("bc-447"). So a bare year like "2026" can only match a field that IS "2026",
// never a policy number that happens to contain it.
function isDistinctiveTerm(term) {
  if (term.length >= 5) return true;
  return term.length >= 3 && /[a-z]/.test(term) && /\d/.test(term);
}

// Identifier lookup: match identifier-shaped query terms against the scope's
// identifier fields, value by value. Equality always counts; a containment
// match needs a distinctive term. The numeric ticket id is equality-only, so
// "42" finds #42 and not #1420. Hits carry `matchedOn` so the UI can say which
// identifier matched. Public scope fails closed — non-public rows can't hit,
// and the field list excludes everything off the public allow-list.
function findIdentifierHits(candidates, terms, { scope } = {}) {
  if (!Array.isArray(terms) || !terms.length) return [];
  const fields = identifierFieldsForScope(scope);
  const hits = [];
  for (const candidate of candidates) {
    const row = candidate.row;
    if (scope === SCOPE_PUBLIC && !row?.is_public) continue;
    const matchedOn = fields.filter((field) => {
      const value = String(row?.[field] == null ? '' : row[field]).trim().toLowerCase();
      if (!value) return false;
      const equalityOnly = field === 'id';
      return terms.some((term) => (
        value === term || (!equalityOnly && isDistinctiveTerm(term) && value.includes(term))
      ));
    });
    if (matchedOn.length) hits.push({ ...candidate, matchedOn });
  }
  return hits.sort((a, b) => b.score - a.score);
}

// Keyword safety net: window-surviving candidates whose SCOPE-SAFE lookup text
// contains a query term, ordered by raw match. Public scope fails closed
// twice — only public rows can hit, and matching runs on the public-safe doc,
// so internal fields (decision notes, reviewer, email) can never create a hit.
function findKeywordHits(candidates, terms, { scope } = {}) {
  if (!Array.isArray(terms) || !terms.length) return [];
  return candidates
    .filter(({ row }) => {
      if (scope === SCOPE_PUBLIC && !row?.is_public) return false;
      const doc = buildKeywordDoc(row, scope).toLowerCase();
      return terms.some((term) => doc.includes(term));
    })
    .sort((a, b) => b.match - a.match);
}

// The literal-match section shown BELOW the semantic results: identifier hits
// first (an exact incident or ticket number is the strongest signal there is),
// then keyword hits by blended score. Anything already listed as a semantic
// match is skipped — a ticket appears in one section, never both.
function composeKeywordMatches({ identifierHits = [], keywordHits = [], excludeIds = [], limit }) {
  const seen = new Set(excludeIds);
  const results = [];
  const ordered = [...identifierHits, ...[...keywordHits].sort((a, b) => b.score - a.score)];
  for (const hit of ordered) {
    if (results.length >= limit) break;
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    results.push(hit);
  }
  return results;
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

// The SEMANTIC section: LLM-endorsed candidates by relevance tier (high >
// medium > low), tie-broken by the recency-blended score, capped at `limit`.
// aiMatches === null means no summary ran: every candidate counts as endorsed
// (blended order). Unendorsed literal hits are no longer appended here — they
// are returned as their own `keywordMatches` section (composeKeywordMatches),
// so "the AI thinks this is relevant" and "this literally contains what you
// typed" stay distinguishable instead of being merged into one ranked list.
function composeFinalResults({ candidates, aiMatches, limit }) {
  const aiById = aiMatches == null ? null : new Map(aiMatches.map((m) => [Number(m.submission_id), m]));
  const endorsed = aiById ? candidates.filter((c) => aiById.has(c.id)) : [...candidates];
  const tier = (c) => RELEVANCE_RANK[aiById?.get(c.id)?.relevance] || 0;
  endorsed.sort((a, b) => (tier(b) - tier(a)) || (b.score - a.score));
  return endorsed.slice(0, Math.max(0, limit));
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

async function loadCandidates({
  scope,
  applicationId,
  onlyTypeId = null,
  excludeTypeId = null,
  reportTypeId = null,
  viewerUserId = null,
}) {
  const { Submission } = dbApi.getModels() || {};
  if (!Submission) return [];
  const where = {};
  if (scope === SCOPE_PUBLIC) where.is_public = 1;
  if (applicationId) where.application_id = applicationId;
  // Request TYPE, narrowed in the query rather than after ranking, so a
  // wrong-kind ticket never takes a top-K slot from a right-kind one.
  if (onlyTypeId) {
    where.type_id = onlyTypeId;
  } else if (excludeTypeId) {
    // `Op.ne` alone drops rows with a NULL type_id, because SQL says NULL is
    // neither equal nor unequal to anything. Historical rows exist with no type,
    // and excluding one KIND of ticket must not also exclude the untyped ones.
    where[Op.or] = [{ type_id: { [Op.ne]: excludeTypeId } }, { type_id: null }];
  }
  const rows = await Submission.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: MAX_CANDIDATES + 1,
    raw: true,
  });
  // A REPORT REQUEST IS NOT PUBLIC READING, even when is_public is set: only the
  // person who filed it may see it (canSeeOnBoard in routes/publicRoutes.js).
  // Search is the third way out of the building after the list and the by-id
  // route, and the one easiest to forget — a summary written over a candidate
  // set is a paraphrase of rows the reader was never entitled to.
  //
  // Applied here rather than at any call site so every public search inherits it,
  // the same way `is_public` is forced above. In JS rather than SQL because the
  // type and ownership clauses would have to interleave with the Op.or that
  // excludeTypeId already owns.
  //
  // These rows are RAW — hydration has not run yet, so they carry `type_id` and
  // not `type`. The shared rule reads `type`, so each row is presented to it in
  // the shape it expects rather than the check being rewritten here against a
  // column: two spellings of one rule is how the fourth surface gets missed.
  const visible = (scope === SCOPE_PUBLIC && reportTypeId)
    ? rows.filter((row) => maySeeReportRequest(
      {
        type: Number(row.type_id) === Number(reportTypeId) ? SUBMISSION_TYPE_REPORT : '',
        reporter_user_id: row.reporter_user_id,
      },
      viewerUserId,
    ))
    : rows;

  if (visible.length > MAX_CANDIDATES) {
    console.warn(`[ai-search] candidate set exceeded ${MAX_CANDIDATES}; ranking the most recent only. Consider the pgvector upgrade.`);
    return visible.slice(0, MAX_CANDIDATES);
  }
  return visible;
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
  // Which KIND of request the caller is asking about. The submit form's duplicate
  // check sends the type being filed; a general search sends nothing and sees
  // everything.
  requestType = '',
  // Who is asking. Only used to decide whether a report request they filed may
  // appear in a public search; null means anonymous, which sees none of them.
  viewerUserId = null,
} = {}) {
  const safeScope = scope === SCOPE_PUBLIC ? SCOPE_PUBLIC : SCOPE_ADMIN;

  if (!isFeatureEnabled(safeScope)) {
    return { enabled: false, reason: 'AI search is not configured.' };
  }

  const cleanQuery = String(query || '').trim().slice(0, AI_SEARCH_MAX_QUERY_LENGTH);
  if (!cleanQuery) {
    return { enabled: true, query: '', summary: emptySummary(), matches: [], keywordMatches: [], window: {}, windowExcluded: 0, meta: emptyMeta() };
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

  // Which kinds of ticket can be a match for this one.
  //
  // A REPORT REQUEST is only ever a duplicate of another report request: "the
  // unapplied cash dashboard needs a write-off column" has nothing to do with a
  // broken invoice screen, and offering one as a possible duplicate of the other
  // wastes the requester's attention on the one screen where they are trying to
  // avoid filing twice. So the two directions are both hard filters.
  //
  // A defect and an enhancement, on the other hand, genuinely blur — the same
  // sentence can be either, and which one it is is a triage decision. They stay
  // eligible for each other, with a preference for the same kind applied to the
  // display order below.
  const wantedType = String(requestType || '').trim().toLowerCase();
  // Needed for the type filters below AND, on a public search, to keep other
  // people's report requests out of the candidate set — so it is resolved
  // whenever either reason applies, not only when a type was asked for.
  //
  // A null answer means the catalog has no `report` type, so there are no report
  // rows to hide. A THROW means the lookup could not run at all, which is a
  // different thing: on a public search it leaves us unable to tell a report
  // request from a defect, so the honest answer is nothing rather than a guess.
  let reportTypeId = null;
  if (wantedType || safeScope === SCOPE_PUBLIC) {
    try {
      reportTypeId = await getLookupIdByName(db, 'submission_types', SUBMISSION_TYPE_REPORT, { lowercase: true });
    } catch (error) {
      if (safeScope !== SCOPE_PUBLIC) throw error;
      console.error('[ai-search] could not resolve the report type; answering empty rather than risk leaking one:', error?.message || error);
      return { enabled: true, query: cleanQuery, summary: emptySummary(), matches: [], keywordMatches: [], window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays }, windowExcluded: 0, meta: emptyMeta() };
    }
  }
  const onlyTypeId = wantedType === SUBMISSION_TYPE_REPORT ? reportTypeId : null;
  const excludeTypeId = wantedType && wantedType !== SUBMISSION_TYPE_REPORT ? reportTypeId : null;

  // 1. Candidate pre-filter (DB) + hydrate.
  const rawCandidates = await loadCandidates({
    scope: safeScope,
    applicationId: appId,
    onlyTypeId,
    excludeTypeId,
    reportTypeId,
    viewerUserId,
  });
  if (!rawCandidates.length) {
    return { enabled: true, query: cleanQuery, summary: emptySummary(), matches: [], keywordMatches: [], window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays }, windowExcluded: 0, meta: emptyMeta() };
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
    return { enabled: true, query: cleanQuery, summary: emptySummary(), matches: [], keywordMatches: [], window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays }, windowExcluded, meta: { candidateCount: hydrated.length, rankedCount: 0, embeddedInline: 0, skippedEmbed: 0 } };
  }

  // 2. Self-heal: ensure candidate embeddings exist (bounded per search). This
  // is opportunistic — a provider failure here must not fail the whole search.
  const ensureReport = await ensureEmbeddingsForHydratedRows(filtered, { maxEmbed: AI_SEARCH_MAX_INLINE_EMBED })
    .catch((error) => {
      console.error('[ai-search] inline embedding refresh failed:', error?.message || error);
      return { embedded: 0, skipped: 0, deletedPublic: 0 };
    });

  // 3. Load vectors for this scope, embed query, cosine top-K.
  const filteredIds = filtered.map((r) => Number(r.id));
  const vectors = await loadVectors(filteredIds, safeScope);
  const withVectors = filtered
    .filter((r) => vectors.has(Number(r.id)))
    .map((r) => ({ id: Number(r.id), vector: vectors.get(Number(r.id)), row: r }));

  // Semantic ranking needs vectors and a working embeddings provider; literal
  // matching (below) needs neither. So the query embedding is skipped when
  // there is nothing to compare against, and a provider failure degrades the
  // search to literal matches instead of failing it — the same fail-safe rule
  // summarizeMatches already follows. An empty index (feature just enabled,
  // backfill not run) and an out-of-quota key both land here.
  const nowTs = Date.now();
  let queryVector = null;
  if (withVectors.length) {
    try {
      queryVector = await embedText(cleanQuery, { inputType: 'query' });
    } catch (error) {
      console.error('[ai-search] query embedding failed; falling back to literal matches:', error?.message || error);
    }
  }

  // Score each candidate: the raw cosine `match` drives SELECTION; the
  // recency-blended `score` is only a display-order tiebreak later on.
  // The same-kind preference rides on `score`, never on `match`: `match` is raw
  // cosine and is what the similarity floor and top-K selection use, so a
  // same-type ticket cannot buy its way past a relevance floor it does not meet —
  // it only sorts above an equally relevant one of the other kind.
  const sameTypeBonus = (row) => (
    wantedType && String(row.type || '').trim().toLowerCase() === wantedType
      ? AI_SEARCH_SAME_TYPE_WEIGHT
      : 0
  );
  const ranked = queryVector ? withVectors.map(({ id, vector, row }) => {
    const match = cosineSimilarity(queryVector, vector);
    const recency = recencyScore(row.created_at, nowTs);
    return {
      id: Number(id),
      row,
      match,
      recency,
      score: match + AI_SEARCH_RECENCY_WEIGHT * recency + sameTypeBonus(row),
    };
  }) : [];
  // Similarity floor first (on the raw match), then top-K by raw match, so
  // near-zero-relevance tickets never pad out the result set and recency never
  // ejects a better semantic match.
  const topK = selectTopK(ranked, { minSimilarity: AI_SEARCH_MIN_SIMILARITY, limit: AI_SEARCH_TOP_K });

  // Literal matching runs over EVERY window-surviving row, not just the
  // vectorized ones, so a ticket created minutes ago is findable by its incident
  // number before the embedding backfill reaches it. Rows without a vector get
  // match 0 and a recency-only score, which is enough to order them.
  const rankedById = new Map(ranked.map((candidate) => [candidate.id, candidate]));
  const literalCandidates = filtered.map((row) => {
    const id = Number(row.id);
    const existing = rankedById.get(id);
    if (existing) return existing;
    const recency = recencyScore(row.created_at, nowTs);
    return { id, row, match: 0, recency, score: AI_SEARCH_RECENCY_WEIGHT * recency + sameTypeBonus(row) };
  });

  // Keyword safety net + identifier lookup. Both ride along to the LLM (so it
  // can endorse and explain one that IS on topic) and both are guaranteed a
  // spot in the response — in the separate `keywordMatches` section when the
  // LLM does not endorse them.
  const keywordTerms = extractKeywordTerms(cleanQuery);
  const identifierTerms = extractIdentifierTerms(cleanQuery);
  const keywordHits = findKeywordHits(literalCandidates, keywordTerms, { scope: safeScope });
  const identifierHits = findIdentifierHits(literalCandidates, identifierTerms, { scope: safeScope });
  const literalHits = [...identifierHits, ...keywordHits];
  const keywordIds = new Set(literalHits.map((c) => c.id));
  const matchedOnById = new Map(identifierHits.map((c) => [c.id, c.matchedOn]));
  const llmCandidates = unionKeywordHits(topK, literalHits, AI_SEARCH_TOP_K + 10);

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

  // 5. Two result sections. `matches` = LLM-endorsed tickets by relevance tier
  // (blended-score tiebreak). `keywordMatches` = literal hits the LLM did not
  // endorse, returned separately so the client can show them below the semantic
  // answer instead of blending "the AI thinks this is relevant" with "this
  // contains the number you pasted". Ticket DATA always comes from the DB row.
  const aiById = new Map(aiMatches.map((m) => [Number(m.submission_id), m]));
  const finalTopK = isAiConfigured()
    ? composeFinalResults({ candidates: llmCandidates, aiMatches, limit: AI_SEARCH_TOP_K })
    : composeFinalResults({ candidates: topK, aiMatches: null, limit: AI_SEARCH_TOP_K });

  const toResult = (cand) => {
    const mapped = safeScope === SCOPE_PUBLIC ? mapPublicSubmission(cand.row) : mapSubmission(cand.row);
    const ai = aiById.get(cand.id);
    const matchedOn = matchedOnById.get(cand.id);
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
        // Which identifier field matched, when the hit came from an identifier
        // lookup (e.g. ['easyvista_ticket_id']). Also additive/optional.
        ...(matchedOn?.length ? { matched_on: matchedOn } : {}),
      },
    };
  };

  const matches = finalTopK.map(toResult);
  const keywordMatches = composeKeywordMatches({
    identifierHits,
    keywordHits,
    excludeIds: finalTopK.map((cand) => cand.id),
    limit: AI_SEARCH_TOP_K,
  }).map(toResult);

  return {
    enabled: true,
    query: cleanQuery,
    window: { reportedWithinDays: reportedDays, resolvedWithinDays: resolvedDays },
    windowExcluded,
    summary,
    matches,
    keywordMatches,
    meta: {
      candidateCount: filtered.length,
      rankedCount: topK.length,
      keywordCount: keywordMatches.length,
      embeddedInline: ensureReport.embedded,
      skippedEmbed: ensureReport.skipped,
      // What was actually searched. Reported because a narrowed search that does
      // not say it is narrowed reads as "there is nothing like this anywhere",
      // and the client puts it on screen.
      requestType: wantedType || null,
      searchedOnlyType: onlyTypeId ? SUBMISSION_TYPE_REPORT : null,
      excludedType: excludeTypeId ? SUBMISSION_TYPE_REPORT : null,
    },
  };
}

function emptySummary() {
  return { answer_summary: '', reported_in_window: false, resolved_in_window: false };
}
function emptyMeta() {
  return { candidateCount: 0, rankedCount: 0, keywordCount: 0, embeddedInline: 0, skippedEmbed: 0 };
}

module.exports = {
  runAiSearch,
  isFeatureEnabled,
  applyTimeWindow,
  applySimilarityFloor,
  selectTopK,
  extractKeywordTerms,
  extractIdentifierTerms,
  findKeywordHits,
  findIdentifierHits,
  composeKeywordMatches,
  unionKeywordHits,
  composeFinalResults,
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
};
