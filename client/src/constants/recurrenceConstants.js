// What the "it happened to me" sheet SAYS at each depth.
//
// The depth itself is decided by the server (server/src/helpers/recurrenceDepth.js)
// from the ticket's status, its release date and when the reporter says it
// happened. Nothing here decides anything — this is the wording for an answer
// already given, kept in one registry so the button, the sheet heading and the
// confirmation cannot drift apart.
//
// Deliberately shaped like the OUTCOMES / HOLDING maps in StatusBoardRow.jsx,
// which is the existing pattern for "behaviour keyed off a status".

export const DEPTH_ALREADY_FIXED = 0;
export const DEPTH_ADD_WEIGHT = 1;
export const DEPTH_CHALLENGE = 2;
export const DEPTH_REGRESSION = 3;

export const ASK_REPRO = 'repro';
export const ASK_EXPECTATION = 'expectation';
export const ASK_IMPACT = 'impact';
export const ASK_FULL = 'full';

/**
 * The one-liner under a match, and the button on it.
 *
 * `reason` is the server's machine key, so a wording change never needs the
 * status list copied over here.
 */
export const RECURRENCE_PROMPTS = {
  'in-flight': {
    prompt: 'Did this happen to you too?',
    action: 'It happened to me',
  },
  'closed-without-fix': {
    prompt: 'This one was closed without a fix. If it is still happening, tell us.',
    action: 'It happened to me',
  },
  'monitoring-impact': {
    prompt: 'We are counting how often this happens. You are the count.',
    action: 'Add to the count',
  },
  'recurred-after-release': {
    prompt: 'A fix for this already shipped. Seeing it since then means it did not hold.',
    action: 'It happened again',
  },
  'predates-release': {
    prompt: 'A fix for this has already shipped.',
    action: 'It happened again',
  },
};

export const DEFAULT_PROMPT = RECURRENCE_PROMPTS['in-flight'];

/** Heading and lede for the open sheet, per depth. */
export const SHEET_COPY = {
  [DEPTH_ADD_WEIGHT]: {
    title: 'You saw this too',
    submit: 'Add my report',
  },
  [DEPTH_CHALLENGE]: {
    title: 'Tell us what changed your mind',
    submit: 'Send for another look',
  },
  [DEPTH_REGRESSION]: {
    title: 'This was fixed — and it is back',
    submit: 'File it as a new report',
  },
  [DEPTH_ALREADY_FIXED]: {
    title: 'This has already been fixed',
    submit: 'Close',
  },
};

/**
 * The extra block a depth-2 sheet shows, and why it is asking.
 *
 * The point of the split: a defect closed as "could not reproduce" is reopened
 * by STEPS and nothing else, while one closed as "working as designed" is
 * reopened by what the requester expected instead. Asking the wrong one wastes
 * the only contribution that would have worked.
 */
export const ASK_BLOCKS = {
  [ASK_REPRO]: {
    why: 'It was closed because the team could not make it happen. Steps we can follow are the only thing that reopens it.',
    fields: ['steps_to_reproduce'],
  },
  [ASK_EXPECTATION]: {
    why: 'It was reviewed and judged to be working correctly. We know it does this — what helps is what you expected instead, and what it costs.',
    fields: ['expected_behaviour', 'workaround_cost', 'frequency'],
  },
  [ASK_IMPACT]: {
    why: 'We agree this is a defect. What decides whether it gets fixed is how much it costs, so that is what we are asking for.',
    fields: ['frequency', 'policies_affected_count', 'direct_dollar_impact', 'workaround_cost'],
  },
  [ASK_FULL]: {
    why: 'This was closed without a fix. Anything you can add helps us look at it again.',
    fields: ['steps_to_reproduce', 'expected_behaviour', 'frequency', 'policies_affected_count', 'direct_dollar_impact', 'workaround_cost'],
  },
};

/** How often it happens. Mirrors the seeded occurrence timeframes. */
export const FREQUENCY_TIMEFRAMES = ['Day', 'Week', 'Month', 'Quarter', 'Year'];

export function promptFor(reason) {
  return RECURRENCE_PROMPTS[reason] || DEFAULT_PROMPT;
}

export function askBlockFor(ask) {
  return ASK_BLOCKS[ask] || null;
}
