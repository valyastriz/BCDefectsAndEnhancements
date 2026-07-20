---
name: react-ui-builder
description: "Use when building or restructuring React UI: pages, components, layouts, tables, forms, dialogs, or data views. Owns component decomposition, responsive any-screen layout, the four data-surface states (skeleton/error/empty/data), live-updating views, action density, design-system consistency, accessibility, and list-scale performance. Not for backend-only work, pure code cleanup, or a tiny change inside an already well-structured component."
---

# React UI Builder

## Purpose

Build React UI that is decomposed into focused components, works on any screen, updates live, stays fast as data grows, and looks like it belongs to the app's design system.

Portable across projects: concrete component names, theme paths, and commands live in the project's root `CLAUDE.md` — read it first and reuse what it names; never invent parallel mechanisms. LOAD the operating-discipline skill now, before Workflow step 1, and fill its templates from its text, not from memory; this skill adds the UI-domain procedure on top of it.

## Use This Skill When

- Building a new page, feature UI, or data view
- Restructuring a large JSX file into components
- Updating layouts, tables, forms, filters, action bars, or dialogs

## Do Not Use This Skill When

- Backend-only work (node-api-structure-enforcer)
- Pure code cleanup with no UI structure change (refactor-and-cleanup)
- A tiny change in an already well-structured component

## Workflow — execute in this order, never inverted

1. **Design gate**: new pages/features and redesigns require an approved Artifact mockup first (artifact-mockup-first). No product code before it.
2. **Intake + inventory** (operating-discipline §1–2) — written down BEFORE the first edit. For UI work the affected-surfaces inventory MUST list, with file:line:
   - importers of every file you will split, move, or rename (grep the filename)
   - every `data-tour="..."` value inside touched JSX (a moved target silently breaks its tour — see guided-onboarding-walkthroughs)
   - locale keys the touched JSX references
   - 2–3 candidate shared components from the project's shared UI directory that could serve, with paths
   - the endpoint each data surface reads: file:line of the route plus the exact response shape (field names, rows/total pattern) — mark it NEW if it doesn't exist yet, which makes it BLOCKING scope; never guess the shape and never work around a missing endpoint by fetch-all-and-filter
   Verify every assumption about the project's components, theme, ws layer, or API contracts against the code before building on it.
3. **Scaffold structure** (rules 1–4).
4. **Wire data + all four states** (rules 8–10) — before any styling polish.
5. **Live updates** (rule 9) and in-flight mutation handling (rule 16).
6. **Responsiveness** (rules 5–7), then scale/performance where lists can grow (rules 11–15).
7. **Accessibility, localization, navigation** (rules 23–26).
8. **Verify** (checklist below); report per operating-discipline §7.

## Component Structure

1. One entry component composes the page; child components own one responsibility each (filters, table, row, card list, actions menu, empty state). Don't pile every concern into one file.
2. **Data fetching and websocket subscriptions live in the page/container component.** Children receive data via props or context so one socket event updates the whole tree. Never fetch or subscribe inside a row/card component. When extracting components from a page, verify the page still live-updates through its existing subscription.
3. Reuse the project's shared UI components before creating new ones — the step-2 inventory names the candidates. Criterion: a visual pattern used (or plausibly reused) on 2+ screens becomes a shared component; single-use stays local. Never inline-style a repeated pattern.
4. Prefer a structure like `users/UsersPage.jsx` + `users/components/{UserFilters,UserTable,UserRow,UserRowActionsMenu,EmptyState}.jsx` — mirror the nearest existing feature's layout (see `CLAUDE.md`).

## Layout & Responsiveness

5. Build mobile, tablet, and desktop behavior from the start. Criterion for a separate card-style view: if the table needs more than 4 columns on a phone, or any cell truncates critical data at 360px → card view on xs; otherwise adapt the table. Never bury responsive branching in one giant render block.
6. If the project uses MUI (v6+), use the Grid `size` API (`size={{ xs: 12, md: 6 }}`, or `size={6}` when fixed) — never legacy `xs=`/`md=` item props. Confirm the project's UI library and version first; in a non-MUI project follow its own grid/layout system — never introduce MUI to comply with this rule.
7. No horizontal body scroll; dense data adapts (table → cards) instead of cramming.

## Data Surfaces — the Four States

8. Every component rendering fetched data implements all four states — none may fall through to a blank region:
   - **loading**: Skeleton matching the final layout (no layout shift, no spinner-only pages)
   - **error**: translated message with retry, via the project's snackbar/alert mechanism (find it in `CLAUDE.md`; never add a parallel one)
   - **empty**: translated guidance plus the primary action
   - **data**
9. Views showing server data that can change while open must update live via the project's ws subscription layer — patch state surgically, never reload or poll. Acceptance: two windows, mutate in one, the other updates without refresh.
10. Never use `window.alert`/`confirm` — use the project's snackbar for messages and its confirmation dialog component for destructive actions.

## Scale & Performance

11. Lists that can exceed ~100 rows are server-paginated or virtualized (check the project for react-window or equivalent); row counts come from the server's `total`, not array length.
12. Memoize row/card components (`React.memo`) with stable handlers (`useCallback`) from the container, so a single-row socket patch doesn't re-render the whole list.
13. Search/filter inputs debounce (~300ms) and hit server-side search — never client-filter a whole table that the server should filter.
14. Heavy dialogs, charts, and editors load lazily (`next/dynamic` or equivalent) — don't bloat the initial bundle.
15. Selectors that can grow past a handful of options use autocomplete/searchable select with narrowed data — not rows of buttons or unbounded lists.

## Mutations In Flight

16. Disable the submit control with a progress indicator during saves; prevent double-submit; confirm success (snackbar) and surface failure with a translated message. Optimistic updates are permitted only for trivially reversible, single-owner mutations — with rollback and a visible error on failure.

## Actions & Density

17. One primary action visible (optionally one secondary); everything else goes into a reusable overflow/actions menu. Destructive actions route through the confirmation dialog. Every rendered menu item is wired to a working handler — no placeholders or permanently disabled stubs.
18. Prefer self-guiding UI: explicit labels, grouping, and hierarchy before helper copy; remove filler text the controls already communicate.

## Design System

19. Colors from `theme.palette`, spacing via `theme.spacing`/system props, text via `Typography` variants — no hardcoded hex/rgb or arbitrary px outside the theme. Check the theme's component overrides before styling manually.
20. Keep text/background contrast clearly readable — never similar-hue pairs (e.g., orange on orange-tint); when unsure, use default text on default background.
21. Verify new screens in both light and dark palettes.
22. If breadcrumbs already show the page title, don't render a duplicate heading below them.

## Accessibility

23. Icon-only buttons get a translated `aria-label`. Dialogs use the real Dialog component (focus trap, Esc, focus restore) — never div modals. No `onClick` on bare divs (use buttons or add role/tabIndex/key handlers). Inputs get real labels, not placeholder-as-label. Tab through the changed flow once before finishing.

## Guided Multi-Step Flows

24. Keep completed steps visible; render the next step as a skeleton until prerequisites complete; gate future steps until prior data is valid and saved. Carve-out: when revisiting a flow whose data already exists (editing a completed setup), steps render enabled — don't force re-completion.

## Navigation & Localization

25. A new page is not done until it's registered in the project's navigation/menu registry and its breadcrumb resolves (see `CLAUDE.md` for the registry location).
26. All user-facing text goes through the project's i18n mechanism (house pattern: react-intl — confirm in `CLAUDE.md`; never install a second i18n library beside an existing one) with keys added to **every** locale file; run the project's locale check/clean scripts (named in `CLAUDE.md`) before finishing. Missing keys = incomplete.

## Delegation

27. Component fleets follow context-lean-orchestrator: parallel builders own disjoint component files — no two agents edit the same file. Every brief uses the delegation-brief template of operating-discipline §8.
28. Registry/barrel wiring and shared-file merges — locale dictionaries above all — go through a single integrator, never parallel edits.
29. Shared hot files use context-lean-orchestrator's fragment-staging rule: workers write per-agent fragment files (never the shared file) with safe defaults so the tree stays green; one integrator composes the real file, fails the merge on any key-parity mismatch, then deletes the fragments.

## Verify Before Finishing

Run the project's definition of done (`CLAUDE.md`), plus for UI specifically:

- Render affected pages at **360 / 768 / 1440 px**: no horizontal body scroll, no clipped/overlapping controls, ≥40px touch targets on mobile
- Exercise all four states: throttle network (skeleton), force a failed request (error + retry), zero records (empty)
- Two-window live-update check for any server data shown
- Both light and dark themes
- Locale scripts pass; new page reachable from navigation; every button/menu item performs a real action
- The changed feature's help doc updated; any guided tour covering it re-run with its selector targets still resolving (see guided-onboarding-walkthroughs)
- On a new page or sizable UI diff: the operating-discipline §6 critique pass, run before reporting

Report each item **pass / fail / not run** — never imply a skipped check passed (operating-discipline §6–7).

## Anti-Patterns — STOP mid-work and re-check when you catch yourself doing any of these

- One giant page file; per-row fetching/subscriptions; blank-while-loading regions; silent failures
- `window.alert`; a second snackbar mechanism; hardcoded hex/px styling
- Mapping an unbounded dataset into DOM rows; client-filtering what the server should filter
- Icon buttons without aria-labels; div modals; placeholder menu items
- Desktop-only layouts patched for mobile later; duplicate page titles under breadcrumbs
- Theming or polishing a surface whose four states and live updates aren't wired yet (workflow order violated)

## Final Rule

A UI is not finished if it works at only one screen size, shows blank or dead states, needs a refresh to show current data, degrades as data grows, or drifts from the design system. Build all of that in from the start.
