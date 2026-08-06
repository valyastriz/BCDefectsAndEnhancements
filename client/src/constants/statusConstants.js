/** The request type these statuses belong to. `'report'` server-side too. */
export const SUBMISSION_TYPE_REPORT = 'report';

/**
 * The nine statuses a report request can hold, in the order they are offered.
 *
 * **Kept in step with `server/src/constants.js`** — `REPORT_REQUEST_STATUSES`,
 * `REPORT_ONLY_STATUSES` and `statusesForRequestType` there are the same three
 * things, and the server is the one that enforces them. Same arrangement as
 * `TRACKER_LABEL` and the usage-frequency scale: two copies, changed together.
 *
 * WHY THERE IS NO SECOND STATUS TABLE. `submissions.status_id` points at
 * `defect_enhancement_statuses`, and six of these nine ARE rows in it —
 * "Approved" means the same thing on a defect and on a report request. A second
 * table would have meant either a second status column (two columns for one fact)
 * or an id whose meaning depends on the row's type. So the table holds one
 * vocabulary and this registry decides which words each type may use; three rows
 * were added for the words report requests needed and nothing else changed.
 */
export const REPORT_REQUEST_STATUSES = [
  'New',
  'Approved',
  'In progress',
  'Delivered',
  'On hold',
  'Rejected',
  'Duplicate',
  'Redirected',
  'Retired',
];

/** The three that belong to report requests alone. Everything else is shared. */
export const REPORT_ONLY_STATUSES = ['In progress', 'Delivered', 'On hold'];

/** The status a delivered report request holds. */
export const REPORT_DELIVERED_STATUS = 'Delivered';

const lower = (value) => String(value || '').trim().toLowerCase();
const REPORT_ONLY_SET = new Set(REPORT_ONLY_STATUSES.map(lower));

/**
 * Which of these statuses this request type may hold.
 *
 * A report request gets the nine in registry order — the order they read in,
 * not the table's sort order, which is a defect-side sequence. Every other type
 * gets the list minus the three report-only words, so a value an admin adds on
 * the Metadata page keeps reaching defects exactly as it does today.
 *
 * Takes the live list so a switched-off value stays switched off for both.
 */
export function statusesForRequestType(type, statuses) {
  const list = (Array.isArray(statuses) ? statuses : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (lower(type) !== SUBMISSION_TYPE_REPORT) {
    return list.filter((name) => !REPORT_ONLY_SET.has(lower(name)));
  }
  const present = new Map(list.map((name) => [lower(name), name]));
  return REPORT_REQUEST_STATUSES.map((name) => present.get(lower(name))).filter(Boolean);
}
