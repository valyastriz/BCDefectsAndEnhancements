const { test } = require('node:test');
const assert = require('node:assert');

const { SUBMISSION_INSERT_COLUMNS, buildInsertPayload } = require('../src/helpers/submissionInsert');

test('buildInsertPayload zips columns and values in order', () => {
  const payload = buildInsertPayload(['a', 'b', 'c'], [1, 2, 3]);
  assert.deepStrictEqual(payload, { a: 1, b: 2, c: 3 });
});

test('buildInsertPayload sets undefined for missing values', () => {
  const payload = buildInsertPayload(['a', 'b'], [1]);
  assert.strictEqual(payload.a, 1);
  assert.ok('b' in payload);
  assert.strictEqual(payload.b, undefined);
});

test('SUBMISSION_INSERT_COLUMNS has no duplicates', () => {
  const unique = new Set(SUBMISSION_INSERT_COLUMNS);
  assert.strictEqual(unique.size, SUBMISSION_INSERT_COLUMNS.length);
});

// THE WHOLE LIST, PINNED IN ORDER.
//
// Two call sites build a values array positionally against it — the admin create
// in submissionService and the per-row insert in importRoutes — so a column added
// anywhere but the END shifts every value after it into the wrong column. That is
// not hypothetical: `delivery_notes` was first slotted in beside `release_notes`,
// which shifted the import's array by one and made the whole import fail with
// "Cannot read properties of undefined", 0 rows in.
//
// An earlier version of this test pinned only the report-request TAIL, which that
// mid-list insert left untouched — so it passed while the import was broken, and
// a browser check found it instead. Pinning the full list is what makes the
// contract enforceable: this test failing is the prompt to go and append the
// matching value to BOTH arrays.
test('the shared insert columns are exactly these, in this order', () => {
  assert.deepStrictEqual(SUBMISSION_INSERT_COLUMNS, [
    'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
    'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
    'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
    'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_of', 'easyvista_ticket_id',
    'desired_completion_date', 'impact_details', 'enhancement_request_type_id', 'priority_level_id',
    'jira_number', 'release_number', 'release_notes', 'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id',
    'easyvista_submitted_by', 'is_public', 'is_retired', 'logged_defect',
    // The requester's half of a report request…
    'is_new_dashboard', 'needed_data', 'measures_and_sources', 'primary_contact',
    'existing_report_link', 'changes_requested', 'report_usage_frequency', 'department',
    'completed_at',
    // …then the analyst's, which the import fills from a history sheet.
    'level_of_effort_id', 'assigned_to', 'approved_at', 'approved_by_name',
    // …then what came out of it.
    'delivery_notes',
  ]);
});

test('nothing was inserted ahead of the defect/enhancement columns', () => {
  // The cheap version of the check above, stated as the rule rather than the
  // list: everything a report request added sits after `logged_defect`, which is
  // where the original defect/enhancement values ended.
  assert.strictEqual(SUBMISSION_INSERT_COLUMNS.indexOf('logged_defect'), 35);
  assert.strictEqual(SUBMISSION_INSERT_COLUMNS.at(-1), 'delivery_notes');
});

test('buildInsertPayload over the shared columns produces one key per column', () => {
  const values = SUBMISSION_INSERT_COLUMNS.map((_, i) => i);
  const payload = buildInsertPayload(SUBMISSION_INSERT_COLUMNS, values);
  assert.strictEqual(Object.keys(payload).length, SUBMISSION_INSERT_COLUMNS.length);
  assert.strictEqual(payload.created_at, 0);
  assert.strictEqual(payload[SUBMISSION_INSERT_COLUMNS.at(-1)], SUBMISSION_INSERT_COLUMNS.length - 1);
});
