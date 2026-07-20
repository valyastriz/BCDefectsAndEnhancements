---
name: root-cause-debugger
description: "Use when diagnosing and fixing a bug, regression, stale-data issue, broken flow, or an intermittent/unreproducible failure: enforces reproducing the failure before changing code, tracing the real execution path to the first wrong behavior, and re-running the reproduction after the fix. Not for building new features (codebase-aware-implementer) or pure refactors (refactor-and-cleanup)."
---

# Root-Cause Debugger

## Purpose

Fix causes, not symptoms — and prove it: the bug is observed failing before the change and observed fixed after it.

Portable across projects; the project's root `CLAUDE.md` names its concrete logger, ws layer, and commands. LOAD the operating-discipline skill now, before Workflow step 1, and fill its templates from its text, not from memory ("section N" below = operating-discipline section N).

## Use This Skill When

- A bug, regression, or intermittent failure needs fixing
- The UI shows incorrect or stale data
- An endpoint returns unexpected results or a flow breaks inconsistently

## Do Not Use This Skill When

- Building new features (codebase-aware-implementer) or refactoring working code (refactor-and-cleanup)

## Diagnosis record — a working-notes deliverable, not a mental note

Open this block before touching code and update it as evidence lands. The post-fix run executes its repro steps verbatim — if the steps aren't written, "the exact same reproduction" cannot exist:

```
DIAGNOSIS
Repro steps: <numbered, copy-runnable>
Expected vs actual: <one line each>
Hypotheses: <one per line: hypothesis | evidence for (file:line / log) | evidence against | open / refuted / CONFIRMED>
Confirmed cause: <first point of divergence, file:line, and the observation that proves it>
```

## Behavior

1. **Reproduce before changing code.** Run the flow, hit the endpoint, observe the bug actually happening. Prefer driving the real flow; a failing test counts only where a real suite already covers that surface.
2. **Re-run after the fix.** Execute the recorded repro steps verbatim and observe the expected result. Do not report fixed until both runs were executed, not reasoned about. Then apply the `CLAUDE.md` definition of done.
3. **Unreproducible bugs get honesty, not confidence.** For intermittent/environment-specific issues you cannot trigger: say so explicitly, state the evidence-based hypothesis and its confidence, and add the smallest targeted structured logging (project's shared logger) to catch the next occurrence — never assert a root cause you didn't observe.
4. Trace the real execution path (UI handler → state/hook → API call → route → controller → query → response → render) and find the **first** place behavior goes wrong. Verify assumptions about nulls, timing, payload shapes, permissions, and stale state — don't guess.
5. **Stale-data bugs: trace the live-update chain first.** Does the mutating path emit the project's ws event and invalidate cache, and does the affected view subscribe and reconcile? The root cause is usually a missing broadcast, invalidation, or subscription — fix that link. Never "fix" staleness with page reloads, refresh buttons, or polling.
6. **Regressions: use git history first.** `git log` / `git diff` / `git blame` on the affected files against the last known-good state is faster than re-deriving the cause from scratch.
7. **Performance bugs get root-cause treatment too.** A slow list is usually an unpaginated endpoint or an N+1 query — fix that (see node-api-structure-enforcer's query rules). Raising a timeout, slapping on a LIMIT, or memoizing the symptom is masking.
8. Apply the smallest safe fix; no unrelated refactors. **Escalation gate:** if the smallest safe fix requires changing a public contract, schema, or cross-repo payload shape, stop and surface the confirmed cause + proposed fix to the user before implementing — those are the user's to decide; a temporary mitigation is acceptable only with a written removal path. If the confirmed failure path lacked observability, add the minimal structured log through the project's logger while you're there.
9. New or changed user-facing strings still go through the project's i18n system with keys in every locale file — a bug fix that breaks six languages isn't a fix.
10. Schema changes during a fix go through the project's migration manager — never hand-written migration files as a debugging shortcut.

## Workflow

1. **Reproduce & record** — trigger the bug; fill the DIAGNOSIS repro steps and expected-vs-actual; note consistent vs intermittent. The user's bug description is itself a premise (section 2): if the reproduction shows a different trigger, a different scope, or no bug at all, that difference is the headline of your next message — otherwise you may fix a different bug than the one reported.
2. **Trace** — follow the path across layers; for regressions, diff against last-known-good; for stale data, walk emit → invalidate → subscribe. Rank hypotheses in the DIAGNOSIS block with evidence for AND against each; retire refuted ones in writing instead of drifting between them. Test order = cheapest decisive evidence first: if the flow ever worked before, `git log`/`git diff` since last-known-good is ALWAYS the first test — never start with expensive instrumentation while a 30-second history check is unrun.
3. **Confirm the cause** — the first point of divergence, verified by evidence (log, breakpoint, response inspection), not plausibility. Record it with file:line.
4. **Fix minimally** — cause, not symptom; rule 8's escalation gate applies. Before writing the fix, run the operating-discipline §3 blast-radius scan on the change point: a fix that adds an emit MUST carry the tenant filter, a fix touching a query keeps tenant scoping and money precision byte-for-byte — a fix that resolves the symptom while introducing a tier-1 leak is worse than no fix.
5. **Prove it** — re-run the recorded repro steps verbatim and observe the expected result. Then sweep neighbors mechanically: grep every other caller of the function/pattern you fixed and every consumer of the same data path; list them with file:line; exercise or explicitly defer each — deferred ones go under Not run. `git status`: every changed file must appear in the trace or the DIAGNOSIS record — revert or justify strays before continuing.
6. **Report** with the REPORT template (section 7): Outcome = cause + fix with file:line; Key facts include the before-run and after-run observations; deferred neighbors and skipped definition-of-done items under Not run — never imply an unexecuted check passed.

## Delegation

- **Multiple plausible hypotheses?** Dispatch parallel read-only evidence-gathering subagents per context-lean-orchestrator — one hypothesis each, returning only evidence and a verdict. The orchestrator weighs the verdicts and keeps the diagnosis decision.
- **Parallelize the investigation, never the fix.** Once the cause is confirmed, a single agent applies the smallest safe fix and re-runs the reproduction.

## STOP — halt and re-check when you catch yourself

- Editing code before ever observing the failure; declaring "fixed" without re-running the repro
- Patching from a stack trace or error message without opening the file it points at
- Random null checks, forced rerenders, reloads/polling, or timeout bumps that hide the cause
- Patching the UI when the API contract is wrong (or vice versa)
- Broad refactors mid-bugfix; asserting certainty about an unobserved cause
- Plus the full operating-discipline STOP list (section 9)

## Final Rule

No fix without a reproduction run before and after — against written, copy-runnable repro steps. Stale data traces through the live-update chain; regressions trace through git; slowness traces to the query. Fix the first wrong thing, prove it, stop.
