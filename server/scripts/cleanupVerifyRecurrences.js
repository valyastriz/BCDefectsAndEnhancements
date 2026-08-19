#!/usr/bin/env node
/**
 * Remove the probe rows `client/scripts/verify-recurrences.mjs` leaves behind.
 *
 * That script writes one recurrence per run and strikes it again, which is
 * enough for correctness — a struck row is invisible to every read path and the
 * count returns to its baseline. But `submission_recurrences` is append-only by
 * design (a retraction is a timestamp, never a DELETE), so the struck rows
 * accumulate one per run on a shared database. This clears them.
 *
 * DRY RUN BY DEFAULT. Pass --apply to delete.
 *
 *   npm run cleanup:verify-recurrences            # list what it would remove
 *   npm run cleanup:verify-recurrences -- --apply # remove them
 *
 * Deliberately narrow: it matches the probe's exact note text AND requires the
 * row to be retracted already, so it cannot touch a real report even if somebody
 * happens to type the same note. Nothing else in this project hard-deletes a
 * recurrence, and nothing else should.
 */
require('dotenv').config();
const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');
const PROBE_NOTES = [
  'VERIFY-RECURRENCES probe',
  'VERIFY-SCRIPT probe - safe to delete',
];

async function main() {
  await dbApi.init();
  const { SubmissionRecurrence } = dbApi.getModels() || {};
  if (!SubmissionRecurrence) throw new Error('SubmissionRecurrence model is not initialized');

  const provider = String(process.env.DB_PROVIDER || process.env.DB_MODE || 'unknown');
  console.log(`Database: ${provider}`);

  const all = await SubmissionRecurrence.findAll({ raw: true });
  // Both conditions, not either: a row somebody actually filed with this wording
  // would still be live, and a live row is never this script's business.
  const probes = all.filter((row) => PROBE_NOTES.includes(String(row.note || '')) && row.retracted_at);

  console.log(`\n${all.length} recurrence row(s) in total, ${probes.length} matching probe row(s):`);
  for (const row of probes) {
    console.log(`  #${row.id} submission=${row.submission_id} by=${row.reported_by_name} retracted=${row.retracted_at}`);
  }

  const live = all.filter((row) => PROBE_NOTES.includes(String(row.note || '')) && !row.retracted_at);
  if (live.length) {
    console.log(`\n${live.length} row(s) carry a probe note but are NOT retracted — left alone:`);
    for (const row of live) console.log(`  #${row.id} submission=${row.submission_id}`);
  }

  if (probes.length === 0) {
    console.log('\nNothing to remove.');
    return;
  }
  if (!APPLY) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --apply to remove them.');
    return;
  }

  const removed = await SubmissionRecurrence.destroy({ where: { id: probes.map((r) => r.id) } });
  const remaining = await SubmissionRecurrence.count();
  console.log(`\nDeleted ${removed} probe row(s). ${remaining} recurrence row(s) remain.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
