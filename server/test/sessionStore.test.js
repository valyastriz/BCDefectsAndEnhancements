const { test } = require('node:test');
const assert = require('node:assert');

const { resolveSessionStoreMode } = require('../src/middleware/session');

// Sessions used to live in MemoryStore, so every deploy signed everybody out.
// The Postgres store fixes that, but it CANNOT be unconditional: local
// development runs on sql.js, where there is no Postgres to talk to. These pin
// the fallback as hard as the happy path — a wrong answer here is either a dev
// box that will not boot, or production silently back on MemoryStore.

const PG_URL = 'postgres://user:pw@host:5432/db';

// ── auto: follow the database the app is already using ───────────────────────
test('auto uses Postgres when the app is on Postgres', () => {
  const result = resolveSessionStoreMode({ setting: 'auto', provider: 'postgres', databaseUrl: PG_URL });

  assert.strictEqual(result.mode, 'pg');
});

test('auto falls back to memory on sql.js — local dev has no Postgres', () => {
  const result = resolveSessionStoreMode({ setting: 'auto', provider: 'sqljs', databaseUrl: undefined });

  assert.strictEqual(result.mode, 'memory');
  assert.match(result.reason, /sqljs/);
});

test('auto falls back to memory when the provider says postgres but no URL is set', () => {
  // Misconfigured rather than deliberate, so stay up and say why.
  const result = resolveSessionStoreMode({ setting: 'auto', provider: 'postgres', databaseUrl: '' });

  assert.strictEqual(result.mode, 'memory');
  assert.match(result.reason, /DATABASE_URL/);
});

test('an absent setting is treated as auto', () => {
  assert.strictEqual(
    resolveSessionStoreMode({ setting: undefined, provider: 'postgres', databaseUrl: PG_URL }).mode,
    'pg',
  );
  assert.strictEqual(
    resolveSessionStoreMode({ setting: '', provider: 'sqljs', databaseUrl: undefined }).mode,
    'memory',
  );
});

// ── explicit overrides ───────────────────────────────────────────────────────
test('memory is honoured even on Postgres — the escape hatch has to work', () => {
  const result = resolveSessionStoreMode({ setting: 'memory', provider: 'postgres', databaseUrl: PG_URL });

  assert.strictEqual(result.mode, 'memory');
});

test('pg is honoured even when the provider is sqljs', () => {
  const result = resolveSessionStoreMode({ setting: 'pg', provider: 'sqljs', databaseUrl: PG_URL });

  assert.strictEqual(result.mode, 'pg');
});

test('pg without a DATABASE_URL throws rather than quietly using memory', () => {
  // Falling back here would reinstate the every-deploy sign-out invisibly, in the
  // one environment whose operator explicitly asked for the opposite.
  assert.throws(
    () => resolveSessionStoreMode({ setting: 'pg', provider: 'postgres', databaseUrl: '' }),
    /DATABASE_URL/,
  );
});

test('an unrecognised setting throws instead of guessing', () => {
  assert.throws(
    () => resolveSessionStoreMode({ setting: 'redis', provider: 'postgres', databaseUrl: PG_URL }),
    /auto, pg, memory/,
  );
});

test('the setting is case- and whitespace-insensitive', () => {
  assert.strictEqual(
    resolveSessionStoreMode({ setting: '  Memory ', provider: 'postgres', databaseUrl: PG_URL }).mode,
    'memory',
  );
});
