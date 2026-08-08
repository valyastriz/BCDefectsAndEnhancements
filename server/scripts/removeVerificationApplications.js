#!/usr/bin/env node
/**
 * Remove applications a verification run created, and prove the table is back.
 *
 *   node scripts/removeVerificationApplications.js "VERIFY Reports Only"          # dry run
 *   node scripts/removeVerificationApplications.js "VERIFY Reports Only" --apply  # write
 *
 * WHY THIS EXISTS. `POST /api/admin/applications` lets a reporting analyst add an
 * application by typing a name in, and there is no DELETE to match — deliberately:
 * an application is a queue, tickets point at it, and the portal deactivates a
 * lookup value rather than destroying one. But the browser check that proves the
 * new control WORKS has to use it, and `npm run dev` talks to the shared hosted
 * database, so the row it creates has to come back out through Sequelize and the
 * count has to be printed rather than assumed.
 *
 * Sibling of `removeVerificationSubmissions.js`, and narrow for the same reason:
 * it takes explicit NAMES, refuses any name that does not begin with the VERIFY
 * marker, and is a dry run unless you say --apply. Loosening it would leave the
 * portal with a script that can delete a real queue.
 *
 * IT ALSO REFUSES AN APPLICATION ANY SUBMISSION POINTS AT, whatever its name is.
 * Creating one grants it and nothing else; a row with tickets in it is not a
 * fixture, and destroying it would orphan them — an application id on a
 * submission with no matching application reads as a ticket in no queue at all,
 * which is worse than a stray lookup value.
 *
 * The GRANTS created alongside it go too. `reportApplicationService` writes one
 * `user_application_roles` row per person who works report requests, in the same
 * transaction as the application — so leaving them behind would leave grants
 * pointing at a queue that no longer exists.
 */
require('dotenv').config();
const dbApi = require('../db');

const MARKER = 'VERIFY';
const APPLY = process.argv.includes('--apply');
const NAMES = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

async function main() {
  if (NAMES.length === 0) {
    console.error('Give at least one application name. Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { Application, UserApplicationRole, Submission } = models;
  if (!Application) throw new Error('Application model is not initialized');

  // The dialect first, every time — `dotenv` resolves `server/.env` against the
  // CWD, so running this from the repo root silently targets the local sql.js
  // file and then reports a confident wrong count. Run it from `server/`.
  const dialect = Application.sequelize.getDialect();
  const before = await Application.count();
  console.log(`${dialect} · ${before} applications before`);

  // Matched case-insensitively on the trimmed name, the same way the create
  // refuses a duplicate — otherwise a fixture created as "VERIFY Reports Only"
  // could not be removed by the same string the script that made it used.
  const wanted = new Map(NAMES.map((name) => [name.replace(/\s+/g, ' ').trim().toLowerCase(), name]));
  const rows = await Application.findAll({ attributes: ['id', 'name'], raw: true });
  const matched = rows.filter((row) => wanted.has(String(row.name || '').trim().toLowerCase()));

  for (const [, original] of wanted) {
    const present = matched.some(
      (row) => String(row.name || '').trim().toLowerCase() === original.replace(/\s+/g, ' ').trim().toLowerCase(),
    );
    if (!present) console.log(`  "${original}" — not present, nothing to do`);
  }

  const removable = [];
  let refused = 0;
  for (const row of matched) {
    const name = String(row.name || '');
    if (!name.trim().startsWith(MARKER)) {
      console.error(`  "${name}" — REFUSED: not a ${MARKER} application`);
      refused += 1;
      continue;
    }
    const tickets = Submission ? await Submission.count({ where: { application_id: Number(row.id) } }) : 0;
    if (tickets > 0) {
      console.error(`  "${name}" — REFUSED: ${tickets} submission(s) still point at it`);
      refused += 1;
      continue;
    }
    removable.push(Number(row.id));
    console.log(`  "${name}" — ${APPLY ? 'removing' : 'would remove'} (id ${row.id}, 0 tickets)`);
  }

  if (removable.length === 0) {
    console.log(`\n${before} applications after — nothing was removed`);
    if (refused > 0) process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN. Re-run with --apply to remove ${removable.length}.`);
    return;
  }

  // Grants first, in one transaction: a grant pointing at a deleted application
  // is what the create's own transaction exists to prevent in the other direction.
  await Application.sequelize.transaction(async (transaction) => {
    if (UserApplicationRole) {
      const grants = await UserApplicationRole.destroy({
        where: { application_id: removable },
        transaction,
      });
      if (grants > 0) console.log(`  ${grants} grant${grants === 1 ? '' : 's'}`);
    }
    const removed = await Application.destroy({ where: { id: removable }, transaction });
    console.log(`  ${removed} application${removed === 1 ? '' : 's'}`);
  });

  const after = await Application.count();
  console.log(`\n${after} applications after (was ${before}, removed ${removable.length})`);
  if (after !== before - removable.length || refused > 0) {
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
