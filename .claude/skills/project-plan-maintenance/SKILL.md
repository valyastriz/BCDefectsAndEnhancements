---
name: project-plan-maintenance
description: "Use after any verified change that adds, changes, or removes a feature, functionality, architecture, data model, API, or workflow — fires after the change is verified working, before reporting the task complete. Keeps a single plan.md at the project root accurate. Bug fixes and env/config changes count; typo/comment/formatting-only edits, test-only changes, and behavior-preserving refactors do not."
model: haiku
---

# Project Plan Maintenance

## Purpose

Every project keeps a single `plan.md` at its root as the living source of truth for what the project is, how it works, and what has been built. Read the relevant parts before working; update the affected sections after every substantive change. The document must never claim something works that has not been observed working.

## Use This Skill When

- Adding, changing, or removing a feature, behavior, workflow, or business rule
- Changing architecture, data models, schemas, APIs, integrations, or services
- Making any decision a future contributor would need to know

Decision line: update if the change alters behavior, data shape, API surface, setup steps, or a recorded decision — bug fixes, dependency bumps that change behavior, and env/config changes all count. Skip only test-only changes, behavior-preserving refactors, and typo/comment/formatting edits. If unsure, update — a stale skip costs more than a spare line.

## Core Rules

1. `plan.md` lives at the project root. If it does not exist, create it per "Creating plan.md" below.
2. **Read before working — scoped.** Read the Overview/Architecture plus the sections relevant to your task. Read the whole file only when the task itself is architectural. Do not re-read unchanged sections you already have in context.
3. **Update after working.** A change without its `plan.md` update is incomplete. In multi-agent work, workers do NOT edit `plan.md` — it is a shared hot file (context-lean-orchestrator): each worker puts its mapping lines (the After-Working shape below) in `notes_for_integrator`, and the integrator applies all `plan.md` updates in one edit.
4. **Keep it accurate, not append-only.** Edit the sections the change made stale; remove contradictions.
5. **Altitude is by content type.** Describe each system at the level of responsibilities, contracts, entry-point files, and invariants — never line-level narrative that duplicates the code. Dated implementation stories, commit hashes, and replaced-component lists belong in one-line Changelog entries, not in sections. Micro-example:
   - BAD (as section text): "2026-07-12: replaced OrderTable with OrderGrid, updated orders_controller.js" — that is a Changelog line only.
   - GOOD (as section text): "Orders list: server-paginated grid; entry `views/orders/`; invariant: rows are tenant-scoped and live-update via order-updated events."
6. **Gate "done" on verification — STOP first.** Before writing `done`, STOP: did you (or the report you are recording) actually observe it working end-to-end per the project's definition of done (see the project's CLAUDE.md)? If not, it stays `in progress` with what's left listed under Plan / roadmap. Every `done` carries its evidence in the `(verified: <how/when>)` field of the Features line format below — a `done` with no evidence is not done.
7. **Record the why** — decisions, trade-offs, and constraints not obvious from the code.
8. **One file, one arbiter.** When other root-level docs already exist, `plan.md` links to them once and owns the architecture narrative; new documentation goes into `plan.md`, not new root files. Where `plan.md` and another doc disagree, `plan.md` is the arbiter for architecture/feature truth ACROSS sessions — correct the other doc or delete the duplication. Exception: a task's in-flight session arbiter/decision doc (operating-discipline section 5) governs while that task runs; its decisions are reconciled into `plan.md` at task end. Cross-cutting coding invariants (live updates, tenancy, localization, pagination) live in the project's CLAUDE.md — do not duplicate them here.
9. **Never record secrets.** Document env var names and where config lives — never values, connection strings, or keys.
10. **When code contradicts `plan.md`, the code is the truth.** Fix the stale section in the same session and surface the contradiction at the TOP of your report — a false premise is a headline, never a footnote (operating-discipline section 2) — because other work may be built on the old claim.

## Creating plan.md

- **New/empty project:** create the file from the skeleton below, filling what is known and leaving `<placeholders>` where nothing is known yet.
- **Existing codebase without plan.md:** inventory FIRST — glob/grep the routes, models, and views (or the project's equivalents). Populate Features only from surfaces you actually observed, each with a file reference. Any status you did not verify is written `status: unverified` — never `done`.

Skeleton (use literally):

```markdown
# <Project name> — Plan

## Overview
<what the project is, who it is for, the problem it solves>

## Architecture
<major components, how they communicate, key technologies — one line each>

## Data model
<entity> — <purpose; key relations>

## Features
- <feature> — <what it does; entry file/dir> — status: planned | in progress | done (verified: <how/when>) | unverified

## Key decisions & constraints
- <decision> — why: <one line> — rejected: <alternative>

## Plan / roadmap
- <next item or known gap>

## How to run & develop
<setup steps, env var NAMES only, how to extend>

## Changelog
- <date>: <one line per notable change>
```

## After Working — Compliance Check

1. Run `git diff --stat` (or review your file list).
2. Write the mapping into your session report — one line per changed area, in this exact shape:
   `<area> → <plan.md section> → updated | no-change-because-<reason>`
3. Update feature statuses (with their `(verified: <how/when>)` evidence) and add the one-line Changelog entry.

An unwritten mapping is not a check — if the lines are not in the report, the check did not happen.

## Anti-Patterns

- Appending notes without fixing the now-outdated sections they contradict
- Pasting dated, commit-level narrative into sections instead of the Changelog
- Marking a feature done in `plan.md` while it still has stubs, was never exercised, or has no `(verified: ...)` evidence
- Populating Features for an existing codebase from memory instead of an observed inventory
- Scattering planning notes across new root files instead of `plan.md`

## Final Rule

No substantive change is complete until the affected `plan.md` sections tell the true, current story of the system — at responsibilities-and-contracts altitude, with "done" meaning verified working and carrying its evidence.
