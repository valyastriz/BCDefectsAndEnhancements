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
 * The point of the split: a closure for "could not reproduce" turns on STEPS and
 * nothing else, while one for "working as designed" turns on what the requester
 * expected instead. Asking the wrong one wastes the only contribution that could
 * have counted.
 *
 * EVERY LINE HERE STATES WHAT IS NEEDED, NEVER WHAT WILL HAPPEN. Nothing in this
 * feature reopens a ticket, re-prioritises one, or commits anybody to a fix — it
 * puts evidence in front of the people who decide. Copy that promises an outcome
 * we do not control is a promise to break, and the person reading it is already
 * the one who was told no once.
 */
export const ASK_BLOCKS = {
  [ASK_REPRO]: {
    why: 'It was closed because the team could not make it happen. Steps they can follow are what that decision turned on — without them there is nothing new to go on.',
    fields: ['steps_to_reproduce'],
  },
  [ASK_EXPECTATION]: {
    why: 'It was reviewed and judged to be working correctly. The team knows it does this — so what is worth adding is what you expected instead, and what it costs you.',
    fields: ['expected_behaviour', 'workaround_cost', 'frequency'],
  },
  [ASK_IMPACT]: {
    why: 'The team agrees this is a defect and is weighing how much it costs. Your numbers go into that.',
    fields: ['frequency', 'policies_affected_count', 'direct_dollar_impact', 'workaround_cost'],
  },
  [ASK_FULL]: {
    why: 'This was closed without a fix. Anything you can add goes to the team with your report.',
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
