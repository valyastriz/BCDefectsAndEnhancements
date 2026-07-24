// One-time backfill: make existing tickets public by default.
//
//   node scripts/backfillPublicVisibility.js          # dry run: report only
//   node scripts/backfillPublicVisibility.js --apply   # perform the update
//
// Flips is_public 0 -> 1 for every currently-private, non-cleanup submission so
// existing defect/enhancement tickets match the new "public by default" rule.
// Internal cleanup-only tasks (is_cleanup = 1) are left untouched. `updated_at`
// is not modified (the model has timestamps: false), so each ticket keeps its
// real timeline on the public board.
//
// After the flip, newly-public tickets are (re)indexed for public AI search when
// the embeddings provider is configured. Safe to re-run: once a ticket is public
// it no longer matches the WHERE clause.
//
// NOTE: this targets whatever DB the environment points at (server/.env). With
// DB_PROVIDER=postgres that is the live Supabase database.

const dotenv = require('dotenv');

dotenv.config();

const dbApi = require('../db');

const APPLY = process.argv.includes('--apply');

// Currently-private, real (non-cleanup) tickets — the set that should flip.
const TARGET_WHERE = { is_public: 0, is_cleanup: 0 };

async function run() {
  await dbApi.init();
  const { Submission } = dbApi.getModels() || {};
  if (!Submission) {
    console.error('Submission model not initialized.');
    process.exit(1);
  }

  console.log(`DB provider: ${process.env.DB_PROVIDER || '(default)'}`);

  const targetRows = await Submission.findAll({
    where: TARGET_WHERE,
    attributes: ['id'],
    order: [['id', 'ASC']],
    raw: true,
  });
  const ids = targetRows.map((r) => Number(r.id)).filter(Boolean);

  console.log(`Private, non-cleanup tickets to make public: ${ids.length}`);
  if (ids.length) {
    const preview = ids.slice(0, 20).join(', ');
    console.log(`  ids: ${preview}${ids.length > 20 ? ', …' : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry run only — no changes written. Re-run with --apply to perform the update.');
    await dbApi.close();
    return;
  }

  if (!ids.length) {
    console.log('Nothing to update.');
    await dbApi.close();
    return;
  }

  // Persist the exact set being flipped so the change can be reverted precisely
  // (after the flip these ids are indistinguishable from always-public tickets).
  const auditPath = require('path').join(__dirname, 'backfill-public-visibility.last-run.json');
  require('fs').writeFileSync(auditPath, JSON.stringify({ flipped_ids: ids }, null, 2));
  console.log(`Wrote revert record for ${ids.length} ids -> ${auditPath}`);

  const [changed] = await Submission.update({ is_public: 1 }, { where: TARGET_WHERE });
  console.log(`Updated ${changed} submissions to is_public = 1.`);

  await reindexPublic(ids);

  await dbApi.close();
  console.log('Done.');
}

// Give the newly-public tickets a public-scope embedding so public AI search can
// find them. No-ops when the embeddings provider is not configured.
async function reindexPublic(ids) {
  const { isEmbeddingConfigured } = require('../src/embeddings');
  if (!isEmbeddingConfigured()) {
    console.log('Embeddings provider not configured — skipping public AI-search reindex.');
    return;
  }
  const { hydrateRows, ensureEmbeddingsForHydratedRows } = require('../src/services/embeddingIndexService');
  const { Submission } = dbApi.getModels();

  const BATCH = 100;
  let embedded = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    // eslint-disable-next-line no-await-in-loop
    const rows = await Submission.findAll({ where: { id: slice }, raw: true });
    // eslint-disable-next-line no-await-in-loop
    const hydrated = await hydrateRows(rows);
    // eslint-disable-next-line no-await-in-loop
    const report = await ensureEmbeddingsForHydratedRows(hydrated, { maxEmbed: Infinity });
    embedded += report.embedded;
    console.log(`  reindex ${Math.min(i + BATCH, ids.length)}/${ids.length} (embedded ${report.embedded} this batch)`);
  }
  console.log(`Public AI-search reindex complete — ${embedded} vectors written/updated.`);
}

run().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
