---
name: scalable-state-management-specialist
description: "Use when building or refactoring React features that involve local state, shared state, derived state, or cross-component coordination and the implementation should stay predictable, minimal, and easy to maintain. Helps the agent keep state as local as possible, avoid unnecessary global state, reduce prop drilling through better composition, prevent duplicated state, and align with the project's existing state management approach using js and jsx."
---

# Scalable State Management Specialist

## Purpose

Use this skill when working on React features where state design affects maintainability, clarity, render behavior, or coordination between components.

This skill makes the agent choose the right state ownership model, keep state minimal, and avoid introducing unnecessary complexity.

## Use This Skill When

- Adding state to a new React feature
- Refactoring messy or duplicated state
- Deciding between local state and shared state
- Reducing prop drilling in a growing component tree
- Cleaning up derived state and render logic
- Improving maintainability in state-heavy UI flows
- Aligning feature state with the project's established patterns

## Do Not Use This Skill When

- Making a tiny static UI change with no state concerns
- Editing purely backend code
- Introducing a new state tool when the existing project approach is already sufficient

## Behavior

When this skill is active, follow these rules:

1. Keep state as local as possible.
2. Elevate state only when multiple consumers truly need shared ownership.
3. Follow the project's existing state management approach.
4. Do not introduce global state for convenience alone.
5. Avoid storing values that can be derived from existing state or props.
6. Keep state shape minimal and predictable.
7. Reduce unnecessary re-renders caused by unstable state design.
8. Prefer composition and clearer ownership before adding more state plumbing.
9. Use js and jsx conventions for frontend code.
10. Make state transitions explicit and easy to trace.

## Workflow

### 1. Identify the State Types

Before coding, classify the state involved, such as:

- local UI state
- form state
- filter state
- async loading state
- server-backed data
- selected item state
- modal or drawer visibility
- shared feature state
- derived display state

### 2. Choose the Right Ownership Level

Use the smallest ownership scope that fits the feature:

- keep truly local UI state inside the component that owns it
- lift state only when multiple children need coordinated access
- use shared state only when multiple distant parts of the feature require synchronization
- avoid moving state upward without a clear reason

### 3. Avoid Duplicated State

Before storing something, check whether it can be derived from:

- props
- existing state
- fetched data
- route state
- current selection
- existing computed values

If it can be derived reliably, do not store it separately.

### 4. Keep State Predictable

When designing state:

- use clear names
- keep the shape simple
- avoid hidden coupling between unrelated values
- avoid nested complexity unless it is truly needed
- make updates understandable at a glance

### 5. Reduce Render Problems

Before finalizing:

- check whether state is placed higher than necessary
- check whether prop drilling can be reduced through better composition
- check whether re-renders are caused by poor ownership boundaries
- check whether multiple values are duplicating the same source of truth
- check whether the state model matches nearby project patterns

## Preferred Approach

Good state structure usually looks like this:

- local visibility state stays with the component that owns the UI
- shared filter state lives at the feature composition level when multiple child components use it
- fetched data stays aligned with the project's data-fetching pattern
- derived display values are computed instead of stored again
- child components receive only the state and handlers they actually need

## Signs the State Design Needs Work

A feature likely needs state cleanup when:

- multiple components store the same truth in different places
- prop chains are too deep and hard to follow
- unrelated UI parts rerender because state is owned too high
- booleans and flags are multiplying without clear meaning
- values are stored even though they can be derived
- the feature uses multiple competing state patterns without reason

## Output Expectations

Good outcomes from this skill look like:

- simpler state ownership
- fewer duplicated values
- cleaner component boundaries
- less unnecessary global state
- easier-to-follow updates
- more predictable render behavior

## Anti-Patterns

Avoid these mistakes:

- putting page-local UI state into app-wide shared state
- storing derived values as separate state without need
- lifting state higher than required
- using global state to avoid small refactors
- creating multiple sources of truth
- passing large state objects through many component levels without need
- introducing a new state library or pattern that conflicts with the existing codebase

## Final Rule

If state does not need to be shared, keep it local. If a value can be derived, do not store it. Keep the state model as small and predictable as possible.