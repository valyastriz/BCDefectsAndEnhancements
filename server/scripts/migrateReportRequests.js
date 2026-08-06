#!/usr/bin/env node
/**
 * The whole Phase 1 schema for report requests, in one reviewable act.
 *
 *   npm run migrate:report-requests            # dry run
 *   npm run migrate:report-requests -- --apply # write
 *
 * DRY RUN BY DEFAULT. It reports exactly what it would do and writes nothing.
 * Safe to re-run: anything already present is skipped, and the summary at the end
 * says so.
 *
 * WHAT IT DOES, and why each part is safe on live data:
 *
 *   1. 14 nullable columns on `submissions`. Nullable and null for every existing
 *      row, so no current ticket changes meaning. Eight are the requester's half
 *      of a report request, six are the analyst's.
 *   2. `attachments.purpose`, nullable. Null means "a screenshot", which is what
 *      every existing attachment is, so the Files tab is untouched.
 *   3. `user_application_roles.request_type`, NOT NULL DEFAULT ''. Every existing
 *      grant gets '' — "covers every type" — so nobody gains or loses access.
 *      The two-column unique index is then replaced by a three-column one, which
 *      is what lets one person hold an all-types grant AND a narrower one.
 *   4. Three new tables: `levels_of_effort`, `request_time_entries`,
 *      `request_assignments`. New tables cannot disturb existing rows.
 *   5. Two seeded lookups: the `report` submission type, and four levels of
 *      effort. Both are `findOrCreate`, so re-running adds nothing.
 *
 * WHY IT EXISTS AT ALL, given that production boots with `sync({ alter: true })`
 * and would do most of this on its own (src/index.js): because a schema change on
 * shared live data should be something a person reads the output of before it
 * happens, not a side effect of a deploy. Same reasoning as the money-columns
 * migration — see plan.md. It also does two things the boot sync CANNOT:
 * `user_application_roles` is synced without `alter` (its composite uniqueness
 * would be corrupted by SQLite's rebuild), so its new column never arrives that
 * way; and the stale two-column index has to be dropped explicitly.
 *
 * NOTHING HERE IS DESTRUCTIVE. It adds columns, adds tables, and replaces one
 * index with a wider one. It drops no column, deletes no row, and changes no
 * stored value.
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');

const SUBMISSION_COLUMNS = [
  // Requester's half.
  { name: 'is_new_dashboard', spec: { type: DataTypes.INTEGER, allowNull: true }, sql: 'INTEGER NULL' },
  { name: 'needed_data', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'measures_and_sources', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'primary_contact', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'existing_report_link', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'changes_requested', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'report_usage_frequency', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'department', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  // Analyst's half.
  { name: 'assigned_to', spec: { type: DataTypes.INTEGER, allowNull: true }, sql: 'INTEGER NULL' },
  { name: 'level_of_effort_id', spec: { type: DataTypes.INTEGER, allowNull: true }, sql: 'INTEGER NULL' },
  { name: 'completed_at', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'approved_at', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'approved_by_name', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
  { name: 'approval_recorded_by', spec: { type: DataTypes.INTEGER, allowNull: true }, sql: 'INTEGER NULL' },
];

const ATTACHMENT_COLUMNS = [
  { name: 'purpose', spec: { type: DataTypes.TEXT, allowNull: true }, sql: 'TEXT NULL' },
];

const GRANT_COLUMNS = [
  {
    name: 'request_type',
    spec: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    sql: "TEXT NOT NULL DEFAULT ''",
  },
];

const NEW_TABLES = ['levels_of_effort', 'request_time_entries', 'request_assignments'];

const STALE_INDEX = 'idx_user_application_roles_unique';
const WIDER_INDEX = 'idx_user_application_roles_unique_v2';

async function tableExists(queryInterface, table) {
  try {
    await queryInterface.describeTable(table);
    return true;
  } catch {
    return false;
  }
}

async function missingColumns(queryInterface, table, columns) {
  if (!(await tableExists(queryInterface, table))) return { absent: true, missing: columns };
  const present = new Set(Object.keys(await queryInterface.describeTable(table)));
  return { absent: false, missing: columns.filter((column) => !present.has(column.name)) };
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
  console.log(APPLY ? 'Mode: APPLY — this will write.\n' : 'Mode: DRY RUN — nothing will be written.\n');

  const plan = [];

  for (const [table, columns] of [
    ['submissions', SUBMISSION_COLUMNS],
    ['attachments', ATTACHMENT_COLUMNS],
    ['user_application_roles', GRANT_COLUMNS],
  ]) {
    const { absent, missing } = await missingColumns(queryInterface, table, columns);
    if (absent) {
      console.log(`${table}: TABLE DOES NOT EXIST — run \`npm run migrate\` first.`);
      throw new Error(`${table} is missing`);
    }
    if (missing.length === 0) {
      console.log(`${table}: all ${columns.length} column(s) already present.`);
    } else {
      console.log(`${table}: ${missing.length} of ${columns.length} column(s) to add`);
      for (const column of missing) {
        console.log(`    ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.sql};`);
      }
      plan.push({ kind: 'columns', table, columns: missing });
    }
  }

  const tablesToCreate = [];
  for (const table of NEW_TABLES) {
    if (await tableExists(queryInterface, table)) {
      console.log(`${table}: already exists.`);
    } else {
      console.log(`${table}: CREATE TABLE`);
      tablesToCreate.push(table);
    }
  }
  if (tablesToCreate.length > 0) plan.push({ kind: 'tables', tables: tablesToCreate });

  console.log(`\nIndexes: DROP ${STALE_INDEX} (if present), CREATE UNIQUE ${WIDER_INDEX}`);
  console.log('    on user_application_roles (user_id, application_id, request_type)');
  console.log('    — the two-column index would reject a second, type-scoped grant.');

  console.log('\nSeeds (findOrCreate, so a re-run adds nothing):');
  console.log("    submission_types: 'report'");
  console.log('    levels_of_effort: 4 starting values the Metadata page can change');

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
    console.log('Every column above is nullable (or defaulted), every table is new, and no');
    console.log('stored value is changed. Existing grants all become "covers every type",');
    console.log('which is exactly what they mean today.');
    return;
  }

  // Tables and columns first, in one transaction. The index swap and the seeds
  // run after: an index cannot be created before the column it names, and a
  // findOrCreate wants the table committed.
  await sequelize.transaction(async (transaction) => {
    for (const step of plan) {
      if (step.kind === 'columns') {
        for (const column of step.columns) {
          await queryInterface.addColumn(step.table, column.name, column.spec, { transaction });
          console.log(`  added ${step.table}.${column.name}`);
        }
      }
    }
  });

  for (const table of tablesToCreate) {
    const model = Object.values(models).find((candidate) => candidate.tableName === table);
    if (!model) throw new Error(`no model defines ${table}`);
    await model.sync();
    console.log(`  created ${table}`);
  }

  await sequelize.query(`DROP INDEX IF EXISTS "${STALE_INDEX}"`);
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS "${WIDER_INDEX}" `
    + 'ON "user_application_roles" ("user_id", "application_id", "request_type")',
  );
  console.log('  index swapped');

  const [reportType] = await models.SubmissionType.findOrCreate({
    where: { name: 'report' },
    defaults: { name: 'report', sort_order: 3, is_active: 1 },
  });
  console.log(`  submission type 'report' -> id ${reportType.id}`);

  const efforts = [
    'S — up to 2 days',
    'M — up to a week',
    'L — up to a month',
    'XL — more than a month',
  ];
  for (let index = 0; index < efforts.length; index += 1) {
    await models.LevelOfEffort.findOrCreate({
      where: { name: efforts[index] },
      defaults: { name: efforts[index], sort_order: index + 1, is_active: 1 },
    });
  }
  console.log(`  levels_of_effort seeded (${efforts.length})`);

  // Prove it, rather than trusting that the ALTERs returned without throwing.
  const problems = [];
  for (const [table, columns] of [
    ['submissions', SUBMISSION_COLUMNS],
    ['attachments', ATTACHMENT_COLUMNS],
    ['user_application_roles', GRANT_COLUMNS],
  ]) {
    const { missing } = await missingColumns(queryInterface, table, columns);
    for (const column of missing) problems.push(`${table}.${column.name} still missing`);
  }
  for (const table of NEW_TABLES) {
    if (!(await tableExists(queryInterface, table))) problems.push(`${table} still missing`);
  }
  const orphanGrants = await models.UserApplicationRole.count({ where: { request_type: null } });
  if (orphanGrants > 0) problems.push(`${orphanGrants} grant(s) have a NULL request_type`);

  if (problems.length > 0) throw new Error(`after applying:\n  - ${problems.join('\n  - ')}`);

  const grants = await models.UserApplicationRole.count();
  console.log(`\nApplied. ${grants} existing grant(s) now read "covers every type"; none changed rank.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
