const dotenv = require('dotenv');
const db = require('../db');
const { getSchemaStatements, getPostMigrateStatements } = require('../db/schema');

dotenv.config();

async function migrate() {
  await db.init();

  const statements = getSchemaStatements(db.provider);
  for (const statement of statements) {
    await db.execute(statement);
  }

  const postMigrateStatements = getPostMigrateStatements(db.provider);
  for (const statement of postMigrateStatements) {
    try {
      await db.execute(statement);
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      const duplicateColumnError =
        message.includes('duplicate column') ||
        message.includes('already exists') ||
        message.includes('column "duplicate_reference" of relation "submissions" already exists');

      if (!duplicateColumnError) {
        throw error;
      }
    }
  }

  console.log(`Migration complete for provider: ${db.provider}`);
}

migrate()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.close();
  });
