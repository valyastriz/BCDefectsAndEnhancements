# Project Plan

Living record of notable features/changes. See `CLAUDE.md` for architecture and
per-app details.

---

# HANDOFF — pick this up cold (updated 2026-08-06)

Everything below this line up to the `---` is the live work queue. It is written to
be read by someone with no memory of the session that produced it. The dated
sections after it are the historical record and unchanged.

## PHASE 1 IS MOSTLY BUILT — start here (2026-08-06)

**All three mockups were approved and three PRs are merged to `main` and
deployed.** The ten-line orientation below is the *previous* session's and is now
history; read this section instead, then §4 for the design decisions that still
govern the remaining work.

**Approved mockups — these are the build contract, not sketches:**
1. Submit form, report branch (v3) — https://claude.ai/code/artifact/075982a2-0670-4d48-b02d-ba92b420b0b7
2. Delivery pane (v3) — https://claude.ai/code/artifact/9d716633-70b6-45f0-94c4-44ad493be76c
3. Throughput page (v2) — https://claude.ai/code/artifact/e6bffd90-c76a-49a4-b042-0aa2ba904835

**Merged and deployed:** PR #12 (schema, authorisation sweep, backend), PR #13
(submit form), PR #14 (Delivery pane, handover trail, approval evidence).
294 server tests, client lint and build clean, 32/32 browser checks on the submit
form at 1500/820/390 in both themes.

### The schema is APPLIED to the hosted database

`npm run migrate:report-requests` (dry-run by default, `-- --apply` to write).
Verified non-destructive afterwards: 83 submissions before and after, both
existing grants preserved, no existing row has a report field set, money columns
untouched. Idempotent — a re-run reports everything already present.

What landed: 14 nullable columns on `submissions`; `attachments.purpose`;
`user_application_roles.request_type`; `levels_of_effort`,
`request_time_entries`, `request_assignments`; the `report` submission type; four
seeded effort values.

**Two schema facts worth knowing before you touch this area:**
- `user_application_roles.request_type` stores **`''`, not NULL**, for "covers
  every type". Both dialects treat NULLs in a unique index as distinct, so a
  nullable column would let one person hold two conflicting all-types grants. The
  unique index is now `(user_id, application_id, request_type)` and the old
  two-column one is dropped. Probed with real inserts, not reasoned about.
- That table is synced **without `alter`** (SQLite would corrupt its composite
  uniqueness), so a new column on it never arrives via the boot sync.
  `ensureColumn` in `db/models/index.js` adds it explicitly. Any future column on
  that table needs the same treatment.

### The authorisation sweep is done

- `canMutateApplication(viewer, applicationId, requestType)` — **the third
  argument is load-bearing.** Omitting it asks the weaker question "may they work
  in this queue at all", which is right for a queue-level check and wrong for a
  write. All six call sites pass it: `can_edit`, both attachment routes, redirect,
  create, update. A new write path MUST pass it too.
- `manager` is a third rank above admin in `APPLICATION_ROLES`, per application.
  It gates exactly one thing: seeing other people's throughput numbers.
- `test/typeScopedAccess.test.js` is the regression net — 13 tests.

### What is LEFT, in order

1. **The throughput page** (mockup 3 v2). The backend is merged and working:
   `GET /api/admin/throughput` takes `from`/`to`/`application_id`, decides
   team-vs-personal from the caller's own rank, and **narrows the query** so a
   non-manager's response never contains a colleague's name. `api.getThroughput`
   already exists on the client. What is missing is `AdminThroughputPage.jsx`, the
   `tp-` CSS (in the artifact, ready to transplant), the route, and a nav entry.
   Chart colours are already decided and validated — see §4's chart-token note.
2. **Admin add/import/export parity.** A fourth segment in the Add-a-ticket
   dialog's segmented control, new `IMPORT_COLUMN_TARGETS` entries, new
   `ADMIN_EXPORT_FIELDS` entries. **The export field needs a `group` or
   `test/exportFields.test.js` fails — which is the point of that test.**
3. **A browser check for the Delivery pane.** Surfaces 1 and 3 have committed
   scripts; the Delivery pane is verified end-to-end through the API but not yet
   through the UI at 1500/820/390 in both themes. Extend
   `verify-admin-data-entry.mjs` rather than writing a throwaway.
4. **§5 step 6** — screenshots and docs.

### Still open, and needing the owner rather than code

- **What is "Report/Dashboard Approval" approving?** Built as a gate before work
  starts ("Approved to go ahead"). If it is really the requester signing off on
  the finished report, it belongs below completion and means something different
  in reporting.
- **Do report requests need their own status words?** They share the defect list,
  so a delivered report has to be filed as **Deployed**, and the public board's
  four-stop track ends at *With Service Desk → Deployed* — it would draw a
  delivered report as stuck at Reported. Either this type gets its own short list
  (a second Metadata panel) or the board learns to draw its track differently.
  **This is the one thing that should be settled before requesters see report
  requests**, or the board will quietly lie to them.

## Where this stands, in ten lines (2026-08-05 — now history, see above)

**Done and on `main`:** the portal rename and the `TRACKER_LABEL` pass (§1), all
three approved artifacts — Add-a-ticket/Import/Export, the Metadata page, the
compacted Submit form (§2) — the whole §3 found-not-fixed list except one held
item (§3b), and **PR #10**, which had sat open since 2026-08-03 on a `plan.md`
conflict and closes both of the EasyVista gaps this file used to record as OPEN
(per-application catalog; attachments that admit failure). Client lint and build
clean, 274 server tests, 119 browser checks across three committed scripts in
`client/scripts/` (§0.3).

**Nothing is blocking. Phase 1 is ready to build.** Both questions that held it up
are answered (§4, "Open questions", items 1 and 4): the report-request field split
is confirmed, and analysts are admins with a type-scoped grant.

**Do these next, in this order:**
1. **Mockups first**, per `.claude/skills/artifact-mockup-first` — three of them,
   each approved before any product code: the submit-form report-request branch,
   the detail-modal analyst fields, and the throughput page. The throughput page is
   chart-shaped: load the `dataviz` skill before drawing, and follow the existing
   `access-tile` / `md-tile` idiom for its summary numbers.
2. **Then the schema**, all additive and all nullable: `assigned_to` (a user id,
   never a name), `completed_at` (with the Complete/Completed booleans DERIVED, not
   stored), `level_of_effort_id` as a new lookup — which is a 10th Metadata panel,
   now a one-line addition — plus `request_time_entries` and `request_assignments`.
   Both child tables have to arrive WITH the feature: neither can be reconstructed
   afterwards.
3. **Then the authorisation sweep** the analyst decision implies — the expensive
   half. See §4 open question 4.
4. **Then admin add/import/export parity** — a fourth type in the Add-a-ticket
   dialog's segmented control, new `IMPORT_COLUMN_TARGETS` and new
   `ADMIN_EXPORT_FIELDS` entries (the export field needs a `group`, or
   `test/exportFields.test.js` fails — which is the point).
5. Then §5 step 6 (screenshots + docs).

Optional housekeeping: set a catalog for Billing Center on the Access page (the card
works now), and decide what happens to `feat/admin-detail-modal-redesign` (see the
branch note below).

**Data housekeeping, all done 2026-08-05:** the status-history backfill applied (7
rows, idempotent, re-run reports 0); the verification's test ticket #84 deleted with
its 3 status events; submission #64 — which displayed as Billing Center but carried
no `application_id`, a historical gap, not an ongoing one — assigned properly, so
`unassignedTicketCount` is 0 and all 83 submissions are Billing Center.

**The catalog columns are in place.** `applications.easyvista_catalog_guid` /
`_code` exist on the hosted database — added by the production deploy's boot sync
minutes after the push, not by the migration script (see §3b). Verified afterwards:
only those two nullable columns were added, and nothing else moved. The Access
page's catalog card is live and a super user can set a catalog; both applications
read "not configured" today, which is correct — no `EASYVISTA_*` variables are set
at all, so there is no environment catalog for anything to inherit.
`npm run migrate:easyvista-catalog-columns` stays for any environment that has not
had the columns applied.

**Branch note.** Cleaned up 2026-08-05: 13 fully-merged branches deleted locally,
and GitHub had already removed their remotes (the repo auto-deletes a merged head
branch). Two remain, both needing a decision:

- ~~`dev`~~ **retired 2026-08-05** (owner's call). It was 24 commits behind `main`
  and **0 ahead** — zero dev-only commits, so nothing was lost. Its last tip was
  `e0b32ae`, recorded here in case anyone ever wants it back. `main` is the only
  working branch now; the note further down about work happening on `dev` is
  history.
- **`feat/admin-detail-modal-redesign`** is kept ON PURPOSE. Its *content* is on
  `main` (it merged as PR #3, which rewrote the SHAs), but the two commits
  themselves are not reachable from `main`, so deleting it needs `git branch -D`
  and would drop the only copy of them. Not worth doing without a reason.

## 0. Read this first

1. **`npm run dev` talks to hosted Supabase.** `server/.env` is `DB_MODE=hosted`,
   `DB_PROVIDER=postgres`, `DATABASE_URL=…@aws-0-us-west-2.pooler.supabase.com`.
   The owner has confirmed that data is entirely test data, the whole app is a
   prototype to be rebuilt by developers, and it is fine to read *and write* for
   verification and screenshots. `CLAUDE.md` has been corrected to say so.

   **But it is shared, so put back anything a check changes.** The metadata
   verification script writes, and an early version of it left a renamed status
   and a switched-off status behind in the hosted database; both were restored by
   hand. `client/scripts/verify-metadata-page.mjs` now ends by comparing a
   before/after fingerprint of every lookup value and failing if anything drifted.
   Any future script that writes should do the same.
2. **The portal is called "Service Requests Portal"** / "Submit · Track ·
   Resolve" (`client/src/components/bite-size/Layout.jsx:112`,
   `client/index.html:6`). It was briefly "Defects & Enhancements Portal" earlier
   the same day; that was replaced once §4 widened the scope, because a portal
   that also orders business cards and handles hotel reimbursements is not a
   defects portal. **Named for the destination deliberately** — the alternative
   was re-shooting 43+ desktop screenshots a second time when the other request
   types land. Do not narrow it again.
3. **The verification harness is committed now.** `client/scripts/` holds three
   Playwright scripts and one shared module; they are the record of what has been
   checked by eye and by measurement, and they run against the real app:
   - `verify-admin-data-entry.mjs` — the three §2c dialogs plus the redirect
     dialog. Read-only.
   - `verify-metadata-page.mjs` — the §2a page. Makes ONE reversible write and
     proves it undid it.
   - `verify-submit-form.mjs` — the §2b form. Read-only.
   - `lib/overflow-probe.mjs` — the per-container overflow probe every one of them
     uses. Read its header before changing it: each exclusion in it is there
     because a false positive buried a real finding.

   All three need the server on :4000 and Vite on :5173 already running, and take
   an optional `--shots <dir>`. If Vite has been running across a lot of edits its
   module graph can go stale and a page will fail to mount with a bogus "does not
   provide an export named …" — restart it rather than debugging the source.

## 1. Landed and verified (2026-08-05, first pass)

The tracker-rename groundwork. The second pass (§2, §3) finished the job — every
remaining user-visible "EasyVista" string in the admin client and the server now
routes through `TRACKER_LABEL` too.

- **Site rename** — brand + `<title>`. The title had been the Vite default
  `client` since scaffolding.
- **One display label for the downstream ticketing system.**
  `TRACKER_LABEL = 'Service Desk'` in **two** places that must change together:
  `client/src/constants/tracker.js` and `server/src/constants.js:13`.
  Deliberately a **display name only** — `easyvista_ticket_id`, the
  `easyvista-preview` route, `EASYVISTA_*` env vars and `server/src/easyvista.js`
  keep the vendor name, because renaming them is a migration with no user-facing
  gain.
- **Public-facing strings converted** — board lane + stage tile now
  "With Service Desk" (`constants/publicConstants.js:33`,
  `components/public/StatusBoardRow.jsx:15`); readiness rail says "get a ticket
  number you can track", was "an EV number"; "The BC team reviews it" → "The
  triage team" (`components/public/SubmitReadinessRail.jsx`).
- **Admin registries converted** — queue column, sort field and both filter
  labels in `constants/adminConstants.js`.
- **Excel import round-trip checked, not assumed.** Relabelling the export header
  is safe because `server/src/helpers/importUtils.js:38` matches on `aliases`,
  never on `label`. Added `service_desk_number` / `service_desk_ticket` /
  `service_desk_submitted_by` aliases so a sheet exported with the new header
  re-imports; confirmed `normalizeImportHeader("Service Desk Number")` →
  `service_desk_number`.
- `cd client && npm run lint` clean. Both public routes render with 0
  "EasyVista" and 2 "Service Desk" in visible text.
- **`playwright` added to `client/devDependencies`** for verification and the
  screenshot harness. Browsers already cached in `%LOCALAPPDATA%\ms-playwright`.

## 2. BUILT AND VERIFIED (2026-08-05, second pass)

All three approved artifacts are built. The descriptions below are kept as the
record of what was agreed; what actually shipped, and where it departed from the
mockup, is noted under each. Verified by
`client/scripts/verify-admin-data-entry.mjs` (2c), `verify-metadata-page.mjs` (2a)
and `verify-submit-form.mjs` (2b) — see §0.3.

### 2a. Metadata page redesign — v5
`https://claude.ai/code/artifact/d54d37c6-97ac-4913-b387-0a179fb13892`

Target: `client/src/pages/AdminMetadataPage.jsx` (rewrite),
`client/src/index.css` (+ `md-` namespace, transplanted from the artifact),
`client/src/constants/adminConstants.js`, `client/src/hooks/useMetaManagement.js`.

- **Usage counts are the spine of it.** Each value shows how many tickets hold
  it; switching off a value that is in use states the consequence inline
  ("25 tickets use Submitted. They keep it — switching off only stops it being
  offered on new tickets"). Needs an **additive `usageCount`** on
  `GET /api/admin/meta/options` (`server/src/routes/metaRoutes.js:46`), computed
  as **one GROUP BY per category** over `LOOKUP_TABLES[].submissionIdColumn`
  (`server/src/constants.js`) — not a per-row subquery, or it is 45 queries.
- One switch replaces the Enabled **and** Disabled checkbox pair.
- **No per-row Save.** A rename commits on Enter/blur, a switch saves
  immediately — the Access page's contract.
- **Fix while there (real bug):** `useMetaManagement.js:164-170` resets
  `metaDraftNames` whenever `activeMetaItems` changes, so saving any row
  **discards an unsaved rename typed into another row**. Immediate-save makes it
  fire far more often, so this must be fixed as part of the build.
- **Add a 9th panel: Occurrence Timeframes.** It feeds the Impact tab's Time
  Frame dropdown (`components/admin/detail/DetailImpactSection.jsx:97`,
  `hooks/useAdminMeta.js:63`) and has a full `LOOKUP_TABLES` entry, but is absent
  from `ADMIN_META_CATEGORIES` — so nobody can manage it.
- Skeleton / error / empty states, which the page has none of.
- Mobile: rail becomes a **dropdown** (not a horizontal scroller — explicitly
  requested); each value becomes an 81px card, count + switch + order on one line.
- Out of scope, named: clicking a usage count through to a filtered queue (the
  queue hydrates filters from localStorage only, `utils/filterUtils.js:87`);
  deleting lookup values (no DELETE endpoint exists); a socket event for lookup
  changes; cleaning the junk `orm_source_1772230352163_u` value in the read-only
  Submission Sources list.

**Shipped.** `usageCount` is additive on every row of
`GET /api/admin/meta/options`, computed by `countSubmissionsByLookup`
(`server/src/helpers/lookups.js`) as **two queries per category** — the values,
plus one GROUP BY over the submissions referencing them. Nine lists, 45 values, 18
queries; never one COUNT per value. A failed count returns an empty Map rather
than failing the page, so counts are the only thing lost.

Occurrence Timeframes is the 9th panel. `ADMIN_META_CATEGORIES` now also carries
`feeds` (what each list actually drives, shown under the list title) and
`readOnly`, so adding a list is one registry entry plus its `LOOKUP_TABLES` row.

The draft-name bug is fixed by removing the reseeding effect entirely rather than
narrowing it: `metaDraftNames` now holds **only** names the admin has typed, keyed
`category:id`, so there is nothing to reseed and no way for one row's save to
clobber another's draft.

**Two departures from the mockup, both deliberate:**
- The protected `Retired` status is **shown**, marked "Protected", with its
  controls disabled — the old page filtered the row out of the list entirely. The
  mockup's treatment is better: a value that exists should be visible.
- **A refused save keeps the table.** The mockup has one error state; a first
  build wired `adminMetaError` to it unconditionally, so a rename rejected as a
  duplicate replaced the whole list with "This list didn't load" and took the
  admin's typed text with it. A failed *load* still renders that state (there is
  nothing to draw); a failed *save* is a banner above the rows. Found by the
  verification script provoking a 409, not by reading the code.

### 2b. Submit form compaction
`https://claude.ai/code/artifact/58f88812-d2db-4eaf-92c4-b1e527a4575c`

Measured **1626px → 1209px desktop (−26%)**, 11% on a phone, with field and
input counts identical in both panes (10 fields, 12 inputs) — nothing removed.

Cause, verified against git: the pre-rebuild form was **one card with a
two-column grid** (`.bs-grid two`); the rebuild made it **six stacked cards,
mostly one field per row**. Same fields, far more page.

Changes: six cards → four (type picker joins "Your request"; workaround joins
"What happened"); drop zone laid out as a row (169px → 86px); `.rs-sub`
reference-numbers box flattened, heading kept; reporter paired with the one-line
summary via `.rs-row--who`; card padding 16/18 → 14/16.
**Textareas deliberately untouched** — they carry the actual report and their
height comes from `rows` in the JSX anyway.

**Shipped, and measured shorter than the review predicted:** the form column is
**1106px** for a signed-in reporter on a desktop, against the review's 1209px,
because "Filing as" replaces a name field and takes its row with it. 4 cards for a
defect, 3 for an enhancement. The counts are asserted rather than eyeballed — 10
fields and 11 controls, where 11 is the review's 12 minus the reporter's input; the
drop zone measures 86px against the old 169px; the textareas are still `rows={5}`
and `rows={3}`.

One thing removed that the review did not mention: `application_name` is no longer
in the form's state at all. It was only there to hold a hardcoded `'Billing
Center'`, and the form has no application picker, so it is now derived from the
viewer at send time (see §3's genericization note).

### 2c. Admin data entry — Add a ticket, Import, Export
`https://claude.ai/code/artifact/d5f3f12b-f9d0-47e8-8466-39672584afce`

**Add a ticket** replaces both `BackdatedTicketModal` and `CleanupTaskModal`, so
the `New ticket ▾` menu (`components/admin/AdminHeader.jsx:118`) collapses from
two entries to one `Add a ticket…`.
- Mode: **New ticket (default)** / Historical ticket. Fields are *absent* in the
  wrong mode, not disabled.
- Type: **Defect / Enhancement / Cleanup**. Cleanup carries its own
  `Tag it as` → Internal only / Defect / Enhancement, because a cleanup task is a
  flag plus a tag in the data, not a peer of the other two. Gating is one
  computed `data-branch` attribute.
- Internal-only cleanup: Summary + Description, **hand-off never offered**.
  Tagged cleanup: that branch's fields + "Send it to the Service Desk once it's
  created", which makes the branch's required fields mandatory
  (`cleanupRequiresEasyVistaFields` in `hooks/useCleanupModal.js`).
- The hand-off checkbox is **New-mode only** — a historical ticket already
  records its Service Desk number, and offering to send it again could raise a
  duplicate downstream.
- `created_via`: New → **`admin_manual`** (an existing lookup with 0 uses that
  fits exactly). Historical → **`admin_backdated`**.
- Owner confirmed: an admin-added New ticket behaves **exactly** like a
  rep-submitted one — status New, on the board under the usual visibility rules,
  sendable to the Service Desk normally.
- New mode mirrors the rep form, which means genuinely **adding** four fields the
  backdated modal never had: screen title, when it happened, what happened,
  steps to reproduce, plus the reference numbers.

**Import**: three real steps. "18 of 20 columns matched by name", with only the
columns needing a decision surfaced and the rest behind "Review all 20 mappings";
same for unknown status values; a **preview of the first rows before anything is
written**; recent imports demoted to a footer. Result step: 47 imported / 3
skipped with the reason per row.

**Export**: leads with **"83 tickets match your current filters"** — the fact the
old dialog never stated. All **48** fields (verified programmatically against
`server/src/helpers/export.js` — every field grouped exactly once) in 7 groups,
with presets, and a button stating the shape: "Download 83 rows × 10 columns",
disabled at zero columns.

### What shipped for 2c

`AddTicketModal` + `useAddTicketModal` replace `BackdatedTicketModal`,
`CleanupTaskModal`, `useBackdatedModal`, `useCleanupModal`, `defaultBackdatedForm`
and `defaultCleanupForm` — all deleted. Field visibility is CSS driven by three
data attributes on `.at-body` (`data-mode`, `data-type`, `data-branch`), so a
cleanup task tagged as a defect gets the defect branch's fields without a rule per
type/tag pair. The `at-`, `xl-` and `md-` CSS is lifted from the artifacts
verbatim into `index.css`, so the built dialogs and the mockups are the same CSS.

**Four departures from the mockups, all deliberate:**
1. **The header is a plain `Add a ticket…` button, not a one-item menu.** A menu
   whose only job is to reveal a single item costs a click; §4's fourth type lands
   as a fourth segment *inside* the dialog, so the menu would never regrow.
2. **`Impact details` was added to the enhancement branch.** The mockup omits it,
   but `submissionService.js:1508` refuses an enhancement hand-off without it — so
   a dialog that never asked would have offered a Send that always failed. It is
   required only when the hand-off checkbox is actually ticked.
3. **Export field grouping lives server-side**, as a `group` on each field
   definition plus `EXPORT_FIELD_GROUPS` in `helpers/export.js`, exposed on
   `/export-fields`. A client-side group registry would have let a newly added
   export field vanish from the dialog. `test/exportFields.test.js` fails if a
   field is ungrouped, double-grouped, or grouped under a key that is not a field.
4. **"What's on screen" is derived from the admin's actual visible columns**, via a
   new `exportKey` on every `ADMIN_TABLE_COLUMNS` entry, rather than the mockup's
   fixed 8 keys — and it reproduces the mockup's 8 exactly for the default view.
   The export dialog's default selection is that same set; it was all 48 before,
   which is a spreadsheet nobody asked for, and `Everything (48)` is one click.

**Screenshots are in Add-a-ticket — a fifth departure, on the owner's call.** The
mockup has no file picker; a first build followed it and left the capability to the
detail modal one step later. The owner said no: it goes back in. It is the rep
form's own `ScreenshotDropZone`, reused rather than rebuilt, so drag, browse and
**paste** all work and the thumbnails/remove come for free — and it is offered on
**every** branch, with the chip reading "strongly encouraged" for a defect and
"optional" otherwise, mirroring the rep form.

Reusing it also fixed a lie: the old cleanup dialog advertised
`accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"` for enhancements, but
`middleware/upload.js`'s `imageFileFilter` accepts **images only** — a rep picking
a PDF got a 400 after filling in the form. The drop zone mirrors the server's real
allow-list and says so: "PNG, JPG, GIF, WEBP, BMP or HEIC · up to 10 MB each".

Upload order matters and is deliberate: create → impact figures → **attachments** →
hand-off. The hand-off reads the ticket's own attachments to decide which files
travel with it, so uploading after it would hand off a ticket with nothing on it. An
upload that fails does not fail the ticket — the ticket is already saved — so it is
reported in the success notice ("The screenshot did not upload: …") rather than
swallowed.

Verified end to end against the hosted database, not just by the drop zone
rendering: a defect filed through the dialog with one attached PNG came back with
`attachments: 1` / `verify-evidence.png`, and the notice read "Ticket #84 created
successfully. 1 screenshot attached." **That test left submission #84 behind** —
attachment deleted, ticket retired and made non-public, summary "VERIFY screenshot
upload — safe to delete". There is no submission DELETE endpoint, so removing the
row is a manual job.

**A latent bug found while building it, now fixed and pinned:**
- **Two exported column headers had never round-tripped.** Import matches on
  aliases, and "Reported Date" (`created_at`) and "Request Details" (`request`)
  normalised to `reported_date` / `request_details`, neither of which was an alias
  — so re-importing a sheet exported by this portal silently dropped both columns.
  A third, `easyvista_submitted_by`, would have broken the same way as soon as its
  header was relabelled. All three aliases added (and `submitted_to_ev_by`, so a
  sheet exported before the rename still re-imports).

  Two tests in `test/exportFields.test.js` keep it that way: one checks every
  export field's normalised label against its target's aliases, and one builds a
  header row out of the real export labels, runs it through the real
  `suggestImportMappings`, and fails if any column comes back unmapped — so it
  would catch a break in the matching itself, not only a missing alias.
- The analyze endpoint gained `sampleRows` and `unknownStatusCounts` (additive) to
  feed the pre-write preview and "appears in 6 rows". Cells are clipped to 200
  chars and only 3 rows are echoed — a preview only has to be recognisable.

## 3. Fixed in the second pass (2026-08-05)

- **Hardcoded application lists — gone.** `ImportModal` reads `dynamicApplications`
  for the "application for rows that don't name one" default, so an application
  added on the Metadata page appears there. `CleanupTaskModal`'s duplicate
  read-only "Application Name" died with the file.
- **Redirect dialog padding — fixed, and it was not the sticky bar.**
  `.dm-modal .bs-modal-body { padding: 0; display: grid }` is a **descendant**
  selector, and the detail modal's footer renders two more modals *inside its own
  DOM* (the redirect dialog and the EasyVista confirm, both in
  `detail/DetailActions.jsx`). Both inherited the outer modal's zeroed padding and
  its three-row grid. The fix is one character — `>` instead of a space — plus a
  committed regression check, because "a nested modal inherits the outer one's
  layout overrides" is a class of bug, not a one-off.
- **Clipped-overflow sweep — done, and it found two.** The probe is now
  `client/scripts/lib/overflow-probe.mjs`, used by all three verification scripts
  at 1500/820/390px in both themes. It found:
  - the **admin queue's phone cards** overflowing their container by 15px, because
    the value side of each label/value row could not shrink below its widest
    nowrap chip. Below 560px the label now sits above its value and takes the full
    card width (and `align-items: flex-start`, not `stretch`, or a bare checkbox
    inflates to the card's width).
  - both **queue banners** (`NewSubmissionsAlert`, `WorkaroundRequestsAlert`)
    overflowing on a phone: a never-shrinking, never-wrapping action button on a
    row with no `flex-wrap`. Both wrap now.

  Read the probe's header before changing it. Every exclusion in it — self-scrolling
  form controls, screen-reader-only subtrees, deliberate negative-margin full-bleed
  (which has to propagate up, or the finding just moves one level up the tree each
  time it is excused) — is there because a false positive buried a real finding.
- **Server-side strings** now route through `TRACKER_LABEL`:
  `submissionService.js` (the two API errors and all three status-history writers),
  `easyvista.js` (the two thrown errors that surface in the UI), `helpers/export.js`
  (the two spreadsheet headers).
- **Admin client strings** now route through `TRACKER_LABEL` / `TRACKER_LABEL_THE`
  across all 12 files §3 listed. Comments that describe the *integration* keep the
  vendor name on purpose — it is still EasyVista; only what a user reads changed.
- **"Billing Center" as data — gone from the client.** `RepSubmitPage` derives the
  application from the viewer (`homeApplicationId` → their AD-group application,
  else most-filed, else the portal's first active one) and dropped
  `application_name` from form state entirely, since the form has no picker. The h1
  is `Report a {name} issue`, falling back to `Report an issue`. The confirmation
  echoes the application actually filed against. `mappers.js` no longer invents a
  fallback — a wrong guess there would retarget the ticket on the next save. The
  server's own `'Billing Center'` fallback in `createAdminSubmission` remains, as
  the last-resort default when a payload names no application.

## 3b. Still open

- ~~Status-history backfill~~ **APPLIED 2026-08-05.** Exactly the 7 rows this file
  predicted (events 206, 207, 220, 221, 257, 258, 260), in one transaction. The
  re-run reports `0 carry the vendor name`, so it is idempotent, and the timeline
  still renders — every reader parses these by prefix (`utils/formatUtils.js`,
  `helpers/timeline.js`, `routes/publicRoutes.js`), never by the vendor name.
  `npm run backfill:tracker-history` stays for any environment that has not had it.
- **Five `401 Unauthorized` fetches** on the public routes when not signed in.
  Pre-existing, looks like the anonymous viewer probe, not traced.
- **Pushing to `main` auto-migrates the shared database.** Worth knowing before the
  next schema change: the deploy boots with `IS_PRODUCTION` true and runs
  `db.migrate()` → `sync({ alter: true })` against the same hosted Supabase the
  local `npm run dev` uses (`src/index.js:93`). The catalog columns from PR #10 were
  added that way, silently, minutes after the push — before anyone ran the explicit
  migration script. Local runs are safe: the sync is guarded to production and
  `NODE_ENV` is unset locally. The schema was checked afterwards and the broad alter
  changed nothing else — money columns are still `NUMERIC`, `updated_at` still
  `TEXT`. But a riskier column change would land the same way, which is exactly what
  the money-columns note warns about.
- **The screenshot harness still does not exist.** `client/scripts/` holds the
  three *verification* scripts (which can write PNGs with `--shots`) but not the
  manifest-driven capture the docs need — see §5 step 4.

## 4. NEW SCOPE — report requests for analysts (owner, 2026-08-05)

### What was asked for
Extend the portal past defects/enhancements/cleanups to **report requests**: a rep
requests a report, it lands in a queue for that application's **analysts**, who
set status, estimated completion, and level of effort. Admins can add report
requests from the admin side too — **new and historical, plus import and export**.
Requests can be **assigned** to an admin/analyst, and the portal should
**report on throughput** — how many reports a given analyst completed, by
timeframe.

### This is not one request type — it is a service catalogue

The owner supplied **67 fields** across two messages. They do not describe a
report request. They describe what is almost certainly an existing shared-services
intake **spreadsheet**, covering many unrelated request types in one flat sheet.

> **Correction (2026-08-05): there is no spreadsheet to go and read.** The owner has
> only **a sample of the column names** — not the file, and not example rows. Every
> earlier suggestion in this file to "settle it from the source spreadsheet" was
> chasing something that does not exist; those have been struck. What follows about
> the SHAPE still holds, because it is inferred from the field names themselves. What
> does not hold is any assumption that the list is **complete**. See the note under
> "Open questions" item 1 for what to do instead.
The give-aways are unmistakable: `Business Card Count`, `Designations`,
`Brand Logo`, `Numbers (Work,Cell,Fax)`, `Toner Link`,
`Type of Sharepoint request`, `Check-In Date` / `Check-Out-Date`, `Recipient(s)`.
Those cannot live on the same form as `List of Measures & Data Sources`.

Best reading — **at least nine candidate request types**:

| Candidate type | Fields that belong to it |
|---|---|
| **Report / dashboard** | Request Type · List Needed Data · New Dashboard Request? · List of Measures & Data Sources · How often will this be used · Primary Contact for dashboard · List Changes Requested · Report/Dashboard Approval · What's not working, missing, or needed to change? |
| **Project / change** | Initiative/Project Name · Project Lead · Project Sponsor · Team Leading Project · Team Impacted · Strategic Alignment · Strategic Focus · Enterprise Scorecard Alignment · Type of Change · Training Needed? · EPPMC Needed? · Ops Support Needed? · Added To Project Board? · Risks · Assumptions · Ops Liason/Project Owner |
| **Business cards / print** | Mailing Address · Designations · Numbers (Work,Cell,Fax) · Cell Phone · Brand Logo · Business Card Count |
| **SharePoint** | Type of Sharepoint request · SharePoint Site URL · SharePoint Approval |
| **Live Letters** | Letter Number · Live Letters Approval |
| **RPA** | RPA Approval |
| **LiveWire** | LiveWire Approval |
| **Card sent to a customer** (owner: "in claims, adjusters can request to have a card sent to a customer") | Congrats Card · Gift Card Information · Recipient(s) · Mailing Address · Amount |
| **Business cards order** | Business Card Count · Designations · Numbers (Work,Cell,Fax) · Cell Phone · Brand Logo · Mailing Address |
| **Travel / expense reimbursement** (owner: "employee needs to request reimbursement for a hotel") | Check-In Date · Check-Out-Date · Amount · Mailing Address |
| **Supplies** | Toner Link |
| **Unplaced** | Claims or CCC? — probably which area the requester belongs to, so likely a shared field rather than a type's own |

Genuinely shared across every type: Request Created Date · Requestor · Email
address · Department · Title · Description · Status · Priority · Assigned To ·
Jira Item Number · Requested Implementation Date · Complete Date · Level Of
Effort · Duration.

**Confirmed by the owner (2026-08-05):** "this is just ALL available fields from
different types of reports… some show up in certain cases and others do not." So
the flat list is the *union* of every type's fields, exactly as the table above
reads it. That settles the premise — the work is to recover the per-type subsets,
not to build one form.

Note that `Mailing Address`, `Amount` and `Recipient(s)` each appear in **more
than one** type. So this is not "each type owns private fields": it is a **shared
field library** from which each type selects a subset. That is a materially
different (and simpler) model than one schema per type, and it explains how the
spreadsheet grew — a new column was added whenever a new request type needed a
field, and every other type inherited a blank.

### Problems in the list to settle before modelling anything

- **Three fields for one fact:** `Complete`, `Completed`, and `Complete Date`.
  Completion should be **one timestamp**, with the boolean *derived*.
- **`Created Month` is derived** from Request Created Date. Storing it invites
  the two to disagree; compute it when reporting.
- **`Level Of Effort` vs `Complexity` vs `Successful Effort Indication`** — three
  effort-ish fields. Which drives the throughput reporting?
- **`What Dept is this for` vs `Department`** — same field twice.
- **`Send to Trevor` hardcodes a person into the workflow.** Whatever this
  routing step is, it must be a role or a queue; a colleague's name in a schema
  breaks the day they change teams. (Same class as the STOP rule against joining
  on names instead of ids.)
- **`Duration`** — analyst hours logged, or elapsed calendar time? It is the basis
  of the throughput reporting, so this changes the data model.
- **Five separate `* Approval` fields** are a per-type **checklist**, not five
  booleans on every row of every type.

### Architectural recommendation

Do **not** add 67 columns to `submissions`, and do not model this as "defects,
enhancements, cleanups, and report requests". The honest shape is a
**request-type registry with per-type field schemas** — an internal service
catalogue where each type declares its own fields, required-before-submit rules,
approvals, queue and assignees. Defect/enhancement/cleanup become three types
among many rather than the hardcoded spine of the app.

That is a **larger change than everything in §2 combined** and it invalidates
parts of the current model. It should be planned as its own project, with its own
mockups, not bolted on. Load-bearing pieces that already exist and should be
reused: per-application roles (`user_application_roles`,
`db/models/index.js:354`), `submission_routings` for queue hand-off, and the
lookup registry the Metadata page manages (new per-type lookups — Level of
Effort, Request Type, Department — are just new panels there).

New data the asks require that does not exist yet:
- **`assigned_to` as a user id**, never a name string, so a rename cannot
  silently unlink work.
- **`completed_at`**, plus assignee history if reassignment must be attributable.
  Throughput cannot be computed retroactively — add it before it is needed.
- An **analyst throughput surface** (completions per assignee per timeframe) is a
  new page, not a field.
- Any money figure (`Amount`) is **`DECIMAL`, never float** — see the float bug
  recorded below, which silently corrupted hosted data.

### PHASE 1 — report / dashboard requests only (owner's chosen starting point)

Owner's direction (2026-08-05): *"maybe we don't build all of it right now, but
put it into plans for the future… whatever we do need to do or can already build,
we can have a start on it, maybe start with analytics/data report requests."*

So: build **one** new request type now — report/dashboard requests — and leave the
other eight in §4 as recorded future scope. The rest of this section is Phase 1.

**Why this type first, and why it fits.** A report request has the same shape the
portal already models: a reporter fills in what they need, a triager takes it,
works it, and closes it. It needs **no registry** and **no new table** — it is a
third `type` alongside defect and enhancement, reusing statuses, applications,
per-application access, routing, the public board, import/export and the detail
modal. Business cards and hotel reimbursements do *not* fit that shape, which is
the other reason to start here.

**The field split falls out of the existing reporter/triager divide:**

| Filled by the requester (submit form) | Filled by the analyst (detail modal) |
|---|---|
| Title · Description · What's not working, missing, or needed to change? · List Needed Data · New Dashboard Request? · List of Measures & Data Sources · How often will this be used · Primary Contact for dashboard · List Changes Requested · Requested Implementation Date · Department · Requestor · Email address | Status · Assigned To · Level Of Effort · Duration · Complete Date · Priority · Report/Dashboard Approval · Jira Item Number |

`List Changes Requested` is only asked when it is a change to an existing report;
`List of Measures & Data Sources` and `Primary Contact for dashboard` only when
`New Dashboard Request?` is yes. That is the same conditional-branch pattern the
Defect/Enhancement toggle already uses on the submit form and in §2c's
Add-a-ticket dialog — follow it rather than inventing a second mechanism.

**Additive schema, all nullable, all useful even if the registry never happens:**
- `assigned_to` — **user id**, FK to `users`, never a name string.
- `completed_at` — timestamp. `Complete` / `Completed` booleans are **derived**
  from it, never stored (the source list had three fields for this one fact).
- `level_of_effort_id` — a **new lookup table**, so it becomes a new panel on the
  Metadata page. Build §2a so a 10th panel is a one-line addition.
- **`Duration` is analyst hours logged** (owner, 2026-08-05) — **not** a column.
  Hours accumulate across sittings and across people, so a single number cannot
  record them without being overwritten. It needs a child table:

  ```
  request_time_entries
    submission_id  FK -> submissions
    user_id        FK -> users        who logged it
    hours          DECIMAL(6,2)      never float (see the float bug below)
    worked_on      DATE              the day worked, not the day entered
    note           TEXT NULL
  ```

  `Duration` on the request is then `SUM(hours)` — derived, never stored, so it
  cannot drift from its entries. This also makes "how long did this take" and
  "who actually did the work" answerable separately, which matters below.
- Report-request-only text fields. Since only one new type is arriving, plain
  nullable columns are honest and simpler than a JSON blob or an EAV table. If
  and when types 3–9 arrive, *that* is the moment to generalise — and the
  §4 registry note is the plan for it.

**Assignment and throughput.**
- Assignable people come from `user_application_roles`
  (`db/models/index.js:354`) — whoever holds a grant on that application. Do not
  invent a parallel analyst list.
- **Reassignment is required** (owner, 2026-08-05), so the current assignee cannot
  be the only record of who worked a request. Assignment gets its own history:

  ```
  request_assignments
    submission_id  FK -> submissions
    assigned_to    FK -> users
    assigned_by    FK -> users
    assigned_at    TIMESTAMP
  ```

  `assigned_to` on the request stays as the *current* holder (cheap to query and
  to index for "my queue"); the table is the audit trail. This cannot be
  reconstructed after the fact — add it with the feature, not later.

- **Throughput credit: use the time log, not the assignee.** The obvious
  implementation of "how many reports has this analyst completed" counts
  `completed_at` grouped by `assigned_to` — but with reassignment that credits
  whoever happened to hold the ticket when it closed, and silently erases the
  person who did most of the work. Because `Duration` is already a per-person time
  log, the honest metrics fall out of it directly:
  - **hours per analyst per timeframe** — sum `request_time_entries.hours`
  - **requests completed per analyst** — distinct requests they logged hours on
    that reached `completed_at` in the window
  - **requests closed per analyst** — grouped by `assigned_to` at completion, kept
    as a *separate* number, since "closed it" and "did it" are different facts and
    conflating them is how throughput reporting becomes untrustworthy.
- The throughput view is a **new page**, and it is chart-shaped: load the
  `dataviz` skill before drawing anything, and follow the existing `access-tile`
  / `md-tile` idiom for the summary numbers.
- Emit live updates on assignment and on time entries the same way every other
  mutation does — a queue showing "assigned to me" that needs a refresh is a stub.

**Also required for parity with the other types** (the owner asked for all of it):
admin-side add (new *and* historical) via §2c's dialog — a fourth Type in that
segmented control — plus Excel import and export coverage, which means new
`IMPORT_COLUMN_TARGETS` entries and new `ADMIN_EXPORT_FIELDS` entries. §2c should
be built with a fourth type in mind so this is an extension, not a rewrite.

**Mockup first.** Per `.claude/skills/artifact-mockup-first`, the new submit-form
branch, the detail-modal fields and the throughput page each need an approved
Artifact before product code. **All three were approved on 2026-08-06** — links at
the top of this handoff. They are the build contract; anything that departs from
them is a deviation to raise, not a detail to decide.

### Decisions made while building, that the rest of Phase 1 must honour

- **Six of the requester's fields reuse existing columns.** Title is
  `summary_of_issue`, Description is `what_happened_exact_details` (which the
  import layer already labels "Description"), "what's not working" is `request`,
  Requested Implementation Date is `desired_completion_date`, and Requestor /
  Email are the existing reporter mechanism. A second column for any of them
  would be the same defect the source list has with Complete / Completed /
  Complete Date.
- **A change request asks which report, and asks it FIRST** — added by the owner,
  `existing_report_link`. It takes a link or, where there is none, wherever the
  requester opens it from. **"What's not working" is change-only**: nothing is
  broken about a report that does not exist yet.
- **Required is deliberately minimal** — summary, description, and the one field
  the chosen branch cannot do without (plus the link on a change). The field list
  is a SAMPLE: somebody blocked by a question they cannot answer types anything to
  get past it, and then the field is worse than absent.
- **"How often will this be used" is a fixed six-value scale held as a module
  constant**, mirrored in `REPORT_USAGE_FREQUENCIES` (server) and
  `USAGE_FREQUENCIES` (client) — **keep the two in step**; the server refuses
  anything else. Not a lookup: it is not a database-managed entity, and free text
  would give "Daily", "daily" and "every day" as three answers.
- **Department is plain text**, not a lookup — there is no department list to
  seed, and a required select over an empty lookup blocks every submission.
- **The approver is a typed NAME** (`approved_by_name`), because they are usually
  not a portal user. `approval_recorded_by` is a user id the server fills in;
  never accept it from a client. This is a deliberate, narrow exception to the
  STOP rule against storing a name where an id exists — there is no id for an
  external approver, and the accountability is the recorder.
- **Hours are counted by `worked_on`, not by when the entry was typed.** That is
  why the child table stores both dates.
- **Chart tokens are validated, not chosen.** `--chart-1` / `--chart-2` in
  `index.css`, one pair per theme, deliberately NOT the `--status-*` colours (a
  status colour on a series makes a badge colour mean two things). Light
  `#2563eb,#eb6834` on `#ffffff` and dark `#3b82f6,#e2622f` on `#1b2638` both pass
  all six dataviz checks. **The dark steps are not the light ones brightened** —
  the portal's dark primary `#60a5fa` has OKLCH L 0.714 and fails the dark
  lightness band. Re-run the validator before changing either.
- **Approval evidence never touches `/uploads`.** That path is `express.static`
  with no authentication (`src/index.js:49`) — fine for screenshots, which are
  public-board content, and not for an approval email. Documents go through
  `approvalUpload` (extension AND mime checked together, `.svg`/`.html`/`.xml`
  refused) and come back only through
  `GET /api/admin/attachments/:id/file`, which re-checks the caller's grant and
  sends `Content-Disposition: attachment`.

### Open questions for the owner

**Phase 1 is unblocked.** Questions 1 and 4 are answered; 2, 3 and 5 belong to
types 3–9 and do not block the report-request build.

1. ~~The authoritative per-type field map.~~ **ANSWERED for report requests
   (owner, 2026-08-05).** The inferred split above — 13 requester fields, 8 analyst
   fields, and both conditional rules — was confirmed on all three counts: right
   set, right requester/analyst split, right conditions.

   **Confirmed "for now", and that qualifier is load-bearing.** It means this is a
   working spec, not a settled one, so the build should assume the field list will
   move. Two consequences, both of which the plan already leans toward and should
   now stick to:
   - **Plain nullable columns, no JSON blob and no EAV table.** Adding a field must
     stay a one-line migration plus a form control. An EAV design buys flexibility
     nobody has asked for and makes every read worse.
   - **Do not generalise into the §4 request-type registry yet.** One new type does
     not justify it. When types 3–9 actually arrive, that is the moment — and the
     registry note in §4 is the plan for it.

   **There is no document that can confirm this, now or later.** The owner has only
   a sample of the column names — not the source file, not example rows. So the
   "for now" above is not a temporary state waiting on paperwork: it is the
   permanent condition of this spec. Two things follow.

   - **Completeness is unknown and unknowable up front.** A sample means fields may
     be missing outright, not just mis-assigned. Do not build anything that assumes
     the list is closed — in particular, do not make a missing field a data-loss
     event. `Description` is the catch-all a requester can put anything into, and it
     should stay generously sized for exactly that reason.
   - **The list gets settled by USE, not by review.** Ship the form to one or two
     analysts, watch what they actually receive, and add what is missing. That loop
     is only cheap if adding a field stays a one-line migration plus a form control
     — which is the real argument for plain nullable columns, stronger than the
     "for now" alone.

   The same applies to open question 2 (the full list of request types): it cannot
   be answered from a document either, so types 3–9 will be discovered the same way.
2. **The full list of request types.** Nine were inferred from the field names;
   the owner named claims cards, hotel reimbursement and business cards
   explicitly. There are likely types whose fields did not make the list — and
   since the 67 names are a SAMPLE, likely types whose fields are not in it at all.
   No document settles this; ask the people who run the intake today. Blocks types
   3–9, not Phase 1.
3. **What are `Claims or CCC?`, and what is `Send to Trevor`?** The latter is a
   person's name doing a workflow's job and must become a role or a queue.
4. ~~Are analysts a new role?~~ **ANSWERED (owner, 2026-08-05): no.** "Analysts are
   basically admins, they would just be configured to certain types of requests."
   So the role ladder stays `viewer` → `admin` (+ the super-user flag) and gains a
   **type dimension on the grant**, not a fourth role.

   **The shape that follows.** `user_application_roles` is today
   `(user_id, application_id, role)`. It gains a nullable type column, where NULL
   means "every type" — so every grant that exists now keeps working untouched, and
   an analyst is simply an admin grant narrowed to one type. One table, additive,
   no migration of existing rows. A separate `user_request_type_roles` table was
   the alternative and is worse: two places to ask the same question.

   **And this is the expensive part of Phase 1, not the schema.** Every check that
   today asks *"may this person administer this application?"* becomes *"…for this
   type?"* — `canMutateApplication` and each of its call sites: the queue scope, the
   detail modal, redirect, the Service Desk send, bulk actions, and the create path.
   That is the work to estimate. The column is an afternoon; the authorisation
   sweep is not, and it is the half where a miss means someone editing a ticket
   they should not see. It also wants its own tests — the existing per-application
   ones (`test/access.test.js`, `test/adminReadScope.test.js`) are the template.
5. ~~What is the portal called?~~ **Answered** — "Service Requests Portal", see
   §0.2. No longer blocks the docs pass.
6. **Does §2 still ship first?** Recommended **yes** — those three are approved,
   self-contained, and they establish the design idiom every new request form
   should follow. Building §4 first would mean designing forms with no settled
   idiom and re-doing them.
7. **Scale check.** Nine-plus request types, each with its own form, queue,
   approvals and assignees, plus throughput reporting, is a bigger build than
   everything this repo currently contains. Worth deciding explicitly whether the
   prototype should grow into it, or whether this is the point where the
   "developers rebuild it properly" plan takes over — the owner has said a rebuild
   is expected.

## 5. Build order

Owner has scoped this: build §2 and Phase 1 of §4 now; types 3–9 are recorded
future scope, not current work.

~~1. Build §2's three approved artifacts.~~ **Done** — see §2. Both extension
   points Phase 1 needs are in place: the Add-a-ticket dialog's type is one
   segmented control plus a computed `data-branch`, so a fourth type is a segment
   and a branch; and a 10th metadata panel is one `ADMIN_META_CATEGORIES` entry
   plus its `LOOKUP_TABLES` row.

~~2. Clear §3.~~ **Done except the backfill apply** — see §3 and §3b.

~~3. Verify.~~ **Done for everything §2 and §3 touched.** Client lint and build
   clean, 258 server tests (8 new in `test/exportFields.test.js`), and **119
   browser checks** across the three committed scripts (76 + 25 + 18) at
   1500/820/390px in both themes, with per-container overflow. Plus one end-to-end
   write against the hosted database to prove the screenshot upload really lands
   (see 2c) — which left submission #84 behind, retired.

   What is NOT verified in a browser: the detail modal's other tabs, the public
   board and the Access page — none were changed structurally, but the
   EasyVista→Service Desk string pass touched the detail modal's labels, so those
   are worth a look.

~~4. Settle the remaining Phase 1 questions.~~ **All answered 2026-08-05.**
   `Duration` (analyst hours, a child table) and reassignment (its own history
   table) were already settled; the report-request field split and the analyst role
   were answered by the owner. The backfill and the schema change are applied. See
   the top of this handoff for the ordered build list.
5. **Build Phase 1** — mockups first (submit-form branch, detail-modal fields,
   throughput page), then the additive schema, then admin add/import/export
   parity.
6. **Only then screenshots and docs.** The manifest
   (`docs/handoff/screenshot-manifest.json`) needs *extending*, not just
   re-shooting, and more of it than before: `18-admin-backdated-modal.png` becomes
   several (New vs Historical × Defect/Enhancement/Cleanup, then × report request),
   the import modal gains its three steps and its result, the export dialog is a
   new shot, the metadata page gains its dropdown/mobile states, the submit form's
   heights all changed, and report requests add whole sections to
   `docs/handoff/README.md` and `README.md`. The portal name is settled (§0.2), so
   this is no longer blocked. **Write the capture script this time** — the three
   verification scripts in `client/scripts/` already take `--shots <dir>` and share
   the login/viewport/theme scaffolding a manifest-driven capture needs.
7. Reconcile this HANDOFF block into the dated record below and delete it.

## 6. Session notes worth keeping

- **Verification harness — now committed** (`client/scripts/`, see §0.3). All three
  checks the previous session recommended re-creating are in it, and all three
  earned their place again: (a) per-container overflow found two real defects on
  the admin queue, (b) the field/control-count assertion caught the submit form's
  counts changing for a reason that turned out to be legitimate (a known reporter
  is stated, not asked) and forced that to be written down rather than guessed, and
  (c) checking the export dialog against the server's own field list is what makes
  the server-side grouping safe.
- **A verification script that writes must prove it put things back.** The metadata
  script's first version committed a rename and switched a status off in the hosted
  database and did not undo either; both had to be repaired by hand. It now takes a
  before/after fingerprint of every lookup value and fails if anything drifted, and
  its rename checks deliberately never commit.
- **A failing check is a claim about the product until proven otherwise — but a
  probe can be wrong too.** Four of the overflow probe's exclusions exist because a
  false positive was burying real findings: `<input>`s scroll their own value; a
  `clip: rect(0 0 0 0)` screen-reader label holds content far wider than its 1px
  box *and so do its children*; a deliberate `margin: 0 -24px` full-bleed makes
  every ancestor up to the clipping element measure wide, so the allowance has to
  propagate upward or the finding just walks one level up the tree each time it is
  excused. Each one was diagnosed by measuring the specific element, never by
  loosening the check until it passed.
- **The screenshot harness still does not exist.** The manifest documents Playwright
  at 1500x950@2x desktop / 390x844@2x mobile, `reducedMotion: reduce`, theme forced
  via `localStorage['bc-theme']` — which is exactly what the three verification
  scripts already set up. Build the capture on top of that scaffolding.
- **Restart Vite if a page suddenly fails to mount.** After a long run of edits —
  especially files rewritten by an external script rather than an editor — the dev
  server's module graph can go stale and throw `does not provide an export named
  'X'` for an export that is plainly there. `npm run build` passing while the dev
  server does not is the tell. Restart it; do not debug the source.
- **Watch for leaked processes.** Playwright runs that time out leave a browser
  tree behind, and stacked `npm run dev` invocations add up: with three duplicate
  dev servers and a leaked Chromium, ESLint died with `Zone Allocation failed —
  process out of memory` on an 8 GB box. Not a code problem.
- **Never slice a stylesheet by line number** to inline it. Doing so cut a rule in
  half, left an unclosed brace, and the CSS parser silently swallowed everything
  after it — two mockup panes rendered unstyled while still reporting plausible
  heights. Inline the whole file.
- **Watch specificity when overriding by class.** `.rs-drop > span` (two classes +
  a type) outranks `.rs-drop-icon` (two classes) and stole its `order`. And a rule
  written for `.rs-refbox` did nothing because the real class is `.rs-sub` — a
  silent no-op that looked like a design decision that hadn't landed.

---

## Money columns were single-precision floats (2026-08-05)

`policy_premium_impact` and `direct_dollar_impact` were `DataTypes.REAL`, which
Sequelize maps to **`float4`** on Postgres — about seven significant digits. The stored
value was therefore wrong, not just the arithmetic on it:

```
1234567.89  ->  1234567.875          (displays as $1,234,567.88 — a cent adrift)
  99999.99  ->  99999.9921875
      0.07  ->  0.07000000029802322
```

**Invisible locally, real in production.** SQLite's `REAL` is a double, so nothing
reproduced on the sqljs path — this only ever damaged the hosted Supabase data. The Excel
export writes these values out raw, so it showed in spreadsheets as well as on screen.
Worth remembering as a class of bug for as long as two dialects are supported.

Now `DECIMAL(14,2)`. The cost of that is a type change on the wire: `pg` returns `numeric`
as a **string** and Sequelize's Postgres `DECIMAL.parse` passes it through to preserve
precision, so a naive change would have turned `1250` into `"1250.00"` in every admin
response. `mapSubmission` coerces both back with a new `toMoneyNumber`, which is the one
boundary every submission payload and socket emit already passes through — so the JSON
contract is identical on both dialects. Null stays **null, not 0**: "nobody costed this
ticket" and "zero dollars" are different answers and the impact totals must not conflate
them.

**Migration is explicit, not a boot-sync side effect.** `npm run migrate:money-columns`
(dry-run by default) performs the `ALTER` in one transaction and reports how many rows
carry the float4 damage signature. Production boots with `sync({ alter: true })`, which
would have done this silently on the next deploy; a column-type change on live data should
be an act someone reads the output of. It **cannot** recover precision already lost —
those figures need re-entering from source.

**One thing corrected in the doing.** The initial diagnosis claimed the queue's impact
totals accumulated visible float error. Measured, that was wrong: float64 summation stays
under half a cent even at 50,000 rows, so `formatCurrency`'s 2dp rounding already hid it.
The totals now sum in integer cents anyway — exact rather than exact-after-rounding — but
it is defensive, and the docs no longer claim otherwise. The storage defect was the real one.

Not fixed, and deliberately: the ISO-strings-in-`TEXT` timestamp columns. `updated_at`
doubles as the optimistic-concurrency token and is compared as a **string** (read-time
check plus the `UPDATE ... WHERE`), so a native-timestamp conversion would fail the JSON
round-trip on precision and 409 every save. Specified for the rebuild instead, in
`docs/handoff/README.md`.

250 server tests (7 new), client lint green. Verified end to end against a local instance:
`1234567.89` and `0.07` round-trip exactly as JSON numbers, an uncosted ticket reads
`null`, and the public endpoint still withholds both fields entirely.

## Pinned queue scope — and the scope filter that never filtered (2026-08-03)

A super user who owns one product had no way to make that their default queue: the
switcher opened on All applications every session, so they re-picked their own product
every time. `admin_view_preferences` stored which columns and filters were VISIBLE, not
what they were set to, and the queue's filter values were never persisted at all.

**A pin, not a memory of the last selection.** `admin_view_preferences.pinned_application`
holds the application this admin lands on. Switching scope to glance at another team's
queue is a look; only the explicit "Make default" star changes where you land tomorrow.
Resolution order on load: pinned → home application (AD group, else most-filed) → all.
A pin on an application since renamed or retired falls through to the home application
rather than to an empty queue, and `'__all__'` is stored as a real pin because "pinned to
everything" and "never chose" are different states.

**Degrades if the column is not there yet.** `src/index.js` starts the server even when
the boot-time schema sync fails, so the read uses `SELECT *` and the write retries
without the pin column. Losing an admin's whole saved view over a missing pin would be a
far worse failure than having no pin.

**Fixes a bug in the release shipped an hour earlier.** `api.listAdminSubmissions`
destructures an explicit field list and rebuilds the query object, and `application` was
never added to it — so it was dropped before `buildAdminSubmissionsQuery` ever saw it.
The switcher rendered, the chip rendered, the band read "Application: Policy Center", and
the table returned everything. Visible only by looking: the row count did not change.
**Not a data leak** — server-side scoping still bounded what each admin could see; the
filter was simply inert. The export path spreads the whole filters object and was
unaffected.

Verified in Chrome, from a cleared preference state: first load lands on the home
application (3 rows, not 6), switching is a look, the star pins, a reload honours the
pin, looking elsewhere does not move it, and the pin is confirmed in the database. 235
tests, lint and build green.

## EasyVista catalog is per application (2026-08-03, merged 2026-08-05)

Closes the first of the two gaps recorded in `docs(plan): record the two open EasyVista
gaps`, which used to sit here as an OPEN section. Both claims in that note were verified
against the code before acting on them, and both were accurate.

**Merged late.** This shipped as PR #10, opened 2026-08-03 and merged 2026-08-05. It sat
open for two days on a `plan.md` conflict — every source file auto-merged — with no
review and no comment but the Vercel bot. Nothing was wrong with it; a newer PR overtook
it. Worth remembering: a doc-only conflict is the easiest kind of stall to not notice.

**The gap.** One global `EASYVISTA_CATALOG_GUID`/`_CODE` from the environment, and a
field map whose repurposed names (`E_KCL_CHECK_VOID_REASON` carries the summary, and so
on) belong to Billing Center's catalog. `application_name` maps to `evField: null`, so
the application was not even transmitted. Adding an application through Manage Metadata
gave it a queue, access and a board lane while its tickets would have posted into
Billing Center's catalog — silently, under a clean "Submitted" confirmation.

**The fix.** `applications.easyvista_catalog_guid` / `_code`. The application's own
catalog wins; the environment is a fallback for exactly ONE application, named by
`EASYVISTA_DEFAULT_APPLICATION`, so the catalog configured before applications had their
own keeps working and no other application inherits it. A real send into an unconfigured
application is refused with a message naming it, rather than misrouted.

**Deliberately not blocking application creation.** Requiring a catalog to add an
application would make it impossible to add any today — EasyVista is switched off, and
Policy Center already exists without one. The harm is in the send, so that is what is
guarded.

**The guard is live-only, because this deployment is a demonstration.** With EasyVista
off, `submitToEasyVista` returns a fabricated id before it ever builds a payload —
nothing is transmitted, so there is no catalog to land in and no misroute to prevent. An
unconfigured application demonstrates end to end exactly like a configured one. The
refusal exists for whoever implements the real integration later.

The Access page grew an **EasyVista catalogs** card: which applications are configured,
which are not, and a super user can set the catalog identifiers. Configured state is
reported even while EasyVista is off, so the gap is visible in a walkthrough rather than
on the day it is switched on. The EasyVista preview carries the same status.

**Three defects found reviewing it before the merge, and fixed in the merge commit.**
The first is the one that mattered:

0. **It broke most of the admin API against any database missing the new columns —
   which is every database, including the hosted one.** Sequelize selects every
   column the MODEL declares, so adding `easyvista_catalog_guid` / `_code` to the
   \`Application\` model made \`SELECT id, name, sort_order, is_active,
   easyvista_catalog_guid, easyvista_catalog_code FROM applications\` the query
   behind \`viewerService.listActiveApplications\` — which runs inside
   \`attachViewer\`, the middleware on most of the admin API. Against the hosted
   database that is \`column "easyvista_catalog_guid" does not exist\`, a 500, and
   the Access page, the detail modal and the EasyVista preview all stop working.

   It was invisible on the branch because the branch author had run \`npm run
   migrate\` locally. It surfaced within a minute of pointing the merged code at the
   real database.

   Fixed two ways, deliberately both:
   - **Four queries now name the attributes they use** (\`viewerService\`,
     \`redirectService\` ×2, \`devRoutes\`). None of them ever wanted a catalog —
     they use \`id\` and \`name\` — and an implicit select of every model column is
     what made a new column a breaking change. This is the real fix.
   - **The two places that DO want the catalog degrade** —
     \`loadApplicationRows\` / \`loadApplicationRowById\` in \`helpers/lookups.js\`
     retry without those columns and warn once, so an unmigrated database loses the
     catalog card and nothing else. Same shape as
     \`admin_view_preferences.pinned_application\`. Fail-closed is preserved: with
     no columns to read, no application reports a catalog, so a live send is
     refused rather than misrouted.

   \`npm run migrate:easyvista-catalog-columns\` adds the two columns explicitly —
   dry-run by default, one transaction, skips a column that already exists. Narrow
   on purpose: \`npm run migrate\` would reconcile every table with
   \`sync({ alter: true })\`, which on live data is a much broader act than adding
   two nullable columns. **It has NOT been applied to the hosted database** — the
   app works without it, so this is a decision rather than an emergency.

1. **The application was resolved by NAME, not by id** — `Application.findOne({ where: {
   name: source.application_name } })`, in both the preview and the send, while
   `rawSubmission.application_id` sits two lines above and is already used for the
   ownership check. That is the STOP-list rule against joining on a name where an id
   exists, and here it had teeth: rename an application on the Metadata page (which the
   rebuilt page makes easy) and the lookup returns null.
2. **And null failed OPEN.** `easyVistaConfig(null)` deliberately reads the environment
   so a preview built before an application is known still renders — but the live guard
   called `easyVistaCatalogStatus` with that same null, got `configured: true` from the
   environment's catalog, and let the send through. So the exact misroute this PR exists
   to prevent was reachable: rename an application, send a ticket, and it posts into the
   environment's catalog under the wrong field names. Now the lookup is by id, done once,
   and a live send with no resolvable application row is refused.

Verified: 274 server tests (2 new for those two paths), client lint, build.

## EasyVista attachments: loud instead of silent (2026-08-03, merged 2026-08-05)

The second gap, from the same PR.

**The upload is genuinely blocked** on EasyVista's contract — endpoint, multipart vs
base64, the file field name, whether several go per request, the per-file cap. Nobody
can write that without the spec, so it stays a documented stub. `sendEasyVistaAttachments`
still never throws: the ticket exists by the time it runs, and turning a created ticket
into an error response would be a worse lie than the one being fixed.

**The silence was ours, and is fixed.** The server always returned the attachment
outcome (`attachments: attachmentResult`), and nothing read it — the client checked
`result.source`, which describes the TICKET, not the files. So a live send created a real
ticket, uploaded nothing, logged a warning into a server log nobody reads, and confirmed
"Submitted. Ticket: I240412" with no caveat. On a defect where the screenshot IS the
evidence.

Now:

- `easyVistaAttachmentsSupported()` is the single source of truth, so the warning shown
  before Send and what actually happens afterwards cannot drift. Whoever writes the
  upload flips one constant and both follow.
- The result carries `attempted`, so the message can say "3 files could not be attached"
  instead of inferring a count it was never given.
- The **preview warns before the send** — going ahead without the files becomes a choice
  rather than a discovery. By the time the confirmation speaks, the ticket exists.
- The **confirmation reports the real outcome**, including files dropped by the
  per-ticket cap, which was equally unread.

None of this changes the demonstration: with EasyVista off nothing is transmitted,
`sent` equals what was picked, and the confirmation stays clean.

The user-facing strings this added were written before the tracker rename, so the merge
routed them through `TRACKER_LABEL` like the rest — they said "EasyVista" to an admin.


## Browser verification — five defects the tests could not see (2026-08-03)

Every page built this session had been reported as "not verified in a browser". That
was an assumption, not a fact: Chrome is installed, and headless Chrome screenshots
without any tooling. Driving the real app found five defects that lint, 229 unit tests
and a full HTTP pass had all missed.

1. **Access page: the "Sees" column was invisible.** A global `table { min-width: 1400px }`
   (`index.css:708`), there for the very wide admin queue, applied to the Access table
   too — 1400px inside an 1190px card, pushing the last column behind a scrollbar nobody
   would think to use. `.access-table` now sets its own floor.
2. **Board: a redirected ticket claimed the previous team's progress.** The track read
   "furthest timestamp wins", so a ticket approved by Billing Center and handed to Policy
   Center still showed as Approved — the sending team's work presented as the receiving
   team's. The track is now driven by the ticket's CURRENT status, and a date only prints
   under a stop actually reached.
3. **Board: an anonymous visitor was silently prefiltered to one application.** The
   anonymous viewer envelope carries a `homeApplicationId` as a submit-form prefill;
   treating it as a board scope hid half the board from a stranger with no clue why.
   Auto-scoping is now for signed-in viewers only.
4. **Board: the list-band hint ran its separators together** — JSX strips whitespace
   between elements and `.pb-sep` carries no margin, so the mockup's spacing was lost.
5. **Admin queue: the scope switcher vanished for the admin who most needed it.** It was
   derived from GRANTED applications, but a ticket handed to another team stays readable
   through the routing ledger — so a one-application admin can hold two applications'
   tickets and had no way to separate them. Now derived from grants plus what is actually
   in the queue.

Verified in Chrome: the board (desktop, phone, dark), the Access page (light, dark,
phone), the admin queue as a super user and as a one-application admin, and a handed-on
ticket showing "This ticket now belongs to Policy Center" with Save and EasyVista both
disabled. Also confirmed the ledger read-scope end to end — `lead`, admin of Billing
Center only, sees 5 tickets including the 2 they redirected to Policy Center.

Driving the app also caught a temporal-dead-zone crash I introduced while fixing (5):
a `useMemo` reading `rows` above its declaration blanked the whole queue. Lint passed it.

## Status board: rows instead of cards, and admin-grade sort/filter (2026-08-04)

Built to the approved redesign mockup, **artifact v2**
(https://claude.ai/code/artifact/f5d5fc91-ec8c-4b9b-b4a3-791cdb33a365). Supersedes the
card layout of the section below; the four-stop track, the tiles and the ownership rules
described there all survive, in new places.

**A ticket is a row, not a card.** ~190px became ~46px, so a screenful holds roughly four
times as many. The four-stop track that made up most of that height is four pips plus the
name of the current stop (`StatusBoardRow.StageCell`); the dated track, the description,
the reference numbers and the hand-off trail moved into an expansion that is not in the
DOM until it is opened. Statuses that end a ticket elsewhere still render one outcome
pill instead of a track, and the parked statuses (Backlog, Future Consideration,
Deferred) now get a holding pill rather than a track that has stopped moving.

**Columns:** Ticket · Type · Summary · Stage · Reported by · Application · Updated. One
CSS grid definition is shared by the header and every row (`.sb-head, .sb-row`), so a
column and its header cannot disagree. They drop in the order of what is recoverable
elsewhere — Application at 1180px, Reported by at 1000px — and below 820px the row folds
to three lines. Both dropped columns stay in the expansion at every width.

**Sort, two ways that write one value** (`filters.sort`), mirroring the admin queue: a
field + direction pair in the band (`PublicSortControl`) and a click on a column header
(`StatusBoardList.toggleSort`). Nine fields, all inside the public allow-list
(`PUBLIC_SORT_FIELDS`). Direction wording follows the field type, from the now-shared
`utils/sortShared.js` — `createSortRegistry` binds the same mechanics to the admin
registry (`sortUtils.js`) and the public one (`publicSortUtils.js`). Blanks sort last in
BOTH directions: the blank check happens before the direction multiplier, so flipping the
sort cannot dredge every ticket with no incident number to the top.

**Filter, like the admin queue:** a command row (search, Filters + count, application
scope, Active/Retired/All, All/My reports), removable chips, and a grouped panel drawn
closed — Ticket / Where it stands / Reference numbers / People. New filters: reported
year, incident #, JIRA #, one box matching either policy or account, reported by. Every
one reads a field already in `PUBLIC_SUBMISSION_FIELDS`; nothing internal became
filterable. State is one `filters` object so the chips, the Filters badge, the band's
summary and the no-matches state cannot drift (`getActivePublicFilters`).

**Stage is not state.** The Stage select and the tiles both read and write
`filters.statuses` (`stageForStatuses` / `statusesForStage`), the same way the headers and
the sort control both write `filters.sort` — otherwise picking a tile and picking a stage
could disagree about what the board is showing.

**The hand-off trail renders for the first time.** `PublicItemCard` had always had the
markup, but only the by-id endpoint attached `routings` — the LIST endpoint never did, so
the block was dead on the board and in AI search results. Fixed with
`listRoutingsBySubmissionIds` (`redirectService.js`): two queries for the whole page
instead of the two-per-row the existing `listRoutings` would have cost, which now
delegates to it. `forPublic` still strips the note.

**A status retired from the metadata no longer hides live tickets.** The board applied its
status whitelist unconditionally, so a ticket sitting on a status that had since been
retired vanished from an unfiltered board. `matchesPublicFilters` now drops the whitelist
when every offered status is selected — the rule the admin queue already had
(`AdminDashboardPage.loadRows`).

**The column header is sticky, pinned below the app bar.** It was briefly shipped
non-sticky on the belief that `.app-header`'s height varies with the nav and could not be
depended on; measuring it disproved that — it is **61px at every width from 320 to 1600,
on every page**. So the offset is now a real relationship rather than a magic number:
`--app-header-h` is declared once in `:root`, `.app-header-top` derives its height from
it, and `.sb-head` pins at `top: var(--app-header-h)`.

Two things have to stay true for that to keep working, hence the comments on both rules:
`.app-header` is sticky at `top: 0` with `z-index: 50`, so a column header stuck at 0
would pin *underneath* it and be invisible; and `.sb-panel` must not carry
`overflow: hidden`, because an overflow ancestor becomes the sticky container and the
stick silently stops. (`body` uses `overflow-x: clip`, which deliberately does not create
one.) Below 820px the column header is hidden anyway, so there is nothing to pin.

Retired: `PublicItemCard.jsx`, `PublicFiltersBar.jsx`, and the `.pb-item` / `.pb-track` /
`.pb-listwrap` CSS. `DuplicateCheck` and the AI search panel render the new row.

**Two defects the browser found that nothing else would have.** The application picker
wrapped onto a line of its own and stretched the full width — `.bs-inline-select` is
`width: 100%`, which made its flex basis the whole row; it and the band's sort selects are
now width-capped. And a long summary pushed a phone row to 154px, so `.sb-sum` is clamped
to two lines below 820px.

Verified in Chromium (headless, real built client against a seeded sandbox DB — never the
hosted one): 1440 / 834 / 360 px × light and dark. Row height **46px** measured on
desktop and tablet, 114px median on a phone (three stacked lines); no horizontal page
scroll at any width; the column drop order confirmed at each breakpoint; a row expands in
place; the filter panel's four groups; Type=Enhancement narrowing 26→7 with a matching
chip that removes just itself; a header click sorting and the sort control following it;
tickets with no incident number sorting last; the no-matches state; the column header
pinning flush under the app bar and releasing with its own list; and **two windows both
picking up a ticket filed by a third client with no refresh**. Console clean apart from
the two 401s an anonymous visitor is meant to get (`/api/realtime/token`, `/api/auth/me`).

One note for whoever runs this next: the live check went through a hand-rolled WebSocket
proxy at first and dropped an event roughly one window in six. Rebuilding with
`VITE_SOCKET_URL` pointed straight at the API — which is how the app connects in
production anyway (client/src/lib/socket.js) — was clean four runs out of four. The flake
was the test scaffolding, not the board.

Also verified: 257 server tests (8 new in `test/routingsBatch.test.js`), client lint,
client build; the routings attach proven end to end (chain oldest-first,
note/`routed_by`/`status_at_handoff` absent, tickets that never moved carry no key); 35
logic checks over sort/filter/chips/stage/persistence and 21 render checks over
`StatusBoardRow`. The logic, render and browser checks all run from the scratchpad and are
NOT wired into a suite — the client has no test runner.

## Status board rebuilt — status became position (2026-08-03)

Step 6. Built to the approved redesign mockup, **artifact v1**
(https://claude.ai/code/artifact/2bef6625-8dc6-4d58-9022-d8521d73aa65). The mockup's
stylesheet was lifted into `index.css` rather than re-derived, so the page and the
artifact are literally the same CSS.

**Status became position.** A four-stop track — Reported → Approved → In EasyVista →
Deployed — with the date under each stop reached, replacing a single badge word.
Statuses that end a ticket somewhere else (Duplicate, Rejected, Redirected, Retired)
would make the track a lie, so they render a one-line outcome instead.

**My reports** uses `useViewer.isMine`, which picks between the server's `is_mine`
(a signed-in reporter) and this browser's remembered ids (everyone else). The toggle
hides entirely when there is no identity and nothing remembered — a control that can
only ever return nothing is worse than no control.

**Application scope** opens on the viewer's home application (AD group, else most-filed
— the server decides) and switches to All from there. It only self-selects while the
picker is untouched, so it can never yank the view from someone who has already chosen.
The scope tiles count the whole application, never the filtered list, and the badge says
so; the "other outcomes" tile catches every status the four named tiles miss, so the
numbers always sum to the total.

**The hand-off trail** renders in a card's details from the public `routings` — teams
and dates only, never the note. (It did not actually render on the board until
2026-08-04; the list endpoint was not sending `routings`. See the section above.)

**Second real bug found by verifying.** The board's per-status timestamps
(`deployed_status_at`, `duplicate_status_at`, and the new `approved_status_at`) matched
event rows by bare status name, but a triager changing status through the admin form
writes `Defect/Enhancement Status: Deployed`. Since that form is the ONLY way those
statuses are ever reached, those timestamps had always been empty — a pre-existing bug
the new track would have inherited. `normalizeEventStatus` in `publicRoutes.js` now
reads both shapes, fixing the four existing fields as well.

Verified: 229 server tests, client lint, build, and a live pass — a ticket driven
Approved → Deployed through the admin form now returns both timestamps. **Not verified:**
the rebuilt page has not been opened in a browser, so the track, tiles and responsive
behaviour are unconfirmed by eye.

## Redirect between application queues (2026-08-03)

Step 5, both halves.

**The dialog** lives behind "Redirect to another queue…" in the detail modal's More menu
(`detail/DetailActions.jsx`): an application picker, an optional note, and a plain
statement of what the move does — it leaves your queue now, comes back New for them,
and the history travels. The note field says outright that the reporter never sees it.
The action hides when there is nowhere to send it (a single-application portal) rather
than opening a dialog with an empty picker. Targets come from the viewer envelope's
`{id, name}` list, not `dynamicApplications` (names only) — the endpoint moves by id.
Deliberately NOT narrowed to applications the caller administers: handing a ticket to a
team you are not part of is the whole point.

**Two locks, kept separate.** The modal already had `locked` for "another admin has this
open", which is temporary and overridable with "edit anyway". A handed-on ticket is a
different thing: `can_edit: false` from the server, no override, because the write would
403. Merging them would have offered an "edit anyway" that cannot work. The read-only
banner outranks the presence one — it is the answer to "why is everything greyed out"
and it cannot be worked around.

**The ticket moves — it is not copied or mirrored.** A copy would give the reporter two
tickets for one problem and leave two teams each assuming the other owned it.
`submissions.application_id` changes and `submission_routings` records who held it
before (`services/redirectService.js`, `POST /api/admin/submissions/:id/redirect`).

Three consequences, all as agreed in the design conversation:

1. **It lands as New.** The receiving team has not triaged it, so its status cannot
   claim they have. The history travels with it — `status_at_handoff` preserves what it
   was, and two status events (`Redirected to <app>`, then `New`) make the story
   readable on arrival.
2. **The sending team keeps reading it and stops writing it, immediately.** Both
   already fell out of Step 3 rather than needing new code: read comes from
   `resolveAdminReadScope` walking the ledger's `from_application_id`, and write is
   refused because `canMutateApplication` asks about the ticket's CURRENT application.
   This is the first time that ledger path has run against real rows. Verified: the
   sender gets 200 on the detail, 403 on an edit, and 403 trying to pull it back.
   The detail response carries `can_edit` so the UI can render read-only rather than
   offering dead controls.
3. **The note is optional and internal.** Optional per the decision at 16:12 (the
   earlier proposal had it required). It never reaches the reporter: `mapPublicRouting`
   allow-lists `{id, from, to, routed_at}` and drops `note`, `routed_by` and
   `status_at_handoff` — the same boundary that keeps reviewer and decision notes off
   the board. The reporter's detail shows THAT it moved and when, so they can follow
   their own ticket across the hand-off.

**Bug caught in verification:** `status_at_handoff` recorded every hand-off as New. The
raw row stores only `status_id` (the legacy text columns were dropped), so reading
`.status` silently produced nothing and fell through to the default. Now resolved from
the FK, with the text column kept as a fallback.

Verified: 229 server tests, client lint, build, and a live hand-off against a sandboxed
copy — Approved ticket moved Billing → Policy, landed New with
`status_at_handoff: Approved`, sender got 200 on read / 403 on edit / 403 pulling it
back, note visible to admins, and the public payload containing none of `note` /
`routed_by` / `status_at_handoff`. **Not verified:** the dialog and read-only banner
were not exercised in a browser — the endpoint behind them was.

## Reporter binding — a ticket knows who filed it (2026-08-03)

Step 4 of the seven. `submissions.reporter_user_id` existed and nothing wrote it;
`useViewer.isMine` expected an `is_mine` flag nothing emitted. Both are now real.

**Who filed a ticket is the server's decision** (`services/reporterService.js`). For a
signed-in reporter the name, email and `reporter_user_id` come from the users row and
the submitted `created_by` / `created_by_email` are discarded — so nobody can file under
a colleague's name. Anonymous filing is unchanged: the typed name stands, is still
required, and `reporter_user_id` stays null. A session pointing at a deleted user falls
back to the anonymous path rather than writing an orphan reference. The route no longer
destructures the two body fields at all, so they cannot be used by accident.

**The submit form stops asking once it knows.** `RepSubmitPage` shows a "Filing as" line
instead of the name input, and drops `created_by` from its required set to match the
server — otherwise it would block a submit that would have succeeded. The confirmation
echoes the recorded name, not the ignored field.

**`is_mine` on the public board** is computed per request in `routes/publicRoutes.js` by
comparing `reporter_user_id` to the session user, and attached after
`mapPublicSubmission` — it is a fact about the viewer, not the row, which is also why
the socket broadcast cannot carry it. `reporter_user_id` itself is now in the mapper
test's sensitive-field list: shipping it would let any watcher correlate which reports
belong to the same person.

**Filing will require signing in — armed, not yet active.** `SUBMIT_REQUIRES_AUTH`
(`src/config.js`) closes the anonymous path entirely: `POST /api/submissions` answers
401 and no typed name substitutes for an identity. It defaults to `AUTH_MODE === 'sso'`
rather than being hardcoded on, because **SSO is the only way a rep can sign in** — the
local login is admin-only, so forcing it on today would leave the submit form reachable
by nobody and take the portal's purpose offline. It arms itself the moment SSO is
switched on; `SUBMIT_REQUIRES_AUTH=true` forces it earlier for testing.

The rule rides on the viewer envelope as `submitRequiresAuth`, so `RepSubmitPage` can
show a sign-in wall instead of a form whose last click would 401. That state carries no
sign-in button on purpose: there is no SSO login route to point at yet, and a dead
button is worse than none — wire the provider's URL there when SSO lands. A failed
`/api/viewer` defaults the flag to false, so a transient fetch error cannot take the
form offline; the server refuses unsigned submissions regardless.

Verified: 223 server tests, client lint, build, and an HTTP pass against a sandboxed
copy — anonymous-without-a-name refused, a signed-in spoof attempt recorded under the
real account, `is_mine` true only for the filer, neither `reporter_user_id` nor
`created_by_email` in the public payload, and the gate proven both ways (forced on:
anonymous 401 / signed-in 201; default off: anonymous 201).

## Per-application access control + Access page (2026-08-03)

Steps 1–3 of a seven-step identity/access plan on `feat/identity-access-and-redirect`.
Steps 5–7 (the redirect ledger, the board redesign, final verification) are **not
started**.

**The model.** Triage rights are per application and per role. `user_application_roles`
holds one row per (person, application, role); no row is no access. The catalog is
`APPLICATION_ROLES` in `server/src/constants.js` — an ordered ladder, `viewer` then
`admin`, so "at least viewer" is a rank comparison. `viewer` reads a queue and exports;
`admin` adds editing, status, attachments, redirect, EasyVista and public visibility.
Portal super users are a flag on the users row, not a role — one bypass, one place to
audit, and it refuses to lose its last holder.

**Active Directory decides which application someone *works in*, never what they may
triage.** `application_ad_groups` sets a person's default application (submit form
prefill, their board scope) via `resolveMemberApplicationIds`; `resolveApplicationRoles`
deliberately does not read it. An earlier revision unioned group mappings into admin
grants — that was removed, and `viewer.test.js` now pins the opposite so it cannot
return by accident.

**The viewer envelope** (`GET /api/viewer`) carries `applicationRoles` (a map),
plus `adminApplicationIds`, `readableApplicationIds` and `memberApplicationIds`
derived from it. Every capability question goes through `roleInApplication`, so
`canReadApplication` and `canMutateApplication` are the only two predicates callers use.

**Scoping is enforced, and fails closed.** `resolveAdminReadScope` +
`canReadSubmissionRow` gate the queue list, the xlsx export, ticket detail, create,
update, both bulk paths, EasyVista send *and* preview, and attachment add/delete. Read
access is deliberately wider than write: a team that redirects a ticket away keeps
seeing it through the routing ledger but can no longer change it. An out-of-scope
ticket reads as **404 rather than 403**, so the queue cannot be walked by id. Omitting
the scope argument returns nothing rather than everything.

**Access page** — `/admin/access`, super users only (`pages/AdminAccessPage.jsx`,
`hooks/useAccessManagement.js`, `access-` styles at the end of `index.css`). Approved as
Artifact **v3** before any code
(https://claude.ai/code/artifact/5e8147b8-a730-4a89-9ecf-9b0c58118552). A people ×
applications matrix with one role dropdown per cell — dropdowns rather than segmented
buttons so the row width holds as applications are added — tinted by value so the gaps
are scannable. Multi-select drives a bulk bar that grants or revokes one role across
many people and many applications in a single transaction, validated in full first so a
bad batch changes nobody. Directory-group mappings live on the same page, labelled as
defaults rather than entitlements.

New endpoints, all behind `ensureSuperUser`: `GET /api/admin/access`,
`PUT /api/admin/access/users/:id/grants`, `PUT .../super-user`,
`POST /api/admin/access/bulk`, `POST|DELETE /api/admin/access/ad-groups[/:id]`.

**Admin queue got an application tag and a scope switcher.** The queue was a flat merged
list once scoping landed, with the application name as unstyled text in the summary cell
and no way to filter by it — so a two-application admin could not tell the two apart.
The tag is now a badge, there is an optional `application` column (off by default; the
summary tag covers the common case), and an application select sits in the command row
beside the Active/Retired scope. It renders only when the caller can see more than one
application. Super users also get "No application set", the only route to tickets that
predate the per-application queues. The filter narrows within the access scope and can
never widen it.

**State of the live database (Supabase).** `admin` is a super user; `lead_admin` and
`ops_admin` hold nothing and will see an empty queue until granted something on the new
page. 83 tickets, 82 Billing Center, 1 with no application set. `user_application_roles`
and `application_ad_groups` are both empty.

Verified: 208 server tests, client lint, production build, and a full HTTP pass against a
sandboxed sqlite copy — 401 unauthenticated, 403 for a non-super-user, viewer-reads /
viewer-cannot-write, cross-application writes refused, last-super-user demotion 409,
bulk grant and revoke, duplicate group mapping 409, queue scoping, and 404 (not 403) on
an out-of-scope ticket id. **Not verified:** no browser was driven, so the rendered
Access page, both themes and the narrow-width behaviour are unconfirmed.

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

**Type choice is two cards**, since it reshapes the whole form. **Confirmation**
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

## Submit form decluttered + "needs a workaround" flag (2026-08-03)

**Every explanatory hint is gone from the form.** The eight `rs-hint` lines under the
fields ("So the BC team knows who to come back to with questions", "Error text matters —
paste or type it exactly", …), the descriptions inside the Defect/Enhancement cards, and
the screenshot justification paragraph. The `hint` prop is removed from `Field` rather
than left unused. Two signals were preserved rather than deleted: the Reference numbers
sentence became an `Optional` chip (the three fields carry no required marker, so it was
the only thing conveying that), and the screenshot argument still lands in the
"Submit Without Screenshots?" dialog, at the moment it matters. `.rs-type` lost a row and
its cards are now a single centred line.

**A rep can flag that they are blocked** — a defect-only checkbox, "I need a workaround to
keep working", for an issue that needs an answer today rather than a place in the
developer queue.

Two columns, not one: `needs_workaround` is the rep's ask, `workaround_provided` is the
team closing it out, so handling a request does not erase that it was made. **An open
request is the first without the second** — that pairing is the whole model, and the
`open` / `handled` / `any` filter exists because a ticket nobody flagged is neither open
nor handled.

- **Server.** Both columns on `Submission` (INTEGER, default 0, added by the existing
  `sync({ alter: true })` migration). `POST /api/submissions` accepts the flag and **drops
  it for enhancements** regardless of what was posted. Parsing goes through a new
  `parseBooleanFlag` in `helpers/utils.js`: the form is multipart, so `false` arrives as
  the *string* `"false"`, which `toBooleanSql` would have read as true and flagged every
  defect. Both flags are on `mapSubmission` as booleans and deliberately **absent from
  `mapPublicSubmission`** — who is blocked is triage information.
- **History.** Three entries, all attributed: `Workaround: Requested by reporter` at submit
  time, then `Workaround: Marked handled` / `Reopened — still needed` against the admin who
  did it. A triager raising or withdrawing the request itself logs too. The first and second
  bracket how long the rep waited.
- **Queue.** A red `Needs workaround` badge in the summary cell — default-visible, so it
  does not wait to be found inside a ticket — going quiet as `Workaround given` once
  handled. A `WorkaroundRequestsAlert` banner mirrors `NewSubmissionsAlert` (louder: this is
  someone unable to work) and its button filters the table to `workaround: 'open'`.
- **Detail modal.** An alert ranked above the resubmission notices with a **Mark handled**
  button; it is keyed off the saved record, so ticking it changes the alert's tone rather
  than making it vanish before Save. The two checkboxes live in Triage under `Workaround`.

Verified end to end against a throwaway copy of the seeded sql.js file: migration adds the
columns, a ticked box persists, an unticked one stays false, an enhancement cannot set it,
both filters follow the state, and the history entries land with the right names. Not
verified: no browser was driven, so the decluttered layout and the new controls are
unconfirmed visually.

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
  marks rows changed by unsaved edits, and shows the outgoing description.
- Blocked sends are **editable inline** on the EasyVista tab, wired to the same `edit`
  state as the other tabs.
- **The action bar sends outright when there is nothing left to decide** — a first send,
  a resolved send-as type, no missing required fields (`canSubmitEasyVistaDirectly` in
  `useDetailModal`). Routing every send through the tab meant a detour past a page that
  had nothing to say. The three cases that do need a decision still go there: a resubmit
  (it forks), a blocked send (fields to fill), a Cleanup Only task (no type yet). The
  button's ellipsis tracks which is which — present only when the click opens something.
- The confirm dialog's **"See the full outgoing text" renders the description as
  EasyVista lays it out**, not as HTML markup. It is a label/value table, so showing the
  tags made the admin parse markup to read their own ticket; the literal `Description`
  string is one disclosure further in. Both come from `preview.rows` / `preview.raw`,
  which the server builds from the same rows, so neither can drift from what is sent.

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
`EV-#####` id and transmits nothing.

**How that is presented is a second switch, `EASYVISTA_DEMO_MODE` (default ON).** The
integration exists to be shown to stakeholders before go-live, so by default an un-wired
send is presented exactly as the real one will be: press send, get an incident number
back, ticket moves to Submitted, no caveats anywhere. Setting it to `false` restores the
honest wording on all three surfaces — the EasyVista tab banner, the confirm dialog
footer, and the result message — for when a stubbed send writing a realistic-looking id
onto a real record must not read as a genuine ticket.

The flag is only consulted when the integration is **not** live (`easyVistaDemoMode()`
returns false outright once `easyVistaIsLive()` is true), so it can never dress up or
quiet a warning about a real transmission. The client reads it as `preview.demo` on the
dry-run response, and as `source: 'demo'` rather than `'stub'` on the send response.

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
