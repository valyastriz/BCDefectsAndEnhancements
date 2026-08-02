const { test } = require('node:test');
const assert = require('node:assert');

const { ADMIN_SEARCH_FIELDS } = require('../src/services/submissionService');
const { SUBMISSION_INSERT_COLUMNS } = require('../src/helpers/submissionInsert');

// The admin command bar has one free-text box, and admins type whatever
// identifier is in front of them into it: a ticket ID, an EasyVista incident
// number, a Jira number, a policy or account, a person's name, or a phrase from
// the ticket text. Each of those must resolve, so the coverage is asserted here
// rather than left to whoever next edits the filter.
const FIELDS_THE_BOX_MUST_MATCH = [
  'id',
  'easyvista_ticket_id',
  'jira_number',
  'release_number',
  'policy_num',
  'account_num',
  'transaction_num',
  'created_by',
  'created_by_email',
  'easyvista_submitted_by',
  'summary_of_issue',
  'screen_title',
  'what_happened_exact_details',
  'request',
  'steps_to_reproduce',
  'application_name',
];

// Broad lookup names would swamp the results: searching "new" would return every
// ticket in the New status. Those have their own dedicated filters.
const FIELDS_THE_BOX_MUST_NOT_MATCH = [
  'status',
  'type',
  'cleanup_status',
  'cleanup_tag_type',
  'decision_notes',
  'impact_details',
  'reviewer',
  'fingerprint',
];

test('the admin search box covers every identifier an admin can type', () => {
  const missing = FIELDS_THE_BOX_MUST_MATCH.filter((field) => !ADMIN_SEARCH_FIELDS.includes(field));
  assert.deepStrictEqual(missing, [], `search fields dropped: ${missing.join(', ')}`);
});

test('the admin search box excludes status/type names and internal notes', () => {
  const leaked = FIELDS_THE_BOX_MUST_NOT_MATCH.filter((field) => ADMIN_SEARCH_FIELDS.includes(field));
  assert.deepStrictEqual(leaked, [], `fields that should not be searched: ${leaked.join(', ')}`);
});

test('every searched field is a real submission column or a hydrated lookup name', () => {
  // `application_name` and `id` are not in the insert column list — the first is
  // hydrated from application_id, the second is the auto-increment primary key.
  const hydratedOrImplicit = new Set(['id', 'application_name']);
  const unknown = ADMIN_SEARCH_FIELDS.filter(
    (field) => !hydratedOrImplicit.has(field) && !SUBMISSION_INSERT_COLUMNS.includes(field),
  );
  assert.deepStrictEqual(unknown, [], `search fields that match no column: ${unknown.join(', ')}`);
});
