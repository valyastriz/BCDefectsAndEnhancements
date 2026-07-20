---
name: codebase-aware-implementer
description: "Use when implementing, extending, or fixing code in an existing React or Node codebase: enforces inspect-first, reuse-first work that follows the project's established architecture, conventions, shared abstractions, and localization — instead of creating parallel solutions. The default skill for feature work in a mature repo. Not for scaffolding a brand-new project (new-project-creation), pure refactoring/cleanup (refactor-and-cleanup), pure debugging (root-cause-debugger), or visual redesigns (artifact-mockup-first)."
---

# Codebase-Aware Implementer

## Purpose

Make every change fit the codebase it lands in: inspect first, reuse existing building blocks, extend established patterns, and ship complete (verified, localized, live-updating) work.

Portable across projects: concrete names, paths, and commands live in the project's root `CLAUDE.md` — read it first (if absent, create one from the new-project-creation template as part of the task). LOAD the operating-discipline skill now, before Workflow step 1, and fill its templates from its text, not from memory ("section N" below = operating-discipline section N).

## Use This Skill When

- Adding a feature, endpoint, or UI to an existing codebase
- Extending shared components, hooks, services, utilities, or middleware
- Fixing bugs where established patterns must be preserved

## Do Not Use This Skill When

- Scaffolding a brand-new project (use new-project-creation)
- The task is pure refactoring/cleanup (use refactor-and-cleanup) or pure debugging (use root-cause-debugger)

## Behavior

0. New page/feature or redesign? Follow `artifact-mockup-first` before writing product code (approved mockup first).
1. Follow the project contracts in `CLAUDE.md`: definition of done, live updates, migration workflow, logging, localization, and code layout. Do not restate or improvise them.
2. **Search before building.** Before creating any file or abstraction, grep the concept name plus two synonyms across frontend and backend. Check the standard homes: the shared UI components directory, the hooks directory, the shared API client, backend `functions/` and `middleware/`. Reuse or extend what fits; create new only when nothing suitable exists — and then place and name it where similar code already lives.
3. **Evaluate fit before reusing:** does the candidate solve the problem fully or with a small extension, is it actively used, does reusing it improve consistency? Do not force a poor-fit abstraction. Record the pick as one DECISION line (section 5): `reused X` | `extended X with <what>` | `created new — candidates A/B failed criterion <which>`.
4. **Extending shared code is a regression risk.** Every usage site of the component/hook/service/middleware you are changing goes into the intake affected-surfaces inventory (file:line) BEFORE the first edit. Extensions must be backward compatible — optional props/params with defaults that preserve current behavior. When finishing, list the usage sites you checked — "checked" means the consumer's screen/flow was rendered or its test executed AFTER the change; sites you only re-read go under Not run.
5. **Mirror the nearest similar feature** for file placement and naming — never introduce a new top-level folder scheme. Before mirroring, read the sibling end-to-end and state in one line why it is shaped that way; never copy code whose purpose you cannot explain — you will clone its quirks and stale patterns along with its shape.
6. Keep changes focused on the requested task; no unrelated refactors or drive-by changes.
7. **Live updates:** every mutation you add emits the project's live-update event (house pattern: `notifyClients` in `backend/functions/webSocketUtils.js` — confirm in this project), and views showing that data subscribe via the project's ws layer. Acceptance: two windows open, mutate in one, the other updates without refresh.
8. **Scale defaults:** list endpoints paginate and filter in SQL — follow node-api-structure-enforcer's Query and Payload Rules for any backend work.
9. **Localization:** all user-facing text goes through the project's i18n system with keys added to every locale file; run the project's locale check scripts (see `CLAUDE.md`). Missing translations = incomplete work.
10. **Completion:** no stubs, TODOs, dead buttons, or unfinished flows. A user-facing feature isn't done until its in-app help docs reflect the change **and** any existing guided tour covering that flow is updated (steps + selector targets) and still runs end-to-end — see guided-onboarding-walkthroughs. Exercise the changed flow per the `CLAUDE.md` definition of done before reporting done.
11. New pages get registered in the project's navigation/menu registry and breadcrumbs (UI details: react-ui-builder).
12. Schema changes go through the project's migration manager (house pattern: declare in models, let database-manager generate) — never hand-written migrations.
13. Keep `plan.md` current per project-plan-maintenance.

## Workflow

1. **Read `CLAUDE.md`, then intake (section 1).** Write the INTAKE block WITH the project's definition of done open — its items (localization, live updates, tour/doc upkeep, etc.) belong in the done-means, not discovered late. Before the first edit the block holds: goal + observable done-means, the user's constraints VERBATIM, the grep-driven affected-surfaces inventory (file:line for every consumer/reader/writer of each symbol, endpoint, table, and event the change touches), and unknowns split blocking vs deferrable. Blocking unknowns are resolved by reading/mapping before any edit.
2. **Verify premises (section 2).** Check against current code that the endpoint/field/flow the request assumes exists and behaves as described. A false premise is the headline of your next message; dependent work stops until direction is re-confirmed.
3. **Inspect the files nearest to where the change lands**: structure, naming, state approach, API access, error handling, localization pattern.
4. **Search for existing solutions** (rule 2) and pick reuse/extend/create with rule 3, recording the DECISION line.
5. **Implement consistently** — same naming, placement, imports, error handling, and localization mechanism as the surrounding code. At every change point run the ordered blast-radius scan (section 3); tiers 1–2 (tenancy, money) block everything below them.
6. **Verify:** changed flow exercised end-to-end (happy + failure path), live-update check where data changes, usage sites of extended shared code checked (rule 4's definition — rendered/executed, not re-read), locale scripts pass, no duplicate abstraction created, `git status` shows only task files. On a sizable diff, run the operating-discipline §6 critique pass before reporting.
7. **Report** with the REPORT template (section 7): outcome first, every definition-of-done item marked pass / fail / not run — never state or imply a skipped check passed.

## Delegation

- **Map before implementing across unfamiliar areas** — per context-lean-orchestrator, fan out parallel mapper subagents that write structured maps to scratchpad files; read only their summaries, conventions, and gotchas. Detail sections stay on disk for whoever builds.
- **Multi-area implementation gets ownership-partitioned builder agents** (each owns its files; none touches another's) per context-lean-orchestrator. Single-area feature work stays inline.
- Every builder still follows this skill inside its boundary: search-before-building, backward-compatible extensions, localization, and the full verification list.

## Anti-Patterns

- Rebuilding a shared component because it wasn't found quickly — search first
- A second helper/hook/service with slightly different naming next to an existing one
- Changing a shared abstraction without checking its other consumers
- A mutation endpoint with no live-update emit, or a view that needs refresh to show changes
- Hardcoded user-facing strings, or a translation key added to only one locale file
- Introducing a folder scheme or state library the project doesn't already use
- Plus the full operating-discipline STOP list (section 9) — it applies mid-keystroke

## Final Rule

Make the code fit the codebase before making the code fit your preference — and nothing ships until it is reused-where-possible, localized everywhere, live-updating, and verified per the project's definition of done.
