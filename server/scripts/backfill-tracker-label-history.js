#!/usr/bin/env node
/**
 * Rename the vendor out of existing status-history entries.
 *
 * `submission_status_events.status` is free text written by the app. Before the
 * tracker's display name was routed through TRACKER_LABEL, three writers in
 * services/submissionService.js embedded "EasyVista" into it, so rows already in
 * the database still read the old name while everything written since reads the
 * new one. This brings the history into line.
 *
 * DRY RUN BY DEFAULT. It prints every row it would change, old value and new,
 * and writes nothing. Pass --apply to perform the UPDATEs, in one transaction.
 *
 *   npm run backfill:tracker-history            # dry run
 *   npm run backfill:tracker-history -- --apply # write
 *
 * Safe to re-run: a row already carrying the new name no longer matches.
 *
 * What it does NOT touch, on purpose:
 *  - `easyvista_ticket_id` and every other column named for the vendor. Those are
 *    identifiers, not display text (see src/constants.js).
 *  - the ticket numbers inside the text. "EV-51067" is the number the Service Desk
 *    issued; rewriting it would make the history disagree with the ticket.
 *
 * Nothing depends on the exact wording: every reader parses these entries by
 * PREFIX — utils/formatUtils.js, helpers/timeline.js and routes/publicRoutes.js
 * all match on "Resubmission:" / "Cleanup Status:" and never on the vendor name.
 */
require('dotenv').config();
const dbApi = require('../db');
const { TRACKER_LABEL } = require('../src/constants');

const APPLY = process.argv.includes('--apply');

/** The one substitution: the vendor's name, as a whole word, in history text. */
const VENDOR_PATTERN = /\bEasyVista\b/g;

function rewrite(text) {
  return String(text || '').replace(VENDOR_PATTERN, TRACKER_LABEL);
}

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const SubmissionStatusEvent = models.SubmissionStatusEvent;
  if (!SubmissionStatusEvent) {
    throw new Error('SubmissionStatusEvent model is not initialized');
  }

  const rows = await SubmissionStatusEvent.findAll({
    attributes: ['id', 'submission_id', 'status', 'changed_at'],
    order: [['id', 'ASC']],
    raw: true,
  });

  const affected = rows
    .filter((row) => VENDOR_PATTERN.test(String(row.status || '')))
    .map((row) => ({ ...row, next: rewrite(row.status) }));

  const provider = String(process.env.DB_PROVIDER || process.env.DB_MODE || 'unknown');
  console.log(`Database: ${provider}`);
  console.log(`Tracker label: "${TRACKER_LABEL}"`);
  console.log(`Scanned ${rows.length} status-history rows.`);
  console.log(`${affected.length} carry the vendor name.\n`);

  if (affected.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  for (const row of affected) {
    console.log(`  event ${row.id} (submission #${row.submission_id}, ${row.changed_at})`);
    console.log(`    -  ${row.status}`);
    console.log(`    +  ${row.next}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply to update these ${affected.length} row(s).`);
    return;
  }

  const sequelize = SubmissionStatusEvent.sequelize;
  await sequelize.transaction(async (transaction) => {
    for (const row of affected) {
      await SubmissionStatusEvent.update(
        { status: row.next },
        { where: { id: row.id }, transaction },
      );
    }
  });

  console.log(`\nUpdated ${affected.length} row(s) in one transaction.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
