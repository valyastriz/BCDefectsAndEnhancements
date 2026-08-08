#!/usr/bin/env node
/**
 * Add `submissions.working_application_id` — the soft association.
 *
 *   node scripts/migrateWorkingApplication.js            # dry run
 *   node scripts/migrateWorkingApplication.js --apply    # write
 *
 * WHY THE SCRIPT EXISTS WHEN THE BOOT SYNC WOULD ADD IT ANYWAY. Production boots
 * with `sync({ alter: true })`, so a deploy adds this column on its own — against
 * the same shared database a local `npm run dev` talks to. That is convenient and
 * it is not reviewable: the change lands with no record of what it did and no way
 * to run it anywhere else deliberately. Every schema change in this project ships
 * with an explicit script for that reason.
 *
 * WHAT IT IS FOR. A request in `Other` is one nobody has identified the system for
 * yet. An analyst who starts working it has two bad options today: move it out of
 * `Other`, which is a claim about whose data it is that nobody can make yet, or
 * leave it there, where it never appears in the queue they actually watch. This
 * column is the third: the ticket stays in `Other` and ALSO shows up in the queue
 * the analyst picked.
 *
 * WHAT IT IS NOT. It never decides who may EDIT a ticket — `application_id` still
 * does, alone. That is the whole reason this is safe to add: a second answer to
 * "whose queue is this in" would be a problem if it were also a second answer to
 * "who may write to it".
 *
 * NULLABLE, and null on every existing row: nothing is softly assigned until an
 * analyst does it. So this migration cannot change how any ticket behaves today.
 *
 * Idempotent: a re-run reports the column is already present and changes nothing.
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');
const TABLE = 'submissions';
const COLUMN = 'working_application_id';
const INDEX = 'idx_submissions_working_application_id';

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { Submission } = models;
  if (!Submission) throw new Error('Submission model is not initialized');

  const sequelize = Submission.sequelize;
  // The dialect first, every time: `dotenv` resolves `server/.env` from the CWD, so
  // running this from the repo root silently targets the local sql.js file and then
  // reports a confident wrong answer. Read this line before believing the rest.
  const dialect = sequelize.getDialect();
  const queryInterface = sequelize.getQueryInterface();

  let described;
  try {
    described = await queryInterface.describeTable(TABLE);
  } catch {
    console.log(`${dialect} · there is no "${TABLE}" table yet. Run \`npm run migrate\` first.`);
    return;
  }

  const total = await Submission.count();
  console.log(`${dialect} · ${total} submissions`);

  if (described[COLUMN]) {
    const softlyAssigned = await Submission.count({
      where: { [COLUMN]: { [sequelize.Sequelize.Op.ne]: null } },
    });
    console.log(`\n${TABLE}.${COLUMN} is already present — ${softlyAssigned} ticket(s) softly assigned.`);
    console.log('Nothing to do.');
    return;
  }

  console.log(`\nWOULD ADD  ${TABLE}.${COLUMN}  INTEGER NULL`);
  console.log(`           and the index ${INDEX}`);
  console.log(`  Null on all ${total} existing rows, so no ticket changes how it behaves.`);
  console.log('  It never decides who may EDIT a ticket — application_id still does, alone.');

  if (!APPLY) {
    console.log('\nDRY RUN. Nothing was changed.');
    console.log('To write:  node scripts/migrateWorkingApplication.js --apply');
    return;
  }

  await queryInterface.addColumn(TABLE, COLUMN, {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  // The scope filter reads this column in the same OR as application_id on every
  // admin queue query, so it is on the hot path from the first request after this.
  try {
    await queryInterface.addIndex(TABLE, {
      name: INDEX,
      fields: [COLUMN],
    });
  } catch (error) {
    // Not fatal: the column is what the feature needs, and the boot sync creates
    // the index from the model definition anyway. Said out loud rather than
    // swallowed, because a missing index here is a slow admin queue, not an error.
    console.warn(`\nThe column was added but the index was not: ${error.message}`);
  }

  // Prove it, rather than assuming the ALTER did what it said.
  const after = await queryInterface.describeTable(TABLE);
  if (!after[COLUMN]) {
    console.error(`\n${COLUMN} is still not there. Check the table.`);
    process.exitCode = 1;
    return;
  }
  const set = await Submission.count({
    where: { [COLUMN]: { [sequelize.Sequelize.Op.ne]: null } },
  });
  console.log(`\nAdded ${TABLE}.${COLUMN}.`);
  console.log(`${total} submissions, ${set} of them softly assigned (expected 0).`);
  if (set !== 0) {
    console.error('An existing ticket came out softly assigned. That should be impossible.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
