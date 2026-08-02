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

- **Database — read `server/.env`, do not assume.** Two modes, selected by
  `DB_PROVIDER` (`db/sequelize.js:16`, defaulting from `DB_MODE`):
  - `sqljs` / `DB_MODE=local` — a local sql.js file with seeded sample data.
    Safe to write to freely.
  - `postgres` / `DB_MODE=hosted` — the **live Supabase** DB, i.e. production
    data. Requires `DATABASE_URL`; `db/sequelize.js:24` throws without it.

  **As of 2026-08-01 `.env` is `sqljs` / `local` with an empty `DATABASE_URL`,
  so local runs are sandboxed.** This flips, so check the file rather than
  trusting this line, and confirm before anything destructive when hosted.

  Note: `[keepAlive] Supabase heartbeat OK` in the server log does **not** mean
  you are on Supabase data — it is a separate keep-alive ping (`keepAlive.js`)
  that runs regardless of provider.
- **Auth & security:** session cookie `bc_sid` (httpOnly); admin routes use
  `ensureAdmin`. CSRF is double-submit (`bc_csrf` cookie + `X-CSRF-Token`
  header) enforced on `/api/admin/*` mutations — the client sends it via the
  shared `request()` helper in `lib/api.js`. `helmet` sets security headers.
- **DB access:** go through Sequelize models; the shared insert columns live in
  `server/src/helpers/submissionInsert.js`. Public API responses are
  field-allow-listed via `mapPublicSubmission` — never leak internal fields
  (email, reviewer, decision/impact notes, fingerprint) on public endpoints.
- **AI semantic search** (`server/docs/ai-search.md`): optional, self-disabling
  when no key is set. Provider is a master switch `AI_PROVIDER` (`openai` = all
  OpenAI; `anthropic` = Claude summary + self-hosted local embeddings). Modules:
  `src/embeddings.js`, `src/aiSummary.js`, `src/services/{aiSearchService,
  embeddingIndexService}.js`, `src/routes/aiSearchRoutes.js`; new
  `submission_embeddings` table; `npm run backfill:embeddings` to index existing
  tickets. Public search reuses `mapPublicSubmission` + `is_public` gating and is
  rate-limited — keep both when touching it. Never send internal fields to the
  public summary call.

## Coding conventions — apply these skills by default

This project follows the skills in `.claude/skills/`. Apply the relevant ones
automatically; read the full `SKILL.md` when a task matches before writing
code. Map:

- **Start of any non-trivial task:** `operating-discipline` (the shared
  procedure layer — intake, premise check, blast-radius scan, decision records,
  verification standards). Domain skills below build on it.
- **Feature work / changes / fixes in this repo:** `codebase-aware-implementer`
  (inspect-first, reuse-first; match existing patterns; minimal, targeted
  changes that look like the maintainers wrote them). This is the default.
- **Cleanup / refactors:** `refactor-and-cleanup` (readability/dedup, no
  speculative abstraction, keep diffs focused; behavior-preserving).
- **Anything touching auth/input/endpoints/data/uploads/secrets/websockets:**
  `security-minded-developer` (validate input, enforce authz server-side,
  tenant isolation, fail closed, no data leakage).
- **React UI (pages, components, layouts, tables, forms, dialogs):**
  `react-ui-builder` (component decomposition, responsive layout, the four
  data-surface states, live updates, a11y) — BUT note this repo has **no MUI**;
  ignore any MUI-Grid guidance and follow the existing `bite-size` design system
  + the `.bs-grid` CSS patterns instead. Use custom dialogs/snackbars
  (`Modal`/`Notice`), never native `alert()`/`confirm()`.
- **React state:** `state-management-specialist` (keep state local, derive
  don't duplicate, single source of truth, follow existing hook patterns).
- **Backend endpoints:** `node-api-structure-enforcer` (thin routes →
  controllers/services; validation at the boundary; pagination/N+1/transactions
  at scale; `.js` not `.jsx`).
- **Debugging:** `root-cause-debugger` (reproduce first, trace to the first
  wrong behavior, smallest safe fix, re-run the repro).
- **Deciding whether to add AI:** `forward-thinking-design` (justify AI vs.
  deterministic; ask before building; design for review/fallback).
- **AI assistant/copilot over app data:** `grounded-data-assistant`
  (tool-using, tenant-scoped, grounded — no hallucinated numbers or invented UI
  steps).
- **New feature/page design or redesign:** `artifact-mockup-first` (approved
  Artifact mockup before product code; build must match it, fully wired to real
  data with live updates + responsiveness).
- **Onboarding tours / in-app help docs:** `guided-onboarding-walkthroughs`
  (declarative tour registry, server-tracked completion; also fires when UI
  changes could break existing tour targets or docs).
- **Multi-step work across 2+ areas/subsystems:** `context-lean-orchestrator`
  (delegate to subagents, exchange files not pasted content, keep context lean).
- **After any verified feature/API/data-model change:** `project-plan-maintenance`
  (keep a single `plan.md` at the project root accurate before reporting done).
- `new-project-creation` applies only to brand-new projects, not this repo.

## Workflow expectations

- Commit/push only when asked. Branch work happens on `dev`; `main` is the
  release branch (they currently track together).
- Keep `npm run lint` (client) and `npm test` (server) passing.
- Skills live in `.claude/skills/`, committed as plain files so Claude Code
  discovers them on every OS (Windows included). `.claude/settings.local.json`
  is local-only (gitignored).
