#!/usr/bin/env node
/**
 * Add `submissions.delivery_notes`.
 *
 * The report-request counterpart to `release_notes`. A report request is built
 * in the portal and handed to the person who asked for it — nothing ships, so
 * there is no release and no release note. What there is, is what was actually
 * delivered, in the analyst's words, and that had nowhere to go: the Delivery
 * pane recorded who did the work and how long it took but never what came out
 * of it.
 *
 * Nullable TEXT, nothing back-fills it, and absent simply means nobody wrote
 * one. The Release group is hidden on a report request rather than repurposed,
 * because "Release Notes" on a dashboard request is the wrong word for the
 * thing and would have quietly redefined the column for the other three types.
 *
 * DRY RUN BY DEFAULT. It reports what exists and what it would add, and writes
 * nothing. Pass --apply to perform the ALTER.
 *
 *   npm run migrate:delivery-notes            # dry run
 *   npm run migrate:delivery-notes -- --apply # write
 *
 * Safe to re-run: a column that already exists is skipped.
 *
 * Narrow on purpose, for the same reason as the catalog columns — `npm run
 * migrate` reconciles every table with sync({ alter: true }), which on live data
 * is a far broader act than adding one nullable column.
 */
require('dotenv').config();
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');

const TABLE = 'submissions';
const COLUMN = 'delivery_notes';

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const sequelize = models.Submission?.sequelize;
  if (!sequelize) throw new Error('Submission model is not initialized');

  const dialect = sequelize.getDialect();
  const provider = String(process.env.DB_PROVIDER || process.env.DB_MODE || 'unknown');
  console.log(`Database: ${provider} (${dialect})`);

  const describe = await sequelize.getQueryInterface().describeTable(TABLE);
  const existing = new Set(Object.keys(describe));
  console.log(`${TABLE} has ${existing.size} columns`);

  if (existing.has(COLUMN)) {
    const [[counts]] = await sequelize.query(
      `SELECT COUNT(*) AS total, COUNT(${COLUMN}) AS filled FROM ${TABLE}`,
    );
    console.log(`\n${COLUMN} is already present — ${counts.filled} of ${counts.total} rows have one. Nothing to do.`);
    return;
  }

  console.log(`\n1 column to add:\n  ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} TEXT NULL;`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to add it.');
    console.log('Until then the Delivery pane has nowhere to record what was delivered.');
    return;
  }

  const { DataTypes } = require('sequelize');
  await sequelize.getQueryInterface().addColumn(TABLE, COLUMN, {
    type: DataTypes.TEXT,
    allowNull: true,
  });

  const after = new Set(Object.keys(await sequelize.getQueryInterface().describeTable(TABLE)));
  if (!after.has(COLUMN)) {
    throw new Error(`${COLUMN} is still missing after the ALTER`);
  }
  console.log(`\nAdded ${COLUMN}. It is NULL for every existing row.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
