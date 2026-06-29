const { QueryTypes } = require('sequelize');
const { createSequelize } = require('./sequelize');
const { defineModels, migrateWithModels } = require('./models');

const { provider, sequelize } = createSequelize();
const dbMode = (process.env.DB_MODE || 'local').toLowerCase();
let initialized = false;
let models = null;

function withReturningIdForInsert(sql) {
  const normalized = String(sql || '').trim();
  if (!/^insert\s+into\s+/i.test(normalized)) {
    return normalized;
  }
  if (/\breturning\b/i.test(normalized)) {
    return normalized;
  }
  return `${normalized} RETURNING id`;
}

function normalizeExecuteResult(sql, rows, metadata) {
  const normalizedSql = String(sql || '').trim();
  const metadataObject = metadata && typeof metadata === 'object' ? metadata : {};
  const rowCountFromMeta = Number(
    metadataObject.rowCount
      ?? metadataObject.changes
      ?? (Array.isArray(rows) ? rows.length : 0),
  ) || 0;

  let lastInsertId = null;
  if (Array.isArray(rows) && rows.length > 0) {
    const first = rows[0];
    if (first && Object.prototype.hasOwnProperty.call(first, 'id')) {
      lastInsertId = first.id;
    }
  }
  if (lastInsertId == null && metadataObject.lastID != null) {
    lastInsertId = metadataObject.lastID;
  }

  return {
    rowCount: rowCountFromMeta,
    lastInsertId,
    rows: Array.isArray(rows) ? rows : [],
    sql: normalizedSql,
  };
}

async function init() {
  if (initialized) return;
  await sequelize.authenticate();
  models = defineModels(sequelize);
  initialized = true;
}

function getModels() {
  return models;
}

async function query(sql, params = []) {
  await init();
  return sequelize.query(String(sql), {
    replacements: params,
    type: QueryTypes.SELECT,
  });
}

async function execute(sql, params = []) {
  await init();
  const sqlToRun = provider === 'postgres' ? withReturningIdForInsert(sql) : String(sql);
  const [rows, metadata] = await sequelize.query(sqlToRun, {
    replacements: params,
  });
  return normalizeExecuteResult(sqlToRun, rows, metadata);
}

async function close() {
  if (!initialized) return;
  await sequelize.close();
  initialized = false;
}

// Apply the schema (sync + seed lookups) using the app's own connection. Same
// effect as `npm run migrate`, but callable in-process so production boot can
// self-sync. Idempotent: sync({ alter: true }) reconciles existing tables and
// the seeds use findOrCreate.
async function migrate() {
  await init();
  await migrateWithModels(sequelize, models);
}

async function transaction(fn) {
  await init();
  const tx = await sequelize.transaction();
  const txApi = {
    query: async (sql, params = []) => sequelize.query(String(sql), {
      transaction: tx,
      replacements: params,
      type: QueryTypes.SELECT,
    }),
    execute: async (sql, params = []) => {
      const sqlToRun = provider === 'postgres' ? withReturningIdForInsert(sql) : String(sql);
      const [rows, metadata] = await sequelize.query(sqlToRun, {
        transaction: tx,
        replacements: params,
      });
      return normalizeExecuteResult(sqlToRun, rows, metadata);
    },
  };

  try {
    const result = await fn(txApi);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

module.exports = {
  dbMode,
  provider,
  init,
  migrate,
  getModels,
  query,
  execute,
  close,
  transaction,
};
