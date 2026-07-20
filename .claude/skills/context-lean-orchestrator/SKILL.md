---
name: context-lean-orchestrator
description: "Use for any substantive multi-step task — one spanning 2+ areas/subsystems, needing unbounded reading, or having phases: features across files/areas, codebase mapping, migrations, audits, reviews, large builds, research. Makes the agent work as an ORCHESTRATOR: delegate the work to subagents, keep its own context lean by exchanging FILES (briefs, maps, reports in the scratchpad) instead of pasted content, require subagents to return only decision-relevant summaries, and read back only the sections it needs. Not for single-file edits, one-off lookups, or conversational answers."
---

# Context-Lean Orchestrator

## Purpose

Big tasks die two deaths: the agent drowns its own context reading everything itself, or it serializes work that could run in parallel. This skill makes the agent operate the way a good tech lead does — **hold decisions, not file contents**. The orchestrator designs, dispatches, integrates conclusions, and verifies; subagents do the reading, writing, and testing. Context is managed by moving information through **scratchpad files**, not through prompts and transcripts. The orchestrator and every subagent follow the **operating-discipline** skill — LOAD it now, before Step 0, and fill its templates from its text, not from memory. This skill adds the fleet mechanics on top; state that lives in files and commits survives long sessions and interruptions.

## Inline vs delegate — countable criteria

- **Inline** when: the task touches one file, OR is answerable by ≤3 targeted Grep/Read calls, OR is purely mechanical. Never spawn an agent for what a single tool call does.
- **Delegate** when: the task spans ≥2 independent areas/subsystems (multi-file work inside ONE feature area stays inline while it fits one agent's context), OR you cannot bound how much reading it needs, OR it has phases (map → design → build → verify), OR it risks exhausting your context before completion.
- State which branch you took whenever it isn't obvious. Delegation buys throughput and context preservation, not ceremony.

## Step 0 — Intake before any dispatch

1. Write the operating-discipline INTAKE block (goal + observable done-means, constraints VERBATIM, affected areas, knowns, unknowns split blocking vs deferrable, risks) into the arbiter or brief file — never only in your head.
2. **Verify premises.** Any claim the plan depends on — from the user, memory, or an earlier map — is checked against the current tree (a targeted grep, or a mapper agent) before builders are dispatched. A false premise found later invalidates work built on it: stop the affected agents, headline the finding to the user, re-plan.
3. **Blocking unknowns get mapper/research agents BEFORE any builder.** Criterion: if the unknown would change what a builder writes, it is blocking — map first, never build-then-discover.
4. Write the arbiter doc before build agents start: each decision, one-line why, and the rejected alternative (operating-discipline DECISION lines).

## Core Rules

1. **Delegate by default for substantive work.** The orchestrator's own tool calls should be: writing briefs/contracts, dispatching agents, targeted reads of summaries/sections, decisions, and user communication. If the orchestrator is reading whole source files or writing feature code itself on a multi-area task, it is doing the subagent's job with the architect's context.
2. **Exchange files, not pasted content.** Write task briefs, design contracts, and shared context to the session scratchpad; agent prompts stay short and POINT at those files ("Read X first"). One brief file serves many agents and survives interruptions. Never paste large file contents or prior agent output into a prompt when a path reference works.
3. **Subagents return only what the orchestrator needs to decide next** — the Return shape of the operating-discipline §8 brief — and write full detail (inventories, payload shapes, evidence) to scratchpad files that *later agents* read directly. Tell every mapper/researcher explicitly: "the reader of your report will NOT have the files — be exhaustive in the file, minimal in the return."
4. **Scratchpad is working memory.** Large outputs (codebase maps, specs, findings, fixture data) become named files: briefs (`*-brief.md`), maps (`map-*.md`), contracts (one ARBITER doc that wins all conflicts), reports (`*-REPORT.md`), staged fragments. Split oversized results into per-topic files so consumers read only their slice.
5. **Deviations from the arbiter are never silently absorbed.** Agents report them in their return's Surprises & deviations field; the orchestrator surfaces every one to the user in its next message with the reason. Mid-work choices the orchestrator can own: pick one, state why in one line, note the runner-up, proceed — never an options menu for decidable things, never deciding what the user explicitly owns.
6. **Read sections, not files.** Before reading anything large, locate what's needed: grep for headings/symbols, then Read with offset/limit. Read summaries and conclusions; skip detail sections until a decision requires them. Never re-read unchanged files; never read a subagent's raw transcript (extract its structured result instead).
7. **Fan out with disjoint ownership.** Partition parallel agents by directory/file ownership and state the boundary in every brief ("you own X; never touch Y — another agent owns it"). Shared invariants that span two agents become an explicit two-sided contract written into BOTH briefs (each side implements its half to the stated contract).
8. **Git discipline for fleets.** Agents stage ONLY their owned paths explicitly — `git add -A` is forbidden in shared trees; retry transient index.lock; either one committer per tree at a time, or workers leave changes uncommitted and a single **integrator** commits.
9. **Integrator pattern.** When many workers produce parts of one surface (components, sections, resources), workers do not wire or commit; one integrator reconciles collisions, wires registries/mounts/manifests, runs every gate (the enumerated battery defined in Verification fleets step 4) plus the STOP checklist below, fixes or drops broken parts (recorded), and commits. Workers' returns include a `notes_for_integrator` field.
10. **Shared hot files are never edited in parallel.** Locale dictionaries, registries, barrel files, lockfiles: parallel agents stage per-agent *fragment* files in the scratchpad; a dedicated merge step composes the real file once, with parity checks. Interim code carries safe defaults (e.g. defaultMessage) so the tree stays green before the merge.
11. **Recursive delegation.** Subagents may spawn their own subagents for independent sub-parts, under the same rules: their children return minimal, they integrate, they own their boundary, and every brief passes the operating-discipline requirement down. Children obey the same Inline-vs-delegate criteria — a subagent never delegates work answerable by ≤3 targeted reads, and never nests more than one additional level without surfacing the reason to the orchestrator.
12. **Recovery over restart.** When an agent is interrupted or stalls waiting on dead children: resume it with a message that says re-orient first (git status/log, inspect the tree and scratchpad), do not redo committed work, do not wait for notifications — verify children's artifacts directly. Design every pipeline for this: each agent's output is durably checkpointed — files written, commits made, a line appended to a result journal — BEFORE the next stage depends on it, so committed work + scratchpad files ARE the checkpoint and any agent can die without losing progress. On interruption, RESUME the pipeline, never restart it: the completed prefix replays from its checkpoints; only the **tail agents** — the not-yet-finished stages at the end of the pipeline — run again. "Tail agent" names a pipeline POSITION, not a different kind of agent: tail agents are ordinary subagents that happen to be the ones still unfinished. Resume procedure:
    1. List the expected checkpoint artifacts of every completed stage and verify each actually exists on disk / in git — never trust a journal entry or a memory of completion without its artifact.
    2. Mark verified stages done and never re-run them.
    3. Re-dispatch only the unfinished tail, pointing its briefs at the verified checkpoint files.

## Brief template — every dispatch instantiates this into a scratchpad file

Instantiate the BRIEF template of operating-discipline §8 verbatim (goal + done-means, constraints VERBATIM, ownership boundary — including paths the USER owns, not only other agents — contracts/arbiter path, discipline line, required return shape). Do not restate or improvise the template; that section is the single copy. Fleet addition: when an integrator exists, the return also carries `notes_for_integrator`.

The agent's prompt points at the brief file; it does not restate it.

## Verification fleets — numbered procedure

This procedure is the orchestrated form of operating-discipline §6's critique pass — distinct critic lenses, concrete failure scenarios required, fix then re-check.

1. **Find:** parallel finder agents with distinct lenses (security/tenancy, data & money, correctness, compatibility, UX), each finding delivered in the operating-discipline FINDING shape: claim / evidence file:line / failure scenario / severity tier / proposed fix.
2. **Refute:** each finding goes to an independent refuter; default-refute unless the concrete failure scenario holds against the real code. Refuters return exactly: `verdict: CONFIRMED | REFUTED / counter-evidence: <file:line> / basis: <what I read or executed>`. A refutation without file:line counter-evidence is itself discarded and the finding stands as PLAUSIBLE for the fix step — a hunch cannot kill an evidenced finding. No inputs/state → wrong-outcome scenario in the original finding means it is a hunch — discard.
3. **Fix:** confirmed findings clustered by file ownership into fix agents that verify-before-fixing and may skip with written reasons.
4. **Gate:** ONE final gate agent runs the full battery on the combined tree and returns pass / fail / not-run per item. The battery = the project CLAUDE.md definition of done PLUS the union of every brief's verify items; the gate brief enumerates them item-by-item — an unenumerated "run the battery" is not a gate, because the gate agent cannot report not-run items it never knew existed.

## Integrator / final-gate STOP checklist

Run before accepting any fleet's output; on a hit, stop and act:

1. A return says "should work" / "likely fixed" without an executed check → send that agent back to execute it.
2. `git status` shows files outside every brief's ownership boundary → identify the author agent; revert or justify each file before integrating.
3. A finding lacks a concrete failure scenario → discard as a hunch.
4. A return is missing its Not run or Surprises & deviations fields → treat all its checks as not run until the agent restates them.

## The Standard Shapes

- **Map:** parallel readers over subsystems → structured maps to scratchpad → orchestrator reads summaries/conventions/gotchas only; detail sections stay on disk for builders.
- **Design:** competing proposals from distinct lenses → adversarial judges score → one synthesizer writes the final spec file; orchestrator reconciles it against the arbiter contract (arbiter wins, deltas surfaced to the user).
- **Build:** briefs reference contracts by path → phase leads with disjoint ownership (may sub-delegate) → verify-as-you-go → logical commits per phase.
- **Fleet + integrator:** N workers on partitioned units, no commits → integrator wires, gates, commits.
- **Review:** the four-step verification fleet above.
- **Merge phase:** staged fragments → one merger with parity/quality checks → tooling updated to recognize any new reference patterns so checkers stay accurate.

## Orchestrator's report to the user

Use the operating-discipline REPORT shape: **Outcome first** / Key facts / Surprises & deviations from the arbiter (never buried) / **Not run:** every gate or battery item that did not execute — never state or imply a check passed that did not run / Paths. Skipped gates are listed, not implied green.

## Anti-Patterns — STOP and re-check if you catch yourself

- Orchestrator reading entire large files "to understand" when grep-for-headings + one section read would do
- Pasting file contents or a previous agent's full report into a new agent's prompt instead of a path
- A subagent returning a transcript-sized dump to the orchestrator instead of writing a file and returning the pointer + summary
- Reading a subagent's raw transcript/output file into the orchestrator's context
- Two agents editing the same file concurrently; any fleet member running `git add -A`
- Dispatching a builder while a blocking unknown is still open
- Spawning an agent for a single lookup; or conversely, the orchestrator hand-implementing a multi-area feature inline
- Re-running a whole fleet after an interruption instead of checking what already landed on disk/in commits
- Verification theater: findings with no concrete failure scenario, or fixers that "fix" without first confirming against the real code

## Final Rule

The orchestrator holds the plan, the contracts, and the decisions; everything else lives in files and subagents. If your context is filling with file contents instead of conclusions, you have stopped orchestrating — write it to the scratchpad, brief an agent, and read back only what you need to decide.
