# Project Plan

Living record of notable features/changes. See `CLAUDE.md` for architecture and
per-app details.

## Admin Bulk Ticket-Visibility Change — done (verified 2026-07-23)

Admins can multi-select tickets in the admin dashboard and flip `is_public`
true/false for the whole selection in one action, behind a confirmation Modal
with Notice feedback.

- **Selection model:** per-row checkboxes plus a master "select all filtered"
  checkbox that covers the entire filtered set across pages (not just the
  current page). Selection is snapshotted on confirm, re-intersected with the
  current rows at apply time (safety against stale selections), guarded against
  concurrent submits, and cleared when filters change.
- **Endpoint:** `POST /api/admin/submissions/bulk-visibility` (`ensureAdmin` +
  the global `/api/admin/*` CSRF). Body `{ ids: number[], is_public: boolean }`,
  validated (≤1000 ids); response `{ ok, is_public, requested, updated,
  failed }`. Handler in `server/src/routes/adminSubmissionRoutes.js`.
- **Service:** `bulkUpdateVisibility` + `validateBulkVisibilityInput` in
  `server/src/services/submissionService.js`. Invariant: it loops the existing
  per-row `updateAdminSubmission` so socket emits (`admin:notification`,
  `public:update` via `mapPublicSubmission`) and embedding scheduling match the
  single-ticket toggle exactly; per-id failures are collected in `failed`
  without aborting the batch.
- **Frontend:** `bulkUpdateVisibility(ids, isPublic)` in `client/src/lib/api.js`;
  orchestration/state in `client/src/pages/AdminDashboardPage.jsx`; new
  `client/src/components/admin/BulkActionBar.jsx`; leading checkbox column in
  `SubmissionsTable.jsx`.
- **Verification:** `server/test/bulkVisibility.test.js` (9 cases); full server
  suite 47/47 pass; client `npm run lint` clean.

## AI Semantic Ticket Search — implemented (needs keys to activate)

Plain-language search that answers "has this issue been reported before, and
what happened to it?" with an AI summary on top and the matching real tickets
below, on three surfaces: admin dashboard, rep submission form, and public
status board.

- **Architecture:** retrieve → rank → summarize. Cached per-ticket embeddings
  (one vector per scope), ranking in Node, top-20 candidates summarized by the
  chat model. Per-search AI cost is flat regardless of ticket count.
- **Provider master switch (`AI_PROVIDER`)** — one line per environment, never a
  mix: `openai` (OpenAI summary + OpenAI embeddings; the demo) or `anthropic`
  (Claude summary + **local self-hosted embeddings**; work). Embeddings run
  `local` (a small model in-app via `@huggingface/transformers` — no vendor, no
  key, no per-call cost, text never leaves the server), `openai`, or `voyage`.
  Summary via `@anthropic-ai/sdk` (Claude) or OpenAI Chat Completions (`fetch`).
  Feature hides itself until a summary key is set.
- **Ranking:** blended match + recency (`similarity + weight × recency`, recency
  halving every 180 days) → newer strong matches first; match stays primary.
- **Data model:** new `submission_embeddings` table (JSON-in-TEXT vectors,
  portable across the SQLite/Postgres backends; no pgvector). Two scopes:
  `admin` (full text) and `public` (public-safe text, only for `is_public`
  tickets) — so public search can never leak internal fields. The
  `(submission_id, scope)` composite uniqueness (which the upsert relies on) is
  created dialect-safely: the table is synced without `alter` and the unique
  index is applied via a raw, idempotent `CREATE UNIQUE INDEX IF NOT EXISTS`
  (valid on both SQLite and Postgres). This avoids a SQLite `sync({ alter:true })`
  quirk that would otherwise mis-derive the composite index into spurious
  standalone `UNIQUE` constraints and reject the second scope row per ticket.
- **Filters:** application scoping (defaults to "All systems") and a time window
  ("reported/resolved in the last 30/90/365 days"), which **defaults to
  "Reported: last 12 months"** (`reported:365`) on all three mounts (rep `/`,
  public `/public`, admin `/admin`); the user can still override, including "Any
  time". Panel: `client/src/components/common/AiSearchPanel.jsx`. A per-user
  application default (auto-scoping to the user's most-submitted app) was
  investigated and **deferred** — no user→ticket identity link yet (the session
  holds only `{id, username, role}`, submitters are anonymous, and submissions
  record the submitter only via free-text `created_by_email`), so it waits on
  real per-user preferences or an identity link.
- **Endpoints:** `POST /api/admin/submissions/ai-search`, `POST /api/ai-search`
  (public, rate-limited), plus `/status` endpoints for UI gating.
- **Cost/abuse controls:** embeddings computed once (content-hash guard),
  bounded inline re-embed per search, ≤20 tickets to Claude, per-IP rate limit
  on the public route.

**To activate:** set `AI_PROVIDER` and its one key in `server/.env` —
`anthropic` needs only `ANTHROPIC_API_KEY` (embeddings run locally, no Voyage
key), `openai` needs only `OPENAI_API_KEY`. Voyage stays optional and is
reachable only via an explicit `EMBEDDINGS_PROVIDER=voyage` (never selected by
`AI_PROVIDER`). Then `npm run migrate` and `npm run backfill:embeddings`. Full
setup, env vars, and the pgvector upgrade path: `server/docs/ai-search.md`.

**Verification:** all `server` unit tests (cosine, doc-level leak guard, content
hash, graceful-degrade) pass in `npm test`; a mocked end-to-end run against an
isolated local SQLite confirmed public results carry no internal fields, public
search excludes private tickets, admin sees full data, and the time window
filters correctly. The self-hosted embedding + retrieval half is verified
working locally by execution: the default `local` provider loads
`Xenova/all-MiniLM-L6-v2` and produces 384-dim vectors with no key. The live
provider summary call (Claude, or OpenAI) was not run here — it requires the
user's summary key.
