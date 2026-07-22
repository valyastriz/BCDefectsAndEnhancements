// Provider-agnostic text embeddings for AI semantic search.
//
// Follows the same shape as easyvista.js: read the key from config, degrade
// gracefully when unconfigured, and call the provider with native `fetch`
// (no SDK). Supports Voyage AI (default) and OpenAI via env config.
//
// Anthropic has no embeddings endpoint, so retrieval uses a small embeddings
// vendor while the summary itself is written by Claude (see aiSummary.js).

const {
  EMBEDDINGS_PROVIDER,
  EMBEDDINGS_MODEL,
  VOYAGE_API_KEY,
  OPENAI_API_KEY,
} = require('./config');

const PROVIDERS = {
  voyage: {
    url: 'https://api.voyageai.com/v1/embeddings',
    key: () => VOYAGE_API_KEY,
    // Voyage supports input_type ('query' | 'document') to specialize the vector.
    buildBody: (texts, model, inputType) => ({
      input: texts,
      model,
      input_type: inputType === 'query' ? 'query' : 'document',
    }),
  },
  openai: {
    url: 'https://api.openai.com/v1/embeddings',
    key: () => OPENAI_API_KEY,
    buildBody: (texts, model) => ({ input: texts, model }),
  },
};

const MAX_BATCH = 96;

// ── Local (self-hosted) provider ───────────────────────────────────────────────
// Runs a small open-source embedding model in-process via transformers.js — no
// vendor, no API key, no per-call cost, and ticket text never leaves the server.
// The model is loaded lazily once and cached; first use downloads its weights
// (~90MB) to the transformers.js cache, then runs on CPU.
let localExtractorPromise = null;
function getLocalExtractor() {
  if (!localExtractorPromise) {
    localExtractorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', EMBEDDINGS_MODEL);
    })().catch((error) => {
      localExtractorPromise = null; // allow a retry on the next call
      throw error;
    });
  }
  return localExtractorPromise;
}

async function embedLocal(texts) {
  const extractor = await getLocalExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist(); // array of float arrays, aligned to input order
}

function isLocal() {
  return EMBEDDINGS_PROVIDER === 'local';
}

function getProvider() {
  return PROVIDERS[EMBEDDINGS_PROVIDER] || null;
}

function isEmbeddingConfigured() {
  if (isLocal()) return true; // self-hosted — no key required
  const provider = getProvider();
  return Boolean(provider && provider.key());
}

function getEmbeddingModelId() {
  return `${EMBEDDINGS_PROVIDER}:${EMBEDDINGS_MODEL}`;
}

async function embedBatch(texts, inputType) {
  const provider = getProvider();
  if (!provider) {
    throw new Error(`Unknown embeddings provider: ${EMBEDDINGS_PROVIDER}`);
  }
  const apiKey = provider.key();
  if (!apiKey) {
    throw new Error('Embeddings provider is not configured (missing API key).');
  }

  const response = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(provider.buildBody(texts, EMBEDDINGS_MODEL, inputType)),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Embeddings API request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : null;
  if (!rows || rows.length !== texts.length) {
    throw new Error('Embeddings API response did not include the expected vectors');
  }

  // Both Voyage and OpenAI return an `index` per row; sort defensively so the
  // returned vectors line up 1:1 with the input order.
  return rows
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((row) => {
      const vector = row?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('Embeddings API returned an empty vector');
      }
      return vector;
    });
}

// Embed an array of strings; returns vectors aligned to the input order.
// inputType: 'document' for stored ticket text, 'query' for the search query.
async function embedTexts(texts, { inputType = 'document' } = {}) {
  const list = Array.isArray(texts) ? texts : [];
  if (list.length === 0) return [];
  if (!isEmbeddingConfigured()) {
    throw new Error('Embeddings provider is not configured.');
  }

  const out = [];
  for (let i = 0; i < list.length; i += MAX_BATCH) {
    const chunk = list.slice(i, i + MAX_BATCH).map((t) => String(t == null ? '' : t));
    // eslint-disable-next-line no-await-in-loop
    const vectors = isLocal() ? await embedLocal(chunk) : await embedBatch(chunk, inputType);
    out.push(...vectors);
  }
  return out;
}

async function embedText(text, opts = {}) {
  const [vector] = await embedTexts([text], opts);
  return vector || null;
}

module.exports = {
  isEmbeddingConfigured,
  getEmbeddingModelId,
  embedTexts,
  embedText,
};
