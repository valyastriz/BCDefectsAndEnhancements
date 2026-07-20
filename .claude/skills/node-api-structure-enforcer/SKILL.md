---
name: node-api-structure-enforcer
description: "Use when creating, updating, or restructuring Node/Express backend endpoints — including requests phrased as 'add a list/table/grid endpoint', 'add an API for X', 'change this route/response shape', or 'this route is slow / times out'. Owns route/controller/model layering, query and payload scale rules (pagination, N+1 prevention, transactions, DECIMAL money), the error status contract, permission wiring, and live-update emission on mutations. Not for frontend work or brand-new project scaffolding."
---

# Node API Structure Enforcer

## Purpose

Keep backend endpoints structurally clean AND production-scale by default: layered by responsibility, paginated, N+1-free, permission-guarded, emitting live updates, and returning a consistent error contract.

Portable across projects. The project's root `CLAUDE.md` documents its concrete layout, middleware, and commands — read it first; existing repo patterns always win over the defaults below. LOAD the operating-discipline skill now, before the first edit, and fill its templates from its text, not from memory.

## Use This Skill When

- Creating or updating an API endpoint
- Restructuring a backend feature whose route/controller has grown messy
- Adding list/table endpoints or multi-step write flows

## Do Not Use This Skill When

- A one-line change in an already well-structured file
- Standalone scripts outside the API
- Scaffolding a new project (new-project-creation)

## Before Touching an Existing Endpoint

Do this in order and write the results into the intake block (operating-discipline §1 — goal, done-means, constraints verbatim) BEFORE the first edit:

1. Grep for every consumer of the route path AND of every response field you will change or remove — the frontend API layer, views reading those fields, other backend callers, tests. List each with file:line; this inventory is a deliverable, not a mental note.
2. If any consumer depends on the current shape, prefer the additive change (new field/param beside the old, deprecate later). If only a breaking change will do, surface it to the user before making it — never silently break a consumer.
3. Read the controller you are about to change end-to-end before editing it.
4. **Performance complaints ("slow", "times out") get measured, not guessed:** before changing anything, time the real request (`curl -w` / logged duration) and record the number in the intake block; then identify WHICH query rule below is actually violated (unbounded query, N+1, blob columns in list `attributes`, missing index) from the query and payload, not from pattern-matching. After the fix, repeat the same measurement — the report states both numbers. "Fixed the slow route" without before/after timings is not a claim you may make.

## Structure — the House Layout

1. Flat layers, all `.js`: `routes/<name>Routes.js` (path wiring + middleware only) → `controllers/<snake_case>_controller.js` (class-based; extend the project's shared base CRUD controllers where they exist) → `models/*.js`. Shared business logic lives in `functions/` **only when used by 2+ controllers**; cross-cutting concerns in `middleware/`. Do not create `services/`, `validators/`, or `data/` directories or per-feature folder trees — confirm the actual layout in the repo and `CLAUDE.md` before placing files.
2. Controllers coordinate the request and hold thin business logic, matching how neighboring controllers are written. Read one sibling controller fully first and copy its structure only when you can state in one line why it is shaped that way; if the sibling itself violates a rule in this skill, follow the skill and flag the sibling — never propagate the defect.
3. Validation is explicit at the request boundary (body/params/query types, required ids, allowed values/transitions) and runs before any business logic.
4. New route files must be mounted in the server entry file — an unmounted route is a dead endpoint.

## Permissions & Tenancy

5. Every route registers the project's permission middleware (house pattern: `requirePermission("<resource>", "<action>")` from `middleware/permissionMiddleware.js` — confirm it exists) or carries `// public: <reason>`. Never hand-roll role checks in controllers.
6. Tenant-owned queries filter by the authenticated tenant id (e.g. `req.user.company_id`) — never bare `findByPk` on tenant data; foreign-tenant ids return 404. Depth: security-minded-developer.

## Query and Payload Rules

7. **Every list endpoint paginates**: accept `page`/`limit` with a hard server max, return `{ rows, total }` via `findAndCountAll` (or the project's established pagination pattern). Unbounded `findAll` for user-facing lists is forbidden.
8. Filter and sort in SQL (`where`/`order`) — never fetch-all-then-filter/sort in JS.
9. Eager-load associations with `include`; never query associations in a loop (N+1).
10. Shape list payloads with `attributes` — exclude blobs/large text from lists; detail endpoints return them.
11. Columns used in `where`/`order` get indexes declared on the model so the migration manager generates them.
12. Bulk work uses `bulkCreate`/`bulkUpdate` — never per-row awaits in loops. Multi-step writes wrap in one `sequelize.transaction`; live-update emits and cache invalidation happen **after commit**.
13. **Money — and any quantity money is computed from — is `DECIMAL` with explicit precision (or integer minor units), never `FLOAT`/`DOUBLE`.** Monetary arithmetic happens in SQL or a decimal library, never in native JS floats; the ORM returns `DECIMAL` as strings — do not `parseFloat` them.

## Live Updates & Cache

14. Every mutation endpoint (create/update/delete/status change) broadcasts through the house websocket helper (`notifyClients` in `functions/webSocketUtils.js` — confirm in this project) after the write succeeds, **always tenant-filtered**, using the neighboring controllers' event naming. A mutation with no broadcast is incomplete.
15. Raw SQL and bulk ops (`bulkCreate`, `Model.update` with `where`, `individualHooks: false`) bypass model-hook cache invalidation — invalidate explicitly via the project's cache utils in those paths.

## Error Contract

16. Consistent JSON error envelope: a translatable message key, no stack traces or internal details. Status selection is mechanical — if X, return Y:
    - Malformed or invalid input → **400** with field-level detail the frontend can render, e.g. `{ "error": "validation", "fields": { "name": "required", "price": "must_be_positive" } }` (adapt keys to the house envelope)
    - Missing or invalid credentials → **401**
    - Authenticated but lacking the permission → **403**
    - Not found OR an id belonging to another tenant → **404** (never a 403 that leaks the record's existence)
    - Unexpected failure → **500** with a generic message; the detail goes to the logger only
17. Unexpected errors log through the project's shared logger (with request context) before responding — never bare `console.log`. Log rejected access, successful mutations, and caught failures; never log secrets/tokens/raw sensitive payloads.

## Migrations

18. Schema changes go through the project's migration manager (house pattern: declare in models, `database-manager.js` generates/applies — see `CLAUDE.md` for commands). Never hand-write migration files unless the user explicitly asks.
19. If the model change **drops or renames** a column or table: STOP. Prefer additive — new column, backfill, deprecate the old — and never apply a drop/rename against a database holding data without a dry-run and explicit user sign-off (operating-discipline §3 tier 4).

## Delegation

20. Multi-resource API work fans out per context-lean-orchestrator: one builder per resource owning its routes + controller pair, with disjoint file ownership.
21. A single lead integrates the server-entry mounts (a shared hot file — never edited in parallel) and runs the combined verification gate before anything is called done.

## Verify Before Finishing

Check in blast-radius order (operating-discipline §3): tenancy/permissions first, then data integrity & money, then correctness — a lower-tier item never ships while a higher-tier item is open. Beyond the `CLAUDE.md` definition of done:

- Route file is mounted; endpoint hit for the happy path AND a failure path (bad input → 400 with field detail; missing permission → 403)
- Pagination enforced: request an oversize `limit` and confirm the server clamps it
- Mutation observed emitting its tenant-filtered event (second client receives it)
- No association queried in a loop in the new code; list payload contains only needed columns
- If the task was a performance complaint: the Before-Touching step-4 measurement re-run after the change, both numbers in the report
- On a new endpoint or sizable API diff: the operating-discipline §6 critique pass, run before reporting

Report per operating-discipline §6–7: every check pass / fail / not run + why — an unexecuted check goes under `Not run:`, never in the passed list.

## STOP Signs — halt and re-check before continuing

Universal list: operating-discipline §9. Domain triggers on top of it:

- Unbounded `findAll` behind a user-facing list; JS-side filtering/sorting of a full table; an association queried per row
- A mutation with no live-update broadcast, or a broadcast without a tenant filter
- Matching records or wiring behavior on a NAME/free-form string where an id exists — a rename becomes a silent unlink
- An empty or catch-and-continue block around a transaction or write path
- Editing a controller you have not read this session
- Inventing `services/`/`validators/` layers or `.jsx` backend files in a flat-layout repo
- A multi-step write with no transaction; `res.status(500)` with raw error internals; `console.log` instead of the shared logger
- The diff touching files the endpoint task does not implicate

## Final Rule

An endpoint is not done when it merely responds: it must be mounted, permission-guarded, tenant-scoped, paginated, N+1-free, transactional where multi-step, emitting tenant-filtered live updates, and returning the error contract — verified by hitting it.
