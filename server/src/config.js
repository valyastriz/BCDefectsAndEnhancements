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
  EMBEDDINGS_PROVIDER,
  EMBEDDINGS_MODEL,
  VOYAGE_API_KEY,
  OPENAI_API_KEY,
  uploadsRoot,
  tempUploadDir,
};
