#!/usr/bin/env node
/**
 * Remove tickets a verification run created, and prove the table is back.
 *
 *   node scripts/removeVerificationSubmissions.js 84 85            # dry run
 *   node scripts/removeVerificationSubmissions.js 84 85 --apply    # write
 *
 * WHY THIS EXISTS. There is no submission DELETE endpoint — deliberately, because
 * a ticket is a record and the portal never destroys one. But a browser check
 * that needs charts with bars in them has to create tickets, and a check that
 * leaves its fixture behind is not a check: it is a change. `npm run dev` talks
 * to the shared hosted database, so the fixture has to come back out through
 * Sequelize, and the count has to be printed rather than assumed. (An earlier
 * verification left ticket #84 behind and it had to be removed by hand; and
 * before that, a metadata run left a renamed status in the live data.)
 *
 * WHY IT IS NARROW, and must stay narrow. It refuses any id whose
 * `summary_of_issue` does not begin with the VERIFY marker, so pointing it at a
 * real ticket is an error rather than a loss. It takes explicit ids — never a
 * pattern, never "all of them" — and it is a dry run unless you say --apply.
 *
 * It removes the children first, in dependency order, so nothing is left
 * orphaned: hours, assignment history, attachments, status events, routings and
 * the embedding row.
 */
require('dotenv').config();
const dbApi = require('../db');

const MARKER = 'VERIFY';
const APPLY = process.argv.includes('--apply');
const IDS = process.argv
  .slice(2)
  .filter((argument) => /^\d+$/.test(argument))
  .map(Number);

async function main() {
  if (IDS.length === 0) {
    console.error('Give at least one submission id. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  await dbApi.init();
  const models = dbApi.getModels() || {};
  const {
    Submission,
    RequestTimeEntry,
    RequestAssignment,
    Attachment,
    SubmissionStatusEvent,
    SubmissionRouting,
    SubmissionEmbedding,
  } = models;
  if (!Submission) throw new Error('Submission model is not initialized');

  // The dialect is printed FIRST, every time, on purpose: `dotenv` resolves
  // `server/.env` relative to the CWD, so running this from the repo root
  // silently targets the local sql.js file instead of the hosted database — and
  // then reports a confident wrong count (13 seeded rows rather than 83 real
  // ones). Run it from `server/`, and read this line before believing the rest.
  const dialect = Submission.sequelize.getDialect();
  const before = await Submission.count();
  console.log(`${dialect} · ${before} submissions before`);

  const rows = await Submission.findAll({
    where: { id: IDS },
    attributes: ['id', 'summary_of_issue'],
    raw: true,
  });
  const found = new Map(rows.map((row) => [Number(row.id), String(row.summary_of_issue || '')]));

  for (const id of IDS) {
    if (!found.has(id)) console.log(`  #${id} — not present, nothing to do`);
  }

  const removable = [];
  for (const [id, summary] of found) {
    if (!summary.startsWith(MARKER)) {
      console.error(`  #${id} — REFUSED: "${summary.slice(0, 60)}" is not a ${MARKER} ticket`);
      continue;
    }
    removable.push(id);
    console.log(`  #${id} — ${APPLY ? 'removing' : 'would remove'}: ${summary.slice(0, 60)}`);
  }

  if (removable.length === 0) {
    console.log(`\n${before} submissions after — nothing was removed`);
    if (found.size > removable.length) process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN. Re-run with --apply to remove ${removable.length}.`);
    return;
  }

  // Children first, in one transaction, so a failure halfway cannot leave an
  // hours row pointing at a ticket that no longer exists.
  const children = [
    ['hours', RequestTimeEntry, 'submission_id'],
    ['assignments', RequestAssignment, 'submission_id'],
    ['attachments', Attachment, 'submission_id'],
    ['status events', SubmissionStatusEvent, 'submission_id'],
    ['routings', SubmissionRouting, 'submission_id'],
    ['embeddings', SubmissionEmbedding, 'submission_id'],
  ];

  await Submission.sequelize.transaction(async (transaction) => {
    for (const [label, model, column] of children) {
      if (!model) continue;
      const removed = await model.destroy({ where: { [column]: removable }, transaction });
      if (removed > 0) console.log(`  ${removed} ${label}`);
    }
    const removed = await Submission.destroy({ where: { id: removable }, transaction });
    console.log(`  ${removed} submission${removed === 1 ? '' : 's'}`);
  });

  const after = await Submission.count();
  console.log(`\n${after} submissions after (was ${before}, removed ${removable.length})`);
  if (after !== before - removable.length) {
    console.error('The count does not match what was removed. Check the table.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
