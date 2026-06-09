---
name: component-first-react-builder
description: "Use when building or refactoring React UI and the task should be structured into reusable components instead of being implemented as one large page or feature file. Helps the agent split UI into focused components, separate page composition from leaf components, extract repeated JSX, keep files small and readable, and build frontend features in a modular, maintainable way using js and jsx."
---

# Component-First React Builder

## Purpose

Use this skill when building or refactoring React UI that should be split into clear, reusable components instead of being placed into one large file.

This skill makes the agent structure frontend work around component boundaries so the code stays readable, maintainable, reusable, and easier to extend.

## Use This Skill When

- Building a new React page
- Building a new feature with multiple UI sections
- Refactoring a large JSX file
- Extracting repeated UI into reusable components
- Splitting page-level layout from smaller leaf components
- Organizing feature files so they are easier to navigate

## Do Not Use This Skill When

- Making a tiny JSX change in a file that is already appropriately small
- Editing a simple presentational component that does not need decomposition
- Splitting a small file would add unnecessary indirection with no maintainability benefit

## Behavior

When this skill is active, follow these rules:

1. Use a component-based approach for React work.
2. Do not place an entire feature into one file when it should be split into smaller pieces.
3. Create a clear entry component for the page, feature, or screen.
4. Break the UI into focused child components with one clear responsibility each.
5. Extract repeated JSX into reusable components.
6. Keep page-level composition separate from lower-level UI rendering.
7. Keep files small enough to understand quickly.
8. Use js and jsx file conventions for frontend code.
9. Reuse existing shared UI components before creating new ones.
10. Prefer composition over large monolithic components.

## Workflow

### 1. Identify UI Boundaries

Before writing code, identify distinct UI responsibilities such as:

- page shell
- header area
- filters
- list or table section
- cards or rows
- empty state
- loading state
- modal or drawer content
- form sections
- action bars

Each responsibility should be considered for its own component boundary.

### 2. Create a Clear Entry File

Use one main entry component to compose the feature.

That entry file should primarily:

- import child components
- arrange layout
- connect props and handlers
- coordinate feature flow at a high level

It should not become the dumping ground for every rendering detail.

### 3. Split Child Components by Responsibility

Create separate components when the UI has clearly different concerns.

Examples:

- `UsersPage.jsx` for page composition
- `UserFilters.jsx` for filter controls
- `UserTable.jsx` for desktop list display
- `UserCardList.jsx` for compact mobile display
- `UserRow.jsx` for a table row
- `EmptyState.jsx` for no-data rendering

### 4. Extract Repeated UI

If the same JSX pattern appears more than once, extract it into a reusable component instead of copying it.

Examples include:

- status badges
- action menus
- cards
- form field groups
- section headers
- confirmation dialogs

### 5. Keep Files Focused

Each component file should do one main job.

Avoid combining all of these in a single file:

- page layout
- local UI sections
- repeated row rendering
- modal content
- empty states
- loading states
- inline helper components
- large blocks of duplicated JSX

### 6. Verify the Structure

Before finalizing:

- check whether the page is easy to scan
- check whether child components have clear names
- check whether repeated JSX was extracted
- check whether any file is doing too many jobs
- check whether the feature would be easy to extend later

## Preferred Structure

A React feature should generally look more like this:

```text
users/
  UsersPage.jsx
  components/
    UsersHeader.jsx
    UserFilters.jsx
    UserTable.jsx
    UserRow.jsx
    UserCardList.jsx
    EmptyState.jsx
```
Not like this:
```text
UsersPage.jsx
```
with one oversized file containing:
- page layout
- filters
- table markup
- card markup
- modal markup
- repeated row markup
- empty state rendering
- loading state rendering
- inline subcomponents
- duplicated JSX patterns

## Responsive UI Guidance

When a feature must support different screen sizes:

- keep desktop and mobile rendering concerns modular
- separate table-style and card-style views when that improves clarity
- do not bury responsive variants inside one giant render block
- use component boundaries that make layout differences easier to manage

## Output Expectations

Good outcomes from this skill look like:

- smaller JSX files
- page files focused on composition
- reusable child components
- reduced duplicated markup
- clearer feature structure
- easier testing and future edits

## Anti-Patterns

Avoid these mistakes:

- one giant page component with every UI concern embedded
- inline child components that should be separate files
- repeated JSX copied in multiple places
- massive render blocks with nested conditional UI everywhere
- mixing page composition and low-level rendering in the same file
- splitting files randomly without clear responsibility boundaries

## Final Rule

If a React file is becoming hard to scan, hard to reuse, or hard to extend, split it into focused components before it turns into a maintenance problem.
