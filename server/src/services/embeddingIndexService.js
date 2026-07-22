// Maintains the per-ticket embedding index used by AI semantic search.
//
// Two scopes per ticket keep public search leak-proof:
//   - 'admin'  : always; embedded from the full internal text.
//   - 'public' : only when is_public=1; embedded from public-safe text only.
//
// Embeddings are cached and only recomputed when the source text changes
// (content_hash guard), so steady-state searches do zero embedding work.

const crypto = require('crypto');
const dbApi = require('../../db');
const { buildAllLookupMaps, hydrateRowFromMaps } = require('../helpers/lookups');
const { embedTexts, getEmbeddingModelId, isEmbeddingConfigured } = require('../embeddings');
const { AI_SEARCH_MAX_INLINE_EMBED } = require('../config');

const SCOPE_ADMIN = 'admin';
const SCOPE_PUBLIC = 'public';

function nowIso() {
  return new Date().toISOString();
}

function line(label, value) {
  const text = String(value == null ? '' : value).trim();
  return text ? `${label}: ${text}` : '';
}

// Full internal text — admins may match on decision notes, steps, impact, etc.
function buildAdminDoc(row) {
  return [
    line('Application', row.application_name),
    line('Type', row.type),
    line('Status', row.status),
    line('Screen', row.screen_title),
    line('Summary', row.summary_of_issue),
    line('What happened', row.what_happened_exact_details),
    line('Request', row.request),
    line('Steps to reproduce', row.steps_to_reproduce),
    line('Decision notes', row.decision_notes),
    line('Impact', row.impact_details),
  ].filter(Boolean).join('\n');
}

// Public-safe text only — mirrors the mapPublicSubmission allow-list. Never
// include decision_notes / impact / reviewer / email here.
function buildPublicDoc(row) {
  return [
    line('Application', row.application_name),
    line('Type', row.type),
    line('Status', row.status),
    line('Summary', row.summary_of_issue),
    line('What happened', row.what_happened_exact_details),
    line('Request', row.request),
  ].filter(Boolean).join('\n');
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

async function hydrateRows(rawRows) {
  const dbModels = dbApi.getModels() || {};
  const maps = await buildAllLookupMaps(dbModels);
  return rawRows.map((row) => hydrateRowFromMaps(row, maps));
}

// Desired (scope, doc) pairs for a hydrated row.
function desiredScopes(row) {
  const pairs = [{ scope: SCOPE_ADMIN, doc: buildAdminDoc(row) }];
  if (Boolean(row.is_public)) {
    pairs.push({ scope: SCOPE_PUBLIC, doc: buildPublicDoc(row) });
  }
  return pairs.filter((p) => p.doc); // skip empty docs
}

async function loadExistingEmbeddingRows(submissionIds) {
  if (!submissionIds.length) return new Map();
  const { SubmissionEmbedding } = dbApi.getModels() || {};
  if (!SubmissionEmbedding) return new Map();
  const rows = await SubmissionEmbedding.findAll({
    where: { submission_id: submissionIds },
    raw: true,
  });
  const map = new Map();
  for (const r of rows) map.set(`${r.submission_id}:${r.scope}`, r);
  return map;
}

async function upsertEmbedding({ submission_id, scope, model, hash, vector }) {
  const { SubmissionEmbedding } = dbApi.getModels() || {};
  const existing = await SubmissionEmbedding.findOne({ where: { submission_id, scope }, raw: true });
  const values = {
    submission_id,
    scope,
    model,
    content_hash: hash,
    vector: JSON.stringify(vector),
    updated_at: nowIso(),
  };
  if (existing) {
    await SubmissionEmbedding.update(values, { where: { id: existing.id } });
  } else {
    await SubmissionEmbedding.create(values);
  }
}

// Given already-hydrated rows, (re)embed any whose text changed or is missing.
// Bounded by `maxEmbed` so a single search never triggers an unbounded burst
// (e.g. right after a bulk import before the backfill runs). Returns a report.
async function ensureEmbeddingsForHydratedRows(rows, { maxEmbed = Infinity } = {}) {
  if (!isEmbeddingConfigured() || !rows.length) return { embedded: 0, skipped: 0, deletedPublic: 0 };

  const { SubmissionEmbedding } = dbApi.getModels() || {};
  if (!SubmissionEmbedding) return { embedded: 0, skipped: 0, deletedPublic: 0 };

  const modelId = getEmbeddingModelId();
  const ids = rows.map((r) => Number(r.id)).filter(Boolean);
  const existing = await loadExistingEmbeddingRows(ids);

  // Remove public vectors for tickets that are no longer public (no stale
  // public embedding must survive an unpublish).
  const unpublishedIds = rows.filter((r) => !Boolean(r.is_public)).map((r) => Number(r.id));
  let deletedPublic = 0;
  if (unpublishedIds.length) {
    deletedPublic = await SubmissionEmbedding.destroy({
      where: { submission_id: unpublishedIds, scope: SCOPE_PUBLIC },
    });
  }

  const pending = [];
  for (const row of rows) {
    for (const { scope, doc } of desiredScopes(row)) {
      const hash = contentHash(doc);
      const prev = existing.get(`${Number(row.id)}:${scope}`);
      const fresh = prev && prev.content_hash === hash && prev.model === modelId;
      if (!fresh) pending.push({ submission_id: Number(row.id), scope, doc, hash });
    }
  }

  const toEmbed = pending.slice(0, maxEmbed);
  const skipped = pending.length - toEmbed.length;
  if (!toEmbed.length) return { embedded: 0, skipped, deletedPublic };

  const vectors = await embedTexts(toEmbed.map((p) => p.doc), { inputType: 'document' });
  for (let i = 0; i < toEmbed.length; i += 1) {
    const p = toEmbed[i];
    // eslint-disable-next-line no-await-in-loop
    await upsertEmbedding({ submission_id: p.submission_id, scope: p.scope, model: modelId, hash: p.hash, vector: vectors[i] });
  }
  return { embedded: toEmbed.length, skipped, deletedPublic };
}

// Refresh embeddings for a single submission by id (used by write hooks and the
// backfill script). Loads + hydrates the row, then ensures its embeddings.
async function ensureEmbeddings(db, submissionId) {
  if (!isEmbeddingConfigured()) return { embedded: 0, skipped: 0, deletedPublic: 0 };
  const { Submission } = dbApi.getModels() || {};
  if (!Submission) return { embedded: 0, skipped: 0, deletedPublic: 0 };
  const raw = await Submission.findByPk(Number(submissionId), { raw: true });
  if (!raw) return { embedded: 0, skipped: 0, deletedPublic: 0 };
  const [hydrated] = await hydrateRows([raw]);
  return ensureEmbeddingsForHydratedRows([hydrated]);
}

// Non-blocking, self-logging refresh for use in mutation code paths — never
// blocks or fails the caller's request.
function scheduleEmbeddingRefresh(submissionId) {
  if (!isEmbeddingConfigured() || !submissionId) return;
  setImmediate(() => {
    ensureEmbeddings(null, submissionId).catch((error) => {
      console.error(`[ai-search] embedding refresh failed for submission ${submissionId}:`, error?.message || error);
    });
  });
}

// Batch, non-blocking refresh for bulk paths (e.g. Excel import). Loads and
// hydrates all rows once (lookup maps built once, not per row) and embeds in
// batches — far more efficient than one scheduleEmbeddingRefresh per ticket.
function scheduleBatchEmbeddingRefresh(submissionIds) {
  if (!isEmbeddingConfigured()) return;
  const ids = (Array.isArray(submissionIds) ? submissionIds : []).map(Number).filter(Boolean);
  if (!ids.length) return;
  setImmediate(async () => {
    try {
      const { Submission } = dbApi.getModels() || {};
      if (!Submission) return;
      const raw = await Submission.findAll({ where: { id: ids }, raw: true });
      const hydrated = await hydrateRows(raw);
      const BATCH = 100;
      let embedded = 0;
      for (let i = 0; i < hydrated.length; i += BATCH) {
        // eslint-disable-next-line no-await-in-loop
        const report = await ensureEmbeddingsForHydratedRows(hydrated.slice(i, i + BATCH), { maxEmbed: Infinity });
        embedded += report.embedded;
      }
      console.log(`[ai-search] batch-embedded ${embedded} vector(s) for ${ids.length} imported submission(s)`);
    } catch (error) {
      console.error('[ai-search] batch embedding refresh failed:', error?.message || error);
    }
  });
}

// Load stored vectors for a set of submission ids at a given scope.
// Returns Map submission_id -> Float array.
async function loadVectors(submissionIds, scope) {
  const { SubmissionEmbedding } = dbApi.getModels() || {};
  if (!SubmissionEmbedding || !submissionIds.length) return new Map();
  const rows = await SubmissionEmbedding.findAll({
    where: { submission_id: submissionIds, scope },
    attributes: ['submission_id', 'vector'],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) {
    try {
      const vec = JSON.parse(r.vector);
      if (Array.isArray(vec) && vec.length) map.set(Number(r.submission_id), vec);
    } catch {
      // ignore a corrupt row; it will be re-embedded on the next refresh
    }
  }
  return map;
}

function dot(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) sum += a[i] * b[i];
  return sum;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a, b) {
  const denom = norm(a) * norm(b);
  return denom === 0 ? 0 : dot(a, b) / denom;
}

// candidates: [{ id, vector, ...passthrough }]; returns top-k by cosine desc,
// each augmented with a `score`.
function cosineTopK(queryVector, candidates, k) {
  const qNorm = norm(queryVector);
  const scored = candidates.map((c) => {
    const denom = qNorm * norm(c.vector);
    const score = denom === 0 ? 0 : dot(queryVector, c.vector) / denom;
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, k));
}

module.exports = {
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
  buildAdminDoc,
  buildPublicDoc,
  contentHash,
  hydrateRows,
  ensureEmbeddings,
  ensureEmbeddingsForHydratedRows,
  scheduleEmbeddingRefresh,
  scheduleBatchEmbeddingRefresh,
  loadVectors,
  cosineTopK,
  cosineSimilarity,
  DEFAULT_MAX_INLINE_EMBED: AI_SEARCH_MAX_INLINE_EMBED,
};
