# Project Guide for Claude

BC Defects & Enhancements — a Billing Center defect/enhancement submission portal.
Monorepo with two apps:

- **`client/`** — React + Vite SPA. Custom design system (no MUI) in
  `client/src/components/bite-size/BitsizeUI.jsx`. Structure: `pages/`,
  `components/{admin,public,bite-size,common}/`, `hooks/`, `lib/` (`api.js`,
  `socket.js`), `utils/`, `constants/`.
- **`server/`** — Node + Express 5 + Sequelize. Structure: `src/routes/`,
  `src/services/`, `src/middleware/`, `src/helpers/`, `db/`, `src/constants.js`.

## Run / verify

- Client dev: `cd client && npm run dev` (Vite on :5173, proxies `/api`,
  `/uploads`, `/socket.io` to :4000).
- Server dev: `cd server && npm run dev` (Express on :4000).
- **Lint must stay green:** `cd client && npm run lint` (ESLint incl.
  react-compiler rules). Run it before considering frontend work done.
- **Tests:** `cd server && npm test` (Node built-in `node:test`). Add/extend
  tests when changing the code they cover.

## Important project facts

- **Database:** `server/.env` has `DB_PROVIDER=postgres` pointing at a **live
  Supabase** DB — local runs hit production data. Local sandbox mode is
  `DB_PROVIDER=sqljs` / `DB_MODE=local` (local SQLite file). Confirm before
  doing anything destructive.
- **Auth & security:** session cookie `bc_sid` (httpOnly); admin routes use
  `ensureAdmin`. CSRF is double-submit (`bc_csrf` cookie + `X-CSRF-Token`
  header) enforced on `/api/admin/*` mutations — the client sends it via the
  shared `request()` helper in `lib/api.js`. `helmet` sets security headers.
- **DB access:** go through Sequelize models; the shared insert columns live in
  `server/src/helpers/submissionInsert.js`. Public API responses are
  field-allow-listed via `mapPublicSubmission` — never leak internal fields
  (email, reviewer, decision/impact notes, fingerprint) on public endpoints.

## Coding conventions — apply these skills by default

This project follows the skills in `.agents/skills/` (also linked at
`.claude/skills/`). Apply the relevant ones automatically; read the full
`SKILL.md` when a task matches before writing code. Map:

- **Every change:** `reuse-first-pattern-finder` (search for existing
  components/hooks/utils before creating new ones) and
  `codebase-aware-implementer` (match existing patterns; minimal, targeted
  changes that look like the maintainers wrote them).
- **Refactors:** `clean-refactor-maintainability-agent` (readability/dedup,
  no speculative abstraction, keep diffs focused).
- **Anything touching auth/input/endpoints/data/uploads/secrets:**
  `security-minded-developer` (validate input, enforce authz server-side,
  least privilege, no data leakage).
- **React UI structure:** `component-first-react-builder` (split into focused
  components; keep page files composition-only).
- **Responsive UI:** `responsive-ui-builder` — BUT note this repo has **no
  MUI**; ignore the skill's MUI-Grid guidance and follow the existing
  `bite-size` design system + the `.bs-grid` CSS patterns instead. Use custom
  dialogs/snackbars (`Modal`/`Notice`), never native `alert()`/`confirm()`.
- **React state:** `state-management-specialist` (keep state local, derive
  don't duplicate, follow existing hook patterns). *(Note: a near-duplicate
  `scalable-state-management-specialist` exists — prefer this one.)*
- **Backend endpoints:** `node-api-structure-enforcer` (thin routes →
  controllers/services; validation at the boundary; `.js` not `.jsx`).
- **Debugging:** `root-cause-debugger` (trace the real failure path; smallest
  safe fix; no speculative edits).
- **Deciding whether to add AI:** `forward-thinking-design` (justify AI vs.
  deterministic; ask before building; design for review/fallback).
- `new-project-creation` applies only to brand-new projects, not this repo.

## Workflow expectations

- Commit/push only when asked. Branch work happens on `dev`; `main` is the
  release branch (they currently track together).
- Keep `npm run lint` (client) and `npm test` (server) passing.
- Don't commit `.agents/skills/` or `.claude/` (kept local for now).
