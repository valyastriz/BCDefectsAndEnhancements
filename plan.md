# Project Plan

Living record of notable features/changes. See `CLAUDE.md` for architecture and
per-app details.

## Tickets Public by Default — done (verified 2026-07-24)

New tickets are now public (`is_public = 1`) by default so they appear on the
public status board and in public AI search without an admin opting each one in;
an admin can still switch any ticket to private. Internal cleanup-only tasks
(`is_cleanup = 1`) stay private by default.

- **Default logic:** `resolveCreateVisibility({ isCleanup, is_public })` in
  `server/src/services/submissionService.js` — explicit boolean wins, else
  `isCleanup ? 0 : 1`. Used by the admin create path (`createAdminSubmission`).
  The rep submission route (`server/src/routes/submissionRoutes.js`) hard-sets
  `is_public: 1` (rep tickets are never cleanup). The DB model default stays `0`
  (fail-closed at storage; the app opens visibility explicitly per channel).
- **Live updates:** both create paths now `emitPublicUpdate(mapPublicSubmission)`
  when the new ticket is public, and the rep route schedules an embedding refresh,
  so the public board live-updates and public AI search indexes new tickets.
- **Backfill:** `npm run backfill:public-visibility [-- --apply]`
  (`server/scripts/backfillPublicVisibility.js`) flips existing private,
  non-cleanup tickets to public and reindexes them for public AI search; dry-run
  by default, writes a revert record of flipped ids. Applied 2026-07-24: 50
  tickets flipped (cleanup tasks left private).
- **XLSX import:** honors an explicitly mapped `is_public`/`public` column;
  when that column is unmapped/blank it now defaults to public unless the row is
  a cleanup task — same rule as `resolveCreateVisibility`
  (`server/src/routes/importRoutes.js`).
- **Collapsed card:** `PublicItemCard` now shows the ticket's incident ref
  (EasyVista id, else `#id` — matching the AI search citation) in the
  non-expanded row so reps can identify an AI result without expanding it.
- **Verification:** `server/test/createVisibility.test.js` (4 cases); full server
  suite 57/57 pass; client `npm run lint` clean.

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

## Admin Bulk Retire/Unretire — done (verified 2026-07-24)

Extends the bulk selection above with Retire and Unretire actions (the app's
"archive" concept): same checkboxes, confirmation Modal, and partial-failure
feedback as bulk visibility.

- **Endpoint:** `POST /api/admin/submissions/bulk-retire` (`ensureAdmin` + the
  global `/api/admin/*` CSRF). Body `{ ids: number[], is_retired: boolean }`,
  validated (≤1000 ids); response `{ ok, is_retired, requested, updated,
  failed }`. Handler in `server/src/routes/adminSubmissionRoutes.js`.
- **Service:** the bulk internals are now shared — `validateBulkFlagInput` +
  `bulkUpdateFlag` (parameterized by `is_public`/`is_retired`) in
  `server/src/services/submissionService.js`, with domain-named wrappers
  `bulkUpdateVisibility`/`validateBulkVisibilityInput` (shapes unchanged) and
  `bulkUpdateRetired`/`validateBulkRetiredInput`. Same invariant: loops the
  per-row `updateAdminSubmission`, so the "Retired"/"Unretired" status-history
  log, socket emits, and embedding scheduling match the single-ticket
  Retire/Unretire buttons exactly; re-retiring an already-retired ticket is a
  quiet no-op.
- **Frontend:** `bulkUpdateRetired(ids, isRetired)` in `client/src/lib/api.js`;
  `BulkActionBar` gains Retire/Unretire buttons; the confirm Modal + apply flow
  in `AdminDashboardPage.jsx` is generalized via a `BULK_ACTIONS` map
  (title/message/confirm label/API call per action) — snapshot-on-confirm,
  apply-time re-intersection, and the in-flight guard are shared across all
  four bulk actions.
- **Verification:** `server/test/bulkRetire.test.js` (9 cases); full server
  suite 66/66 pass; client lint + build clean; exercised end-to-end against a
  sandboxed sqljs DB (retire → status log → unretire, partial failure with an
  unknown id, CSRF/auth/validation rejections, bulk-visibility regression).

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
- **Ranking:** top-K candidates are **selected by raw cosine similarity** (after
  the `AI_SEARCH_MIN_SIMILARITY` floor, env-tunable, default 0.25, `0`
  disables); the recency-blended score (`similarity + weight × recency`,
  halving every 180 days) is only a display-order tiebreak and can never eject
  a higher-similarity candidate from the K. Display order: LLM relevance tier
  (high > medium > low), tie-broken by blended score, unendorsed keyword hits
  last. Why: selection-by-blended-score buried the corpus's single best raw
  match (a 2.5-year-old ticket, raw rank 1 of 76) at rank 27 behind recent
  low-relevance tickets — the recency term's magnitude rivaled the whole
  corpus's cosine spread. Floor may need re-tuning if `EMBEDDINGS_PROVIDER`
  changes (different models have different similarity scales).
- **Keyword safety net:** salient query terms (stopwords dropped; a
  trailing-'s' variant so "invoices" matches "invoice") are matched against
  window-surviving candidates' text; keyword hits are unioned into the LLM
  candidate set (cap top-K + 10) and are **guaranteed to appear in results**
  even if the LLM doesn't endorse them (appended after endorsed matches, total
  ≤ top-K, additive `ai.keyword_match` flag). Public scope keyword-matches only
  public-safe text of public candidates (fail-closed `is_public` re-check).
- **Summary honesty:** the summary prompt treats candidates as raw similarity
  retrievals that may all be irrelevant — it must describe what the most
  relevant ticket is actually about (one sentence from its content, not just
  status) and explicitly say when nothing matches the query's topic (returning
  empty matches; optional `has_relevant_match` boolean in the result). A
  server-side self-consistency guard forces `matches: []` whenever the model
  reports `has_relevant_match: false` (observed: gpt-4o-mini listed a ticket as
  relevance "high" while its own summary text said it wasn't relevant); OpenAI
  summary calls use strict structured output (`json_schema`, strict), Claude
  path unchanged. Note the summary is load-bearing for endorsement ordering:
  final results are the LLM-endorsed matches plus guaranteed keyword hits.
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
  ("reported/resolved in the last 30/90/365/730 days"), which **defaults to
  "Reported: last 24 months"** (`reported:730`) on all three mounts (rep `/`,
  public `/public`, admin `/admin`); the user can still override, including "Any
  time". The window filter is never silent: the response carries
  `windowExcluded` (count of candidates dropped solely by the time window) and
  the panel surfaces it — on zero matches, an info notice + "Search all time"
  button; with matches, a muted footnote with a link-style widen affordance.
  The 24-month default replaced the earlier 12-month default after it silently
  hid a 29-month-old ticket that was the query's only true match. A failed
  search (error) no longer also renders the "not been reported yet" empty state
  (empty state is gated behind `!error`). Panel:
  `client/src/components/common/AiSearchPanel.jsx`. A per-user
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

**Verification:** all `server` unit tests pass in `npm test` (53 as of
2026-07-24: cosine, doc-level leak guard, content hash, graceful-degrade, plus
similarity-floor and `windowExcluded` coverage); a mocked end-to-end run
against an isolated local SQLite confirmed public results carry no internal
fields, public search excludes private tickets, admin sees full data, and the
time window filters correctly. The self-hosted embedding + retrieval half is
verified working locally by execution (`Xenova/all-MiniLM-L6-v2`, 384-dim, no
key). Production (2026-07-24): `backfill:embeddings` ran against the live DB
with `openai:text-embedding-3-small` — all 81 submissions indexed (81 admin +
26 public vectors, no dimension mismatch). A prior in-app 500 was root-caused
to OpenAI `insufficient_quota` (fixed by the user swapping to a funded key),
not a code defect. Ranking rework (2026-07-24, second pass): a live browser
repro ("anything on invoices") showed the true best match — ticket #22, raw
cosine rank 1 of 76 — buried at blended rank 27 under recent junk test
tickets and never shown even on "Search all time"; a read-only diagnostic
script against prod embeddings measured and confirmed the cause (see Ranking
bullet). Fixes verified by `server/test/aiSearch.test.js` (21 cases: floor,
windowExcluded, raw-match selection, self-consistency guard, keyword net incl.
public-scope isolation); full suite 60/60 pass; client lint clean. Not yet
exercised live in the browser: the reworked ranking, keyword safety net, and
strict-schema summary on a real search.

**Known data caveats (surfaced, not yet acted on):** the public corpus is
dominated by 2026 junk "test" tickets which degrade search quality (worth a
cleanup/retire pass); `is_retired` tickets are not excluded from public AI
search candidates; ticket #53 duplicates #22.
