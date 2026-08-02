# Project Plan

Living record of notable features/changes. See `CLAUDE.md` for architecture and
per-app details.

## Submit a Request Page Redesign — built, awaiting UI sign-off (2026-08-02)

Carries the queue and detail-modal vocabulary out to the one page reps actually use.
Design approved as Artifact **v2** before any code
(https://claude.ai/code/artifact/e9839aff-f9c0-4cae-88e9-2b205eebb052). Redesigned from
the rep's job — *tell the BC team fast, and don't file something already reported* —
rather than by rearranging the old form. No DB, endpoint or payload change:
`POST /api/submissions` is untouched.

**The duplicate check moved into the summary field** (`components/public/DuplicateCheck.jsx`).
The old page put `AiSearchPanel` above the form, so a rep typed their issue into the search
box and then retyped the same sentence into "Summary of Issue". Now the summary *is* the
query, and the check renders inline beneath it: idle → loading skeletons → hits (AI summary
+ `PublicItemCard` results, collapsible) → nothing-found → error. Editing the summary after
a check flips the control to "Re-check" rather than leaving stale matches looking current.
Searches **all time**, unlike the panel's 24-month default — for a duplicate check an old
Deployed ticket is exactly the answer the rep needs. Self-disables with the feature.

`AiSearchPanel` is deliberately **untouched** — it is a search tool with its own query box,
system scope and time window, and it still serves the admin queue and the status board. The
two share `api.aiSearch`, not a component.

**A "Before you submit" rail** (`components/public/SubmitReadinessRail.jsx`) ticks required
fields off as they are typed, holds the screenshot nudge next to the button that needs it,
and owns the primary action plus a "what happens next" 1-2-3 (New → Approved → Submitted).
The old form only revealed missing fields *after* Submit, as one concatenated string.
Failed submit now also marks each field inline and focuses the first one. Under 980px the
rail stacks and a sticky bottom bar takes over as the always-reachable Submit — it is a
sibling of the rail, not nested in the form column, so it still lands last once stacked.

**Screenshots got a real drop zone** (`components/public/ScreenshotDropZone.jsx`): drag,
browse, or **Ctrl+V paste** — the way reps actually capture screens. Mirrors the server's
allow-list (`middleware/upload.js`) so an oversized or non-image file is refused inline with
a reason instead of coming back as a 400 after the whole form is filled. Object-URL
lifecycle stays in the page, where `files` is local state — as a prop it trips
`react-hooks/set-state-in-effect`.

**Type choice is two descriptive cards**, since it reshapes the whole form. **Confirmation**
keeps the reference number, a recap of what the team will see, and a link to the Status
Board (true: rep tickets are created `is_public: 1`).

Styles are a new `rs-` namespace at the end of `index.css`, semantic vars + `color-mix()`
only, so there are no dark-theme overrides to keep in sync. `.section-label` and `.thumb-*`
were left alone — five admin components render them. Removed with the page that owned them:
`.type-picker`, `.submit-page-wrap`, `.submitted-card`, `.submitted-icon`.

Also dropped the dead `desired_completion_date` from the form payload — it was in
`initialForm` and always sent empty. Admins fill it in before the EasyVista hand-off.

Not verified: no browser was driven, so the rendered layout, both themes, and the
narrow-width behaviour are unconfirmed. API paths, lint, build and the server suite were
exercised.

## FIXED — enhancements were being sent to EasyVista as defects (2026-08-01)

Found while building the EasyVista preview; not introduced by the redesign. Resolved by
**making the outgoing type an explicit choice instead of an inference** (see "Send as"
below), which removes the guess rather than correcting it.

What was wrong: the effective type consulted only `cleanup_tag_type`, so an ordinary
(non-cleanup) enhancement — where that field is null — resolved to `defect`. Every such
EasyVista ticket opened with `Type: defect`, the server validated it against **defect**
rules (Summary of Issue, Screen Title, Description) so the enhancement branch was dead
code, and the client disagreed with the server about which fields block a send. Evidence
it was an oversight rather than a decision: twelve lines earlier the same function tested
enhancement-ness with `source.type === 'enhancement'`.

Pinned by `server/test/easyVistaPayload.test.js` — the default for each of the five
ticket shapes, plus a named regression guard that an ordinary enhancement never resolves
to `defect`.

## Admin Detail Modal Redesign — v2 tabs, built, awaiting UI sign-off (2026-08-01)

Carries the queue redesign's vocabulary into the modal it never reached, and gives the
EasyVista hand-off a real review step. Design approved as Artifact **v2** before any code
(https://claude.ai/code/artifact/c331a963-65b9-4da8-be0f-da894f17c3d5). v1 stacked the
sections as cards in one scroll; reviewed live and rejected as still too busy, so v2
moves to **one pane at a time**.

**Tabs** (`detail/DetailTabs.jsx`, registry in `constants/detailModalConstants.js`):
Triage · Impact · Report · Files · History & reference · EasyVista, the last set apart at
the right end as an outbound action. Identity, alerts and the footer render OUTSIDE the
strip, so nothing needing attention can hide behind an inactive tab; tab labels carry a
file count, a warning marker when they hold a required-but-empty field, and a dot for
unsaved edits. One tab stop for the strip with arrow-key/Home/End navigation. Under
~480px of modal width (container query, so it follows the modal not the window) the
strip becomes a labelled select carrying the same badges as text. Only the active pane
is rendered — every input is controlled by `edit`, so unmounting loses nothing, and the
rendered markup for a defect dropped from ~12k to ~4.9k characters.

**EasyVista review** — the second half of the work, and the reason for the backend
changes:
- `server/src/helpers/easyVistaPayload.js` is now the single definition of the outgoing
  format. `submitToEasyVista` and the preview both use it; the hand-maintained copy that
  lived in the modal is deleted. Verified byte-identical to the previous inline builder
  across defect, enhancement and all-blank inputs. One intentional divergence: a null
  value now renders empty instead of the literal text `null`.
- `POST /api/admin/submissions/:id/easyvista-preview` runs the **real submit path in
  dry-run mode** (`submitSubmissionToEasyVista({ dryRun: true })`) and returns just
  before the outbound call. The preview therefore cannot disagree with the request about
  the payload, the effective type, or which fields are blocking. It carries the unsaved
  draft and writes nothing.
- The tab states the consequences a re-submit actually has — it **forks the record**
  rather than updating the ticket — lists all 18 fields that never reach EasyVista,
  marks rows changed by unsaved edits, and offers the raw string.
- Blocked sends are **editable inline** on the EasyVista tab, wired to the same `edit`
  state as the other tabs. The footer's send button opens the tab; the tab's opens a
  confirm. Nothing outbound happens without the payload being seen first.

**"Send as" — the outgoing type is chosen, not inferred.** EasyVista accepts a defect or
an enhancement and nothing else, so the admin picks which one a send goes out as, on both
first-time sends and re-submits:
- Pre-filled with the ticket's own type. A **Cleanup Only** task has no valid default, so
  it must be chosen — which is also how a cleanup task now reaches EasyVista at all. The
  old hard 400 ("Tag as Defect or Enhancement first") is gone; re-tagging the ticket just
  to send it is no longer necessary.
- **Which fields block the send follows the choice**, client and server alike: pick
  Enhancement and it needs Impact Details and Request Type; pick Defect and it needs
  Screen Title and Description.
- **Whether the record is reclassified depends on which send it is** — the split is
  `isResubmissionRequest = !isBlank(submission.easyvista_ticket_id)`:
  - **First send** (no EasyVista ticket yet): the record is updated in place, nothing is
    forked. A **Cleanup Only** task is therefore *retagged* to cleanup + the chosen type,
    because the choice is resolving an incomplete classification rather than overriding a
    good one — Cleanup Only is not a type EasyVista recognises. A history entry records
    it. The lookups are resolved BEFORE the outbound call so a missing metadata value
    can't leave a created ticket against an untagged record.
  - **Re-submit** (a ticket already exists): forks. The *new* submission carries the
    chosen type (a Cleanup Only original becomes a cleanup tagged with it); the original
    keeps its own classification, including Cleanup Only, and gains only its resubmission
    link plus a history entry recording what went out —
    `…as Submission #1503, sent as Enhancement`.
  - A ticket that already has a valid type is **never** reclassified by sending it, on
    either path.

  The worked case: reported as a defect → EasyVista defect ticket raised → turns out to
  be working as designed → marked Cleanup Only → later needs to go out as an enhancement.
  Because an EasyVista ticket already exists, that second send forks: a new submission and
  a new EasyVista ticket as an Enhancement, with the original defect ticket left intact.
- `resolveEasyVistaEffectiveType(source, sendAsType)` returns `null` when there is no
  default and no choice, which is what produces the "must choose" state in both the
  preview and the send.

**The original problem was structural, not decorative.** Every `detail/*` section
returned a bare fragment, so all six section labels and their fields were siblings in one
`.stack` grid at `gap: 16px` — the gap between two *sections* equalled the gap between
two *fields*. `.section-label` was 11px `--slate-400` while `.bs-field > span` was
13px/600, so group titles were the smallest, faintest text in the body: hierarchy
inverted. Roughly 86 elements, 16 headings in 4 styles, 12 banner slots, and 4 flat
footer actions that scrolled out of view.

Also carried over from v1 and still true:

- **Identity band** (`detail/DetailIdentityBand.jsx`): the queue row's badges, summary
  and meta line carried into the modal. Badges read from `edit`, so they track the
  dropdowns live. This is now the only place the EasyVista ID appears — it used to show
  in four.
- **Alerts region** (`detail/DetailAlerts.jsx`): the 12 banner slots become one region
  ordered by severity, capped past two alerts so warnings can never push the content
  below the fold.
- **Pinned footer**: `Modal` gained two **optional** props, `footer` and `className`;
  `.bs-modal--with-foot` switches the grid to `auto 1fr auto`. Defaults preserve all
  nine existing mount points. Respond/Retire sit behind a `⋯ More` menu reusing
  `AdminMenu`. The menu is a DOM descendant of the modal, never a portal — a portal's
  clicks land on the backdrop, whose close handler discards staged attachments.
- **Retire now confirms.** It was irreversible-in-the-modal with no prompt, while the
  *less* consequential bulk retire already confirmed.
- **Presence lock rewritten**: `.modal-locked`'s blanket `pointer-events: none;
  opacity: .55` contradicted its own "you can view everything below" copy and still left
  every control keyboard-reachable. Now `inert` on the editable pane only — bodies stay
  readable, attachments stay openable, mutating controls switch off.
- **Deletions**: the duplicate `JIRA Number` (both bound to `edit.jira_number`), the
  duplicate header Save button, the doubled label on Impact Notes, the
  permanently-disabled `Cleanup Status` for non-cleanup tickets, `Fingerprint` as an
  editable input, the client-side copy of the EasyVista format, and every inline
  `style={{}}` in `detail/*` — so the panes participate in dark mode and the responsive
  rules.
- **CSS**: one appended block in `client/src/index.css` after the queue block, semantic
  vars + `color-mix()` only, **no new dark-theme overrides**. Also adds `.bs-field-hint`,
  which components referenced but was never defined.

Verified: `npm run lint` and `npm run build` (client) green, `npm test` (server) 77/77,
EasyVista payload parity proven byte-identical against the pre-refactor builder, and a
`react-dom/server` harness renders five states (defect, enhancement, dense/all-alerts,
empty, cleanup) asserting the tab strip, exactly one rendered pane, the narrow select,
the capped alerts, the auto-switch to EasyVista on a blocked send, and the absence of
every legacy class.
**Not verified in a browser** — no browser tooling in this environment. Outstanding:
visual check in both themes, keyboard walk of the tab strip, the narrow-width select,
the confirm dialog and inline blocked-field editing exercised for real, and an
`easyvista-preview` round-trip against a real record.

**EasyVista is wired but deliberately not connected.** `EASYVISTA_ENABLED` is a master
switch that defaults OFF; credentials alone are not enough, because the endpoint path and
the response shape are still assumptions. While it is off, a send records a placeholder
`EV-#####` id and transmits nothing, and both the EasyVista tab and the success message
say so — a stubbed send still writes a realistic-looking id onto a real record, so it
must not read as a genuine ticket.

To connect it, in order: confirm `EASYVISTA_REQUESTS_PATH` and the response shape, fill
in `sendEasyVistaAttachments` (the only unimplemented function — the picker, the four-file
cap and the ownership validation are done), set the catalog config in `.env`, then set
`EASYVISTA_ENABLED=true`. Every variable is documented in `server/.env.example`.

Testing notes: with `.env` on `sqljs`/`local` the whole flow writes only to the local
seeded file. A re-submit can be exercised end to end — it really does fork the record
locally, which is the fastest way to see the behaviour the confirm dialog describes.

## Admin Queue UI Redesign — built, awaiting UI sign-off (2026-07-30)

Branch `feat/admin-queue-redesign`. Rebuilds the admin dashboard around the triage
job: 14 always-open filters become a command row plus a grouped panel, the two
count scopes are labelled instead of merged, sorting stops depending on which
columns are visible, and the table gains real loading/empty/error states. Design
was approved as Artifact v6 before any code
(`admin-queue-redesign.html`, decisions recorded there).

- **Command row** (`components/admin/CommandBar.jsx`): search + a Filters button
  carrying the applied-filter count + a Customize-view button + an
  Active/Retired/All segmented control. Of the 14 filter keys, `search` and
  `retiredFilter` live here (`COMMAND_ROW_FILTER_KEYS`); the other 12 are grouped
  four ways by `ADMIN_FILTER_GROUPS` in `FilterPanel.jsx`, drawn closed. Both
  promoted controls still honour the admin's visible-filter set, because the page
  resets the value of any hidden filter.
- **Search matches every identifier on the ticket** (2026-08-02): the box used to
  match only policy/account/summary while its placeholder promised more, so an
  EasyVista incident number or a reporter's name returned nothing. It now matches
  the fields in `ADMIN_SEARCH_FIELDS` (`services/submissionService.js`) — ticket
  id, EasyVista incident, Jira and release numbers, policy/account/transaction,
  reporter (`created_by`, its email, `easyvista_submitted_by`), the descriptive
  text, and application name — each field independently, so a query can't match
  by straddling two fields. Status/type names and internal notes stay out
  (dedicated filters exist; "new" would otherwise return the board). Guarded by
  `test/adminSearchFields.test.js`. XLSX export uses the same filter path, so it
  follows automatically.
- **Active filter chips** (`ActiveFilterChips.jsx` + `utils/activeFilterUtils.js`):
  one removable chip per applied filter, plus Clear all. `getActiveFilters` is the
  single derivation shared by the Filters badge, the chips, the filtered-view
  band's summary line and the empty state, so those four can't drift.
  An all-selected status multi-select is treated as "no filter", matching the
  default view.
- **Two count scopes, deliberately separate and now labelled** — the split was
  intentional, so it was kept and made legible rather than merged.
  `QueueScopeStrip.jsx` is badged **Whole queue** (all non-retired, ignores
  filters); `FilteredViewBand.jsx` is badged **Filtered view**, states that it
  changes with every filter, carries its denominator ("142 of 247"), and is
  visually joined to the top of the table it describes.
- **Fixed headline statuses + the missing counts**: the strip keeps
  New/Approved/Submitted/Deployed (`SCOPE_STRIP_STATUSES`, fixed so cards never
  reorder) and adds an expandable "other statuses" card. `loadBaselineCounts` now
  also returns `cleanupOnly`, so Total finally equals the sum of the cards —
  previously those tickets were counted in Total and shown nowhere.
- **Sorting decoupled from column visibility** (`SortControl.jsx` +
  `utils/sortUtils.js`): a Sort-by/direction pair listing every field in
  `SORT_FIELDS`, whether or not its column shows. Direction wording follows the
  field type (`SORT_DIRECTIONS_BY_TYPE`: dates Newest/Oldest, numbers
  Highest/Lowest, text A→Z, booleans Yes/No first), mirroring the server's
  compareText/compareNum/compareBool. Header click-to-sort still works and writes
  the same `filters.sort`.
- **Columns**: new `id` column (the `#1234` the app already uses in AI-search
  citations and reply emails). Default visible set trimmed to 8 data columns —
  `id, reportedDate, summary, status, cleanupStatus, isPublic, easyvista,
  jiraCard` — keeping all four inline editors. `reportedDate` renders reported +
  last-status-update in one cell; Type moved into the Summary cell as badges. All
  13 previous columns remain available via Customize View.
- **Saved-view safety**: `useAdminViewPreferences` now sanitizes against
  `ALL_COLUMN_KEYS`/`ALL_FILTER_KEYS` rather than the default visible sets. With
  the defaults now a subset, the old code would have silently stripped columns
  like `policyPremium` from an admin's saved view on every load.
- **Server**: `id_asc`/`id_desc` added to `comparatorMap`
  (`services/submissionService.js`) using `compareNum` so #10 sorts after #9;
  `id` added to `ADMIN_VIEW_COLUMN_KEYS`. No new endpoints, no migration.
- **States** (`QueueStates.jsx`): layout-matching `TableSkeleton` replaces the
  "Loading…" line over stale rows; `QueueEmptyState` names how many filters are
  narrowing the view and offers Clear all; `QueueErrorState` offers Retry. A
  failure with rows still on screen keeps them and reports via the page Notice.
- **Bulk bar** (`BulkActionBar.jsx`): sticky to the viewport bottom so it stays
  reachable down a long selection, and states in words that the selection spans
  every page of the filtered view. Same four actions, same confirm modal, same
  snapshot/re-intersect safety in the page.
- **AI search**: `AiSearchPanel` gained opt-in `collapsible` + `entryHint`. Only
  the admin queue passes them (collapsed entry strip, so the table stays above the
  fold); Public Updates and Rep Submit are unchanged.
- **Theming**: status color tokens added for the four statuses that had none
  (Redirected + the three parked ones as `holding`) plus Retired and Cleanup Only,
  and **dark-theme values for every status pair** — the light pastels were being
  reused in dark mode. New badge classes wired in `BADGE_CLASS_MAP`.
- **Removed**: `StatTiles.jsx` and `FiltersBar.jsx` (fully replaced). The
  "viewing new form submissions only" info bar went with them — the chips now show
  that state and Clear all reverses it, so the hidden previous-filters snapshot
  (`preNewSubmissionFiltersRef`) was dropped too.
- **Verification:** client `npm run lint` clean; `npm run build` succeeds; server
  `npm test` 77/77 pass including new `test/adminSortKeys.test.js` (every sort key
  the control can emit has a comparator; id sorting is numeric; `id` is
  allow-listed). Endpoints exercised live against a **local sqljs sandbox** on
  port 4100 (seeded, production untouched): `id_asc` → 1,2,3,4,5 and `id_desc` →
  5,4,3,2,1; an unknown sort key still falls back to `updated_desc`; a saved view
  containing `id` **and** the non-default `policyPremium` round-trips intact.
  NOT yet done: no browser walkthrough of the rebuilt page, no two-window
  live-update check, no narrow-width/dark-theme visual pass.

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
  empty matches). It must never open with a "Yes, this has been reported"
  verdict (similarity ≠ sameness — the model cannot verify the user's issue is
  the same one); it leads with the closest ticket's substance and status and
  lets the reader judge sameness (optional
  `has_relevant_match` boolean in the result). A
  server-side self-consistency guard forces `matches: []` whenever the model
  reports `has_relevant_match: false` (observed: gpt-4o-mini listed a ticket as
  relevance "high" while its own summary text said it wasn't relevant); OpenAI
  summary calls use strict structured output (`json_schema`, strict), Claude
  path unchanged. Note the summary is load-bearing for endorsement ordering:
  `matches` is exactly the LLM-endorsed set; guaranteed literal hits it did not
  endorse are returned in `keywordMatches` instead (see below).
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
  (empty state is gated behind `!error`). The summary + results area is
  collapsible ("Hide results" / "Show results (N)") so the page below — e.g.
  the submission form — stays reachable; a new search always re-expands.
  Panel: `client/src/components/common/AiSearchPanel.jsx` (shared by all three
  mounts, so behaviors land on rep, public, and admin surfaces at once). A per-user
  application default (auto-scoping to the user's most-submitted app) was
  investigated and **deferred** — no user→ticket identity link yet (the session
  holds only `{id, username, role}`, submitters are anonymous, and submissions
  record the submitter only via free-text `created_by_email`), so it waits on
  real per-user preferences or an identity link.
- **Two result sections: semantic, then literal** (2026-08-02). The panel now
  returns `matches` (LLM-endorsed, ranked by relevance) *and* a separate
  top-level `keywordMatches` array rendered below them under a "Keyword matches"
  heading — tickets that literally contain what was typed but weren't endorsed.
  Previously the two were merged into one ranked list, which made a literal hit
  look like an AI judgement. A ticket appears in one section, never both.
  - **Identifier lookup**: pasting a ticket id, EasyVista incident, Jira,
    release, policy, account, or transaction number now resolves, as does a
    reporter's name. Identifier terms bypass the prose tokenizer's stopword and
    3-char rules (`#42` is a real ticket) and match identifier *fields* rather
    than the free text — equality always, containment only for distinctive terms
    (5+ chars, or 3+ mixing letters and digits). The numeric `id` is
    equality-only, so `#42` can't drag in `#1420`, and a bare `2026` can't
    substring-match a policy number. Hits carry `ai.matched_on`.
  - **No re-index was needed, by design.** The identifiers live in
    `buildKeywordDoc` (`embeddingIndexService.js`), which extends the embedded
    doc for *matching only*. Embedding ID strings would add semantic noise, and
    any change to the embedded text changes its `content_hash` and re-embeds the
    whole corpus. The embedded docs and every stored vector are untouched — a
    test asserts this.
  - Literal matching runs over every window-surviving row, not just vectorized
    ones, so a brand-new ticket is findable by its incident number before the
    backfill reaches it; with an empty index the search degrades to literal
    matches instead of returning nothing.
  - Public scope still fails closed twice: only public rows can hit, and the
    public lookup fields are the `mapPublicSubmission` allow-list (no email, no
    `easyvista_submitted_by`, no notes).
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
