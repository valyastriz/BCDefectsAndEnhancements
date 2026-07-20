---
name: operating-discipline
description: "The shared operating method behind every other skill. Use at the start of any non-trivial coding, analysis, review, or multi-step task — anything beyond a one-line answer or a single mechanical edit — and whenever a domain skill says 'per operating-discipline'. Provides the intake block, premise verification, the ordered blast-radius scan, prioritization rules, decision records, claim/verification standards, the report and delegation-brief templates, and the red-flag STOP list. Not a substitute for domain skills — it is the procedure layer they all share."
---

# Operating Discipline

Weaker models do not infer unstated judgment — they follow explicit text and fill templates. This skill IS that text: execute its procedures literally and fill its templates verbatim. Domain skills add domain rules on top; on domain content the domain skill wins, on operating method this skill wins. Portable: project facts (ports, paths, commands) come from the project's CLAUDE.md, never from here.

## 1. Intake — before any edit or dispatch

Write this block into your working notes (a scratchpad file for multi-step work). It is a deliverable, not a mental note:

```
INTAKE
Goal: <one sentence, ending with what "done" observably means — a command that exits 0, a screen that renders X, a report delivered>
Constraints (VERBATIM): <quote the user's exact constraint sentences — paraphrase loses requirements>
Affected surfaces: <file:line for every call site, consumer, and dependent — grep-driven, rule 1 below>
Knowns: <facts verified, each with file:line or command evidence>
Unknowns — BLOCKING: <would change what you build — resolve BEFORE building>
Unknowns — deferrable: <note and continue>
Risks: <top items from the blast-radius scan, section 3>
```

1. **The affected-surfaces inventory is grep-driven and written down BEFORE the first edit.** Grep every symbol, endpoint, table, event name, and route the change touches; list each consumer/reader/writer with file:line. If you cannot name who else reads or writes a thing you are about to change, intake is not finished.
2. **Resolve blocking unknowns first** — map → design → build, never build-then-discover. Criterion: if the answer would change what you'd write, the unknown is blocking.
3. Do not skip intake because the task "looks small." For a mechanical single-file edit the block may be four lines — write it anyway.

## 2. Premise verification

- Every claim about how the system works — from the user, docs, memory files, a plan file, an earlier report, or your own assumption — gets checked against the current code (targeted grep/read, or run the thing) before work builds on it.
- The user's description of a bug or behavior is also a premise. If reality differs (different trigger, different scope, not actually broken), that difference IS the finding.
- **A discovered false premise is the headline of your very next message, never a footnote** — it invalidates everything built on top of it. Stop dependent work until the decision-holder re-confirms direction.

## 3. Blast-radius scan — ordered; higher tiers block lower ones

Run at intake and again at every change point. Check and fix in this order; NEVER ship a lower-tier item while a higher-tier item is open, and never polish before correctness:

1. **Security / tenancy** — authentication, permissions, tenant scoping on every query and broadcast, data egress, injection, secrets in logs.
2. **Data integrity & money** — money is never float/double (DECIMAL or integer minor units); transactionality; state after partial failure; idempotency; anything irreversible.
3. **Correctness** — the change does what was asked, including the failure path (invalid input, failed request).
4. **Compatibility / migration** — existing consumers, schemas, stored data, public contracts. Prefer additive and backward-compatible on live systems; destructive or irreversible operations (drop/rename/mass-update/delete) require an explicit gate: dry-run first, then user sign-off. A dry-run means showing the decision-holder the exact statements/files that would change plus the affected-surfaces inventory for them; the sign-off must reference that output — sign-off on a one-line intent ("I will rename the table") is not the gate.
5. **UX** — loading/empty/error states, responsiveness, live updates.
6. **Polish** — naming, dedupe, style.

At each change point answer, in writing when non-trivial: who else reads/writes this? What races? What happens on partial failure? What breaks on rename/reorder/retire? What does this do to live production data?

## 4. Prioritization

- De-risk before you invest: blocking unknowns and highest-tier blast-radius items first; cheap-and-certain before expensive-and-uncertain.
- Cost floor: one targeted Grep/Read beats an agent; an agent fleet beats one context drowning in files. State which you chose when it isn't obvious. (Fleet mechanics: the context-lean-orchestrator skill.)

## 5. Decisions

- **Record before the work**: what was decided, one-line why, and the rejected runner-up. Multi-area work gets ONE arbiter document that wins all conflicts **while the task is in flight**; at task end its decisions are reconciled into the project's `plan.md`, which is the arbiter ACROSS sessions (project-plan-maintenance).
- Mid-work choice you can own: pick one, state why in one line, note the runner-up, proceed. Never present an options menu for something you can decide; never decide something the user explicitly owns (scope, destructive operations, public/cross-repo contracts, spending).
- **Deviations are surfaced, never silently absorbed**: any departure from the arbiter, the record, or the approved plan is reported to the decision-holder with a reason — in the report's Surprises & deviations line, and immediately if it threatens a standing decision.

```
DECISION: <what> | why: <one line> | rejected: <runner-up + one-line why not>
```

## 6. Claims & verification

A reported issue COUNTS only in this shape; anything less is labeled a **hunch**, never a finding:

```
FINDING
Claim: <one sentence — the defect>
Evidence: <file:line>
Failure scenario: <these inputs / this state → this wrong outcome>
Severity: <tier number from section 3>
Proposed fix: <one line>
```

- Verify by **executing the real path** — run the test, hit the endpoint, boot the app, click the flow — never by re-reading code you just wrote. Exercise the failure path, not only the happy path.
- **Never state or imply a check passed that did not run.** Every verification item reports pass / fail / not run + why. If a probe lacks a fixture (second tenant, unprivileged user, second browser), first try to create the fixture and run it; only if genuinely impossible does it go under `Not run:` — it never appears in the passed list.
- **Critique pass — after producing any substantial artifact, BEFORE declaring it done.** Substantial = a spec/design doc, a sizable diff, a migration, or a user-facing deliverable. Procedure: critique the artifact from independent perspectives with DISTINCT lenses, picking the lenses that fit it (correctness, security/tenancy, consistency-with-sources, migration/rollout safety); each critique must state a concrete failure scenario (these inputs / this state → this wrong outcome) or it does not count; fix confirmed issues, then re-check the fixed artifact against the same lenses. Solo inline work: self-critique against those lenses, written into the working notes. Orchestrated work: independent critic agents per context-lean-orchestrator's verification-fleet procedure — follow it there, do not improvise a variant.

## 7. Reporting

Every report — to the user or to a calling agent — uses this shape, in this order:

```
REPORT
Outcome: <what happened / what was found — always first>
Key facts: <minimal decision-relevant list, file:line cited>
Surprises & deviations: <false premises, arbiter deviations, latent bugs discovered — NEVER buried; "none" if none>
Not run: <every check skipped or impossible, with why — "none" if all ran>
Paths: <files holding the exhaustive detail>
```

- Exhaustive detail (inventories, evidence, payload shapes) goes in FILES; the reader of your return does not have your context, so each file must stand alone. The return itself stays minimal.
- Complete sentences; technical terms spelled out; no invented shorthand or codenames; file:line for every factual claim.
- A latent bug discovered mid-task is reported under Surprises — not silently fixed and not silently dropped.

## 8. Delegation brief

Every hand-off to a subagent instantiates this template into a brief file the agent is pointed at (fleet mechanics, ownership partitioning, and integrators: the context-lean-orchestrator skill):

```
BRIEF: <task name>
Goal + done-means: <one sentence, observable>
Constraints (VERBATIM): <the user's exact words>
You own: <paths>   You must NOT touch: <paths — another agent or the user owns them>
Contracts: <path to the arbiter doc; shared invariants are written into BOTH sides' briefs>
Discipline: follow the operating-discipline skill — write your own INTAKE block, verify premises, run the STOP list, report pass/fail/not-run honestly
Return exactly: the REPORT template of operating-discipline section 7 (+ notes_for_integrator when an integrator exists)
```

## 9. STOP list — halt mid-keystroke and re-check when you catch yourself

1. Writing "should work" / "likely fixed" instead of demonstrating it works.
2. Editing a file you have not read this session; trusting a description of code over the code itself.
3. Matching or joining on a NAME/string where an id exists (a rename becomes a silent unlink).
4. Float/double for money; an unbounded/unpaginated query; fetch-all-then-filter in application code.
5. An empty catch, an ignored rejected promise, or an auth/permission error path that fails open; a "temporary" hack with no written removal path.
6. Copy-paste-adapting a sibling whose shape you cannot explain in one line — read it end-to-end first.
7. Testing only the happy path; skipping the failure path.
8. `git status` / the diff showing files the task does not implicate — revert or justify each before continuing.
9. About to mark an item done whose verification you did not execute — move it to `Not run:` instead.

On any trigger: stop, re-check against the relevant section above, fix or surface, then continue.

## Final Rule

Intake before edits, premises before plans, tiers before polish, evidence before claims, honesty before green checkmarks. If you cannot show the filled template, the step did not happen.
