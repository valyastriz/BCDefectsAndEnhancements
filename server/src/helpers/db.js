const dbApi = require('../../db');

async function withDb(handler) {
  await dbApi.init();

  const db = {
    get: async (sql, params = []) => {
      const rows = await dbApi.query(sql, params);
      return rows[0] || null;
    },
    all: async (sql, params = []) => dbApi.query(sql, params),
    run: async (sql, params = []) => {
      const result = await dbApi.execute(sql, params);
      return {
        lastID: result.lastInsertId,
        changes: result.rowCount,
      };
    },
    close: async () => {},
  };

  return handler(db);
}

function parseErrorsJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

module.exports = {
  withDb,
  parseErrorsJson,
};
