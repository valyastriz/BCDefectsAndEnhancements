/**
 * Verification for the persistent session store.
 *
 * WHY IT RESTARTS A SERVER. The bug this closes cannot be seen in one process:
 * sessions lived in express-session's default MemoryStore, so every restart of
 * the API — every deploy, and there were three in one day — dropped all of them
 * while open tabs went on showing "Filing as …". The owner hit it as "That did
 * not send — Requester Name is required" for a field the form had stopped
 * showing. Nothing short of stopping the process and starting it again proves
 * the fix, so this script owns its servers rather than borrowing one: it spawns
 * its own on a spare port, signs in, kills it, spawns a fresh one on the same
 * port, and presents the same cookie.
 *
 * THE CONTROL MATTERS AS MUCH AS THE TEST. The same sequence is run a second
 * time with SESSION_STORE=memory, where the session MUST be lost. Without that
 * half, a pass only shows the cookie was accepted — not that Postgres is what
 * accepted it.
 *
 * The honest "your session expired" path is checked too, because the fix is
 * meant to stop it firing on deploys, not to remove it: an 8-hour expiry, a
 * pruned row and a local sql.js box all still reach it.
 *
 * IT WRITES: session rows only, in `user_sessions`, and signs out of every one
 * it makes. It creates no tickets. It ends by printing the table's row count
 * from the migration script's dry run, the same way the ticket-writing scripts
 * print the submission count.
 *
 * It does NOT need Vite, a browser, or the server on :4000 — it drives the API
 * directly and brings its own. Ports 4100/4101 by default.
 *
 * Usage:
 *   node scripts/verify-session-store.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_DIR = path.resolve(fileURLToPath(new URL('../../server', import.meta.url)));
const PORT = Number(process.env.VERIFY_SESSION_PORT || 4100);
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin123';
const BOOT_TIMEOUT_MS = 60000;

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const base = () => `http://127.0.0.1:${PORT}`;

/** Is anything answering on the port? Used both to wait for a boot and to prove a kill. */
async function health() {
  try {
    const response = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start a server on PORT and wait until it answers.
 *
 * Its stdout is kept, not just piped away: the store's choice is announced there
 * (`[sessionStore] …`) and that line is the only honest way to confirm the
 * conditional resolved the way the environment should make it resolve — short of
 * adding an endpoint that reports configuration, which is not worth having.
 */
async function boot(sessionStore) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    // NODE_ENV stays unset on purpose: production boots with sync({ alter: true })
    // against this same hosted database, and a verification run must never do that.
    env: { ...process.env, PORT: String(PORT), SESSION_STORE: sessionStore, NODE_ENV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited during boot (${child.exitCode}):\n${log}`);
    if (await health()) return { child, log: () => log };
    await sleep(250);
  }
  child.kill();
  throw new Error(`server did not answer on ${base()} within ${BOOT_TIMEOUT_MS}ms:\n${log}`);
}

/** Stop it, and do not return until the port is genuinely free — the next boot needs it. */
async function stop(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once('exit', resolve));
  server.child.kill();
  await Promise.race([exited, sleep(10000)]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!(await health())) return;
    await sleep(200);
  }
  throw new Error('something is still answering on the port after the kill');
}

/** Pull one cookie's value out of a Set-Cookie header list. */
function readCookie(response, name) {
  const raw = response.headers.getSetCookie?.() || [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const [key, ...rest] = pair.split('=');
    if (key.trim() === name) return rest.join('=');
  }
  return null;
}

const withCookie = (sid) => (sid ? { cookie: `bc_sid=${sid}` } : {});

async function signIn() {
  const response = await fetch(`${base()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (response.status === 429) {
    // 10 attempts per 15 minutes per IP. Each boot is a fresh in-memory limiter,
    // so this should be unreachable here — say so plainly if it ever is not,
    // because a 429 mid-run reads exactly like a broken check.
    throw new Error('login was rate-limited (429) — wait out the 15-minute window and re-run');
  }
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return { sid: readCookie(response, 'bc_sid'), body: await response.json() };
}

const whoAmI = async (sid) => {
  const response = await fetch(`${base()}/api/auth/me`, { headers: withCookie(sid) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

/**
 * The row count the store is holding, and which database it is, read from the
 * migration script's dry run.
 *
 * The dialect comes from there rather than from this process's own environment:
 * `server/.env` is loaded by the server's dotenv, in the server's directory, and
 * a script sitting in `client/` reading `process.env.DB_PROVIDER` sees nothing at
 * all. An early version of this check did exactly that, concluded it was on
 * sql.js, and failed a server that had chosen correctly.
 */
function sessionRowCount() {
  const output = execFileSync(process.execPath, ['scripts/migrateSessionStore.js'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
  });
  const rows = output.match(/(\d+) row\(s\), (\d+) not yet expired/);
  const dialect = (output.match(/^Database: \S+ \((\w+)\)/m) || [])[1] || 'unknown';
  return {
    total: rows ? Number(rows[1]) : null,
    live: rows ? Number(rows[2]) : null,
    dialect,
    output,
  };
}

/**
 * Sign in, restart the server, and ask who the same cookie is now.
 * Returns what the server said after the restart.
 */
async function survivesARestart(sessionStore) {
  let server = await boot(sessionStore);
  try {
    const storeLine = (server.log().match(/\[sessionStore\].*/) || [''])[0];
    const { sid, body } = await signIn();
    const before = await whoAmI(sid);
    const firstPid = server.child.pid;

    await stop(server);
    server = null;
    server = await boot(sessionStore);

    const after = await whoAmI(sid);
    return { storeLine, sid, loginBody: body, before, after, firstPid, secondPid: server.child.pid, server };
  } catch (error) {
    await stop(server);
    throw error;
  }
}

async function run() {
  const baseline = sessionRowCount();
  console.log(`Database: ${baseline.dialect}`);
  console.log(`user_sessions before: ${baseline.total} row(s), ${baseline.live} live\n`);

  let server = null;
  try {
    // ── The fix: Postgres-backed sessions outlive the process ────────────────
    console.log('── Postgres store ──');
    const pg = await survivesARestart('pg');
    server = pg.server;

    record(
      'the store announces itself as Postgres on boot',
      /Postgres, table "user_sessions"/.test(pg.storeLine),
      pg.storeLine.trim() || '(no [sessionStore] line logged)',
    );
    record('signing in returns a bc_sid cookie', Boolean(pg.sid), pg.sid ? `${pg.sid.slice(0, 12)}…` : 'none');
    record(
      'the session works before the restart',
      pg.before.status === 200 && pg.before.body?.user?.username === USER,
      `${pg.before.status} ${pg.before.body?.user?.username || ''}`,
    );
    record(
      'the restart really was a new process',
      pg.firstPid !== pg.secondPid,
      `pid ${pg.firstPid} → ${pg.secondPid}`,
    );
    // The one that matters. This is the deploy, and the answer used to be 401.
    record(
      'THE SAME COOKIE IS STILL SIGNED IN AFTER THE RESTART',
      pg.after.status === 200 && pg.after.body?.user?.username === USER,
      `${pg.after.status} ${pg.after.body?.user?.username || '(nobody)'}`,
    );

    const viewer = await fetch(`${base()}/api/viewer`, { headers: withCookie(pg.sid) })
      .then((response) => response.json())
      .catch(() => ({}));
    record(
      'and /api/viewer — what the form reads for "Filing as …" — agrees',
      viewer?.viewer?.user?.username === USER,
      viewer?.viewer?.user?.username || '(anonymous)',
    );

    // ── The honest expired path still exists, it just stops firing on deploys ─
    const expired = await fetch(`${base()}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'bc_sid=s%3Anot-a-real-session.nope' },
      body: JSON.stringify({ type: 'defect', summary_of_issue: 'VERIFY session store — must not be created' }),
    });
    const expiredBody = await expired.json().catch(() => ({}));
    record(
      'an unknown bc_sid with no typed name is still 401 sessionExpired',
      expired.status === 401 && expiredBody.sessionExpired === true,
      `${expired.status} ${expiredBody.error || ''}`,
    );

    const anonymous = await fetch(`${base()}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'defect', summary_of_issue: 'VERIFY session store — must not be created' }),
    });
    const anonymousBody = await anonymous.json().catch(() => ({}));
    record(
      'no cookie and no name is still 400 "Requester Name is required" — a form that IS asking',
      anonymous.status === 400 && /Requester Name is required/.test(anonymousBody.error || ''),
      `${anonymous.status} ${anonymousBody.error || ''}`,
    );

    // Put the row back: signing out is how a session row leaves.
    const loggedOut = await fetch(`${base()}/api/auth/logout`, { method: 'POST', headers: withCookie(pg.sid) });
    record('signing out is accepted', loggedOut.ok, String(loggedOut.status));
    const afterLogout = await whoAmI(pg.sid);
    record(
      'and the signed-out cookie no longer resolves to anyone',
      afterLogout.status === 401,
      String(afterLogout.status),
    );

    await stop(server);
    server = null;

    // ── The setting that actually ships is `auto`, not `pg` ──────────────────
    // Everything above forced the store on so the run is the same everywhere.
    // Nothing has yet shown that a server booted the way the deploy boots it —
    // SESSION_STORE unset — reaches the same place.
    console.log('\n── the default (SESSION_STORE unset) ──');
    server = await boot('');
    const auto = (server.log().match(/\[sessionStore\].*/) || [''])[0];
    const expectsPostgres = baseline.dialect === 'postgres';
    record(
      expectsPostgres
        ? 'with no setting at all, a Postgres box chooses Postgres — this is the deployed configuration'
        : 'with no setting at all, a sql.js box falls back to MemoryStore — local dev still boots',
      expectsPostgres ? /Postgres, table "user_sessions"/.test(auto) : /MemoryStore/.test(auto),
      `${baseline.dialect} → ${auto.trim() || '(no [sessionStore] line logged)'}`,
    );
    await stop(server);
    server = null;

    // ── The control: without the store, the restart still loses everything ───
    console.log('\n── MemoryStore control ──');
    const memory = await survivesARestart('memory');
    server = memory.server;

    record(
      'SESSION_STORE=memory announces MemoryStore instead',
      /MemoryStore/.test(memory.storeLine),
      memory.storeLine.trim() || '(no [sessionStore] line logged)',
    );
    record(
      'the memory session works before the restart too',
      memory.before.status === 200 && memory.before.body?.user?.username === USER,
      `${memory.before.status} ${memory.before.body?.user?.username || ''}`,
    );
    // If this ever passes, the Postgres result above proves nothing.
    record(
      'and IS LOST by the restart — so the store is what carried the session, not the cookie',
      memory.after.status === 401,
      `${memory.after.status} ${memory.after.body?.user?.username || '(nobody)'}`,
    );
  } finally {
    await stop(server);
  }

  // ── Put the shared database back where it was found ────────────────────────
  const after = sessionRowCount();
  console.log(`\nuser_sessions after: ${after.total} row(s), ${after.live} live`);
  record(
    'no session this run made was left behind',
    after.live === baseline.live,
    `live ${baseline.live} → ${after.live}`,
  );

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const result of failed) console.log(`  - ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
