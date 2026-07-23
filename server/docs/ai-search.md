# AI Semantic Ticket Search

Plain-language search over submissions: a user describes an issue, an **AI
summary** ("has this been reported before, and what happened to it?") appears on
top, and the **matching real tickets** are listed below — on the admin
dashboard, the rep submission form, and the public status board.

The feature is **optional and self-disabling**: with no keys configured the
search panel is hidden everywhere and the app runs exactly as before.

## How it works (retrieve → rank → summarize)

1. Each ticket has a cached embedding vector (see `submission_embeddings`).
2. A search embeds only the **query** (tiny), pre-filters candidates in SQL
   (application, time window, `is_public` for public surfaces), ranks them by
   cosine similarity in Node, and takes the **top 20** (`AI_SEARCH_TOP_K`).
3. Claude (Haiku) ranks/explains those ≤20 and writes the grounded summary.
4. The response returns the summary + the **real hydrated ticket rows** in
   ranked order — Claude never invents a ticket, status, or date.

Per-search Claude cost is flat regardless of corpus size (only ≤20 tickets are
ever sent). Ticket embeddings are computed once and re-embedded only when the
source text changes (`content_hash` guard).

### Scope safety (no leakage)

Two embedding scopes per ticket:
- `admin` — always; from full internal text (may match on decision notes, etc.).
- `public` — only when `is_public=1`; from public-safe text only.

Public searches force `is_public=1`, build Claude cards from public-safe fields
only, and map every result through `mapPublicSubmission` — so internal fields
(email, reviewer, decision/impact notes, fingerprint) can never leak.

## Providers — one master switch

`AI_PROVIDER` picks **both** the summary vendor and the embeddings vendor, so an
environment is never a mix. Flip one line per environment:

| `AI_PROVIDER` | Summary | Embeddings | Keys needed |
|---|---|---|---|
| `openai` | OpenAI (`OPENAI_SUMMARY_MODEL`, default `gpt-4o-mini`) | OpenAI (`text-embedding-3-small`) | `OPENAI_API_KEY` |
| `anthropic` | Claude (`AI_MODEL`, default `claude-haiku-4-5`) | **Local, self-hosted** (`Xenova/all-MiniLM-L6-v2`) | `ANTHROPIC_API_KEY` only |

Claude has **no** embeddings API, so an all-Anthropic environment pairs Claude
(summary) with a **local, self-hosted** embedding model that runs inside the app
via `@huggingface/transformers` — no vendor, no key, no per-call cost, and the
ticket text never leaves the server. So `AI_PROVIDER=anthropic` needs **only** the
Anthropic key; there is zero third-party vendor.

Embeddings have three modes (set via `EMBEDDINGS_PROVIDER`, or let `AI_PROVIDER` pick):
- **`local`** (default for anything but `AI_PROVIDER=openai`) — self-hosted model, no key. Loads once (~90MB, cached), runs on CPU. Best on a real server (work); heavier for a small host.
- **`openai`** — OpenAI embeddings API (needs `OPENAI_API_KEY`).
- **`voyage`** — Voyage AI embeddings API (needs `VOYAGE_API_KEY`).

> Switching the embeddings provider changes the vector space, so re-run
> `npm run backfill:embeddings` after changing it (the `model` guard re-embeds
> everything; searches also self-heal stale vectors).

**Demo preset** (all OpenAI, one key): `AI_PROVIDER=openai`, `OPENAI_API_KEY=…`
**Work preset** (Claude + self-hosted embeddings, no third-party vendor): `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…`

## Ranking — newer + higher-match first

Results are ordered by a blended score: `similarity + AI_SEARCH_RECENCY_WEIGHT ×
recency`, where recency halves every `AI_SEARCH_RECENCY_HALFLIFE_DAYS` (default
180). Semantic match stays primary — a much-better older ticket still outranks a
weak recent one — but among comparable matches the newer ticket wins. Set the
weight to `0` for pure match, or higher to lean harder on recency. Each result
carries `ai.match` (raw similarity) and `ai.score` (blended) for transparency.

## Setup

1. **Pick the provider** and add its keys to `server/.env` (see `.env.example`
   for the two presets above).
2. **Create the table**: `npm run migrate` (adds `submission_embeddings` via the
   normal model-sync; safe/idempotent).
3. **Backfill embeddings** for existing tickets: `npm run backfill:embeddings`
   (idempotent — re-run any time; only changed text is re-embedded).

After that, indexing stays current automatically:
- Manual create / edit / EasyVista submit → the ticket is re-embedded
  non-blocking after the write.
- **Excel bulk import** → all imported tickets are batch-embedded in the
  background when the import finishes (efficient: one hydrate pass + batched
  embed calls; never blocks the import response).
- Any missing vector is also self-healed at search time (bounded by
  `AI_SEARCH_MAX_INLINE_EMBED` per search).

The backfill script remains the catch-all: run it any time to (re)index
everything, e.g. after enabling the feature on a DB that already has tickets, or
if a large import happened while the provider key was temporarily missing.

## Key env vars

| Var | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | — | Master switch: `openai` or `anthropic`. Drives summary + embeddings. |
| `ANTHROPIC_API_KEY` | — | Claude key (needed when the summary is Anthropic). |
| `OPENAI_API_KEY` | — | OpenAI key (needed when provider is OpenAI). |
| `VOYAGE_API_KEY` | — | Voyage key (only if `EMBEDDINGS_PROVIDER=voyage`). |
| `AI_MODEL` | `claude-haiku-4-5` | Anthropic summary model. |
| `OPENAI_SUMMARY_MODEL` | `gpt-4o-mini` | OpenAI summary model. |
| `EMBEDDINGS_MODEL` | auto per provider | `Xenova/all-MiniLM-L6-v2` (local) / `text-embedding-3-small` (openai) / `voyage-3.5-lite` (voyage). |
| `EMBEDDINGS_PROVIDER` | (from `AI_PROVIDER`) | `local` \| `openai` \| `voyage`. |
| `AI_SUMMARY_PROVIDER` | (from `AI_PROVIDER`) | `anthropic` \| `openai`. |
| `AI_SEARCH_RECENCY_WEIGHT` | `0.15` | Recency boost in ranking (`0` = pure match). |
| `AI_SEARCH_RECENCY_HALFLIFE_DAYS` | `180` | How fast the recency boost decays. |
| `AI_SEARCH_ENABLED` | `true` | Master on/off. |
| `AI_SEARCH_PUBLIC_ENABLED` | `true` | Toggle the public/rep-form surfaces independently. |
| `AI_SEARCH_TOP_K` | `20` | Candidate tickets sent to Claude per search. |
| `AI_SEARCH_MAX_QUERY_LENGTH` | `500` | Query length cap. |
| `AI_SEARCH_MAX_INLINE_EMBED` | `25` | Max embeddings computed inline during one search. |
| `AI_SEARCH_PUBLIC_RATE_LIMIT` / `_WINDOW_MS` | `20` / `60000` | Per-IP rate limit on the public endpoint. |

## Endpoints

- `POST /api/admin/submissions/ai-search` (admin; full data)
- `POST /api/ai-search` (public; `is_public` + public fields only; rate-limited)
- `GET  /api/admin/ai-search/status`, `GET /api/ai-search/status` → `{ enabled, summaryEnabled }` (UI gating)

Body: `{ query, applicationName?, applicationId?, reportedWithinDays?, resolvedWithinDays? }`.

## Scaling / upgrade path

Cosine similarity is computed in Node, which is fine up to ~10–50K tickets. Past
that (or at hundreds of thousands), replace the in-JS ranking with **pgvector**
(Postgres only): add a `vector` column + ANN index and swap `loadVectors` +
`cosineTopK` in `embeddingIndexService.js` for an indexed `ORDER BY embedding
<-> query` query. The candidate cap is `MAX_CANDIDATES` in `aiSearchService.js`
(logs when exceeded).

## Files

- `src/embeddings.js` — provider-agnostic embeddings (local self-hosted / OpenAI / Voyage).
- `src/aiSummary.js` — Claude Haiku structured summary (fails safe to empty).
- `src/services/embeddingIndexService.js` — search docs, `ensureEmbeddings`, cosine.
- `src/services/aiSearchService.js` — retrieve → rank → summarize orchestration.
- `src/routes/aiSearchRoutes.js` — admin + public routes, rate limiter, status.
- `scripts/backfillEmbeddings.js` — one-time/idempotent backfill.
- `db/models/index.js` — `submission_embeddings` table.
- Client: `components/common/AiSearchPanel.jsx` + mounts on the 3 surfaces.
