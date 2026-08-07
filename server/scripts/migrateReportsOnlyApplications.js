#!/usr/bin/env node
/**
 * Add `applications.reports_only`.
 *
 *   node scripts/migrateReportsOnlyApplications.js            # dry run
 *   node scripts/migrateReportsOnlyApplications.js --apply    # write
 *
 * WHY THE SCRIPT EXISTS WHEN THE BOOT SYNC WOULD ADD IT ANYWAY. Production boots with
 * `sync({ alter: true })`, so a deploy adds this column on its own — against the same
 * shared database a local `npm run dev` talks to. That is convenient and it is not
 * reviewable: the change lands with no record of what it did and no way to run it
 * anywhere else deliberately. Every other schema change in this project ships with an
 * explicit script for that reason (see `migrateEasyVistaCatalogColumns.js`), and this
 * one follows.
 *
 * WHAT IT DOES. One nullable-in-effect column, `NOT NULL DEFAULT 0`, so **every
 * application that already exists keeps taking every request type** — Billing Center,
 * Policy Center and `Other` included. Nothing about any existing queue changes.
 *
 * Only an application created by a reporting analyst through
 * `POST /api/admin/applications` gets `1`, and that one takes report requests and
 * nothing else. `src/helpers/applicationScope.js` is where that is enforced, at all
 * four write paths.
 *
 * Idempotent: a re-run reports the column is already present and changes nothing.
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');
const TABLE = 'applications';
const COLUMN = 'reports_only';

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { Application } = models;
  if (!Application) throw new Error('Application model is not initialized');

  const sequelize = Application.sequelize;
  // The dialect first, every time: `dotenv` resolves `server/.env` from the CWD, so
  // running this from the repo root silently targets the local sql.js file. Read this
  // line before believing anything below it.
  const dialect = sequelize.getDialect();
  const queryInterface = sequelize.getQueryInterface();

  let described;
  try {
    described = await queryInterface.describeTable(TABLE);
  } catch {
    console.log(`${dialect} · there is no "${TABLE}" table yet. Run \`npm run migrate\` first.`);
    return;
  }

  const applications = await Application.findAll({
    attributes: ['id', 'name', 'is_active'],
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  console.log(`${dialect} · ${applications.length} applications`);
  for (const row of applications) {
    console.log(`  ${row.name}${Number(row.is_active) === 1 ? '' : ' (switched off)'}`);
  }

  if (described[COLUMN]) {
    const reportsOnly = await Application.count({ where: { [COLUMN]: 1 } });
    console.log(`\n${TABLE}.${COLUMN} is already present — ${reportsOnly} reports-only application(s).`);
    console.log('Nothing to do.');
    return;
  }

  console.log(`\nWOULD ADD  ${TABLE}.${COLUMN}  INTEGER NOT NULL DEFAULT 0`);
  console.log('  Every application above keeps taking every request type — the default is 0.');
  console.log('  Only one created through POST /api/admin/applications gets 1.');

  if (!APPLY) {
    console.log('\nDRY RUN. Nothing was changed.');
    console.log('To write:  node scripts/migrateReportsOnlyApplications.js --apply');
    return;
  }

  await queryInterface.addColumn(TABLE, COLUMN, {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  });

  // Prove it, rather than assuming the ALTER did what it said.
  const after = await queryInterface.describeTable(TABLE);
  if (!after[COLUMN]) {
    console.error(`\n${COLUMN} is still not there. Check the table.`);
    process.exitCode = 1;
    return;
  }
  const wrong = await Application.count({ where: { [COLUMN]: 1 } });
  console.log(`\nAdded ${TABLE}.${COLUMN}.`);
  console.log(`${applications.length} applications, ${wrong} of them reports-only (expected 0).`);
  if (wrong !== 0) {
    console.error('An existing application came out reports-only. That should be impossible — check the default.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
