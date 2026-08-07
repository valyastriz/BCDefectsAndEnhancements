#!/usr/bin/env node
/**
 * Remove EVERY submission and its children. The reseed's first half.
 *
 *   node scripts/purgeSubmissions.js                       # dry run: the whole plan
 *   node scripts/purgeSubmissions.js --apply --confirm=86  # write
 *
 * WHY THIS EXISTS, GIVEN THAT `removeVerificationSubmissions.js` ALREADY DELETES
 * TICKETS. That script refuses any id whose summary does not begin with `VERIFY`,
 * and it takes explicit ids — never "all of them". Both limits are deliberate and
 * both make it the wrong tool here: the owner authorised clearing every ticket so
 * the documentation screenshots stop reading "Testing a report request", and that
 * is a different operation with different guards, not a loosened version of the
 * narrow one. Loosening the narrow script would have left the portal with no
 * script that cannot destroy real data.
 *
 * THE GUARDS, and what each one is for:
 *   - Dry run unless `--apply`, like every other script in this directory.
 *   - `--apply` ALSO needs `--confirm=<n>`, where n is the exact submission count
 *     the dry run reported. If somebody files a ticket between the dry run and the
 *     apply, the number no longer matches and the run refuses: the plan you read
 *     is the plan that executes, or nothing executes. This is the one guard that
 *     cannot be satisfied by habit.
 *   - It names what it will keep as well as what it will remove, because on a
 *     shared database the interesting question is what SURVIVES: users, grants,
 *     every lookup value, view preferences and the import-run log.
 *
 * CHILDREN, in dependency order — miss one and the orphan outlives the ticket:
 * hours (`request_time_entries`), assignment history (`request_assignments`),
 * attachments, status events, routings, embeddings. The throughput page reads the
 * first, the Delivery pane the second, the public board's track the fourth; an
 * orphaned row in any of them is a number about a ticket that no longer exists.
 *
 * STORED FILES. An attachment row points at a file, either a Supabase Storage
 * object (hosted) or a path under `uploads/` (local). Deleting the row alone
 * leaves the file, so both are removed with it — and where a file cannot be
 * reached from this environment (a Supabase URL with no storage credentials in
 * `.env`) it is reported rather than passed over in silence.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dbApi = require('../db');
const { SUPABASE_STORAGE_ENABLED } = require('../src/config');
const {
  extractSupabaseObjectPathFromUrl,
  deleteSupabaseStoredFileByUrl,
} = require('../src/helpers/storage');

const APPLY = process.argv.includes('--apply');
const CONFIRM = (() => {
  const argument = process.argv.find((value) => value.startsWith('--confirm='));
  if (!argument) return null;
  const parsed = Number(argument.slice('--confirm='.length));
  return Number.isInteger(parsed) ? parsed : null;
})();

// A locally-stored attachment's `file_path` is relative to the SERVER directory,
// not the repo root: helpers/storage.js writes
// `path.relative(path.join(__dirname, '..', '..'), finalPath)` from
// `server/src/helpers`, which resolves to `server/`. Getting this wrong reports
// every local file as already missing and quietly leaves all of them on disk.
const STORAGE_BASE = path.resolve(__dirname, '..');

/** Where an attachment's bytes actually live, and whether this box can reach them. */
function classifyAttachment(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return { kind: 'missing', detail: 'no path recorded' };
  if (/^https?:\/\//i.test(value)) {
    const objectPath = extractSupabaseObjectPathFromUrl(value);
    if (!objectPath) return { kind: 'foreign-url', detail: value.slice(0, 60) };
    return SUPABASE_STORAGE_ENABLED
      ? { kind: 'supabase', detail: objectPath }
      : { kind: 'supabase-unreachable', detail: objectPath };
  }
  const absolute = path.resolve(STORAGE_BASE, value);
  return fs.existsSync(absolute)
    ? { kind: 'local', detail: absolute }
    : { kind: 'local-missing', detail: absolute };
}

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const {
    Submission,
    SubmissionType,
    Application,
    DefectEnhancementStatus,
    RequestTimeEntry,
    RequestAssignment,
    Attachment,
    SubmissionStatusEvent,
    SubmissionRouting,
    SubmissionEmbedding,
    ExcelImportRun,
    User,
    UserApplicationRole,
    AdminViewPreference,
  } = models;
  if (!Submission) throw new Error('Submission model is not initialized');

  // The dialect first, every time — `dotenv` resolves `server/.env` relative to
  // the CWD, so running this from the repo root silently targets the local sql.js
  // file instead of the hosted database and then reports a confident wrong count.
  // Run it from `server/`, and read this line before believing anything below it.
  const sequelize = Submission.sequelize;
  const dialect = sequelize.getDialect();
  const total = Number(await Submission.count());
  console.log(`${dialect} · ${total} submissions\n`);

  // ── What is about to go ───────────────────────────────────────────────────
  const rows = await Submission.findAll({
    attributes: ['id', 'type_id', 'application_id', 'status_id', 'summary_of_issue'],
    order: [['id', 'ASC']],
    raw: true,
  });

  const nameById = async (model) => {
    if (!model) return new Map();
    const list = await model.findAll({ attributes: ['id', 'name'], raw: true });
    return new Map(list.map((row) => [Number(row.id), row.name]));
  };
  const types = await nameById(SubmissionType);
  const applications = await nameById(Application);
  const statuses = await nameById(DefectEnhancementStatus);

  const tally = (rowsIn, key, names) => {
    const counts = new Map();
    for (const row of rowsIn) {
      const label = names.get(Number(row[key])) || '(none)';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  const asList = (entries) => entries.map(([label, count]) => `${count} ${label}`).join(' · ') || '—';

  console.log('WHAT WILL BE REMOVED');
  console.log(`  submissions            ${total}`);
  console.log(`    by type             ${asList(tally(rows, 'type_id', types))}`);
  console.log(`    by application      ${asList(tally(rows, 'application_id', applications))}`);
  console.log(`    by status           ${asList(tally(rows, 'status_id', statuses))}`);
  if (rows.length > 0) {
    console.log(`    id range            #${rows[0].id} – #${rows[rows.length - 1].id}`);
  }

  const children = [
    ['hours (request_time_entries)', RequestTimeEntry],
    ['assignments (request_assignments)', RequestAssignment],
    ['attachments', Attachment],
    ['status events', SubmissionStatusEvent],
    ['routings', SubmissionRouting],
    ['embeddings', SubmissionEmbedding],
  ];
  for (const [label, model] of children) {
    const count = model ? Number(await model.count()) : 0;
    console.log(`  ${label.padEnd(22)} ${count}`);
  }

  const attachmentRows = Attachment
    ? await Attachment.findAll({ attributes: ['id', 'submission_id', 'file_path'], raw: true })
    : [];
  const classified = attachmentRows.map((row) => ({ row, where: classifyAttachment(row.file_path) }));
  if (classified.length > 0) {
    const byKind = new Map();
    for (const item of classified) byKind.set(item.where.kind, (byKind.get(item.where.kind) || 0) + 1);
    console.log(`  stored files          ${[...byKind.entries()].map(([kind, count]) => `${count} ${kind}`).join(' · ')}`);
    for (const item of classified) {
      console.log(`    #${item.row.submission_id} attachment ${item.row.id} — ${item.where.kind}: ${item.where.detail}`);
    }
  }

  // ── What survives. On a shared database this is the load-bearing half ─────
  console.log('\nWHAT WILL BE KEPT');
  const keep = [
    ['users', User],
    ['grants (user_application_roles)', UserApplicationRole],
    ['admin view preferences', AdminViewPreference],
    ['applications', Application],
    ['statuses', DefectEnhancementStatus],
    ['submission types', SubmissionType],
    // Not a child of a submission — no FK, and it records who ran an import and
    // when, which stays true after the rows it inserted are gone. Clearing it
    // would destroy an audit trail nothing asked to lose.
    ['excel import runs', ExcelImportRun],
  ];
  for (const [label, model] of keep) {
    const count = model ? Number(await model.count()) : 0;
    console.log(`  ${label.padEnd(34)} ${count}`);
  }
  console.log('  every other lookup value          untouched');
  console.log('  user_sessions                     untouched (signing out is not part of this)');
  console.log('\n  The id sequence is NOT reset: a sequence does not roll back, and the next');
  console.log(`  ticket filed after this will be about #${(rows[rows.length - 1]?.id || 0) + 1}. That is the truth about`);
  console.log('  a portal that has been used, and resetting it on a shared database to make');
  console.log('  screenshots start at #1 is a risk taken for cosmetics.');

  if (!APPLY) {
    console.log(`\nDRY RUN. Nothing was changed.`);
    console.log(`To write:  node scripts/purgeSubmissions.js --apply --confirm=${total}`);
    return;
  }

  if (CONFIRM === null) {
    console.error(`\nREFUSED: --apply needs --confirm=${total}. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }
  if (CONFIRM !== total) {
    console.error(`\nREFUSED: --confirm=${CONFIRM} does not match the ${total} submissions present.`);
    console.error('The table moved since the dry run. Re-read the plan above, then confirm that number.');
    process.exitCode = 1;
    return;
  }
  if (total === 0) {
    console.log('\nNothing to remove.');
    return;
  }

  // Files first, and outside the transaction, because they are not in it: a
  // storage delete cannot be rolled back, so the safe order is to lose the file
  // whose row is about to go rather than the row whose file survived. Every
  // failure is reported and none of them stops the run — a file that will not
  // delete must not leave the whole table half-purged.
  let filesRemoved = 0;
  const fileProblems = [];
  // Deduplicated by TARGET, because two attachment rows can point at one stored
  // object: an EasyVista resubmission copies the row and keeps the same
  // `file_path` (#65 carries #30's object on the hosted data today). Deleting per
  // row would then report a second success for a file already gone, or a failure
  // for one that was deleted correctly.
  const seenTargets = new Set();
  for (const { row, where } of classified) {
    if (where.kind === 'local' || where.kind === 'supabase') {
      if (seenTargets.has(where.detail)) continue;
      seenTargets.add(where.detail);
    }
    try {
      if (where.kind === 'local') {
        fs.rmSync(where.detail, { force: true });
        filesRemoved += 1;
      } else if (where.kind === 'supabase') {
        await deleteSupabaseStoredFileByUrl(row.file_path);
        filesRemoved += 1;
      } else {
        fileProblems.push(`attachment ${row.id}: ${where.kind} — ${where.detail}`);
      }
    } catch (error) {
      fileProblems.push(`attachment ${row.id}: ${error.message}`);
    }
  }
  console.log(`\n${filesRemoved} stored file${filesRemoved === 1 ? '' : 's'} removed`);
  for (const problem of fileProblems) console.log(`  NOT removed — ${problem}`);

  // Children before parents, in one transaction, so a failure halfway cannot
  // leave an hours row pointing at a ticket that no longer exists.
  await sequelize.transaction(async (transaction) => {
    for (const [label, model] of children) {
      if (!model) continue;
      const removed = await model.destroy({ where: {}, truncate: false, transaction });
      console.log(`  ${removed} ${label}`);
    }
    const removed = await Submission.destroy({ where: {}, truncate: false, transaction });
    console.log(`  ${removed} submissions`);
  });

  const after = Number(await Submission.count());
  console.log(`\n${after} submissions after (was ${total})`);
  if (after !== 0) {
    console.error('The table is not empty. Check it before seeding.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
