// AI-written summary for semantic search — provider-switchable (Claude/OpenAI).
//
// The summary vendor is chosen by config (AI_SUMMARY_PROVIDER, driven by the
// AI_PROVIDER master switch): 'anthropic' uses Claude via @anthropic-ai/sdk,
// 'openai' uses the OpenAI Chat Completions API via native fetch. Same prompt,
// same JSON contract, same defensive parsing — flip one env var to switch.
//
// Given the user's query and a small set of already-retrieved candidate tickets,
// the model ranks them and writes a short, grounded summary. It may ONLY
// reference the tickets it was given — it never invents a ticket, status, or
// date; the caller renders the real ticket rows below the summary.
//
// The caller is responsible for scope safety: for public searches, the `tickets`
// passed in must already contain only public-safe fields.

const Anthropic = require('@anthropic-ai/sdk');
const {
  ANTHROPIC_API_KEY,
  AI_MODEL,
  OPENAI_API_KEY,
  OPENAI_SUMMARY_MODEL,
  AI_SUMMARY_PROVIDER,
  AI_SEARCH_ENABLED,
} = require('./config');

let anthropicClient = null;

function usingOpenAI() {
  return AI_SUMMARY_PROVIDER === 'openai';
}

function isAiConfigured() {
  if (!AI_SEARCH_ENABLED) return false;
  return usingOpenAI() ? Boolean(OPENAI_API_KEY) : Boolean(ANTHROPIC_API_KEY);
}

function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return anthropicClient;
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer_summary: { type: 'string' },
    reported_in_window: { type: 'boolean' },
    resolved_in_window: { type: 'boolean' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          submission_id: { type: 'integer' },
          relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
          why: { type: 'string' },
        },
        required: ['submission_id', 'relevance', 'why'],
      },
    },
  },
  required: ['answer_summary', 'reported_in_window', 'resolved_in_window', 'matches'],
};

const EMPTY_RESULT = {
  answer_summary: '',
  reported_in_window: false,
  resolved_in_window: false,
  matches: [],
};

function describeWindow(window) {
  const parts = [];
  if (window?.reportedWithinDays) parts.push(`reported within the last ${window.reportedWithinDays} days`);
  if (window?.resolvedWithinDays) parts.push(`resolved (Deployed/Retired/Rejected/Duplicate) within the last ${window.resolvedWithinDays} days`);
  return parts.length ? parts.join(' and ') : null;
}

const SYSTEM_PROMPT = [
  'You help a Billing Center defect/enhancement portal answer: "Has this issue been reported before, and what happened to it?"',
  'You are given the user\'s query and a list of candidate tickets already retrieved by semantic similarity.',
  'Rules:',
  '- Only reference tickets from the provided list. Never invent a ticket, status, number, or date.',
  '- Use each ticket\'s given status and dates verbatim; do not guess.',
  '- Write answer_summary as 2-4 plain sentences. Lead with the direct answer (whether it appears to have been reported before, and the most relevant ticket\'s current status). Cite tickets by their "ref" value.',
  '- Only include tickets in "matches" that are genuinely relevant to the query; order them most-relevant first. If none are relevant, return an empty matches array and say so in answer_summary.',
  '- If a time window is specified, set reported_in_window / resolved_in_window based only on the provided dates; if no window is specified, set both to false.',
  '',
  'Respond ONLY with a JSON object of this exact shape (no prose outside the JSON):',
  '{"answer_summary": string, "reported_in_window": boolean, "resolved_in_window": boolean, "matches": [{"submission_id": number, "relevance": "high"|"medium"|"low", "why": string}]}',
].join('\n');

function buildUserText({ query, tickets, windowText }) {
  const payload = { query: String(query), time_window: windowText || 'none', candidate_tickets: tickets };
  return [
    'User query and candidate tickets (JSON):',
    JSON.stringify(payload),
    '',
    windowText ? `The user is asking specifically about issues ${windowText}.` : 'No time window specified.',
  ].join('\n');
}

// ── Provider calls: each returns the raw JSON string (or '') ───────────────────
async function callAnthropic(userText) {
  const response = await getAnthropicClient().messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    messages: [{ role: 'user', content: userText }],
  });
  const textBlock = (response.content || []).find((b) => b.type === 'text');
  return textBlock?.text || '';
}

async function callOpenAI(userText) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_SUMMARY_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI summary request failed: ${response.status} ${message}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

// tickets: [{ id, ref, application, type, status, created_at, resolved_at, summary, details, request, decision_notes? }]
// window: { reportedWithinDays?, resolvedWithinDays? } | null
async function summarizeMatches({ query, tickets, window }) {
  if (!isAiConfigured()) return { ...EMPTY_RESULT };
  const list = Array.isArray(tickets) ? tickets : [];
  if (!String(query || '').trim() || list.length === 0) return { ...EMPTY_RESULT };

  const windowText = describeWindow(window);
  const userText = buildUserText({ query, tickets: list, windowText });

  try {
    const raw = usingOpenAI() ? await callOpenAI(userText) : await callAnthropic(userText);
    if (!raw) return { ...EMPTY_RESULT };

    const parsed = JSON.parse(raw);
    return {
      answer_summary: String(parsed.answer_summary || ''),
      reported_in_window: Boolean(parsed.reported_in_window),
      resolved_in_window: Boolean(parsed.resolved_in_window),
      matches: Array.isArray(parsed.matches)
        ? parsed.matches
          .filter((m) => m && Number.isFinite(Number(m.submission_id)))
          .map((m) => ({
            submission_id: Number(m.submission_id),
            relevance: ['high', 'medium', 'low'].includes(m.relevance) ? m.relevance : 'low',
            why: String(m.why || ''),
          }))
        : [],
    };
  } catch (error) {
    // Never let a provider/parse failure break the search request. The route
    // still returns the similarity-ranked tickets; the summary is just empty.
    console.error('[ai-search] summarizeMatches failed:', error?.message || error);
    return { ...EMPTY_RESULT };
  }
}

module.exports = {
  isAiConfigured,
  summarizeMatches,
};
