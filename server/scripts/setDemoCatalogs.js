#!/usr/bin/env node
/**
 * Give the walkthrough applications a DEMO catalog, and leave the rest without one.
 *
 *   node scripts/setDemoCatalogs.js                                  # dry run
 *   node scripts/setDemoCatalogs.js --apply                          # write
 *   node scripts/setDemoCatalogs.js --clear --apply                  # undo
 *   node scripts/setDemoCatalogs.js --for="Billing Center" --apply   # a different set
 *
 * WHY THIS EXISTS. The owner's requirement, in their words: Billing Center and
 * Policy Center must keep pretend-sending on the demo site, and `Other` should be
 * "the one configured as if it's not configured to send to the service desk" —
 * so the walkthrough can show a Send button greyed out with the note telling the
 * admin to raise the ticket by hand and come back with its number.
 *
 * That needs a per-application difference, and until now there was none: with
 * `EASYVISTA_ENABLED` off, an application with no catalog demonstrated a send
 * exactly like a configured one, so every application behaved identically.
 *
 * WHY THE VALUE SAYS `DEMO-` OUT LOUD. Writing a plausible-looking GUID into these
 * rows would mean that on the day the integration is switched on, a real send posts
 * into a catalog that does not exist — and the whole point of the catalog guard is
 * that a ticket must never land somewhere it was not meant to. So the placeholder
 * names itself, and `easyVistaCatalogStatus` (src/helpers/easyVistaPayload.js)
 * stops honouring it the moment `easyVistaIsLive()` is true: good enough to
 * demonstrate a send, never good enough to transmit one. On a live server these
 * applications read as NOT configured, with a message pointing at whoever
 * configured the server rather than at the admin.
 *
 * SO THIS IS NOT A STEP TOWARDS GO-LIVE. Before the integration is switched on,
 * the real catalog IDs have to come from the team that runs the Service Desk and
 * go into `EASYVISTA_CATALOG_GUIDS` (an application's own column wins over the
 * environment, so `--clear` these first, or the placeholder keeps winning).
 *
 * It writes `easyvista_catalog_code` and not `_guid`: a GUID is a shape people
 * recognise and might copy, a code is free text, and neither is read while the
 * integration is off.
 */
require('dotenv').config();
const dbApi = require('../db');
const { easyVistaCatalogStatus } = require('../src/helpers/easyVistaPayload');

const APPLY = process.argv.includes('--apply');
const CLEAR = process.argv.includes('--clear');
// The two the owner named. Overridable so this is not the only shape it can make.
const DEFAULT_NAMES = ['Billing Center', 'Policy Center'];
const forArgument = process.argv.find((argument) => argument.startsWith('--for='));
const NAMES = forArgument
  ? forArgument.slice('--for='.length).split(',').map((name) => name.trim()).filter(Boolean)
  : DEFAULT_NAMES;

/** Self-describing on purpose — see the header. */
const demoCodeFor = (name) => `DEMO-${name.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase()}`;

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const { Application } = models;
  if (!Application) throw new Error('Application model is not initialized');

  // The dialect first, every time: `dotenv` resolves `server/.env` from the CWD, so
  // running this from the repo root silently targets the local sql.js file and then
  // reports a confident wrong answer. Read this line before believing the rest.
  console.log(`${Application.sequelize.getDialect()} · ${CLEAR ? 'CLEARING' : 'SETTING'} demo catalogs\n`);

  let rows;
  try {
    rows = await Application.findAll({
      attributes: ['id', 'name', 'is_active', 'easyvista_catalog_guid', 'easyvista_catalog_code'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
  } catch (error) {
    if (/easyvista_catalog/i.test(String(error?.message || ''))) {
      console.error(
        'applications.easyvista_catalog_guid/_code do not exist on this database.\n'
        + 'Run `npm run migrate:easyvista-catalog-columns -- --apply` first.',
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const wanted = new Set(NAMES.map((name) => name.trim().toLowerCase()));
  for (const name of NAMES) {
    if (!rows.some((row) => String(row.name || '').trim().toLowerCase() === name.trim().toLowerCase())) {
      console.log(`  "${name}" — not present, nothing to do`);
    }
  }

  const changes = [];
  for (const row of rows) {
    const name = String(row.name || '').trim();
    const targeted = wanted.has(name.toLowerCase());
    const currentCode = String(row.easyvista_catalog_code || '').trim();
    const currentGuid = String(row.easyvista_catalog_guid || '').trim();
    const nextCode = CLEAR ? '' : (targeted ? demoCodeFor(name) : currentCode);

    // A REAL value is never overwritten and never cleared, in either direction.
    // Whoever put it there has the catalog ID this whole placeholder exists to
    // stand in for, and a script that quietly replaced it would undo the go-live.
    const hasRealValue = (currentGuid && !currentGuid.toUpperCase().startsWith('DEMO-'))
      || (currentCode && !currentCode.toUpperCase().startsWith('DEMO-'));
    if (hasRealValue) {
      console.log(`  ${name} — LEFT ALONE: it already has a real catalog value`);
      continue;
    }

    if (nextCode !== currentCode) changes.push({ id: Number(row.id), name, from: currentCode, to: nextCode });
  }

  // What each application will DO, which is the thing being changed — the column
  // value on its own does not say whether a Send button works.
  const describe = (name, code) => {
    const status = easyVistaCatalogStatus({ name, easyvista_catalog_code: code });
    if (!status.configured) return 'Send greyed out, raise it by hand';
    return status.demoOnly ? 'Send works (pretend), refused once live' : 'Send works for real';
  };

  console.log('\n  after this runs:');
  for (const row of rows) {
    const name = String(row.name || '').trim();
    const change = changes.find((candidate) => candidate.id === Number(row.id));
    const code = change ? change.to : String(row.easyvista_catalog_code || '').trim();
    const inactive = Number(row.is_active) === 1 ? '' : ' (switched off)';
    console.log(`    ${name.padEnd(22)} ${(code || '—').padEnd(24)} ${describe(name, code)}${inactive}`);
  }

  if (changes.length === 0) {
    console.log('\nNothing to change.');
    return;
  }

  console.log(`\n  ${changes.length} change${changes.length === 1 ? '' : 's'}:`);
  for (const change of changes) {
    console.log(`    ${change.name}: "${change.from || '(empty)'}" → "${change.to || '(empty)'}"`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.');
    return;
  }

  await Application.sequelize.transaction(async (transaction) => {
    for (const change of changes) {
      await Application.update(
        { easyvista_catalog_code: change.to || null },
        { where: { id: change.id }, transaction },
      );
    }
  });

  // Read back rather than trust the update count: this is the shared database, and
  // "2 rows updated" is not the same claim as "the two rows say what I wanted".
  const after = await Application.findAll({
    attributes: ['id', 'name', 'easyvista_catalog_code'],
    where: { id: changes.map((change) => change.id) },
    raw: true,
  });
  let wrong = 0;
  for (const change of changes) {
    const row = after.find((candidate) => Number(candidate.id) === change.id);
    const value = String(row?.easyvista_catalog_code || '').trim();
    const ok = value === change.to;
    if (!ok) wrong += 1;
    console.log(`  ${ok ? 'OK  ' : 'BAD '} ${change.name} = "${value || '(empty)'}"`);
  }
  console.log(`\n${changes.length} applied, ${wrong} wrong.`);
  if (wrong > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
