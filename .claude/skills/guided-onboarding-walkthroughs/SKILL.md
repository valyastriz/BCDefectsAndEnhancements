---
name: guided-onboarding-walkthroughs
description: "Use when building first-time-user onboarding, product tours, guided walkthroughs that spotlight real on-screen elements, a welcome flow for new accounts, or an in-app help/documentation center. ALSO use when changing any existing feature's UI or flow in a project that already has tours or help docs — moved or renamed elements silently break tour targets and stale docs mislead users. Builds declarative-registry tours with server-tracked completion, role gating, deep-linking, and a single help-docs source of truth shared with the AI assistant."
---

# Guided Onboarding & Walkthroughs

## Purpose

Guide new users with interactive tours that drive the real UI, a one-time welcome for new accounts, and an in-app help center — from **one declarative registry**, with **server-tracked per-user completion** and **one source of truth for help docs** shared by the Help page, the tours, and the AI assistant.

**Discover first.** If the project already has a walkthrough registry/context/overlay, extend it. If not, scaffold from this skill's `templates/`. If the project keeps in-app help docs in a doc-content module (house pattern: a typed `docContent`-style module — location named in the project's `CLAUDE.md`), THAT is the single source of truth tours and the help center read from — never duplicate its content.

## Use This Skill When

- Building first-run onboarding, welcome prompts, product tours, or coach-marks
- Spotlighting real UI elements with step-by-step explanations
- Building or extending an in-app help/documentation center
- Changing an existing feature's UI or flow in a project that has tours/help docs (maintenance workflow below)

## Do Not Use This Skill When

- A single static tooltip suffices; the content belongs in a repo README; the audience is developers, not end users

## Core Principles

1. **One declarative registry** of tours — adding a tour appends one object; no per-page tour code.
2. **Tours drive the real app**: each step navigates to a real route and highlights a real element via a stable dedicated attribute (`data-tour="..."`) — never CSS classes, nth-child, or screenshots.
3. **Degrade gracefully**: a step whose target isn't on screen falls back to a centered, descriptively-worded card — never "tap this" with nothing highlighted.
4. **Completion is per-user and server-tracked** — never localStorage/redux-persist only; progress follows the person across devices.
5. **Gate by audience**: only roles that can reach the toured screens see the tours. Use feature flags ONLY if the project already has a flag system — otherwise gate by the role/permission checks that exist. Never invent a flag framework for tours.
6. **Always replayable** from a persistent help menu; deep-link `?tour=<key>` auto-starts a tour (used by the AI assistant) and strips itself so refresh doesn't loop.
7. **One source of truth for help docs**: structured typed blocks in one module that renders the Help page, feeds the AI assistant's how-to knowledge (see grounded-data-assistant), and seeds tours. Write each guide once.
8. **Docs and tours are part of feature completion**: a new user-facing feature isn't complete until its help doc exists and a tour is added wherever onboarding already covers comparable flows; a changed feature isn't complete until the maintenance workflow below has run.

## Server Persistence (required, not optional)

- Completion state is one JSON(B) map per user. Default: a column on the users table; a separate `user_walkthrough_states` table ONLY if the users table is shared across apps or the project already splits per-user JSON state into satellite tables. Create via the project's migration manager — never hand-written migrations.
- Two endpoints following the project's routes/controllers layering: `GET /api/walkthroughs/state` and `PUT /api/walkthroughs/state`. State is keyed by `req.user.id` resolved on the server — the endpoints NEVER accept a user id from the client body/params (that would let any user overwrite a colleague's completion state). Both routes register the project's permission middleware like any other route (node-api-structure-enforcer rule 5) — "authenticated" alone is not the bar.
- Saves surface failures (retry or notify) — no swallowed `.catch(() => {})`; a silently failed save resurrects the welcome prompt.
- Refresh completion state on window focus (or subscribe via the project's ws layer) so two open tabs don't re-prompt.
- **Not done until**: complete a tour → log out and back in AND open a second browser → the welcome prompt does not reappear.

## Overlay Behavior (required)

- Clamp the step card inside the viewport on every placement; on screens narrower than ~600px render it as a full-width bottom sheet, not an anchored card.
- Re-measure the target on BOTH scroll and resize (or a position observer) — a fixed spotlight must not drift when the user scrolls.
- Keep retrying target lookup until the route's content has actually mounted (several seconds or a MutationObserver) before falling back to the centered card — lazy-loaded routes mount late.
- Theme + a11y: style with the project's theme tokens (no hardcoded #fff — must work in dark mode); focus trap, Esc to exit, focus restore on close, aria dialog roles, keyboard next/back.
- Lazy-load the registry and overlay (dynamic import) — tours must not weigh down the main bundle for every user.

## Workflow — Adding A Tour Or Guide

1. **Inspect** — a search, not a glance: grep the frontend for `data-tour`; glob for `*alkthrough*` and `*[Tt]our*` components; check the project's `CLAUDE.md` for the doc-content module. Only if all three come up empty, scaffold from `templates/`. State in your notes what you found, with paths (operating-discipline §1–2 — LOAD that skill first and fill its templates from its text, not from memory).
2. **Tag** targeted elements with stable `data-tour="..."` attributes on the real components.
3. **Append one registry entry** — ordered steps, each with `route` + `target` or `placement: 'center'`; gate with the project's role (and existing flag) mechanisms.
4. **Localize**: every title/body message id in every locale file; run the project's locale scripts.
5. **Write the help doc once** in the single-source doc module.
6. **Verify (runnable)**: run each tour end-to-end at desktop AND a 360px viewport (bottom sheet, no off-screen cards, spotlight tracks scroll); centered fallbacks read correctly; completion persists per the server-persistence check above; `?tour=<key>` works and strips; replayable from the help menu; welcome prompt defers to any first-run setup wizard — check the wizard's completion state and, while it is incomplete, suppress the welcome prompt entirely for the session; run the operating-discipline §6 critique pass on new tour + doc content before reporting; plus the `CLAUDE.md` definition of done. Report each item **pass / fail / not run** (operating-discipline §6–7) — the log-out/second-browser persistence check and the 360px viewport run are the checks most often skipped; a skipped check is `not run`, never implied passed.

## Workflow — Changing An Existing Feature (maintenance)

When any feature's UI or flow changes in a project that has tours/help docs:

1. Grep the registry for the changed route(s) AND for every `data-tour` value present in the touched components.
2. Write the affected list — tours and doc sections, with file:line — BEFORE editing anything. The list is a deliverable (operating-discipline §1).
3. Make the feature change; update every listed doc section and tour step — text AND `data-tour` targets (a renamed or moved target breaks silently, degrading to the centered fallback).
4. Re-run each listed tour end-to-end and confirm every target still resolves. An empty affected list is stated explicitly ("no tours/docs cover these routes"), not assumed.

## Starter Templates

Generic stubs in `templates/` (only for projects without an existing system — never copy into a project that has one): `walkthroughs.js` (registry), `WalkthroughContext.jsx` (state, server completion, welcome, gating, deep-links), `WalkthroughOverlay.jsx` (spotlight renderer with viewport clamping, scroll re-measure, bottom-sheet mode), `docContent.js` (typed help blocks). Adapt names to the target project's auth/router/i18n/theme.

## Anti-Patterns — STOP mid-work and re-check when you catch yourself doing any of these

- Typing tour or help text anywhere other than the registry / doc-content module
- Per-page hardcoded coach-marks; class/nth-child targeting; localStorage-only completion
- Welcome prompt stacked on a first-run wizard; tours for screens the role can't reach
- A second copy of help text for the AI or the tours; hardcoded colors that break dark mode
- An anchored card off-screen on mobile; a spotlight that drifts on scroll; a dead `api/walkthroughs` import with no backend
- Shipping a UI change without running the maintenance workflow's affected-tour grep

## Final Rule

One declarative, server-tracked, role-gated registry driving the real UI through stable selectors, an overlay that survives scroll/mobile/dark-mode, and one help-docs source of truth serving the Help page, the tours, and the AI alike — verified across logins and browsers before it's called done.
