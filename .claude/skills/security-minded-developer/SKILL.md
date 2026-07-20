---
name: security-minded-developer
description: "Use when code touches authentication, authorization, permissions, tenant-scoped data, API endpoints handling user input, file uploads, secrets, tokens, or websocket broadcasts — and also when reviewing, auditing, or probing existing code for security issues (tenant leaks, IDOR, permission gaps). Owns permission middleware wiring, multi-tenant isolation, fail-closed error handling, upload safety, secret handling, and the security probe checklist. Not for purely visual changes with no data or permission impact."
---

# Security-Minded Developer

## Purpose

Apply the project's real enforcement mechanisms — not hand-rolled checks — so every change ships with explicit authorization, tenant isolation, safe data handling, and verified (not assumed) protections.

Portable across projects. Discover the project's concrete mechanisms first (middleware directory, `CLAUDE.md`); the house patterns below are standard across these apps — confirm presence, and if a mechanism is missing entirely, raise it before shipping unprotected code. LOAD the operating-discipline skill now, before Step 0, and fill its templates from its text, not from memory.

## Use This Skill When

- Creating or changing API endpoints, auth flows, or permission logic
- Handling user input, uploads, tokens, secrets, or sensitive fields
- Emitting websocket broadcasts or caching authenticated responses
- Reviewing or auditing existing code for security issues

## Do Not Use This Skill When

- Purely visual changes with no data, input, or permission impact

## Step 0 — Inventory the Security Surface (before any edit)

As part of the intake block (operating-discipline §1), list with file:line every surface the task touches or creates:

1. Routes added or changed — and whether each has permission middleware or a `// public:` comment
2. Every new or modified query on a tenant-owned table
3. Every websocket broadcast
4. Every point where external input crosses the boundary (body, params, query, headers, uploads)

This inventory is a deliverable and drives the probe checklist below — each probe runs against every item on it, not just the one route you were pointed at.

## Authorization

1. Every new or modified route registers the project's permission middleware — house pattern: `requirePermission("<resource>", "<action>")` from `middleware/permissionMiddleware.js` — or carries `// public: <reason>` above it. Never hand-roll role checks inside controllers when middleware can express them; new resource/action pairs get registered in the project's RBAC config, not invented inline.
2. Enforce on the backend. Client-side checks are UX, never security.
3. **Fail closed.** Any error thrown while evaluating authentication, permission, or tenant ownership results in denial (401/403/404) — never in proceeding. An empty or logging-only `catch` in an auth or tenancy path is a STOP sign.

## Tenant Isolation (multi-tenant projects)

4. Check the models for a tenant column (house pattern: `company_id`, often `location_id`). Every query on a tenant-owned table filters by the authenticated tenant id (`req.user.company_id`) or verifies ownership through an association include — **never bare `findByPk(req.params.id)` on tenant data**. A valid id belonging to another tenant returns 404, never the record. This is the primary IDOR defense.
5. **Websocket broadcasts leak by default**: the house `notifyClients` broadcasts to every authenticated client when the filter argument is omitted. Always pass a tenant filter (e.g. `{ company_id }`). A bare call is a cross-tenant data leak.
6. Cached authenticated responses must be keyed by tenant scope + query string — never a tenant-blind cache key.

## Input & Uploads

7. Treat all external input as untrusted: validate required fields, types, and allowed values at the request boundary; reject malformed input with 400s. Concretely: raw SQL takes only bound parameters (`replacements`/placeholders) — never template-string interpolation of input; file paths derived from input are server-side lookups of allowlisted ids — never joined/concatenated user-supplied paths; input never reaches shell-adjacent operations.
8. Uploads: explicit size limits and a content-type allowlist on the upload middleware (house: multer), server-generated storage keys (never client filenames), and uploads are never executed or served from the app origin.

## Secrets & Sensitive Data

9. Secrets live in backend env config only — never in source, frontend bundles, logs, or `plan.md`. Reuse the project's encryption helper (house: `backend/functions/encryption.js`); if it is absent, do NOT hand-roll ad-hoc crypto — flag the gap with the concrete risk and proceed only on the user's call.
10. Responses return only needed fields — never full records with password/hash/token/internal fields; errors return safe messages, never stack traces or infrastructure details.
11. Log security-relevant outcomes (rejected access, permission denials) through the project's shared logger with minimal safe context — never secrets, tokens, or raw sensitive payloads.

## Abuse Resistance

12. Rate-limit auth, upload, and expensive endpoints (house dependency: express-rate-limit — confirm presence). If absent → do not silently skip and do not invent a substitute; flag the gap and its concrete risk (brute force, credential stuffing, cost blowup degrading all tenants) to the user and proceed only on their call.

## Findings & Delegation

13. Every reported issue uses the operating-discipline §6 FINDING template (claim / evidence file:line / failure scenario / severity / proposed fix). The Severity field always carries operating-discipline §3's GLOBAL tier numbers — never a domain-local renumbering, so findings from different lenses merge and rank on one scale. Map this domain's categories onto that scale, and fix in this order — a lower-ranked fix never ships while a higher-ranked finding is open:
    - Cross-tenant access or auth bypass → `Severity: 1 (tenancy/auth)`
    - Sensitive-data exposure (secrets, tokens, over-returned fields, leaky logs/broadcasts) → `Severity: 1 (exposure)`
    - Hardening gaps (rate limits, headers, defense-in-depth) → `Severity: 1 (hardening)` — ranked AFTER every confirmed tier 1–3 defect from any lens (a missing rate limit never blocks a correctness fix)
14. A finding without a concrete failure scenario (these inputs/this state → this wrong outcome, held against the real code) doesn't count — default-refute it; label anything less a hunch.
15. Security review at scale runs as context-lean-orchestrator's verification-fleet procedure (do not restate it — follow it there), with the final gate running this skill's probe checklist on the combined tree.

## Verification Before Finishing (all required, actually executed)

- [ ] Grep the touched route files: every route has the permission middleware or a `// public:` comment
- [ ] Hit each new/changed endpoint unauthenticated → 401; as a user without the permission → 403
- [ ] Request a record id belonging to a different tenant → 404, never the record
- [ ] Inspect the actual response JSON: no password/hash/token/secret/stack/internal fields
- [ ] Grep the frontend diff for server secrets or privileged config
- [ ] If broadcasts were added: confirm each `notifyClients` call passes a tenant filter
- [ ] If the task touched input parsing or raw SQL (rule 7): send one malformed payload and one injection-shaped payload (`' OR 1=1--` in a string field) → 400 rejection, never a 500 and never executed
- [ ] If the task touched uploads (rule 8): post an oversize file and a disallowed content type → both rejected; post a filename containing path segments (`../../x`) → stored under a server-generated key, never the client path

**Fixture rule** (operating-discipline §6): a probe missing its fixture (second tenant, unprivileged user) gets the fixture CREATED — seed script or direct insert — and run; only a genuinely impossible probe goes under `Not run: <probe> — <why>`, never in the passed list.

## STOP Signs — halt and re-check before continuing

Universal list: operating-discipline §9. Domain triggers on top of it:

- Hand-rolled role checks in controllers beside existing permission middleware
- `findByPk(req.params.id)` on tenant data; 403-with-data instead of 404 for foreign ids
- A `catch` in an auth/permission/ownership path that falls through to allow
- Bare `notifyClients` calls; tenant-blind cache keys
- Trusting client-provided role/ownership fields; auth checks only in the UI
- Returning whole model instances; logging tokens; uploads with client-controlled names

## Final Rule

Authorization is middleware-enforced, data is tenant-scoped, broadcasts are filtered, errors fail closed, and none of it counts until the 401/403/404 probes were actually run. If a choice is convenient but riskier, take the safer one — state the one-line why and note the runner-up (operating-discipline §5).
