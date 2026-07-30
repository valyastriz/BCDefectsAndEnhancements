const { test } = require('node:test');
const assert = require('node:assert');

const { ADMIN_VIEW_COLUMN_KEYS } = require('../src/constants');
const { sanitizeViewPreference } = require('../src/services/adminViewPreferenceService');

// The admin queue's sort control offers every sortable field, not just the ones
// whose column happens to be visible, so each sort key it can emit must have a
// comparator on the server. `id_asc` / `id_desc` are the pair added for the new
// ID column — the rest already existed and are asserted here so a rename or a
// dropped comparator fails loudly instead of silently falling back to the
// default sort.
const SORT_KEYS_THE_CLIENT_CAN_SEND = [
  'id_asc', 'id_desc',
  'created_asc', 'created_desc',
  'updated_asc', 'updated_desc',
  'type_asc', 'type_desc',
  'requester_asc', 'requester_desc',
  'summary_asc', 'summary_desc',
  'status_asc', 'status_desc',
  'public_asc', 'public_desc',
  'logged_defect_asc', 'logged_defect_desc',
  'jira_number_asc', 'jira_number_desc',
  'release_number_asc', 'release_number_desc',
  'policy_premium_impact_asc', 'policy_premium_impact_desc',
  'direct_dollar_impact_asc', 'direct_dollar_impact_desc',
  'policies_affected_count_asc', 'policies_affected_count_desc',
  'frequency_asc', 'frequency_desc',
  'easyvista_asc', 'easyvista_desc',
  'submitted_by_asc', 'submitted_by_desc',
];

// The comparator map is built inside listAdminSubmissions, so read the source and
// assert each key is present rather than exporting internals just for the test.
const serviceSource = require('node:fs').readFileSync(
  require.resolve('../src/services/submissionService.js'),
  'utf8',
);

test('every sort key the admin sort control can send has a comparator', () => {
  const missing = SORT_KEYS_THE_CLIENT_CAN_SEND.filter(
    (key) => !new RegExp(`\\b${key}:`).test(serviceSource),
  );
  assert.deepStrictEqual(missing, [], `sort keys without a comparator: ${missing.join(', ')}`);
});

test('id sorting is numeric, not lexicographic', () => {
  // A text comparator would order 10 before 9; compareNum must be used so #10
  // sorts after #9 and the ID column matches the ticket numbering admins read.
  const idAscLine = serviceSource
    .split('\n')
    .find((line) => line.includes('id_asc:'));
  assert.ok(idAscLine, 'id_asc comparator not found');
  assert.match(idAscLine, /compareNum/);
});

test('the id column is allow-listed for saved view preferences', () => {
  assert.ok(
    ADMIN_VIEW_COLUMN_KEYS.includes('id'),
    'id must be allow-listed or an admin who shows the ID column cannot save that view',
  );
  const result = sanitizeViewPreference({ columns: ['id', 'summary'], filters: [] });
  assert.deepStrictEqual(result.columns, ['id', 'summary']);
});
