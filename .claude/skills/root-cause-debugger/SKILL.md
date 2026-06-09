---
name: root-cause-debugger
description: "Use when a React or Node issue needs to be diagnosed and fixed by finding the actual source of failure instead of guessing. Helps the agent trace the real execution path, inspect related frontend and backend code, verify assumptions about state, data, and API behavior, identify the true root cause, and apply the smallest safe fix without introducing unrelated changes."
---

# Root-Cause Debugger

## Purpose

Use this skill when debugging bugs, regressions, broken flows, inconsistent data behavior, UI state problems, or frontend-backend integration issues.

This skill makes the agent investigate the real failure path before changing code.

## Use This Skill When

- A bug needs to be fixed
- A regression appeared after a recent change
- The UI is showing incorrect or stale data
- A backend endpoint is returning unexpected results
- A frontend action works sometimes but not consistently
- A state transition is breaking the expected flow
- An API contract mismatch is causing failures
- The visible error is likely a symptom instead of the real cause

## Do Not Use This Skill When

- Building a brand new feature with no bug involved
- Making a pure refactor with no reported issue
- Guessing at a fix without enough evidence from the code path

## Behavior

When this skill is active, follow these rules:

1. Do not guess.
2. Reconstruct the real execution path before proposing a fix.
3. Identify where expected behavior diverges from actual behavior.
4. Check both frontend and backend when the issue crosses boundaries.
5. Verify assumptions about inputs, state, data shape, timing, and API contracts.
6. Fix the actual cause, not just the visible symptom.
7. Make the smallest safe change that resolves the issue.
8. Avoid unrelated refactors during bug fixes unless required for the fix.
9. Check whether the issue affects neighboring flows or edge cases.
10. Explain the root cause clearly.

## Workflow

### 1. Reproduce the Failure Path

Before changing code, identify:

- what action triggers the issue
- what result was expected
- what result actually happened
- where the failure first becomes visible
- whether the issue is consistent or intermittent

### 2. Trace the Real Flow

Follow the code path through the relevant layers, such as:

- UI event handler
- component state update
- hook logic
- service or API call
- backend route
- controller
- service layer
- validation
- persistence
- returned response
- rendered output

### 3. Verify Assumptions

Check assumptions about:

- null and undefined values
- stale state
- async timing
- request payload shape
- response payload shape
- field names
- permissions
- feature flags
- data ordering
- conditional rendering
- derived values

### 4. Identify the Root Cause

Find the first place where the system behavior becomes wrong.

That may be:

- the UI sending the wrong input
- a hook deriving the wrong state
- a stale dependency causing outdated behavior
- a service mapping data incorrectly
- an endpoint returning the wrong shape
- missing validation
- a permission check blocking the intended action
- a race condition or timing issue

### 5. Apply the Smallest Safe Fix

Once the cause is confirmed:

- fix only the necessary part
- preserve intended surrounding behavior
- avoid broad rewrites unless they are required
- update related tests when appropriate
- verify nearby scenarios that could be affected

## Investigation Expectations

Good debugging work should:

- trace the issue through the real code path
- isolate the exact failure point
- distinguish symptoms from causes
- avoid speculative code edits
- reduce regression risk

## Output Expectations

Good outcomes from this skill look like:

- a clear explanation of what was actually wrong
- a focused fix with minimal surface area
- no unnecessary architecture changes
- tests added or updated for the failure path when needed
- related edge cases checked before finalizing

## Anti-Patterns

Avoid these mistakes:

- adding random null checks without understanding the source
- patching the UI when the API contract is wrong
- patching the API when the client is sending invalid assumptions
- forcing rerenders to hide a state bug
- making broad refactors during a focused bug fix
- changing multiple layers before proving where the issue starts

## Final Rule

Do not change code until the real failure path is understood. Fix the cause, not the symptom.