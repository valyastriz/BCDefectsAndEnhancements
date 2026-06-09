---
name: responsive-ui-builder
description: "Use when building or updating React UI that must work well across mobile, tablet, and desktop layouts and should use the current MUI Grid API instead of legacy breakpoint props. Helps the agent design responsive interfaces with clear layout boundaries, mobile-friendly structure, adaptable components, and clean separation between desktop and compact render patterns using js and jsx."
---

# Responsive UI Builder

## Purpose

Use this skill when building or updating React UI that must adapt cleanly across different screen sizes and interaction contexts.

This skill makes the agent treat responsiveness as part of the implementation from the start instead of as a later patch.

## Use This Skill When

- Building a new page or feature that must work on mobile and desktop
- Refactoring a layout that breaks on smaller screens
- Creating data views that need different presentation patterns by screen size
- Updating forms, tables, cards, filters, or action bars for responsiveness
- Improving mobile usability in an existing React feature
- Splitting desktop-heavy render logic into more manageable responsive components
- Building layouts with MUI Grid using the current API

## Do Not Use This Skill When

- Making a change that has no layout or viewport impact
- Editing purely backend code
- Working on a tiny isolated UI element with no responsive behavior concerns

## Behavior

When this skill is active, follow these rules:

1. Build for responsive behavior from the start.
2. Keep mobile, tablet, and desktop needs in mind while structuring the UI.
3. Use MUI Grid for layout when the feature benefits from responsive grid structure.
4. Use the current MUI Grid API with `size` instead of legacy `xs`, `sm`, `md`, `lg`, or `xl` item props.
5. For responsive column widths, use patterns like `size={{ xs: 12, md: 6 }}`.
6. For a fixed width across breakpoints, use patterns like `size={6}`.
7. Do not use old item syntax such as `xs={5}` or `md={6}`.
8. Keep responsive variants readable and maintainable.
9. Use js and jsx conventions for frontend code.
10. Make responsive behavior intentional, not accidental.
11. Never use basic alerts, always create or reuse custom dialogs for confirmation or snackbar for important messages.

## Important MUI Grid Note

Use the updated Grid syntax.

Preferred:

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        ...
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        ...
      </Grid>
    </Grid>

Also valid when the width is the same at all breakpoints:

    <Grid container spacing={2}>
      <Grid size={6}>
        ...
      </Grid>
      <Grid size={6}>
        ...
      </Grid>
    </Grid>

Do not use legacy item breakpoint props like:

    <Grid container spacing={2}>
      <Grid xs={12} md={6}>
        ...
      </Grid>
    </Grid>

## Workflow

### 1. Identify Layout Pressure Points

Before building, identify where responsive behavior matters most, such as:

- page headers
- filters and search controls
- action bars
- tables
- card lists
- forms
- side panels
- modal content
- navigation sections
- dense information blocks

### 2. Choose the Right Presentation Pattern

Use the presentation that fits the screen size and information density.

Examples:

- use structured table-style layouts where wide screens support scanning
- use card or stacked layouts where narrow screens need readability
- split dense control groups so they remain usable on smaller screens
- separate desktop and compact render paths when that improves clarity

### 3. Structure Layout with Current Grid Syntax

When using MUI Grid:

- use `container` on the parent layout
- use `size` on child grid items
- use responsive objects for breakpoint-specific sizing
- keep grid item sizes easy to scan and consistent
- avoid legacy breakpoint props on Grid items

### 4. Keep Responsive Logic Maintainable

When the UI differs significantly by viewport:

- separate desktop-oriented and mobile-oriented rendering when needed
- avoid stuffing all responsive branching into one giant JSX block
- keep responsive variants readable
- use well-named components for alternate render patterns

### 5. Preserve Usability

When adapting layouts:

- keep primary actions easy to reach
- preserve readable content hierarchy
- avoid cramped controls
- avoid forcing horizontal scrolling unless absolutely necessary
- make lists, forms, and actions usable without layout breakage

### 6. Verify Across Sizes

Before finalizing:

- check whether the layout still works at small widths
- check whether dense data remains understandable
- check whether actions are still easy to find
- check whether responsive branching is maintainable
- check whether the solution matches existing app patterns
- check that Grid items use `size` syntax instead of legacy breakpoint props

## Preferred Structure

A responsive feature should generally look more like this:

    users/
      UsersPage.jsx
      components/
        UsersToolbar.jsx
        UsersTable.jsx
        UsersCardList.jsx
        UserCard.jsx
        UserRow.jsx
        EmptyState.jsx

Not like this:

    UsersPage.jsx

with one file containing:

- desktop-only assumptions
- giant nested conditional layout logic
- table and mobile card rendering mixed chaotically
- responsive branches scattered across the full file
- cramped controls with no screen-size adaptation

## Output Expectations

Good outcomes from this skill look like:

- layouts that work well on both small and large screens
- responsive code that is easy to follow
- separate render patterns where that improves clarity
- data displays that remain usable across devices
- frontend structure that supports future responsive changes
- MUI Grid usage that follows the current API

## Anti-Patterns

Avoid these mistakes:

- building only for desktop and trying to patch mobile later
- forcing dense tables onto narrow screens without adaptation
- hiding critical actions on mobile without a usable alternative
- putting all responsive conditions into one huge render block
- creating layout shifts that make the UI hard to use
- ignoring existing responsive conventions in the codebase
- using old Grid item props like `xs`, `sm`, or `md` instead of `size`

## Final Rule

If a UI works only at one screen size, it is not finished. Build responsive behavior into the structure of the feature from the beginning, and use the current MUI Grid API correctly.
