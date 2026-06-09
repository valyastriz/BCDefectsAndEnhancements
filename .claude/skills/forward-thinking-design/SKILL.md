---
name: forward-thinking-design
description: "Use when deciding whether AI should be added to a feature or when implementing AI-powered capabilities such as document parsing, OCR intake, auto-translation, summarization, classification, recommendations, or assistant-style workflows. Helps the agent evaluate whether AI is actually justified, ask the user for approval before any AI implementation, and then reuse the current project's provider, review, fallback, and background-processing patterns instead of inventing fragile AI flows."
---

# Forward-Thinking Design

## Purpose

Use this skill when a feature request could involve AI and the agent needs to decide whether AI is a good fit before building anything.

This skill makes the agent think forward about product value, risk, review requirements, fallback behavior, and implementation cost before introducing AI. If AI is justified, the skill then guides the agent to implement it using the current project's existing patterns for providers, structured outputs, status handling, review workflows, and graceful degradation.

## Use This Skill When

- The user asks for an AI feature or an LLM-based workflow
- A feature could use document parsing, OCR, extraction, or intake automation
- A feature could use auto-translation or translated dynamic content
- A feature could use summarization, classification, recommendations, or assistant-style responses
- The task involves deciding whether AI is a good solution for a product problem
- The request may benefit from AI, but it is not obvious whether deterministic logic would be better

## Do Not Use This Skill When

- The request is purely deterministic and already has a clear rules-based implementation
- The user explicitly does not want AI involved
- The feature requires strict, fully deterministic enforcement that cannot tolerate probabilistic output
- The task is just wiring an already-approved AI implementation with no product or architectural decision left to make

## Behavior

When this skill is active, follow these rules:

1. Do not assume AI should be implemented just because it might help.
2. Evaluate whether deterministic logic, validation rules, search, configuration, or a simpler workflow would solve the problem more safely.
3. Always ask the user whether they want an AI implementation before building any AI path.
4. If the user does not explicitly approve AI, do not implement AI. Offer the best non-AI solution instead.
5. Treat AI as an optional product capability, not the default answer.
6. Prefer AI as assistive draft, enrichment, or acceleration before treating it as a source of truth.
7. If AI output could affect authoritative data, money, compliance, operations, routing, or user trust, require validation and review in the design.
8. Reuse the current project's existing provider abstraction, review flow, and failure-handling patterns before creating any new AI infrastructure.
9. Prefer structured outputs, sanitization, and post-processing over directly storing free-form model text.
10. Design for graceful degradation when providers are unavailable, unconfigured, rate-limited, or return unusable output.
11. Use background work, queues, or async repair when AI latency should not block the primary user flow.
12. Make user-visible AI behavior intentional. Do not hide important review or uncertainty states.

## Decision Framework

Before recommending AI, evaluate all of the following:

- user value: what materially improves for the user if AI is added
- deterministic alternative: whether rules, heuristics, search, or standard code would solve the problem more safely
- error tolerance: the acceptable false-positive and false-negative rate
- review requirement: whether a person must verify the result before it is trusted
- authority level: whether the output is a draft, suggestion, enrichment, or source-of-truth data
- latency and cost: whether the user flow can tolerate model time and provider cost
- privacy and security: whether sensitive files, messages, or customer data would be sent to a provider
- explainability: whether the result must be auditable or easy to justify
- fallback behavior: what happens when AI is unavailable, incomplete, or low confidence
- operational fit: whether the feature should be user-triggered, automatic, or background-only

If AI is not clearly justified after this review, do not recommend it as the primary implementation.

## Ask Before Building

Before implementing any AI feature, ask the user these questions:

- Do you want AI used for this feature at all?
- What exact job should AI perform for the user?
- Is the AI result a draft/suggestion, or will it update authoritative product data?
- What error rate is acceptable?
- Does the result require manual review before it is trusted?
- Should the AI behavior be automatic, user-triggered, or run only in the background?
- Do you already have a provider and API keys configured?
- What should happen when AI is unavailable or returns unusable output?
- Are there privacy, security, compliance, or data residency constraints on sending this data to a model provider?

Do not start implementation until the user has confirmed that they want an AI-based solution.

## Workflow

### 1. Inspect Existing Patterns First

Before designing or coding anything, inspect the existing implementation patterns that already exist in the current project for AI features. If the project does not have them yet, identify the nearest equivalent architecture and keep the new AI design minimal and consistent with the codebase:

- provider abstraction and provider selection
- structured response parsing and sanitization
- translation fallback and no-op filtering
- review states and trust boundaries
- background processing and queue usage
- user-triggered AI flows versus automatic AI flows

### 2. Decide Whether AI Is The Right Tool

Use the Decision Framework and Ask Before Building sections together.

- If the user does not want AI, stop the AI path and implement a non-AI solution.
- If deterministic logic is clearly better, say so explicitly and recommend that path.
- If AI is justified and the user approves it, continue with implementation planning.

### 3. Choose The Correct AI Pattern

Use the current project's existing patterns as the default model:

- Document parsing / OCR / extraction:
  Use provider-backed extraction with strict structured output, sanitization, post-processing, and review before trusting the result.
- Auto-translation:
  Use language normalization, provider fallback, no-op translation filtering, and translation-aware persistence or serialization.
- Summarization / classification / recommendations / assistants:
  Use the same provider abstraction, structured outputs, status-based failure handling, and review state where the output could mislead users or modify important data.

### 4. Design For Failure And Review

When AI is approved, design for failure from the start:

- return statuses instead of throwing unusable provider output straight into the user flow
- provide non-AI fallback behavior where possible
- mark high-risk outputs for review
- avoid blocking the core request path if the AI step can be done asynchronously
- preserve the original user data alongside AI-enriched or translated data when that context matters

### 5. Implement Consistently

When coding an AI feature:

- reuse the existing provider abstraction before adding a provider-specific client directly in feature code
- keep prompts or model instructions close to the feature logic that owns them
- sanitize and validate structured output before persistence
- store enough metadata to distinguish original data from AI-derived data
- make review or failure states visible in the API and UI when users need to act on them

## Reference Patterns

Before implementing a new AI feature, inspect the current project for equivalent patterns such as:

- provider abstraction or provider-selection logic
- document parsing, OCR, or extraction workflows
- translation or language-handling utilities
- queue, job, background worker, or async processing infrastructure
- controllers, services, or UI flows that expose AI behavior to users
- review, approval, confidence, or status-based trust boundaries

These project-level patterns should guide the implementation for:

- provider abstraction
- strict structured outputs
- post-processing and sanitization
- review-before-trust workflows
- automatic versus user-triggered AI behavior
- graceful degradation when providers are not available

## Output Expectations

Good outcomes from this skill look like:

- the agent first determines whether AI is justified instead of forcing AI into the design
- the agent asks the user for AI approval before implementation
- low-risk problems stay deterministic when AI is unnecessary
- approved AI features reuse the current project's existing provider and workflow patterns when they exist
- higher-risk AI outputs include validation, review, fallback behavior, and clear trust boundaries
- AI failures degrade gracefully instead of breaking the core product flow

## Anti-Patterns

Avoid these mistakes:

- auto-implementing AI without asking the user first
- using AI because it sounds modern rather than because it materially helps the feature
- using LLM prompts as the only enforcement for business rules or policy
- replacing authoritative data with unreviewed AI output
- persisting free-form model text directly when a structured result is required
- blocking critical request paths on slow or fragile provider calls when async work is safer
- hiding uncertainty, failure, or review requirements from users
- duplicating provider-selection logic instead of reusing the shared provider layer

## Example Thinking

Prefer this:

1. Decide whether the problem actually needs AI.
2. Ask the user whether they want an AI implementation.
3. If approved, choose the lowest-risk AI pattern that solves the problem.
4. Add validation, status handling, fallback behavior, and review where needed.

Not this:

1. See a messy workflow.
2. Add an LLM call immediately.
3. Persist the output as truth.
4. Deal with hallucinations and provider failures later.

## Final Rule

Use AI only when it clearly improves the feature, only after the user approves it, and only with the same review, fallback, and trust-boundary discipline already proven in the current project or established cleanly for that project.
