// One-time (idempotent) backfill of the AI-search embedding index.
//
//   node scripts/backfillEmbeddings.js
//
// Embeds every existing ticket (admin scope always; public scope for is_public
// tickets). Safe to re-run: the content_hash guard skips tickets whose text is
// already indexed with the current model. The default `local` embeddings
// provider needs no key; only EMBEDDINGS_PROVIDER=openai/voyage require their
// respective key (OPENAI_API_KEY / VOYAGE_API_KEY) — see .env.example.

const dotenv = require('dotenv');

dotenv.config();

const dbApi = require('../db');
const { ensureEmbeddingUniqueIndex } = require('../db/models');
const { isEmbeddingConfigured, getEmbeddingModelId } = require('../src/embeddings');
const { hydrateRows, ensureEmbeddingsForHydratedRows } = require('../src/services/embeddingIndexService');

async function backfill() {
  if (!isEmbeddingConfigured()) {
    console.error('Embeddings provider is not configured. The default `local` provider needs no key; if EMBEDDINGS_PROVIDER=openai or voyage, set OPENAI_API_KEY or VOYAGE_API_KEY respectively, then retry.');
    process.exit(1);
  }

  await dbApi.init();
  const { Submission, SubmissionEmbedding } = dbApi.getModels() || {};
  if (!Submission || !SubmissionEmbedding) {
    console.error('Models not initialized.');
    process.exit(1);
  }

  // Ensure the embeddings table exists without altering the rest of the schema,
  // then guarantee the composite unique index the upsert relies on is present
  // even when this script runs before `npm run migrate` on a fresh DB.
  await SubmissionEmbedding.sync();
  await ensureEmbeddingUniqueIndex(SubmissionEmbedding.sequelize);

  const raw = await Submission.findAll({ order: [['id', 'ASC']], raw: true });
  console.log(`Embedding provider/model: ${getEmbeddingModelId()}`);
  console.log(`Backfilling embeddings for ${raw.length} submissions...`);

  const hydrated = await hydrateRows(raw);

  // Process in batches so a very large table doesn't build one giant request.
  const BATCH = 100;
  let embedded = 0;
  let deletedPublic = 0;
  for (let i = 0; i < hydrated.length; i += BATCH) {
    const slice = hydrated.slice(i, i + BATCH);
    // eslint-disable-next-line no-await-in-loop
    const report = await ensureEmbeddingsForHydratedRows(slice, { maxEmbed: Infinity });
    embedded += report.embedded;
    deletedPublic += report.deletedPublic;
    console.log(`  ${Math.min(i + BATCH, hydrated.length)}/${hydrated.length} processed (embedded ${report.embedded} this batch)`);
  }

  console.log(`Done. Embedded/updated ${embedded} vectors; removed ${deletedPublic} stale public vectors.`);
  await dbApi.close();
}

backfill().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
