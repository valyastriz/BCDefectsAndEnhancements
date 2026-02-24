const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_FILE = process.env.SQLJS_PATH || path.join(__dirname, '..', 'data', 'dev.sqlite');

let SQL = null;
let db = null;

function ensureReady() {
  if (!db) {
    throw new Error('sql.js adapter not initialized. Call init() first.');
  }
}

async function persistToDisk() {
  ensureReady();
  const dir = path.dirname(DB_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

async function init() {
  if (db) return;

  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(new Uint8Array(fileBuffer));
  } else {
    db = new SQL.Database();
    await persistToDisk();
  }
}

async function query(sql, params = []) {
  ensureReady();

  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

async function execute(sql, params = []) {
  ensureReady();

  if (!params || params.length === 0) {
    db.run(sql);
  } else {
    const stmt = db.prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  const changesResult = db.exec('SELECT changes() AS row_count');
  const rowCount =
    changesResult?.[0]?.values?.[0]?.[0] != null ? Number(changesResult[0].values[0][0]) : 0;

  const insertResult = db.exec('SELECT last_insert_rowid() AS id');
  const lastInsertId =
    insertResult?.[0]?.values?.[0]?.[0] != null ? Number(insertResult[0].values[0][0]) : null;

  await persistToDisk();

  return {
    rowCount,
    lastInsertId,
    rows: [],
  };
}

async function close() {
  if (!db) return;
  await persistToDisk();
  db.close();
  db = null;
}

async function transaction(fn) {
  ensureReady();

  const txApi = {
    query,
    execute,
  };

  await execute('BEGIN');
  try {
    const result = await fn(txApi);
    await execute('COMMIT');
    return result;
  } catch (error) {
    await execute('ROLLBACK');
    throw error;
  }
}

module.exports = {
  init,
  query,
  execute,
  close,
  transaction,
};
