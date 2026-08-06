const path = require('path');
const { Sequelize } = require('sequelize');

function resolveSqliteFile() {
  const configured = process.env.SQLITE_PATH || process.env.SQLJS_PATH;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(__dirname, '..', configured);
  }
  return path.join(__dirname, '..', 'data', 'dev.sqlite');
}

function resolveProvider() {
  const dbMode = (process.env.DB_MODE || 'local').toLowerCase();
  return (process.env.DB_PROVIDER || (dbMode === 'hosted' ? 'postgres' : 'sqljs')).toLowerCase();
}

// Strip the SSL query parameters and let the driver options below decide instead.
// Supabase URLs carry `sslmode=require`, which `pg` reads as "verify the chain"
// and then fails on the pooler's certificate. Anything else connecting with this
// URL (the session store) needs the same treatment, hence the shared helper.
function normalizeDatabaseUrl(rawUrl) {
  const normalizedUrl = new URL(rawUrl);
  normalizedUrl.searchParams.delete('sslmode');
  normalizedUrl.searchParams.delete('ssl');
  return normalizedUrl.toString();
}

const POSTGRES_SSL = {
  require: true,
  rejectUnauthorized: false,
};

function createSequelize() {
  const provider = resolveProvider();

  if (provider === 'postgres') {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when DB_PROVIDER=postgres');
    }

    return {
      provider,
      sequelize: new Sequelize(normalizeDatabaseUrl(process.env.DATABASE_URL), {
        dialect: 'postgres',
        dialectOptions: {
          ssl: POSTGRES_SSL,
        },
        logging: false,
      }),
    };
  }

  return {
    provider: 'sqljs',
    sequelize: new Sequelize({
      dialect: 'sqlite',
      storage: resolveSqliteFile(),
      logging: false,
    }),
  };
}

module.exports = {
  createSequelize,
  resolveProvider,
  normalizeDatabaseUrl,
  POSTGRES_SSL,
};
