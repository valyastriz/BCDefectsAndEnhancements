const { createSequelize } = require('./sequelize');
const { defineModels, migrateWithModels } = require('./models');

async function migrateSchema() {
  const { provider, sequelize } = createSequelize();
  const models = defineModels(sequelize);
  await migrateWithModels(sequelize, models);
  await sequelize.close();
  return provider;
}

function getSchemaStatements() {
  throw new Error('Raw SQL schema statements were removed. Use migrateSchema() or scripts/migrate.js (Sequelize models).');
}

function getPostMigrateStatements() {
  throw new Error('Raw SQL post-migration statements were removed. Use migrateSchema() or scripts/migrate.js (Sequelize models).');
}

module.exports = {
  migrateSchema,
  getSchemaStatements,
  getPostMigrateStatements,
};
