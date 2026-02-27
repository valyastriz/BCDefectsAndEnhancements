const dotenv = require('dotenv');
const { createSequelize } = require('../db/sequelize');
const { defineModels, migrateWithModels } = require('../db/models');

dotenv.config();

async function migrate() {
  const { provider, sequelize } = createSequelize();
  const models = defineModels(sequelize);
  await migrateWithModels(sequelize, models);
  await sequelize.close();
  console.log(`Migration complete for provider: ${provider}`);
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
