#!/usr/bin/env node
/**
 * Schema for "it happened again" — recurrences, regressions, and the two
 * supporting lookups.
 *
 * DRY RUN BY DEFAULT. It reports what exists and what it would create, and
 * writes nothing. Pass --apply to perform the changes, in one transaction.
 *
 *   npm run migrate:recurrences            # dry run
 *   npm run migrate:recurrences -- --apply # write
 *
 * Safe to re-run: an existing table or column is skipped.
 *
 * ENTIRELY ADDITIVE. Two new tables, eleven new columns across two existing
 * tables, every one of them nullable or defaulted. No existing row changes
 * meaning and no existing column is touched, so the app behaves exactly as it
 * does today until the feature's own code paths start writing.
 *
 * Narrow on purpose, and this matters more here than usual: production boots with
 * `sync({ alter: true })` against the same hosted Supabase (src/index.js), so a
 * model change lands on live data the moment it is pushed. This script is what
 * makes the change reviewable BEFORE that happens and re-runnable somewhere else
 * afterwards. Same precedent as scripts/migrateEasyVistaCatalogColumns.js.
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const dbApi = require('../db');
const { DEFAULT_REJECTION_REASONS } = require('../src/constants');

const APPLY = process.argv.includes('--apply');

// Eleven columns on two existing tables. `spec` is passed straight to addColumn.
const SUBMISSION_COLUMNS = [
  { name: 'recurrence_count', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
  { name: 'last_recurrence_at', spec: { type: DataTypes.TEXT, allowNull: true } },
  { name: 'recurrence_challenged', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
  { name: 'open_workaround_requests', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
  { name: 'workaround_requests_total', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
  { name: 'regression_of_submission_id', spec: { type: DataTypes.INTEGER, allowNull: true } },
  { name: 'regression_claim_confirmed', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
  { name: 'has_regression', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
  { name: 'latest_regression_submission_id', spec: { type: DataTypes.INTEGER, allowNull: true } },
  { name: 'rejection_reason_id', spec: { type: DataTypes.INTEGER, allowNull: true } },
];

// Defaults are the Billing Center answer: a policy number and an account number
// identify a case; a transaction number does not. Applied to EVERY existing
// application, because a default has to be something and this is the only one
// with evidence behind it. Read only by the recurrence sheets — the main submit
// form still asks for all three regardless of these flags.
const APPLICATION_COLUMNS = [
  { name: 'uses_policy_num', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 } },
  { name: 'uses_account_num', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 } },
  { name: 'uses_transaction_num', spec: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } },
];

const NEW_TABLES = ['rejection_reasons', 'submission_recurrences'];

async function tableExists(queryInterface, name) {
  try {
    await queryInterface.describeTable(name);
    return true;
  } catch {
    return false;
  }
}

async function missingColumns(queryInterface, table, columns) {
  const describe = await queryInterface.describeTable(table);
  const existing = new Set(Object.keys(describe));
  return columns.filter((column) => !existing.has(column.name));
}

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const sequelize = models.Submission?.sequelize;
  if (!sequelize) throw new Error('Submission model is not initialized');

  const queryInterface = sequelize.getQueryInterface();
  const dialect = sequelize.getDialect();
  const provider = String(process.env.DB_PROVIDER || process.env.DB_MODE || 'unknown');
  console.log(`Database: ${provider} (${dialect})`);
  console.log('');

  const tablesToCreate = [];
  for (const name of NEW_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await tableExists(queryInterface, name))) tablesToCreate.push(name);
  }
  const submissionMissing = await missingColumns(queryInterface, 'submissions', SUBMISSION_COLUMNS);
  const applicationMissing = await missingColumns(queryInterface, 'applications', APPLICATION_COLUMNS);

  console.log('Tables to create:');
  console.log(tablesToCreate.length ? tablesToCreate.map((t) => `  CREATE TABLE ${t}`).join('\n') : '  none — both already exist');
  console.log('');
  console.log(`Columns to add to submissions (${submissionMissing.length}):`);
  console.log(submissionMissing.length
    ? submissionMissing.map((c) => `  ALTER TABLE submissions ADD COLUMN ${c.name}`).join('\n')
    : '  none — all already present');
  console.log('');
  console.log(`Columns to add to applications (${applicationMissing.length}):`);
  console.log(applicationMissing.length
    ? applicationMissing.map((c) => `  ALTER TABLE applications ADD COLUMN ${c.name}`).join('\n')
    : '  none — all already present');
  console.log('');

  const nothingToDo = !tablesToCreate.length && !submissionMissing.length && !applicationMissing.length;

  if (!APPLY) {
    if (nothingToDo) {
      console.log('Schema is already up to date. Re-run with --apply to reconcile the derived');
      console.log('aggregates anyway — that step is idempotent and runs on every apply.');
    } else {
      console.log('DRY RUN — nothing was written. Re-run with --apply to make these changes.');
      console.log('Every change is additive: new tables, and new columns that are nullable or');
      console.log('defaulted. No existing row changes meaning and nothing is dropped or renamed.');
    }
    return;
  }

  if (nothingToDo) console.log('Schema already up to date — reconciling aggregates only.\n');

  await sequelize.transaction(async (transaction) => {
    // Sequelize builds both tables from the models, so the migration and the
    // running app cannot disagree about their shape.
    for (const name of tablesToCreate) {
      const model = name === 'rejection_reasons' ? models.RejectionReason : models.SubmissionRecurrence;
      // eslint-disable-next-line no-await-in-loop
      await model.sync({ transaction });
      console.log(`  created ${name}`);
    }
    for (const column of submissionMissing) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.addColumn('submissions', column.name, column.spec, { transaction });
      console.log(`  submissions.${column.name} added`);
    }
    for (const column of applicationMissing) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.addColumn('applications', column.name, column.spec, { transaction });
      console.log(`  applications.${column.name} added`);
    }
  });

  // Seed the reasons only once the table is really there. Outside the
  // transaction on purpose: findOrCreate per row is idempotent, and a seeding
  // hiccup must not roll back a schema change that succeeded.
  if (tablesToCreate.includes('rejection_reasons')) {
    for (let index = 0; index < DEFAULT_REJECTION_REASONS.length; index += 1) {
      const name = DEFAULT_REJECTION_REASONS[index];
      // eslint-disable-next-line no-await-in-loop
      await models.RejectionReason.findOrCreate({
        where: { name },
        defaults: { name, sort_order: index + 1, is_active: 1 },
      });
    }
    console.log(`  seeded ${DEFAULT_REJECTION_REASONS.length} rejection reasons`);
  }

  // ── Reconcile the derived aggregates ─────────────────────────────────────
  //
  // A column added AFTER rows already exist reads back as its default on every
  // one of them, and nothing recomputes until the next write to that submission.
  // `workaround_requests_total` arrived that way and left the workaround filter's
  // `handled` and `any` states wrong for every recurrence filed before it.
  //
  // Runs every time, not only on the pass that adds a column: it is idempotent,
  // it is cheap, and it is the one thing that makes "the aggregates are always
  // recomputed from the child rows, never incremented" true across a migration
  // as well as across a write.
  const { recalculateRecurrenceAggregates } = require('../src/services/recurrenceService');
  const affected = await models.SubmissionRecurrence.findAll({
    attributes: ['submission_id'],
    group: ['submission_id'],
    raw: true,
  });
  for (const row of affected) {
    // eslint-disable-next-line no-await-in-loop
    await recalculateRecurrenceAggregates(Number(row.submission_id));
  }
  console.log(`  reconciled aggregates on ${affected.length} submission(s)`);

  // Prove it, rather than assume the ALTERs took.
  const stillMissingSubmissions = await missingColumns(queryInterface, 'submissions', SUBMISSION_COLUMNS);
  const stillMissingApplications = await missingColumns(queryInterface, 'applications', APPLICATION_COLUMNS);
  const stillMissingTables = [];
  for (const name of NEW_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await tableExists(queryInterface, name))) stillMissingTables.push(name);
  }
  const problems = [
    ...stillMissingTables.map((t) => `table ${t}`),
    ...stillMissingSubmissions.map((c) => `submissions.${c.name}`),
    ...stillMissingApplications.map((c) => `applications.${c.name}`),
  ];
  if (problems.length) throw new Error(`still missing after apply: ${problems.join(', ')}`);

  console.log('');
  console.log('Done. Both tables exist and every column is present.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
