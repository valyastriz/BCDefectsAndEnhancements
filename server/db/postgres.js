const { Pool } = require('pg');

let pool = null;

function toPostgresPlaceholders(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => `$${++index}`);
}

function withReturningIdForInsert(sql) {
  const normalized = String(sql).trim();
  if (!/^insert\s+into\s+/i.test(normalized)) {
    return normalized;
  }
  if (/\breturning\b/i.test(normalized)) {
    return normalized;
  }

  return `${normalized} RETURNING id`;
}

async function init() {
  if (pool) return;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when DB_PROVIDER=postgres');
  }

  pool = new Pool({ connectionString });
}

function ensureReady() {
  if (!pool) {
    throw new Error('Postgres adapter not initialized. Call init() first.');
  }
}

async function query(sql, params = []) {
  ensureReady();
  const text = toPostgresPlaceholders(sql);
  const result = await pool.query(text, params);
  return result.rows;
}

async function execute(sql, params = []) {
  ensureReady();
  const text = toPostgresPlaceholders(withReturningIdForInsert(sql));
  const result = await pool.query(text, params);

  const row0 = result.rows && result.rows[0] ? result.rows[0] : null;
  const lastInsertId = row0 && Object.prototype.hasOwnProperty.call(row0, 'id') ? row0.id : null;

  return {
    rowCount: result.rowCount || 0,
    lastInsertId,
    rows: result.rows || [],
  };
}

async function close() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

async function transaction(fn) {
  ensureReady();

  const client = await pool.connect();
  const txApi = {
    query: async (sql, params = []) => {
      const text = toPostgresPlaceholders(sql);
      const result = await client.query(text, params);
      return result.rows;
    },
    execute: async (sql, params = []) => {
      const text = toPostgresPlaceholders(withReturningIdForInsert(sql));
      const result = await client.query(text, params);
      const row0 = result.rows && result.rows[0] ? result.rows[0] : null;
      const lastInsertId = row0 && Object.prototype.hasOwnProperty.call(row0, 'id') ? row0.id : null;
      return {
        rowCount: result.rowCount || 0,
        lastInsertId,
        rows: result.rows || [],
      };
    },
  };

  try {
    await client.query('BEGIN');
    const result = await fn(txApi);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  init,
  query,
  execute,
  close,
  transaction,
};
