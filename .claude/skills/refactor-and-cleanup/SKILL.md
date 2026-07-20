---
name: refactor-and-cleanup
description: "Use when the user asks to clean up, tidy, simplify, polish, or refactor existing working CODE (readability, duplication, oversized files, tangled logic) while preserving behavior. Has an in-place mode when the user says 'in place' or 'no new files'. Not for visual redesigns ('redesign', 'modernize the look' → artifact-mockup-first), new features (codebase-aware-implementer), or bug fixes (root-cause-debugger)."
---

# Refactor & Cleanup

## Purpose

Make working code easier to read, maintain, and extend — while provably preserving behavior, side effects, and performance. "It looks cleaner" is not the bar; "it still demonstrably works and nothing load-bearing was lost" is.

Portable across projects; the project's `CLAUDE.md` names its concrete commands and side-effect helpers. LOAD the operating-discipline skill now, before Workflow step 1, and fill its templates from its text, not from memory ("section N" below = operating-discipline section N).

## Modes

- **Default mode**: splitting oversized files and extracting focused modules is allowed and encouraged (React decomposition specifics: react-ui-builder).
- **In-place mode**: activates ONLY when the user literally says "in place", "without new files", or equivalent — then no new files or folders.

## Use This Skill When

- The user asks to clean up, tidy, simplify, polish, or refactor existing code
- Reducing duplication, splitting oversized files, flattening tangled logic, improving naming

## Do Not Use This Skill When

- The request is about visual design or layout ("redesign", "modernize the look", "rethink this page") → artifact-mockup-first
- Building new features (codebase-aware-implementer) or diagnosing a bug (root-cause-debugger)
- Cleanup would widen a narrow bug-fix task without being asked

## Consent Gate

If the user explicitly asked for cleanup, be aggressive within the requested area. If cleanup is merely an opportunity you noticed, ask before doing it.

## Preservation Rules — what a refactor must not lose

1. **Side effects are behavior, not noise.** Websocket emits, cache invalidation, and queue/worker wiring must survive. A dropped emit is a refactor-induced bug; done-gate item 1 proves each still fires.
2. **Load-bearing "clutter" carve-out — never delete as noise:** memoization (`useMemo`/`useCallback`/`React.memo`), debounce/throttle, loading/skeleton/error/empty states, optimistic-rollback state, guard clauses, structured logging, and breakpoint-differing JSX (it looks duplicated; it isn't — check `sx` breakpoints/`useMediaQuery` before consolidating).
3. **Highest-tier lines — preserve byte-for-byte:** tenancy/permission filters in queries and middleware, and money/precision arithmetic. A "simplified" where-clause that drops a tenant filter is the worst possible refactor outcome. Any change to these is out of scope for a cleanup — surface it to the user, never absorb it.
4. **Performance shape:** extracted helpers must not turn one bulk query into per-item queries (N+1); extracted components are defined at module scope, never inside a render body; memo wrappers and list keys carry over.
5. **Reference integrity:** after any move/split/rename, zero stale references to old paths or identifiers (done-gate item 2). Delete superseded code and files; no re-export shims, no commented-out originals.
6. **Comments:** preserve comments about code that still exists; comments describing code you deleted go with the code. Don't rewrite comments unless asked.
7. **Contracts:** public APIs, props, exports, and call sites stay compatible unless the user asked otherwise.
8. **Localization:** restructured JSX must not inline hardcoded strings or lose i18n wiring; run the project's locale scripts if user-facing text was touched.
9. Schema stays on the project's migration manager — never hand-written migration files during a refactor.

## Workflow

1. **Intake (section 1).** Write the INTAKE block; quote the user's request VERBATIM at the top — the exact words decide the mode (in-place trigger) and the consent-gate boundary. The affected-surfaces inventory lists, per target file: exports and their consumers (grep, file:line), side-effect calls (notify / invalidate / enqueue / emit — feeds rule 1), and public contracts. Rules 1, 5, and 7 are verified against this list, not from memory.
2. **Identify the real maintenance problem** (duplication with actual cost, oversized files, unclear names, mixed responsibilities, deep nesting) and choose the smallest refactor that fixes it. A claimed "duplicate" is a premise (section 2): diff the candidates' full bodies AND their call-site argument shapes before merging — any behavioral difference (timezone handling, defaults, rounding, side effects) is surfaced, never absorbed into whichever copy survives. Record one DECISION line (section 5): problem → chosen refactor → rejected alternative + one-line why. No speculative abstraction; don't trade a mess for a more abstract mess.
3. **Capture the baseline.** Before the first edit, execute the code's runnable path(s) and record the observable behavior (command output, response bodies, rendered states) in the working notes. "Behaved identically" at the gate means identical to THIS record — without it there is nothing to compare against.
4. **Refactor** within scope. Read every file in full before restructuring it — never refactor from grep snippets. In default mode split/extract as needed; in in-place mode edit current files only.
5. **Run the done-gate** — every item, reported pass / fail / not run:
   1. Side effects: grep each pre-refactor file AND its replacement for `notify|invalidate|enqueue|emit|queue` PLUS every side-effect helper the project's `CLAUDE.md` names (audit-log, event-publish, and similar helpers match none of the five generic tokens) — every pre-refactor hit accounted for on the same success path.
   2. References: repo-wide grep for every old identifier AND every old path — zero hits; superseded files deleted.
   3. Contracts: export/props list before vs after — identical unless the user approved the change (rule 7).
   4. Localization: locale scripts run if user-facing text moved.
   5. Behavior: re-run the baseline paths from step 3 and compare — identical observable behavior; lint/build pass. Static-check-only completion is permitted ONLY when no runtime path exists, and it goes under Not run explicitly. Then apply the `CLAUDE.md` definition of done.
   6. Critique pass on the diff per operating-discipline §6 (lenses that fit a refactor: correctness, preservation rules 1–3, reference integrity).
6. **Report** with the REPORT template (section 7): grep results as counts, not vibes. Dead code or a latent bug discovered mid-refactor goes under Surprises — a latent bug is surfaced, never silently fixed (that is root-cause-debugger work and the user's call).

## Delegation

- **Sweep-scale refactors** (one pattern, many files) fan out per context-lean-orchestrator: per-directory workers with disjoint file ownership apply the pattern; one integrator runs the done-gate on the combined tree and commits.
- **Single-file cleanups stay inline** — no fleet for what one focused edit does.

## Anti-Patterns

- Deleting a "redundant-looking" emit, invalidation, debounce, memo, guard clause, or loading state
- Touching a tenancy filter or money arithmetic as part of a "simplification"
- Restructuring a file you have not read in full this session
- Consolidating JSX that differs by breakpoint; defining extracted components inside render bodies
- A rename/move that leaves one stale import; superseded files left beside their replacements
- "Verified" by re-reading the diff instead of running anything; scope creep into unrelated areas
- Declaring done with "no new errors" while never executing the code
- Plus the full operating-discipline STOP list (section 9)

## Final Rule

A refactor is finished when the code is simpler AND the done-gate proves nothing load-bearing was dropped AND the refactored flow was executed and matched the recorded baseline. Anything less is a prettier diff, not a refactor.
