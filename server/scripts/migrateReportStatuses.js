#!/usr/bin/env node
/**
 * The report-request status vocabulary, in one reviewable act.
 *
 *   npm run migrate:report-statuses            # dry run
 *   npm run migrate:report-statuses -- --apply # write
 *
 * DRY RUN BY DEFAULT. Idempotent: a re-run reports everything already present and
 * writes nothing.
 *
 * WHAT IT DOES. Adds three rows to `defect_enhancement_statuses` — 'In progress',
 * 'Delivered' and 'On hold' — with sort orders after every existing value, active,
 * not retired. That is the whole schema change for the feature.
 *
 * WHY THERE IS NO SECOND TABLE, which is the decision this script encodes.
 * `submissions.status_id` points at this one table. A separate report-request
 * status table would have meant either a second status column on `submissions`
 * (two columns for one fact — the same defect the source field list has with
 * Complete / Completed / Complete Date) or an id whose meaning depends on the
 * row's type, which cannot be joined or foreign-keyed. Six of a report request's
 * nine statuses are already rows here and mean the same thing on both types —
 * "Approved" is "Approved" — so the table keeps one vocabulary and
 * `statusesForRequestType` (src/constants.js) decides which words each type may
 * hold. What a requester sees is identical either way: a report request offers
 * exactly its nine.
 *
 * NOTHING HERE IS DESTRUCTIVE. It inserts three lookup rows. It changes no
 * existing value, no existing ticket, and no column.
 *
 * The boot sync would seed these three on its own (`seedLookup` in
 * db/models/index.js runs on every start, and production runs it against the
 * shared database on deploy). This script exists so the change is something a
 * person can read the output of first, and so an environment can have it applied
 * without a deploy — same reasoning as the report-requests and money-columns
 * migrations.
 */
require('dotenv').config();
const dbApi = require('../db');
const { REPORT_ONLY_STATUSES, REPORT_REQUEST_STATUSES } = require('../src/constants');

const APPLY = process.argv.includes('--apply');

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { DefectEnhancementStatus } = models;
  if (!DefectEnhancementStatus) throw new Error('DefectEnhancementStatus model is not initialized');

  const dialect = DefectEnhancementStatus.sequelize.getDialect();
  const existing = await DefectEnhancementStatus.findAll({
    attributes: ['id', 'name', 'sort_order', 'is_active'],
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
    raw: true,
  });
  const byName = new Map(existing.map((row) => [String(row.name || '').trim().toLowerCase(), row]));
  let nextOrder = existing.reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0);

  console.log(`${dialect} · ${existing.length} statuses before`);

  const added = [];
  const present = [];
  for (const name of REPORT_ONLY_STATUSES) {
    const found = byName.get(name.toLowerCase());
    if (found) {
      present.push(`${name} (#${found.id}, ${found.is_active ? 'offered' : 'switched off'})`);
      continue;
    }
    nextOrder += 1;
    added.push({ name, sort_order: nextOrder, is_active: 1, is_retired: 0 });
  }

  for (const row of present) console.log(`  already present: ${row}`);
  for (const row of added) {
    console.log(`  ${APPLY ? 'adding' : 'would add'}: ${row.name} (sort order ${row.sort_order})`);
  }

  if (added.length > 0 && APPLY) {
    await DefectEnhancementStatus.sequelize.transaction(async (transaction) => {
      for (const row of added) {
        await DefectEnhancementStatus.findOrCreate({
          where: { name: row.name },
          defaults: row,
          transaction,
        });
      }
    });
  }

  // What a report request can actually be set to once this has run. Printed
  // rather than asserted in a comment: a missing word here is a dropdown with a
  // hole in it, and the six shared values are somebody else's rows.
  const after = await DefectEnhancementStatus.findAll({
    attributes: ['name', 'is_active'],
    raw: true,
  });
  const offered = new Set(after
    .filter((row) => Boolean(row.is_active))
    .map((row) => String(row.name || '').trim().toLowerCase()));
  const missing = REPORT_REQUEST_STATUSES.filter((name) => !offered.has(name.toLowerCase()));

  console.log(`\n${after.length} statuses after`);
  console.log(`A report request can be set to: ${REPORT_REQUEST_STATUSES
    .filter((name) => offered.has(name.toLowerCase()))
    .join(' · ') || '(none)'}`);
  if (missing.length > 0) {
    console.log(`Not offered (switched off on the Metadata page, or not yet applied): ${missing.join(' · ')}`);
  }
  if (!APPLY && added.length > 0) {
    console.log(`\nDRY RUN. Re-run with --apply to add ${added.length}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
