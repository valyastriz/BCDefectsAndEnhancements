const sqljs = require('./sqljs');
const postgres = require('./postgres');

const provider = (process.env.DB_PROVIDER || 'sqljs').toLowerCase();

function resolveBackend() {
  if (provider === 'postgres') {
    return postgres;
  }
  return sqljs;
}

const backend = resolveBackend();
let initialized = false;

async function init() {
  if (initialized) return;
  await backend.init();
  initialized = true;
}

async function query(sql, params = []) {
  await init();
  return backend.query(sql, params);
}

async function execute(sql, params = []) {
  await init();
  return backend.execute(sql, params);
}

async function close() {
  if (!initialized) return;
  await backend.close();
  initialized = false;
}

async function transaction(fn) {
  await init();
  if (typeof backend.transaction === 'function') {
    return backend.transaction(fn);
  }
  return fn({ query, execute });
}

module.exports = {
  provider,
  init,
  query,
  execute,
  close,
  transaction,
};
