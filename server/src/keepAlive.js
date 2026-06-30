/**
 * keepAlive.js
 *
 * Runs a lightweight no-op query against the database once a day so that
 * Supabase never sees the project as inactive and pauses it (free-tier projects
 * pause after ~7 days idle, so a daily ping is ample).
 * The query (SELECT 1) reads nothing and writes nothing – it is purely a
 * connection heartbeat.
 */

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let _db = null;

function ping() {
  if (!_db) return;

  _db.query('SELECT 1')
    .then(() => {
      console.log('[keepAlive] Supabase heartbeat OK –', new Date().toISOString());
    })
    .catch((err) => {
      console.warn('[keepAlive] Heartbeat query failed:', err.message);
    });
}

/**
 * Start the keep-alive heartbeat.
 * @param {object} db - The db adapter (must expose a `query(sql)` method).
 */
function startKeepAlive(db) {
  _db = db;

  // Fire once immediately so we know it works on startup.
  ping();

  // Then repeat once a day.
  const timer = setInterval(ping, INTERVAL_MS);

  // Don't let this timer block Node from exiting cleanly.
  if (timer.unref) timer.unref();

  console.log('[keepAlive] Supabase heartbeat scheduled once a day.');
}

module.exports = { startKeepAlive };
