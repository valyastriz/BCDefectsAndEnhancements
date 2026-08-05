// migrateMoneyColumns.js
//
// One-time (idempotent) migration: convert the two money columns on `submissions`
// from REAL to DECIMAL(14,2).
//
//   node scripts/migrateMoneyColumns.js            # dry run: report only
//   node scripts/migrateMoneyColumns.js --apply    # perform the ALTER
//
// WHY
// Sequelize's REAL is single-precision (float4) on Postgres — roughly 7
// significant digits — so the STORED value was wrong:
//
//     1234567.89  ->  1234567.875          (displays as $1,234,567.88)
//       99999.99  ->  99999.9921875
//           0.07  ->  0.07000000029802322
//
// SQLite's REAL is a double, which is why this never reproduced locally and only
// ever damaged the hosted data. The Excel export writes these values out raw, so
// the damage showed up in spreadsheets as well as a cent adrift on screen.
//
// WHY THIS SCRIPT EXISTS AT ALL
// Production boots with `sync({ alter: true })` (src/index.js), which would apply
// this type change on the next deploy on its own — silently, unreviewed, and
// rewriting the table while the app starts. A column-type change on live data
// should be a deliberate act with output someone reads, so run this first and let
// the boot sync find the work already done.
//
// WHAT THIS CANNOT DO
// It cannot recover precision that float4 already destroyed. A value stored as
// 1234568 converts to 1234568.00 — the original .89 is gone. The dry run reports
// how many rows look like they were damaged so the scale of that is known rather
// than assumed; recovering them means re-entering the figures from source.
//
// NOTE: this targets whatever DB the environment points at (server/.env). With
// DB_PROVIDER=postgres that is the live Supabase database.

const dotenv = require('dotenv');

dotenv.config();

const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');

const MONEY_COLUMNS = ['policy_premium_impact', 'direct_dollar_impact'];
const TARGET_TYPE = 'numeric(14,2)';

async function describeColumns(sequelize) {
  const rows = await sequelize.query(
    `SELECT column_name, data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_name = 'submissions'
        AND column_name IN (:columns)`,
    { replacements: { columns: MONEY_COLUMNS }, type: sequelize.QueryTypes.SELECT },
  );
  return rows;
}

// Values that survived float4 with more than two decimal places are the visible
// signature of precision damage: nothing in the UI can enter a third decimal.
async function countSuspectValues(sequelize, column) {
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS n
       FROM submissions
      WHERE ${column} IS NOT NULL
        AND ${column}::numeric <> ROUND(${column}::numeric, 2)`,
    { type: sequelize.QueryTypes.SELECT },
  );
  return Number(rows[0]?.n || 0);
}

async function run() {
  await dbApi.init();
  const provider = dbApi.provider;
  console.log(`DB provider: ${provider}`);

  if (provider !== 'postgres') {
    console.log('');
    console.log('Nothing to do: SQLite stores REAL as a double and does not enforce');
    console.log('column types, so the declared DECIMAL takes effect on the next');
    console.log('`npm run migrate` with no data conversion needed.');
    await dbApi.close();
    return;
  }

  // Reach the raw Sequelize instance; the db facade only exposes query/execute.
  // eslint-disable-next-line global-require
  const { createSequelize } = require('../db/sequelize');
  const { sequelize } = createSequelize();
  sequelize.QueryTypes = require('sequelize').QueryTypes;

  const before = await describeColumns(sequelize);
  console.log('\nCurrent column types:');
  for (const row of before) {
    const detail = row.numeric_precision
      ? `${row.data_type}(${row.numeric_precision},${row.numeric_scale})`
      : row.data_type;
    console.log(`  ${row.column_name}: ${detail}`);
  }

  const alreadyDone = before.length > 0
    && before.every((row) => String(row.data_type).toLowerCase() === 'numeric'
      && Number(row.numeric_scale) === 2);

  if (alreadyDone) {
    console.log('\nAlready DECIMAL(14,2) — nothing to do.');
    await sequelize.close();
    await dbApi.close();
    return;
  }

  console.log('\nRows whose stored value has >2 decimal places (float4 damage):');
  for (const column of MONEY_COLUMNS) {
    const n = await countSuspectValues(sequelize, column);
    console.log(`  ${column}: ${n}`);
  }
  console.log('  (these convert as-is — the lost digits cannot be recovered here)');

  const statements = MONEY_COLUMNS.map(
    (column) => `ALTER TABLE submissions ALTER COLUMN ${column} TYPE ${TARGET_TYPE}`,
  );

  console.log('\nStatements:');
  statements.forEach((sql) => console.log(`  ${sql};`));

  if (!APPLY) {
    console.log('\nDry run only — nothing written. Re-run with --apply to perform the change.');
    await sequelize.close();
    await dbApi.close();
    return;
  }

  // One transaction: a half-converted pair would leave the two impact figures on
  // different types, and the mapper's coercion assumes they behave alike.
  const transaction = await sequelize.transaction();
  try {
    for (const sql of statements) {
      console.log(`\nApplying: ${sql}`);
      await sequelize.query(sql, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    console.error('\nFailed — rolled back, nothing changed:', error.message);
    await sequelize.close();
    await dbApi.close();
    process.exit(1);
  }

  const after = await describeColumns(sequelize);
  console.log('\nNew column types:');
  for (const row of after) {
    console.log(`  ${row.column_name}: ${row.data_type}(${row.numeric_precision},${row.numeric_scale})`);
  }

  console.log('\nDone.');
  await sequelize.close();
  await dbApi.close();
}

run().catch(async (error) => {
  console.error(error);
  try { await dbApi.close(); } catch { /* already closed */ }
  process.exit(1);
});
