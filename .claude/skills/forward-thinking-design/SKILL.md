---
name: forward-thinking-design
description: "Use when deciding whether AI belongs in a feature, when the user asks to 'automate' or 'smart-detect' something that deterministic rules might solve (the go/no-go decision lives here), or when implementing AI-powered capabilities (document parsing, OCR, auto-translation, summarization, classification, recommendations). Owns the AI go/no-go decision, provider/queue reuse, failure-and-review design, live status updates, and cost bounds. Assistant/copilot chat features are governed by grounded-data-assistant instead."
---

# Forward-Thinking Design (AI Features)

## Purpose

Decide whether AI is actually the right tool before building it — and when it is, implement it on the project's existing AI infrastructure with review, fallback, live status updates, and bounded cost designed in from the start.

Portable across projects; the project's `CLAUDE.md` lists its concrete AI files. LOAD the operating-discipline skill now, before Step 0, and fill its templates from its text, not from memory.

## Use This Skill When

- A feature could use parsing/OCR/extraction, auto-translation, summarization, classification, or recommendations
- The user asks to "automate" something that deterministic rules might solve — the go/no-go decision lives here
- Deciding whether AI or deterministic logic is the better solution

## Do Not Use This Skill When

- The problem is clearly deterministic, or the user explicitly doesn't want AI
- Building an assistant/copilot that answers questions about app data (grounded-data-assistant)
- Wiring an already-approved AI implementation with no design decision left

## Step 0 — Intake (before any design or code)

Write the INTAKE block per operating-discipline section 1, with these domain specifics:

1. Quote VERBATIM every user statement about privacy, data egress, review requirements, or acceptable error posture — these are constraints, not preferences, and they die in paraphrase.
2. Grep the project for its AI infrastructure and record file:line findings under Knowns / Affected surfaces: the provider manager, queue config and workers, existing AI result/message models and routes, and every existing AI call site. Design against what you FOUND, never against guessed infrastructure.
3. Blocking unknowns — resolve with the user before writing code: privacy posture on sending this data to a provider; whether output requires human review; draft vs authoritative output.

## Approval — scaled to ambiguity

1. If AI was NOT requested but might help: propose it and ask before building. Do not implement AI without explicit approval. Use this shape:

   ```
   AI PROPOSAL
   Would do: <one sentence>
   Non-AI alternative: <best deterministic option and its limits>
   Data sent to provider: <exactly what would leave the app>
   Cost & latency posture: <rough per-call cost class; sync or queued>
   Recommendation: <AI | deterministic> because <one line>
   ```

2. If the user explicitly requested the AI feature: do NOT re-ask "do you want AI?" — confirm only the genuinely open decisions (draft vs authoritative output, review requirement, automatic vs user-triggered, acceptable error posture, privacy constraints on sending data to a provider).
3. Prefer deterministic logic when rules/validation/search solve the problem more safely; say so explicitly when that's the recommendation. Decide with these criteria — "matching"/"automating" pattern-matching to AI is not a reason — and state the estimated rule-coverage % in the proposal:
   - Input is structured / id- or enum-bearing (SKUs, codes, exact fields) → deterministic (a WHERE clause, a rule, validation).
   - The mapping needs human-level reading of free text or images → AI candidate.
   - Rules cover most cases (roughly ≥90%) → rules + a manual-review queue for the residual; AI only if the residual itself justifies the spend and nondeterminism.
4. Record before implementing (operating-discipline section 5): a DECISION line for AI-vs-deterministic with the rejected runner-up, plus the answer to each open decision from rule 2. Any later deviation from this record is surfaced to the user — never silently absorbed.

## Reuse the Project's AI Infrastructure (discover first)

5. Inspect what exists before designing — house patterns across these projects (confirm presence; `CLAUDE.md` names this repo's files):
   - **Providers**: a provider manager with `isConfigured`, fallback, and rate-limit cooldowns (house: `backend/functions/ai/providerManager.js` + `providers/BaseProvider.js`) — never instantiate an SDK client in feature code.
   - **Background jobs**: the project's queue (house: `addJob()` from `config/queueConfig.js`, workers in `functions/queueWorkers.js`) — never a bespoke setTimeout/interval worker.
   - **Persistence**: the existing AI message/result models; endpoints via the existing AI controller/routes.
   If the project lacks this infrastructure, establish it following new-project-creation's patterns — never a parallel one-off stack.

## Design Rules

6. AI output is a draft/suggestion/enrichment by default. Anything affecting authoritative data, money, compliance, or routing requires a review state (needs-review/approved) and preserves the original data alongside the AI-derived version.
7. Structured outputs only: parse, sanitize, and validate model output before persisting — never store free-form model text where a structured result is required. Unusable output lands in a failed/needs-review status, never crashes the flow or persists garbage.
8. Don't block the primary user flow on provider latency — run AI async via the queue when the user doesn't need to wait.
9. **Live status updates**: async AI work pushes its transitions live — on queued → processing → complete/failed/needs-review, emit the project's ws event for the affected entity **always with the project's tenant filter on the emit**, and invalidate related cache with tenant-scoped patterns, so open clients update without refresh. An unfiltered broadcast of AI results (parsed documents, translations) is a cross-tenant data leak. Never ship an AI flow whose result appears only after reload or polling.
10. **Perceived performance**: enqueuing shows an immediate pending affordance (skeleton/progress/status chip); long jobs show progress or at least state.
11. **Bounded cost**: AI spend must not scale with re-renders or repeat views of unchanged data. Concretely: dedupe key = hash(input + model + purpose); if a job with that key is already queued or running, attach to it — don't enqueue another; cache the result under the same key and invalidate it when the source record changes; set an explicit per-provider queue concurrency and state the number in your report. Log provider selection, fallback, and failures through the project's logger (never raw prompts/sensitive content).
12. Graceful degradation: when no provider is configured or the provider is down, the feature's non-AI path still works and the AI affordance is hidden/disabled with an explanation — never a button that errors.

## Pre-Ship Scan — ordered

Instantiate operating-discipline section 3 for AI features — keeping its GLOBAL tier numbers (any FINDING's Severity field cites these numbers; never renumber the shared scale). Check in this order; higher tiers block lower ones:

1. **Tenancy & data egress** (tier 1) — tenant-filtered emits, tenant-scoped cache invalidation, only approved data leaves for the provider, no prompts or sensitive payloads in logs.
2. **Authoritative-data integrity** (tier 2) — review states enforced where output touches truth/money/compliance; original data preserved beside the AI version.
3. **Correctness** (tier 3) — model output parsed/validated; malformed output lands in failed/needs-review, never persisted garbage, never a crash.
4. **Compatibility / migration** (tier 4) — AI columns and payload-shape changes are additive; existing consumers and stored data unbroken; the feature can be disabled without data loss.
5. **UX states** (tier 5) — pending/processing/failed/needs-review all visible; results arrive live without refresh.
6. **Cost** (domain check, ranked last) — dedupe, cache, and concurrency bound in place (rule 11).

## Delegation

13. Wide-open design spaces (several plausible AI or non-AI approaches) use context-lean-orchestrator's Design shape (follow it there); the go/no-go and user-approval decisions stay with the orchestrator — never delegated.

## Verify Before Finishing (runnable)

- With NO provider key configured: the AI action is hidden or disabled with an explanatory affordance (via the provider manager's `isConfigured`) — exercise this state
- Simulate malformed model output — procedure: temporarily hardcode the provider call site to return a non-JSON/garbage string, run the flow, observe the record land in failed/needs-review with nothing garbage persisted, then revert the tamper (show both diffs in the report). Re-reading your own try/catch does not count as running this check
- Simulate provider rate-limit/unavailability → fallback provider or graceful status
- Happy path end-to-end including the live ws update on completion (two-window check)
- New user-facing strings exist in every locale file; plus the `CLAUDE.md` definition of done
- Run the operating-discipline §6 critique pass on the shipped AI feature before reporting

Report per operating-discipline §6–7: outcome first, each Verify item with what you actually observed, unexecuted checks under an explicit "not run:" list with reasons — never stated as passing.

## STOP — mid-work triggers

STOP and re-check (operating-discipline section 9) the moment you catch yourself:

- Implementing AI nobody approved, or re-interrogating a user who explicitly asked for it
- Instantiating an SDK client or writing provider-selection logic in feature code beside an existing provider manager
- Writing a queue-worker catch block that logs nothing, or a `.catch(() => {})` — a swallowed rejection makes a job silently vanish
- Writing "should work" about a provider path (fallback, rate-limit, malformed output) you did not actually exercise
- Persisting raw model text as authoritative data, or hiding failure/review states from users
- Shipping results that appear only after refresh, or re-running AI over unchanged inputs on every view

## Final Rule

AI ships only when it's the right tool, approved at the right level, built on the project's provider/queue infrastructure, reviewed where it touches truth, live-updating in the UI, degrading gracefully, and bounded in cost.
