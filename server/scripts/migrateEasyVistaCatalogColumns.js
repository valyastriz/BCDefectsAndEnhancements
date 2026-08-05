#!/usr/bin/env node
/**
 * Add `applications.easyvista_catalog_guid` and `_code`.
 *
 * These arrived with the per-application EasyVista catalog. Both are nullable
 * TEXT and nothing back-fills them: absent means NOT CONFIGURED, which refuses a
 * real send for that application rather than misrouting it into whichever
 * application owns the environment's catalog.
 *
 * DRY RUN BY DEFAULT. It reports what exists and what it would add, and writes
 * nothing. Pass --apply to perform the ALTERs, in one transaction.
 *
 *   npm run migrate:easyvista-catalog-columns            # dry run
 *   npm run migrate:easyvista-catalog-columns -- --apply # write
 *
 * Safe to re-run: a column that already exists is skipped.
 *
 * Narrow on purpose. `npm run migrate` would reconcile every table with
 * `sync({ alter: true })`, which on live data is a much broader act than adding
 * two nullable columns — see the money-columns note in plan.md, which is the
 * precedent for making a schema change something someone reads the output of.
 *
 * The app does not depend on this having been run: `loadApplicationRows`
 * (src/helpers/lookups.js) retries without the columns and logs once. This
 * migration is what turns the Access page's catalog card from permanently
 * "not configured" into something a super user can actually set.
 */
require('dotenv').config();
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');

const COLUMNS = [
  { name: 'easyvista_catalog_guid', type: 'TEXT' },
  { name: 'easyvista_catalog_code', type: 'TEXT' },
];

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const sequelize = models.Application?.sequelize;
  if (!sequelize) throw new Error('Application model is not initialized');

  const dialect = sequelize.getDialect();
  const provider = String(process.env.DB_PROVIDER || process.env.DB_MODE || 'unknown');
  console.log(`Database: ${provider} (${dialect})`);

  const describe = await sequelize.getQueryInterface().describeTable('applications');
  const existing = new Set(Object.keys(describe));
  const missing = COLUMNS.filter((column) => !existing.has(column.name));

  console.log(`applications has ${existing.size} columns: ${[...existing].join(', ')}`);
  if (missing.length === 0) {
    console.log('\nBoth catalog columns are already present. Nothing to do.');
    return;
  }

  console.log(`\n${missing.length} column(s) to add:`);
  for (const column of missing) {
    console.log(`  ALTER TABLE applications ADD COLUMN ${column.name} ${column.type} NULL;`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to add them.');
    console.log('Until then every application reads as having no catalog, which refuses a');
    console.log('real send rather than misrouting it. Nothing else is affected.');
    return;
  }

  const { DataTypes } = require('sequelize');
  await sequelize.transaction(async (transaction) => {
    for (const column of missing) {
      await sequelize.getQueryInterface().addColumn(
        'applications',
        column.name,
        { type: DataTypes.TEXT, allowNull: true },
        { transaction },
      );
      console.log(`  added ${column.name}`);
    }
  });

  const after = new Set(Object.keys(await sequelize.getQueryInterface().describeTable('applications')));
  const stillMissing = COLUMNS.filter((column) => !after.has(column.name));
  if (stillMissing.length > 0) {
    throw new Error(`still missing after the ALTER: ${stillMissing.map((c) => c.name).join(', ')}`);
  }
  console.log(`\nAdded ${missing.length} column(s). Both are now present and NULL for every row.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
