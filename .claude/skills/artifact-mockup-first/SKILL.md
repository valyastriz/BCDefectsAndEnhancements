---
name: artifact-mockup-first
description: "Use BEFORE implementation when designing a new feature, building a new page, or redesigning an existing page ('redesign', 'redo the design', 'modernize the look', 'rethink the page') — AND when the user approves a mockup and says build it. Requires an approved Artifact mockup before any product code; the build must then match the artifact exactly, wired fully to the real database with live updates, localization, and responsiveness included. Not for code-hygiene cleanup or small edits inside an existing design."
---

# Artifact Mockup First

## Purpose

Design decisions get made on a cheap, disposable mockup — published as an Artifact and approved by the user — before any product code exists. When approved, the artifact becomes the build contract: implemented exactly, end to end, against the real database.

Portable across projects; the project's `CLAUDE.md` names its locale set, ws layer, theme, and definition of done. LOAD the operating-discipline skill now, before the Mockup Phase, and fill its templates from its text, not from memory.

## Use This Skill When

- Building a brand-new page, screen, or feature with user-facing UI
- Redesigning or rethinking an existing page's layout, workflow, or information architecture
- The user approves a mockup and says to build it (the build phase below governs)

## Do Not Use This Skill When

- Small edits inside an existing design (bug fix, one control, adding a field to an existing form)
- Backend-only work; code-hygiene cleanup (refactor-and-cleanup)
- The user explicitly says to skip the mockup

## Mockup Phase

1. Before any design work, write the operating-discipline INTAKE block — its Constraints (VERBATIM) line quotes the user's exact constraint sentences (paraphrase loses requirements) and is pasted at the top of the grounding table; check every mockup iteration against it before publishing. Then, before any implementation, publish a mockup as an Artifact. No product code until the user approves the direction.
2. Load the `artifact-design` skill first; write a self-contained HTML file in the scratchpad and publish with the Artifact tool. Iterate by editing the same file → same URL.
3. The mockup shows the real proposed design with realistic sample data and the states that matter: default, **empty, loading (skeleton), error, and dense/many-records**.
4. **The mockup itself is responsive** (relative units, flex/grid). If the layout changes materially on small screens, show or describe the mobile arrangement (second frame or width toggle) so the user approves both. Check it in both light and dark schemes.
5. **Build the grounding table while mocking** — one row per displayed element and control; it is a deliverable kept with your working notes:

   | Element | Data source (file:line or NEW) | Action (endpoint or NEW) | Notes |
   |---|---|---|---|

   Criterion: if a value is produced by app logic (totals, statuses, derived fields), read the producing function BEFORE inventing the number and cite it in the table. Sample values are faithful to the app: real status/enum values, real formats, internally consistent numbers (totals add up). Lists/selectors whose data can grow are designed for server-side pagination or search-driven loading — never fetch-all.
6. **Publish with the implied-scope inventory**, generated mechanically from the grounding table's NEW rows:

   ```
   IMPLIED SCOPE
   Pages: <new/changed pages>
   DB (via the project's migration manager): <fields/tables>
   Endpoints: <new/changed, with method + path>
   Live updates: <mutation> emits <event> → <view> subscribes
   Explicitly out of scope: <...>
   ```

   Approving the mockup approves this scope. Then stop and wait.

## Approval Gate — what unblocks the build

- Build ONLY on an **explicit build instruction referencing the current artifact version** ("build this", "go ahead with v3").
- Feedback requiring changes → edit, republish, stop and wait again.
- Ambiguous positives ("nice", "I like it", "looking good") are NOT approval — ask: "Build this version?"
- A "change X, then build" message approves only after X is changed and republished; if the change is material to scope, re-confirm.
- Approval covers the published implied-scope inventory; if scope changed since the user last saw it, re-present the inventory before building.

## Redesigns Are Ground-Up, Never Reshuffles

- Start from the page's purpose and the user's job — write both down in a sentence before mocking. Set the old layout aside.
- Do not produce the old page with sections moved and colors changed. Dropping sections, merging screens, or changing the interaction model is expected when it serves the job.
- "From scratch" describes the **process**, not a required delta: if job-first design independently converges on part of the old layout because it is genuinely best, keep it. The test is that nothing survived by default or by copying.
- Ground-up applies to layout and information architecture; the implementation still reuses existing components, hooks, and services.

## Simplicity and Progressive Disclosure

- Show only what the user needs for the current task; everything else behind disclosure (expandable sections, drawers, overflow menus, drill-downs). Draw the disclosure closed in the mockup.
- One clear primary action per view. Fewer, larger, clearer elements; empty space is a feature.
- "A stakeholder might want to see it" is a reason for disclosure, not for the default view.

## Build Phase — exactly like the artifact, in this order

7. The artifact is the contract — same sections, hierarchy, labels, actions, states, and disclosure. If something is infeasible, raise it; never silently deviate. Two explicit carve-outs ARE the exact match, not deviations:
   - **Responsive adaptation**: stacking, table-to-card collapse, overflow menus on narrow screens.
   - **Localization**: every label/heading/button ships through the project's i18n mechanism (named in `CLAUDE.md`) with keys in ALL the project's locale files; "exactly" means the rendered default-language output matches. A hardcoded string or missing key = not done.
8. Build the implied scope in this order — each step complete before the next:
   1. **DB**: declare models, generate and apply via the project's migration manager.
   2. **Backend**: routes → controllers → shared functions; permissions, tenant scoping, pagination.
   3. **Frontend**: components matching the artifact's sections and hierarchy; every linked page.
   4. **Live wiring**: every mutation emits its event; every view showing that data subscribes and reconciles — a page that needs refresh is a stub.
   5. **States**: layout-matching skeletons, translated errors with retry, empty states; growing lists server-paginated.
   6. **Element walk + verify** (below).
9. **Element walk**: walk the approved artifact top to bottom; for each section and control, record the implementing file and status (`done` / `deviation-raised`). Unwalked elements = unbuilt scope. No dangling anything: no dead buttons, placeholder pages, fields that render but never persist, or leftover mockup sample data.

## Delegation

- Mockup construction can go to a subagent per context-lean-orchestrator, briefed with the delegation-brief template of operating-discipline §8; the brief additionally carries the design goals, the grounding table, and the fidelity bar (states, responsiveness, realistic data). The orchestrator reviews the result, publishes the Artifact, and drives iteration.
- The approval conversation is never delegated — the orchestrator presents the mockup, gathers feedback, and holds the approve/build decision with the user.

## Verify Before Finishing (runnable)

- Build/lint pass; app launched; every artifact element exercised against real data (happy + failure paths)
- Browser console clean; two-window live-update check on every mutation the feature performs
- Phone (360px — or the narrowest width the project's definition of done names) / tablet / desktop widths; both themes
- Locale scripts pass (all locale files have every new key); new pages reachable from navigation
- The new/changed feature's in-app help doc updated in the single-source doc module; any guided tour covering the flow added or updated and re-run (see guided-onboarding-walkthroughs)
- Plus the project `CLAUDE.md` definition of done
- Critique pass per operating-discipline §6, run twice: on the mockup before publishing (lenses: grounding-table consistency, implied-scope completeness) and on the build before this report

Close the build report with the element walk, a deviations table (what / why / when the user approved it), and each verify item as **pass / fail / not run** — never imply a skipped check passed (operating-discipline §6–7).

## STOP mid-keystroke and re-check if

- You are writing product code and cannot paste the approved artifact's URL and version
- Your "redesign" mockup is recognizably the old layout rearranged; or it's a gray-box placeholder
- You typed a sample value you didn't derive from real app logic (grounding table has no source row)
- You are treating "nice!" as approval, or building while the implied-scope inventory is stale
- You are shipping the visible page while implied scope (pages, endpoints, migrations, live updates) is unbuilt
- You hardcoded the artifact's English strings to honor "exactly"

## Final Rule

No product code before an approved Artifact mockup. Redesigns start from the job, not the old layout. And when the user says build it: build exactly the approved artifact — responsive, localized, live-updating, fully wired to the real database, with nothing dangling.
