---
name: reuse-first-pattern-finder
description: "Use when adding, updating, or refactoring React or Node code and there is a risk of creating duplicate components, hooks, services, utilities, middleware, validators, or API patterns that may already exist in the codebase. Helps the agent search for existing implementations first, reuse shared building blocks, extend established patterns, and avoid creating parallel solutions that increase maintenance cost."
---

# Reuse-First Pattern Finder

## Purpose

Use this skill when working in an existing codebase and there is a chance that the requested functionality already exists fully, partially, or in a reusable form somewhere else in the repo.

This skill makes the agent search for existing solutions first and reuse or extend them instead of rebuilding similar code.

## Use This Skill When

- Adding a new UI feature that may already have shared components
- Creating a new hook that might already exist in another feature
- Building a service or API helper in an established backend
- Adding validation that may already be implemented elsewhere
- Creating middleware, formatters, mappers, or helper utilities
- Refactoring duplicate logic into a shared pattern
- Working in a mature repo with a lot of existing abstractions

## Do Not Use This Skill When

- Starting a new codebase with no existing reusable patterns
- Building a truly unique implementation with no meaningful overlap in the repo
- Forcing reuse when the existing abstraction is clearly wrong for the task

## Behavior

When this skill is active, follow these rules:

1. Search the codebase for existing implementations before creating new ones.
2. Reuse shared components, hooks, services, utilities, middleware, validators, and helpers whenever they fit.
3. Extend established patterns instead of creating parallel versions with different names.
4. Prefer improving an existing reusable abstraction over duplicating it in a new file.
5. Do not create near-duplicate helpers or components with slightly different naming.
6. Match the conventions of the existing reusable pattern when extending it.
7. Create a new abstraction only when no suitable reusable option exists.
8. Keep reuse practical and do not force a poor-fit abstraction into a different use case.
9. Reduce maintenance cost by consolidating duplication where appropriate.
10. Leave the codebase with fewer parallel patterns, not more.

## Workflow

### 1. Search Before Building

Before writing code, check whether the repo already has something similar, such as:

- shared UI components
- layout wrappers
- cards
- tables
- form controls
- hooks
- services
- API clients
- validators
- middleware
- repositories
- mappers
- formatters
- utility helpers
- permission checks
- response helpers

### 2. Evaluate Fit

When you find an existing candidate, ask:

- does it already solve this problem fully
- does it solve most of the problem with a small extension
- does it follow the same pattern needed here
- is it actively used and trusted in the codebase
- would reusing it improve consistency

If yes, reuse or extend it.

### 3. Avoid Parallel Solutions

Do not create new files that are basically duplicates of existing ones with only minor differences, such as:

- a second hook that wraps the same state pattern
- another badge component with slightly different prop names
- another API helper with the same transport logic
- another validator that duplicates existing rules
- another middleware with almost identical checks

### 4. Create New Only When Needed

Create a new abstraction only when:

- nothing suitable exists
- existing code would be a bad fit
- reuse would make the implementation more confusing
- the new behavior represents a genuinely different pattern

When creating something new, place it where similar reusable code already lives.

### 5. Verify the Result

Before finalizing:

- check whether a reusable option was overlooked
- check whether a duplicate abstraction was created
- check whether the chosen reuse pattern improves consistency
- check whether the new code matches existing naming and structure
- check whether future maintenance is simpler, not harder

## Output Expectations

Good outcomes from this skill look like:

- fewer duplicate utilities and components
- stronger reuse of shared patterns
- more consistent feature implementation
- less repeated code across the repo
- cleaner extension of existing abstractions
- lower long-term maintenance cost

## Anti-Patterns

Avoid these mistakes:

- rebuilding a shared component because it was not found quickly
- creating a second helper with nearly identical logic
- introducing a new pattern when the repo already has one
- forcing reuse when the old abstraction is clearly the wrong shape
- copying and pasting code into a new file instead of extracting or extending
- creating multiple versions of the same concept across the codebase

## Final Rule

Before creating anything new, prove that the codebase does not already have a reusable solution that should be used instead.