---
name: clean-refactor-maintainability-agent
description: "Use when React or Node code works but the structure is harder to read, maintain, extend, or review than it should be. Helps the agent reduce duplication, improve naming, split oversized files, extract focused modules, simplify code paths, and leave the codebase cleaner without mixing in unrelated changes or speculative abstraction."
---

# Clean Refactor Maintainability Agent

## Purpose

Use this skill when code is functional but the structure has become harder to understand, maintain, or safely extend.

This skill makes the agent improve readability and maintainability without turning the task into an uncontrolled rewrite.

## Use This Skill When

- Refactoring a feature that has grown messy
- Reducing duplication across React or Node files
- Breaking apart oversized files
- Improving naming and file organization
- Simplifying deeply nested or hard-to-follow logic
- Preparing a feature area for safer future changes
- Cleaning up code while preserving behavior

## Do Not Use This Skill When

- Building a brand new feature where structure is already clear
- Making unrelated cleanup during a focused bug fix unless the cleanup is required
- Introducing large architectural changes without a clear need
- Creating abstractions that are not justified by actual reuse or complexity

## Behavior

When this skill is active, follow these rules:

1. Refactor toward readability, reuse, and maintainability.
2. Preserve existing intended behavior unless the request explicitly changes it.
3. Keep changes focused on the area being improved.
4. Reduce duplication when the duplication has real maintenance cost.
5. Split oversized files when they are hard to scan or doing too many jobs.
6. Improve names so roles and responsibilities are obvious.
7. Prefer straightforward structure over clever abstraction.
8. Avoid speculative abstraction that is not supported by real usage.
9. Keep diffs reviewable and easy to reason about.
10. Leave the codebase cleaner than it was before.

## Workflow

### 1. Identify the Real Maintenance Problem

Before changing code, identify what is making the code hard to maintain, such as:

- repeated logic
- repeated JSX
- oversized files
- unclear names
- mixed responsibilities
- deeply nested branching
- hard-to-follow data flow
- hidden coupling between modules
- confusing helper placement

### 2. Choose the Smallest Useful Refactor

Refactor only as much as needed to improve the problem.

Examples include:

- extracting repeated code into a helper
- splitting a large component into smaller focused components
- moving business logic into a service or hook
- renaming vague functions or variables
- flattening nested conditionals
- reorganizing files so related code is easier to find

### 3. Preserve Behavior

While refactoring:

- keep outputs and side effects consistent
- avoid changing contracts unless required
- do not sneak in unrelated behavior changes
- keep the refactor easy to validate

### 4. Improve Boundaries

When code is carrying mixed concerns:

- separate rendering from logic
- separate request handling from business logic
- separate shared utilities from feature-specific code
- separate composition-level files from lower-level implementation details

### 5. Verify the Improvement

Before finalizing:

- check whether the code is easier to scan
- check whether naming is clearer
- check whether duplication was actually reduced
- check whether responsibility boundaries improved
- check whether the diff stays focused
- check whether existing behavior is still preserved

## Typical Refactor Targets

Good candidates for cleanup include:

- large React page files
- route files doing too much work
- repeated formatting helpers
- duplicated validation paths
- utility files with mixed unrelated helpers
- state-heavy components with tangled logic
- deeply nested conditional rendering
- poorly named service functions

## Output Expectations

Good outcomes from this skill look like:

- smaller and more focused files
- clearer names
- reduced duplication
- cleaner responsibility boundaries
- easier reviews
- lower risk for future edits

## Anti-Patterns

Avoid these mistakes:

- rewriting large areas without clear payoff
- introducing abstractions before there is real reuse
- mixing refactor work with unrelated feature changes
- renaming everything at once without improving clarity
- splitting files randomly without stronger boundaries
- making the architecture more complicated than the original

## Final Rule

Refactor only when it makes the code easier to understand, safer to change, and cheaper to maintain. Do not trade one mess for a more abstract mess.