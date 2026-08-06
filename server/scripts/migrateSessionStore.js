#!/usr/bin/env node
/**
 * Create the `user_sessions` table that backs the persistent session store.
 *
 * Sessions used to live in express-session's default MemoryStore, so every
 * restart of the API — including every deploy — signed everybody out. An open
 * tab went on showing "Filing as …" while its cookie was already dead, and the
 * submit came back asking for a field the form had stopped showing. See the
 * seventh pass in plan.md for that failure in full; this table is what stops it.
 *
 * DRY RUN BY DEFAULT. It reports what exists and what it would create, and
 * writes nothing. Pass --apply to create the table, in one transaction.
 *
 *   npm run migrate:session-store            # dry run
 *   npm run migrate:session-store -- --apply # write
 *
 * Safe to re-run: a table that already exists is left exactly as it is.
 *
 * The shape is connect-pg-simple's, which is not negotiable — the store's own
 * SQL names these three columns and upserts `ON CONFLICT (sid)`, so the primary
 * key is load-bearing, not decoration. The store can create this itself
 * (`createTableIfMissing`), and does, so a deploy that runs ahead of this script
 * still works; this exists so the change is reviewable, re-runnable, and names
 * its own constraint and index rather than inheriting the bundled file's
 * "session_pkey" on a table that is not called session.
 *
 * Postgres only. Local development runs on sql.js, where MemoryStore is still
 * the store and there is nothing to create.
 */
require('dotenv').config();
const dbApi = require('../db');
const { SESSION_TABLE } = require('../src/middleware/session');

const APPLY = process.argv.includes('--apply');

const STATEMENTS = [
  `CREATE TABLE "${SESSION_TABLE}" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
  )`,
  `ALTER TABLE "${SESSION_TABLE}"
     ADD CONSTRAINT "${SESSION_TABLE}_pkey" PRIMARY KEY ("sid")
     NOT DEFERRABLE INITIALLY IMMEDIATE`,
  `CREATE INDEX "IDX_${SESSION_TABLE}_expire" ON "${SESSION_TABLE}" ("expire")`,
];

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const sequelize = models.Application?.sequelize;
  if (!sequelize) throw new Error('models are not initialized');

  const dialect = sequelize.getDialect();
  const provider = String(process.env.DB_PROVIDER || process.env.DB_MODE || 'unknown');
  console.log(`Database: ${provider} (${dialect})`);

  if (dialect !== 'postgres') {
    console.log(`\nProvider is "${provider}" — sessions stay in MemoryStore here. Nothing to do.`);
    return;
  }

  const [existing] = await sequelize.query(
    'SELECT to_regclass($1) AS table_name',
    { bind: [SESSION_TABLE] },
  );
  if (existing[0]?.table_name) {
    const [[counts]] = await sequelize.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE expire >= now())::int AS live
         FROM "${SESSION_TABLE}"`,
    );
    console.log(`\n"${SESSION_TABLE}" already exists: ${counts.total} row(s), ${counts.live} not yet expired.`);
    console.log('Nothing to do.');
    return;
  }

  console.log(`\n"${SESSION_TABLE}" does not exist. ${STATEMENTS.length} statement(s) to run:`);
  for (const statement of STATEMENTS) {
    console.log(`\n  ${statement.replace(/\s+/g, ' ').trim()};`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to create it.');
    console.log('Until then sessions stay in memory and every restart signs everybody out.');
    return;
  }

  await sequelize.transaction(async (transaction) => {
    for (const statement of STATEMENTS) {
      await sequelize.query(statement, { transaction });
    }
  });

  const [after] = await sequelize.query(
    'SELECT to_regclass($1) AS table_name',
    { bind: [SESSION_TABLE] },
  );
  if (!after[0]?.table_name) {
    throw new Error(`"${SESSION_TABLE}" is still missing after the CREATE`);
  }
  console.log(`\nCreated "${SESSION_TABLE}", empty. Sessions now survive a restart.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
