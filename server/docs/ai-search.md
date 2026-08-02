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
   (application, `is_public` for public surfaces), applies the reported/resolved
   **time window** in Node (so the excluded count can be reported — see
   [`windowExcluded`](#time-window--windowexcluded)), drops anything under the
   **minimum-similarity floor** (`AI_SEARCH_MIN_SIMILARITY`), and selects the
   **top 20** (`AI_SEARCH_TOP_K`) by **raw cosine similarity** — recency never
   ejects a strong match from the shortlist.
3. **Literal hits** — window-surviving candidates whose text contains a salient
   query term, or whose identifier fields match a pasted number (see
   [Keyword safety net](#keyword-safety-net)) — are unioned into the candidate
   set, capped at `AI_SEARCH_TOP_K + 10`.
4. The summary model ranks/explains those candidates and writes the grounded
   summary.
5. The response returns the summary + the **real hydrated ticket rows** in two
   sections: **`matches`** (endorsed by the model, by relevance tier) and
   **`keywordMatches`** (literal hits it did not endorse). The model never
   invents a ticket, status, or date.

Per-search summary cost is flat regardless of corpus size (at most top-K + 10
tickets are ever sent). Ticket embeddings are computed once and re-embedded only
when the source text changes (`content_hash` guard).

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

## Ranking — selected by raw match, recency only tiebreaks display

**Selection** into the top-K candidate set is by **raw cosine similarity**
(`ai.match`) alone, after the minimum-similarity floor. The recency-blended
score can never eject a higher-raw-similarity ticket from the shortlist — so an
old but highly relevant ticket always reaches the summary model instead of being
crowded out by recent low-relevance ones.

**Display order** of the final results: AI relevance tier first (high > medium >
low), tie-broken by the blended score `similarity + AI_SEARCH_RECENCY_WEIGHT ×
recency` (recency halves every `AI_SEARCH_RECENCY_HALFLIFE_DAYS`, default 180) —
among comparably relevant matches the newer ticket lists first. Unendorsed
keyword hits come last. Set the weight to `0` to ignore recency entirely, or
higher to lean harder on it; it only ever affects ordering, never selection.
Each result carries `ai.match` (raw similarity) and `ai.score` (blended) for
transparency.

### Minimum-similarity floor

Before the top-K slice, candidates whose **raw cosine similarity** (`ai.match`)
falls below `AI_SEARCH_MIN_SIMILARITY` (default `0.25`) are dropped — so
near-irrelevant tickets no longer pad the top 20 just because top-K had room.
The floor is applied to the raw match, **never** the recency-blended `ai.score`:
recency must not rescue an irrelevant ticket past the floor. Set it to `0` to
disable. The `0.25` default is calibrated for OpenAI `text-embedding-3-small`;
different embedding models produce different similarity scales, so re-tune it
after changing `EMBEDDINGS_PROVIDER`/`EMBEDDINGS_MODEL`.

## Keyword safety net

Semantic similarity misses two things: literal wording, and **lookups** — a
pasted incident number, ticket id, policy, or a reporter's name. Vectors are
structurally bad at exact tokens, so both are handled by literal matching
alongside the cosine ranking.

**Keyword hits** — the query is lowercased, punctuation is stripped, stopwords
and terms under 3 characters are dropped, and a trailing-`s`-trimmed variant is
matched too ("invoices" also hits "invoice"). Any candidate whose scope-safe
lookup text contains a term is a hit.

**Identifier hits** — tokens containing a digit (leading `#` and trailing
punctuation stripped: `#42` → `42`, `INC0012345`, `BC-4471`) are matched against
identifier *fields*, not the free text. A term matches a field when it **equals**
the value, or is **distinctive** enough to appear inside it (5+ characters, or
3+ mixing letters and digits). The numeric ticket `id` is equality-only, so
`#42` finds ticket 42 and not 1420, and a bare year like `2026` can never
substring-match a policy number. Identifier hits carry `ai.matched_on`
(e.g. `['easyvista_ticket_id']`).

Both kinds:

- Are **unioned into the candidate set** sent to the summary model, capped at
  `AI_SEARCH_TOP_K + 10`, so the model can endorse and explain one that *is* on
  topic.
- Are **guaranteed to appear in the response**. Anything the model endorses is
  in `matches`; everything else is returned in the separate **`keywordMatches`**
  array (identifier hits first, then keyword hits by blended score), capped at
  `AI_SEARCH_TOP_K`. A ticket never appears in both.
- Carry the additive flag `ai.keyword_match: true`; clients must tolerate its
  absence.
- Run over **every window-surviving row, not just the vectorized ones**, so a
  ticket created minutes ago is findable by its incident number before the
  backfill reaches it. With a completely empty index the search degrades to
  literal matches rather than returning nothing.
- Honour scope: public searches match only the **public-safe fields of public
  tickets**, so the union can never introduce a private ticket or an internal
  field.

### Why identifiers are not embedded

The lookup text (`buildKeywordDoc` in `embeddingIndexService.js`) deliberately
extends — never replaces — the embedded doc. Identifiers stay out of the
embedded text because ID strings are semantic noise that dilutes the topical
signal ranking depends on, and because any change to an embedded doc changes its
`content_hash`, which would re-embed the whole corpus. **Adding or changing
lookup-only fields therefore requires no re-index.**

## Time window & `windowExcluded`

The request may carry `reportedWithinDays` / `resolvedWithinDays`. The server
applies **no window unless one is sent**; the client UI defaults to **"Reported:
last 24 months"** (`reportedWithinDays: 730`) on all three surfaces, with
30/90/365/730-day options for both dimensions plus "Any time" (no filter).

The window filter is never silent: every search response includes a top-level
**`windowExcluded`** integer — the count of candidate tickets excluded *solely*
by the time window (counted before ranking, independent of similarity; `0` when
no window params are sent). It is present on both the admin and public responses
(shared service). The panel uses it to tell the user older matches were outside
the time frame and to offer a one-click "Search all time" re-run: an info notice
plus button when there are zero matches, a muted footnote with a link-style
widen affordance when there are matches.

## Summary honesty & schema

The summary prompt presents the candidates as raw similarity retrievals that
**may all be irrelevant** — not as pre-vetted matches. It must describe what the
most relevant ticket is actually *about* (one sentence drawn from its content,
not just its status), and explicitly say when nothing on file addresses the
query's topic, returning an empty `matches` list. The structured result includes
an optional **`has_relevant_match`** boolean; clients must tolerate its absence
(treat it as metadata, never require it).

A **self-consistency guard** backs the prompt: if the summary reports
`has_relevant_match: false`, the server forces its match list empty — the model
can no longer list a ticket while claiming nothing relevant exists. On the
OpenAI path the summary call uses strict structured output (`response_format:
json_schema` with `strict: true`); the Claude path is unchanged.

Note the summary is load-bearing for the *endorsed* results: they are the
LLM-approved subset of the candidates, so when the model says nothing is
relevant the endorsed list is correctly empty — only guaranteed
[keyword hits](#keyword-safety-net) can still appear, flagged and listed last.

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
| `AI_SEARCH_MIN_SIMILARITY` | `0.25` | Floor on the **raw** cosine `ai.match` (never the blended score); below it a candidate is dropped. `0` disables. Calibrated for `text-embedding-3-small` — re-tune per embeddings model. |
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

The search response includes a top-level `windowExcluded` integer (see
[Time window & `windowExcluded`](#time-window--windowexcluded)) alongside
`summary`, `matches`, `keywordMatches`, `window`, and `meta`.

## Troubleshooting

- **Searches fail with a 500 (client shows an error toast)** — check the
  summary/embeddings provider key first. An out-of-quota key (OpenAI
  `429 insufficient_quota`) surfaces as a failed search; fund or rotate the key
  in `server/.env`. Not a code issue. The client renders the error only — it
  never shows the "not been reported yet" empty state alongside an error (they
  are mutually exclusive).
- **Slow searches / missing results** — confirm `npm run backfill:embeddings`
  ran once after the feature was enabled. With an empty index, each search
  degrades to slower inline embedding, bounded by `AI_SEARCH_MAX_INLINE_EMBED`
  per request, so it can take several searches to cover a large backlog.

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
- `src/services/embeddingIndexService.js` — embedded docs + the non-embedded
  `buildKeywordDoc` lookup text, `ensureEmbeddings`, cosine.
- `src/services/aiSearchService.js` — retrieve → rank → summarize orchestration.
- `src/routes/aiSearchRoutes.js` — admin + public routes, rate limiter, status.
- `scripts/backfillEmbeddings.js` — one-time/idempotent backfill.
- `db/models/index.js` — `submission_embeddings` table.
- Client: `components/common/AiSearchPanel.jsx` + mounts on the 3 surfaces.
