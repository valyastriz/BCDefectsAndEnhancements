# Project Plan

Living record of notable features/changes. See `CLAUDE.md` for architecture and
per-app details.

## EasyVista catalog is per application (2026-08-03)

Closes the first of the two gaps recorded in `docs(plan): record the two open EasyVista
gaps`. Both claims in that note were verified against the code before acting on them,
and both were accurate.

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

Verified: 243 server tests, client lint, build, and in Chrome — both applications start
unconfigured, configuring Policy Center persists and re-reads, and **a demo send from an
application with no catalog still returns `EV-17674 / source: demo`**.

## EasyVista attachments: loud instead of silent (2026-08-03)

The second gap. Split deliberately, because its two halves are not the same kind of
problem.

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

Verified: 249 server tests, client lint, build.

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

## OPEN — the EasyVista call is Billing Center's, not the portal's (2026-08-03)

**Not built. This is the blocker standing between "the portal supports many
applications" and "the portal can actually file their tickets."** Everything else about
multi-application — per-application access, scoped queues, redirect between queues, the
board — landed this week. The outbound EasyVista call did not move with it: it is still
the single Billing Center integration it was written as.

**What is Billing Center-specific today.**

- **The catalog.** `easyVistaConfig()` (`server/src/helpers/easyVistaPayload.js:134`)
  reads one `EASYVISTA_CATALOG_GUID` / `EASYVISTA_CATALOG_CODE` from the environment,
  plus one `Origin`, `Severity_ID` and default `Urgency_ID`. There is one catalog and
  the process has no way to hold a second.
- **The repurposed field names.** `EASYVISTA_FIELD_MAP`
  (`easyVistaPayload.js:60`) is a hardcoded array whose EV-side names —
  `E_KCL_CHECK_VOID_REASON` carrying the summary, `E_KCL_MKT_AUDIENCE` carrying what
  happened, `E_KCL_CHECK_TYPE`, `E_KCL_CHECK_PAYEE`, `E_KCL_CHECK_REISSUED`,
  `E_PRB_CENTURYLINK_DCI1`, `E_LEGAL_POLICY_NUMBER`, `E_PRB_LAST_UPDATE_UT` — are fields
  that exist in **Billing Center's** EV catalog and were repurposed because it had
  nothing better. Policy Center and Claim Center have their own catalogs, their own
  fields, and no reason to have repurposed the same ones the same way.
- **The required-fields gate.** The send is refused unless a fixed list is filled
  (`server/src/services/submissionService.js:1506-1528`, mirrored client-side by
  `EASYVISTA_REQUIREMENT_SECTION` / `_FIELD` / `_LABEL` in
  `client/src/constants/detailModalConstants.js:22-49`). "Summary of Issue, Screen Title,
  Description" for a defect is a Billing Center rule.
- **The ticket data itself.** `Policy#/Submission#`, `Account#`, `Transaction#` are
  Billing Center's vocabulary. Claim Center wants a claim number; the submit form and
  the description table both assume otherwise.
- **The mailbox.** `EASYVISTA_ADMIN_MAILS` / `EASYVISTA_FALLBACK_MAIL` are one flat
  username→mail list with no notion of which team's queue the ticket came from.

**Why adding an application does not currently work.** `applications` is a bare lookup
table — `id, name, sort_order, is_active` (`server/db/models/index.js:271`). Inserting a
row through Manage Metadata immediately gives that application a queue, access grants, a
board lane and a redirect target. It gives it **no EasyVista identity at all**, and
nothing refuses the send: a Policy Center ticket would be posted, silently, into Billing
Center's catalog under Billing Center's field codes.

**What has to become per-application.** Catalog GUID + code; `Origin`, `Severity_ID`,
default `Urgency_ID`; the our-key → EV-field map including which fields are table-only;
the description table's row order and labels (the order is wire format — see the note at
the top of `easyVistaPayload.js`); the required-before-send list on both sides; the
requestor/recipient mailbox. Likely also the request path, if the applications sit behind
different EV endpoints.

**Two constraints that shape the design.**

1. **A ticket's application can change after it is filed.** Redirect between queues
   (see below, 2026-08-03) moves `submissions.application_id`. The payload must be built
   from the ticket's application **at send time**, not at creation.
2. **Field codes are wire format.** Getting one wrong produces a ticket that EV accepts
   and a human then cannot read. Whatever holds them wants review and a test, the way
   `server/test/easyVistaPayload.test.js` pins the current map.

**Proposed shape (not decided).** A per-application EV config record for the catalog and
the ids — that part is data, an admin can hold it, and it changes without a deploy —
paired with a code-side field map keyed by application, kept where the current one lives
and covered by the same tests. Splitting it that way keeps the risky half reviewable.

**Fail closed first, and it is small.** Before any of the above: an application with no
EasyVista mapping should refuse the send with a plain message ("EasyVista is not
configured for Policy Center") instead of falling back to Billing Center's catalog. That
is a guard worth having the moment a second application is real, independent of how the
per-application config eventually lands.

**Open questions for the EV owners.** One EV instance with several catalogs, or several
instances? Does every application split the same defect/enhancement way, or do some have
a third request type the "Send as" control has no room for? Does each team have its own
requestor mailbox? Is the 4-attachment cap (`server/src/easyvista.js:95`) per catalog?

## OPEN — images never reach EasyVista, and the admin is not told (2026-08-03)

**Not built, and unlike the item above this one blocks Billing Center go-live on its
own.** Screenshots are the substance of most defect reports here — the submit form is
image-only for exactly that reason — and right now none of them would arrive.

**Where it stops.** `sendEasyVistaAttachments` (`server/src/easyvista.js:118`) is an
honest stub: it caps the list, warns to the server console, and returns
`{ sent: 0, skipped, source: 'not-implemented' }`. Everything *around* it is finished
and tested — the picker, the 4-file cap, the check that each id belongs to this
submission (`server/src/services/submissionService.js:1466-1477`), the confirm dialog.
The upload request itself is the only hole.

**The part that is a defect today, not a missing feature.** The client builds its
confirmation from `result.source` alone and never reads `result.attachments`
(`client/src/hooks/useDetailModal.js:586-598`). The moment `EASYVISTA_ENABLED` is turned
on, an admin selects three screenshots, presses Send, and reads **"Submitted. Ticket:
EV-12345"** — with the images silently not sent and the only trace in a server log
nobody is watching. The ticket then reaches a developer who has no screenshots and no
reason to think any were meant to exist. **Surfacing `attachments.source` in that
confirmation should land before go-live regardless of when the upload contract arrives**
— it is small, and it converts a silent data loss into a visible one.

**What we need from the EasyVista owners.**

- Endpoint: part of the same create call, or a follow-up POST against the new ticket id?
- Transport: `multipart/form-data`, or base64 inside JSON?
- The field name for the file, and whether several files go per request or one each.
- Per-file size cap, and which content types are accepted.
- Can files be added to an **existing** ticket? Re-submission creates a new card against
  a ticket that already exists, so the answer decides whether a re-send can carry images.
- Is the 4-file cap real? `EASYVISTA_MAX_ATTACHMENTS` (`server/src/easyvista.js:95`) is
  currently an assumption the UI enforces on admins.

**What our side already fixes for them.** Uploads are images only —
`.png .jpg .jpeg .gif .webp .bmp .heic .heif` with a matching `image/*` mime — 10 MB per
file, 10 files per request (`server/src/middleware/upload.js:6-38`).

**One implementation wrinkle worth knowing before estimating.** `attachments.file_path`
is dual-mode: a repo-relative path on disk, **or** a Supabase Storage public URL when
`SUPABASE_STORAGE_ENABLED` (`server/src/helpers/storage.js:116-139`). The uploader cannot
just `readFileSync` — it has to resolve bytes from either source.

**If EV has no usable attachment API,** the fallback is a link in the Description table.
`/uploads` is `express.static` with no session check (`server/src/index.js:49`), so a URL
would in principle resolve for an EV reader — but only if the server is reachable from
their network, and it means screenshots that can contain policy data sit behind an
unauthenticated, guessable path. Raise it as a decision, not a default.

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
and dates only, never the note.

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
