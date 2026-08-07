const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGINS = String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((value) => String(value || '').trim())
  .filter(Boolean);
const CLIENT_ORIGIN = CLIENT_ORIGINS[0] || 'http://localhost:5173';
const DEFAULT_SESSION_SECRET = 'local-dev-secret-change-me';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
if (IS_PRODUCTION && (SESSION_SECRET === DEFAULT_SESSION_SECRET || SESSION_SECRET.length < 32)) {
  throw new Error(
    'SESSION_SECRET must be set to a strong value (>= 32 chars) in production. Refusing to start with the development default.',
  );
}
const SESSION_COOKIE_SAME_SITE = String(
  process.env.SESSION_COOKIE_SAME_SITE || (IS_PRODUCTION ? 'none' : 'lax'),
).toLowerCase();
const SESSION_COOKIE_SECURE = String(process.env.SESSION_COOKIE_SECURE || (IS_PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';
const SESSION_COOKIE_DOMAIN = String(process.env.SESSION_COOKIE_DOMAIN || '').trim() || null;

// Where sessions are kept. express-session's default MemoryStore drops every
// session when the process restarts, which on a deployed app means every deploy
// signs everybody out mid-form. 'auto' uses the Postgres store whenever the app
// is already talking to Postgres and MemoryStore otherwise, because local
// development runs on sql.js where a Postgres store cannot work.
//   auto   — Postgres when DB_PROVIDER=postgres, else memory (the default)
//   pg     — force the Postgres store; refuses to start without DATABASE_URL
//   memory — force MemoryStore, the escape hatch if the store misbehaves
const SESSION_STORE = String(process.env.SESSION_STORE || 'auto').trim().toLowerCase();

// ── Identity ─────────────────────────────────────────────────────────────────
// 'local' = the username/password admin login this app ships with.
// 'sso'   = an external identity provider (Active Directory) asserts who the
//           caller is. Only the viewer envelope's source changes for consumers;
//           every page reads GET /api/viewer either way.
const AUTH_MODE = String(process.env.AUTH_MODE || 'local').trim().toLowerCase();

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || 'attachments').trim();
const SUPABASE_STORAGE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_STORAGE_BUCKET);

// ── AI semantic ticket search ────────────────────────────────────────────────
// The Claude summary and the embeddings provider are both optional: when the
// relevant keys are missing the feature disables itself gracefully (the UI hides
// the search panel), so the app runs unchanged without any AI configured.
const toBool = (value, fallback) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};
const toPositiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

// ── Who may file a ticket ────────────────────────────────────────────────────
// FILING REQUIRES A SIGNED-IN PERSON. A request is from somebody: a ticket that
// belongs to nobody is unfindable by its own requester, unanswerable when triage
// needs to ask a question about it, and an anonymous POST to /api/submissions is
// an open door on a public URL.
//
// This used to default to `AUTH_MODE === 'sso'`, and the reason was real at the
// time: SSO was going to be the only way a REP could sign in, the local login
// was admin-only, and arming this while AUTH_MODE=local would have left the
// submit form reachable by nobody and taken the portal's whole purpose offline.
//
// THAT CONSTRAINT IS GONE. `users.role` now has a second value that may sign in
// — `rep` (see ACCOUNT_ROLES_THAT_MAY_SIGN_IN in constants.js, and the `pc_rep` /
// `bc_rep` accounts seedTeamAccounts.js creates) — so a requester can sign in
// through the local login today, with no identity provider involved. The report
// branch has required a session since the eleventh pass for exactly the reason
// above; there was never an argument for the other two types being different,
// only the missing login.
//
// So it defaults ON, in code rather than in an environment variable, because a
// deploy takes the code and not this machine's `.env`. `SUBMIT_REQUIRES_AUTH=false`
// re-opens the anonymous path for an environment that has to have it — a
// deliberate, named decision, which is the right shape for taking a door off.
const SUBMIT_REQUIRES_AUTH = toBool(process.env.SUBMIT_REQUIRES_AUTH, true);

// Master switch: 'openai' or 'anthropic'. Flip this per environment (demo vs
// work). It drives BOTH the summary vendor and the embeddings vendor, so a
// single line picks the whole stack — never a mix. The granular
// AI_SUMMARY_PROVIDER / EMBEDDINGS_PROVIDER overrides below still win if set.
const AI_PROVIDER = String(process.env.AI_PROVIDER || '').trim().toLowerCase();

const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || '').trim();
const AI_MODEL = String(process.env.AI_MODEL || 'claude-haiku-4-5').trim(); // Anthropic summary model
const OPENAI_SUMMARY_MODEL = String(process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini').trim(); // OpenAI summary model
// Which vendor writes the AI summary. Explicit override wins; else follow the
// master switch; else default to Anthropic.
const AI_SUMMARY_PROVIDER = String(process.env.AI_SUMMARY_PROVIDER || AI_PROVIDER || 'anthropic').trim().toLowerCase();
const AI_SEARCH_ENABLED = toBool(process.env.AI_SEARCH_ENABLED, true);
const AI_SEARCH_PUBLIC_ENABLED = toBool(process.env.AI_SEARCH_PUBLIC_ENABLED, true);
const AI_SEARCH_TOP_K = toPositiveInt(process.env.AI_SEARCH_TOP_K, 20);
const AI_SEARCH_MAX_QUERY_LENGTH = toPositiveInt(process.env.AI_SEARCH_MAX_QUERY_LENGTH, 500);
// Cap embeddings computed inline during a single search (self-healing for
// tickets created/edited before the backfill ran), so search stays bounded.
const AI_SEARCH_MAX_INLINE_EMBED = toPositiveInt(process.env.AI_SEARCH_MAX_INLINE_EMBED, 25);
// Per-IP rate limit for the unauthenticated public search endpoint.
const AI_SEARCH_PUBLIC_RATE_LIMIT = toPositiveInt(process.env.AI_SEARCH_PUBLIC_RATE_LIMIT, 20);
const AI_SEARCH_PUBLIC_RATE_WINDOW_MS = toPositiveInt(process.env.AI_SEARCH_PUBLIC_RATE_WINDOW_MS, 60000);
// Ranking blends semantic match with recency: final = similarity + weight * recency,
// where recency decays by half every RECENCY_HALFLIFE_DAYS. Higher weight favors
// newer tickets more; 0 disables the recency boost (pure match).
const AI_SEARCH_RECENCY_WEIGHT = Number.isFinite(Number(process.env.AI_SEARCH_RECENCY_WEIGHT))
  ? Number(process.env.AI_SEARCH_RECENCY_WEIGHT)
  : 0.15;
const AI_SEARCH_RECENCY_HALFLIFE_DAYS = toPositiveInt(process.env.AI_SEARCH_RECENCY_HALFLIFE_DAYS, 180);
// Minimum raw cosine similarity for a candidate to count as a match at all —
// drops near-zero-relevance tickets instead of letting them fill top-K. Applied
// to the raw match, never the recency-blended score. Calibrated for
// text-embedding-3-small; tune per embeddings model. 0 disables the floor.
const AI_SEARCH_MIN_SIMILARITY = Number.isFinite(Number(process.env.AI_SEARCH_MIN_SIMILARITY))
  ? Number(process.env.AI_SEARCH_MIN_SIMILARITY)
  : 0.25;

// Embeddings vendor (Claude has none). Explicit override wins; else follow the
// master switch — 'openai' uses OpenAI embeddings, anything else uses 'local'
// (a small self-hosted model, no vendor/key) so an all-Anthropic environment has
// zero third parties. Set EMBEDDINGS_PROVIDER=voyage to use Voyage instead.
const EMBEDDINGS_PROVIDER = String(
  process.env.EMBEDDINGS_PROVIDER || (AI_PROVIDER === 'openai' ? 'openai' : 'local'),
).trim().toLowerCase();
const EMBEDDINGS_MODEL = String(
  process.env.EMBEDDINGS_MODEL || (
    EMBEDDINGS_PROVIDER === 'openai' ? 'text-embedding-3-small'
      : EMBEDDINGS_PROVIDER === 'voyage' ? 'voyage-3.5-lite'
        : 'Xenova/all-MiniLM-L6-v2'
  ),
).trim();
const VOYAGE_API_KEY = String(process.env.VOYAGE_API_KEY || '').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();

// ── Dev-only impersonation ───────────────────────────────────────────────────
// Per-application admin roles and super users cannot be tested before SSO exists
// without a way to become a different user. This is that way, and it is a
// password-free login by design — so it is gated on THREE independent conditions
// and its route is not even registered unless all three hold:
//
//   1. AUTH_MODE=local        — under SSO the provider is the only way in
//   2. NODE_ENV != production — the deployed app can never expose it
//   3. DEV_IMPERSONATION=true — explicit opt-in, off by default
//
// Any one of these being false makes it unreachable, so a single mis-set variable
// cannot open it.
const DEV_IMPERSONATION_ENABLED = AUTH_MODE === 'local'
  && !IS_PRODUCTION
  && toBool(process.env.DEV_IMPERSONATION, false);

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const tempUploadDir = path.join(uploadsRoot, 'tmp');

fs.mkdirSync(tempUploadDir, { recursive: true });

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  CLIENT_ORIGINS,
  CLIENT_ORIGIN,
  SESSION_SECRET,
  SESSION_COOKIE_SAME_SITE,
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_DOMAIN,
  SESSION_STORE,
  AUTH_MODE,
  SUBMIT_REQUIRES_AUTH,
  DEV_IMPERSONATION_ENABLED,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET,
  SUPABASE_STORAGE_ENABLED,
  AI_PROVIDER,
  ANTHROPIC_API_KEY,
  AI_MODEL,
  OPENAI_SUMMARY_MODEL,
  AI_SUMMARY_PROVIDER,
  AI_SEARCH_ENABLED,
  AI_SEARCH_PUBLIC_ENABLED,
  AI_SEARCH_TOP_K,
  AI_SEARCH_MAX_QUERY_LENGTH,
  AI_SEARCH_MAX_INLINE_EMBED,
  AI_SEARCH_PUBLIC_RATE_LIMIT,
  AI_SEARCH_PUBLIC_RATE_WINDOW_MS,
  AI_SEARCH_RECENCY_WEIGHT,
  AI_SEARCH_RECENCY_HALFLIFE_DAYS,
  AI_SEARCH_MIN_SIMILARITY,
  EMBEDDINGS_PROVIDER,
  EMBEDDINGS_MODEL,
  VOYAGE_API_KEY,
  OPENAI_API_KEY,
  uploadsRoot,
  tempUploadDir,
};
