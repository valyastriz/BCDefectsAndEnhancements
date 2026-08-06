const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { resolveProvider, normalizeDatabaseUrl, POSTGRES_SSL } = require('../../db/sequelize');
const {
  SESSION_SECRET,
  SESSION_STORE,
  SESSION_COOKIE_SAME_SITE,
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_DOMAIN,
} = require('../config');

// Created by `npm run migrate:session-store`. `createTableIfMissing` below is the
// safety net for an environment where that has not been run yet, not the plan.
const SESSION_TABLE = 'user_sessions';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8;
// Expired rows are swept every 15 minutes rather than every minute (the store's
// default): sessions last 8 hours, so nothing needs finding faster than that, and
// the shared pooler does not need 60 extra queries an hour.
const PRUNE_INTERVAL_SECONDS = 60 * 15;
// The store only ever holds one connection's worth of work at a time. Supabase's
// pooler is shared with Sequelize, so take as little of it as possible.
const SESSION_POOL_MAX = 2;

/**
 * Decide where sessions live. Pure so the choice can be tested without a
 * database — the fallback matters as much as the happy path, since getting it
 * wrong means either a broken local dev box or silently going back to the
 * every-deploy sign-out this store exists to end.
 */
function resolveSessionStoreMode({ setting, provider, databaseUrl }) {
  const requested = String(setting || 'auto').trim().toLowerCase();

  if (requested === 'memory') {
    return { mode: 'memory', reason: 'SESSION_STORE=memory' };
  }

  if (requested === 'pg') {
    if (!databaseUrl) {
      // Asked for explicitly and impossible. Falling back here would quietly
      // reinstate the bug, so say so instead.
      throw new Error('SESSION_STORE=pg requires DATABASE_URL. Set it, or use SESSION_STORE=auto.');
    }
    return { mode: 'pg', reason: 'SESSION_STORE=pg' };
  }

  if (requested !== 'auto') {
    throw new Error(`SESSION_STORE must be one of auto, pg, memory — got "${requested}".`);
  }

  if (provider !== 'postgres') {
    return { mode: 'memory', reason: `DB_PROVIDER is "${provider}", not postgres` };
  }
  if (!databaseUrl) {
    return { mode: 'memory', reason: 'DATABASE_URL is not set' };
  }
  return { mode: 'pg', reason: 'DB_PROVIDER=postgres' };
}

function createSessionStore(mode) {
  if (mode !== 'pg') return undefined;

  const PgStore = connectPgSimple(session);
  return new PgStore({
    tableName: SESSION_TABLE,
    createTableIfMissing: true,
    pruneSessionInterval: PRUNE_INTERVAL_SECONDS,
    // Its own small pool, with the same SSL treatment Sequelize gets — the
    // pooler's certificate does not verify. The store attaches its own 'error'
    // handler to a pool it owns, so an idle-client error is logged, not fatal.
    conObject: {
      connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      ssl: POSTGRES_SSL,
      max: SESSION_POOL_MAX,
    },
    errorLog: (...args) => console.error('[sessionStore]', ...args),
  });
}

function createSessionMiddleware() {
  const { mode, reason } = resolveSessionStoreMode({
    setting: SESSION_STORE,
    provider: resolveProvider(),
    databaseUrl: process.env.DATABASE_URL,
  });

  if (mode === 'memory') {
    console.log(`[sessionStore] MemoryStore (${reason}) — sessions end when this process does.`);
  } else {
    console.log(`[sessionStore] Postgres, table "${SESSION_TABLE}" (${reason}) — sessions survive a restart.`);
  }

  return session({
    name: 'bc_sid',
    store: createSessionStore(mode),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: SESSION_COOKIE_SAME_SITE,
      secure: SESSION_COOKIE_SECURE,
      maxAge: SESSION_MAX_AGE_MS,
      ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
    },
  });
}

module.exports = {
  createSessionMiddleware,
  resolveSessionStoreMode,
  SESSION_TABLE,
};
