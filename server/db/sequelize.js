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

function createSequelize() {
  const provider = resolveProvider();

  if (provider === 'postgres') {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when DB_PROVIDER=postgres');
    }

    const normalizedUrl = new URL(process.env.DATABASE_URL);
    normalizedUrl.searchParams.delete('sslmode');
    normalizedUrl.searchParams.delete('ssl');

    return {
      provider,
      sequelize: new Sequelize(normalizedUrl.toString(), {
        dialect: 'postgres',
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
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
};
