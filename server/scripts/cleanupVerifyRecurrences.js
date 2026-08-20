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
// Also remove probe rows that were never struck. Off by default: the
// retracted-only rule is what guarantees this script can never delete a real
// report, so lifting it is a deliberate act for repairing a broken run.
const INCLUDE_LIVE = process.argv.includes('--include-live');
const PROBE_NOTES = [
  'VERIFY-RECURRENCES probe',
  'VERIFY-SCRIPT probe - safe to delete',
  // Written by the "unauthenticated write is refused" probe during a run where
  // that check wrongly shared the admin's signed-in context, so the write
  // succeeded instead of being refused. Fixed in the script; the note stays here
  // so any row it left behind can still be cleared.
  'anon probe',
  'no-csrf probe',
  // Written by capture-screenshots.mjs so the "somebody is blocked" pictures had
  // something to photograph. Removed by that script's own teardown.
  'VERIFY-SHOTS probe',
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
    console.log(`\n${live.length} row(s) carry a probe note but are NOT retracted:`);
    for (const row of live) console.log(`  #${row.id} submission=${row.submission_id} note=${JSON.stringify(row.note)}`);
    if (INCLUDE_LIVE) {
      console.log('  --include-live given: these will be removed too.');
    } else {
      console.log('  Left alone. A live row is normally a real report, and the retracted-only');
      console.log('  rule is what keeps this script from ever touching one. Pass --include-live');
      console.log('  if a broken run left a probe row un-struck and you have checked the list.');
    }
  }
  if (INCLUDE_LIVE) probes.push(...live);

  if (probes.length === 0) {
    console.log('\nNothing to remove.');
    return;
  }
  if (!APPLY) {
    console.log('\nDRY RUN — nothing was deleted. Re-run with --apply to remove them.');
    return;
  }

  const touchedSubmissions = [...new Set(probes.map((r) => Number(r.submission_id)))];
  const removed = await SubmissionRecurrence.destroy({ where: { id: probes.map((r) => r.id) } });

  // Recompute, because the aggregates on `submissions` are derived and this is a
  // write to the child table like any other. Deleting rows and leaving
  // recurrence_count behind would be exactly the drift the "always recompute,
  // never increment" rule exists to prevent — and it would be invisible, because
  // the number would simply be wrong rather than missing.
  const { recalculateRecurrenceAggregates } = require('../src/services/recurrenceService');
  for (const id of touchedSubmissions) {
    // eslint-disable-next-line no-await-in-loop
    await recalculateRecurrenceAggregates(id);
  }

  const remaining = await SubmissionRecurrence.count();
  console.log(`\nDeleted ${removed} probe row(s); reconciled ${touchedSubmissions.length} submission(s).`);
  console.log(`${remaining} recurrence row(s) remain.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
