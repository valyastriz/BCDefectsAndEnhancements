// Shared Submission insert-payload helpers.
//
// The admin "create submission" POST handler and the Excel import per-row insert
// build the *exact same* column set, in the same order, and then zip a parallel
// values array into a payload object. That column list and zip step are extracted
// here verbatim so the two call sites cannot drift apart.
//
// NOTE: the EasyVista resubmission insert uses a *different* column set (it adds
// duplicate_reference, impact_notes, the impact numerics, and the resubmission
// bookkeeping columns, in a different order), so it does NOT reuse
// SUBMISSION_INSERT_COLUMNS — it only reuses buildInsertPayload for the identical
// columns→values zip step.

// Column order shared by adminSubmissionRoutes POST and importRoutes per-row insert.
const SUBMISSION_INSERT_COLUMNS = [
  'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
  'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
  'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
  'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_of', 'easyvista_ticket_id',
  'desired_completion_date', 'impact_details', 'enhancement_request_type_id', 'priority_level_id',
  'jira_number', 'release_number', 'release_notes', 'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id',
  'easyvista_submitted_by', 'is_public', 'is_retired', 'logged_defect',
];

// Zip a parallel columns array and values array into a payload object.
// Equivalent to the repeated `columns.reduce((acc, column, index) => { acc[column] = values[index]; return acc; }, {})`.
function buildInsertPayload(columns, values) {
  return columns.reduce((acc, column, index) => {
    acc[column] = values[index];
    return acc;
  }, {});
}

module.exports = {
  SUBMISSION_INSERT_COLUMNS,
  buildInsertPayload,
};
