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

// The two call sites (adminSubmissionRoutes' create and importRoutes' per-row
// insert) each build a values array positionally, so a column inserted in the
// MIDDLE of this list silently shifts every value after it into the wrong column.
// Both appended their report-request block at the end; this pins that.
test('the report-request columns are appended, not inserted mid-list', () => {
  const REPORT_TAIL = [
    // The requester's half…
    'is_new_dashboard', 'needed_data', 'measures_and_sources', 'primary_contact',
    'existing_report_link', 'changes_requested', 'report_usage_frequency', 'department',
    'completed_at',
    // …then the analyst's, which the import fills from a history sheet.
    'level_of_effort_id', 'assigned_to', 'approved_at', 'approved_by_name',
  ];
  assert.deepStrictEqual(SUBMISSION_INSERT_COLUMNS.slice(-REPORT_TAIL.length), REPORT_TAIL);
  // And the column the ten original defect/enhancement values ended on is still
  // where it was, so no existing value moved.
  assert.strictEqual(
    SUBMISSION_INSERT_COLUMNS[SUBMISSION_INSERT_COLUMNS.length - REPORT_TAIL.length - 1],
    'logged_defect',
  );
});

test('buildInsertPayload over the shared columns produces one key per column', () => {
  const values = SUBMISSION_INSERT_COLUMNS.map((_, i) => i);
  const payload = buildInsertPayload(SUBMISSION_INSERT_COLUMNS, values);
  assert.strictEqual(Object.keys(payload).length, SUBMISSION_INSERT_COLUMNS.length);
  assert.strictEqual(payload.created_at, 0);
  assert.strictEqual(payload[SUBMISSION_INSERT_COLUMNS.at(-1)], SUBMISSION_INSERT_COLUMNS.length - 1);
});
