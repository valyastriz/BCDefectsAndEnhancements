const { TRACKER_LABEL } = require('../constants');

function buildAdminExportFields() {
  return [
    { key: 'id', label: 'Submission ID', value: (row) => row.id },
    { key: 'created_at', label: 'Reported Date', value: (row) => row.created_at },
    { key: 'status_update_at', label: 'Status Update Date', value: (row) => row.status_update_at },
    { key: 'latest_status_update', label: 'Latest Status Update', value: (row) => row.latest_status_update },
    { key: 'latest_status_update_at', label: 'Latest Status Update Date', value: (row) => row.latest_status_update_at },
    { key: 'type', label: 'Type', value: (row) => row.type },
    { key: 'status', label: 'Defect/Enhancement Status', value: (row) => row.status },
    { key: 'is_cleanup', label: 'Is Cleanup', value: (row) => Boolean(row.is_cleanup) ? 'Yes' : 'No' },
    { key: 'cleanup_status', label: 'Cleanup Status', value: (row) => row.cleanup_status },
    { key: 'cleanup_tag_type', label: 'Cleanup Tag Type', value: (row) => row.cleanup_tag_type },
    { key: 'is_public', label: 'Public', value: (row) => Boolean(row.is_public) ? 'Yes' : 'No' },
    { key: 'is_retired', label: 'Retired', value: (row) => Boolean(row.is_retired) ? 'Yes' : 'No' },
    { key: 'summary_of_issue', label: 'Summary', value: (row) => row.summary_of_issue },
    { key: 'what_happened_exact_details', label: 'What Happened (Exact Details)', value: (row) => row.what_happened_exact_details },
    { key: 'request', label: 'Request Details', value: (row) => row.request },
    { key: 'created_by', label: 'Requester Name', value: (row) => row.created_by },
    { key: 'created_by_email', label: 'Requester Email', value: (row) => row.created_by_email },
    { key: 'reviewer', label: 'Reviewer', value: (row) => row.reviewer },
    { key: 'created_via', label: 'Created Via', value: (row) => row.created_via },
    { key: 'application_name', label: 'Application', value: (row) => row.application_name },
    { key: 'policy_num', label: 'Policy Number', value: (row) => row.policy_num },
    { key: 'account_num', label: 'Account Number', value: (row) => row.account_num },
    { key: 'transaction_num', label: 'Transaction Number', value: (row) => row.transaction_num },
    { key: 'screen_title', label: 'Screen Title', value: (row) => row.screen_title },
    { key: 'steps_to_reproduce', label: 'Steps to Reproduce', value: (row) => row.steps_to_reproduce },
    { key: 'date_time_of_error', label: 'Date/Time of Error', value: (row) => row.date_time_of_error },
    { key: 'desired_completion_date', label: 'Desired Completion Date', value: (row) => row.desired_completion_date },
    { key: 'impact_details', label: 'Impact Details', value: (row) => row.impact_details },
    { key: 'impact_notes', label: 'Impact Notes', value: (row) => row.impact_notes },
    { key: 'policy_premium_impact', label: 'Policy Premium Impact ($)', value: (row) => row.policy_premium_impact },
    { key: 'direct_dollar_impact', label: 'Direct Dollar Impact ($)', value: (row) => row.direct_dollar_impact },
    { key: 'policies_affected_count', label: 'Policies Affected Count', value: (row) => row.policies_affected_count },
    { key: 'enhancement_request_type', label: 'Enhancement Request Type', value: (row) => row.enhancement_request_type },
    { key: 'priority_level', label: 'Priority Level', value: (row) => row.priority_level },
    { key: 'jira_number', label: 'JIRA Number', value: (row) => row.jira_number },
    // Column HEADERS are user-facing, so they carry the display label. The import
    // side matches on aliases, never on the header text (see IMPORT_COLUMN_TARGETS
    // in src/constants.js), so a sheet exported under this header re-imports.
    { key: 'easyvista_ticket_id', label: `${TRACKER_LABEL} Ticket`, value: (row) => row.easyvista_ticket_id },
    { key: 'easyvista_submitted_by', label: `Submitted to ${TRACKER_LABEL} By`, value: (row) => row.easyvista_submitted_by },
    { key: 'release_number', label: 'Release Number', value: (row) => row.release_number },
    { key: 'release_notes', label: 'Release Notes', value: (row) => row.release_notes },
    { key: 'decision_notes', label: 'Decision Notes', value: (row) => row.decision_notes },
    { key: 'fingerprint', label: 'Fingerprint', value: (row) => row.fingerprint },
    { key: 'duplicate_reference', label: 'Duplicate Reference', value: (row) => row.duplicate_reference || row.duplicate_of },
    { key: 'has_resubmission', label: 'Has Resubmission', value: (row) => Boolean(row.has_resubmission) ? 'Yes' : 'No' },
    { key: 'latest_resubmission_easyvista_ticket_id', label: 'Latest Resubmission Ticket', value: (row) => row.latest_resubmission_easyvista_ticket_id },
    { key: 'occurrence_count', label: 'Occurrence Count', value: (row) => row.occurrence_count },
    { key: 'occurrence_timeframe_count', label: 'Occurrence Timeframe #', value: (row) => row.occurrence_timeframe_count },
    { key: 'occurrence_timeframe', label: 'Occurrence Timeframe', value: (row) => row.occurrence_timeframe },
    { key: 'occurrence_rate', label: 'Occurrence Rate (per month)', value: (row) => row.occurrence_rate != null ? Number(row.occurrence_rate).toFixed(2) : '' },

    // ── Report requests ─────────────────────────────────────────────────────
    // Null on every other type, which is what an empty cell means. Every one of
    // these labels normalises onto an alias in IMPORT_COLUMN_TARGETS, so a sheet
    // exported from here re-imports — the two headers that did not used to
    // ("Reported Date", "Request Details") are why `exportFields.test.js` checks
    // every label rather than trusting the pairing.
    {
      key: 'is_new_dashboard',
      label: 'New Dashboard Request?',
      // Yes/No like every other boolean here, and the shape parseImportBoolean
      // reads back. Blank for a ticket that is not a report request at all —
      // "No" there would answer a question nobody asked.
      value: (row) => (row.is_new_dashboard === null || row.is_new_dashboard === undefined
        ? ''
        : (row.is_new_dashboard ? 'Yes' : 'No')),
    },
    { key: 'needed_data', label: 'Needed Data', value: (row) => row.needed_data },
    { key: 'measures_and_sources', label: 'Measures & Data Sources', value: (row) => row.measures_and_sources },
    { key: 'primary_contact', label: 'Primary Contact', value: (row) => row.primary_contact },
    { key: 'existing_report_link', label: 'Existing Report', value: (row) => row.existing_report_link },
    { key: 'changes_requested', label: 'Changes Requested', value: (row) => row.changes_requested },
    { key: 'report_usage_frequency', label: 'Usage Frequency', value: (row) => row.report_usage_frequency },
    { key: 'department', label: 'Department', value: (row) => row.department },
    { key: 'completed_at', label: 'Complete Date', value: (row) => row.completed_at },
    { key: 'level_of_effort', label: 'Level of Effort', value: (row) => row.level_of_effort },
    // The assignee as a NAME, resolved from the user id the column stores. The id
    // itself is not exported: a spreadsheet of ids is unreadable, and a name in a
    // sheet is not something the import side would be right to trust back into an
    // FK — so this one travels out and never in.
    { key: 'assigned_to_name', label: 'Assigned To', value: (row) => row.assigned_to_name },
    { key: 'approved_at', label: 'Approved Date', value: (row) => row.approved_at },
    { key: 'approved_by_name', label: 'Approved By', value: (row) => row.approved_by_name },
  ];
}

// ── How the export dialog groups those fields ───────────────────────────────
//
// A flat list of 48 checkboxes is unreadable, so the dialog draws them in these
// groups, in this order. The grouping lives HERE, beside the field definitions,
// rather than in the client: a field added above must arrive in the dialog with
// somewhere to live, and a client-side registry is a second list someone has to
// remember to update. Anything not named below still renders, under UNGROUPED —
// visible-but-misfiled is recoverable, invisible is not. `export.test.js` fails
// if UNGROUPED is ever non-empty.
const UNGROUPED_FIELD_GROUP = 'other';

const EXPORT_FIELD_GROUPS = [
  {
    key: 'identity',
    label: 'Identity',
    fieldKeys: ['id', 'type', 'summary_of_issue', 'application_name', 'is_public'],
  },
  {
    key: 'report',
    label: 'The report',
    fieldKeys: [
      'what_happened_exact_details', 'request', 'steps_to_reproduce', 'screen_title',
      'date_time_of_error', 'policy_num', 'account_num', 'transaction_num',
      'created_by', 'created_by_email',
    ],
  },
  {
    key: 'triage',
    label: 'Triage',
    fieldKeys: [
      'status', 'reviewer', 'decision_notes', 'priority_level', 'enhancement_request_type',
      'desired_completion_date', 'is_retired', 'created_via',
    ],
  },
  {
    key: 'cleanup',
    label: 'Cleanup',
    fieldKeys: ['is_cleanup', 'cleanup_status', 'cleanup_tag_type'],
  },
  {
    key: 'impact',
    label: 'Impact',
    fieldKeys: [
      'impact_details', 'impact_notes', 'policy_premium_impact', 'direct_dollar_impact',
      'policies_affected_count', 'occurrence_count', 'occurrence_timeframe_count',
      'occurrence_timeframe', 'occurrence_rate',
    ],
  },
  {
    key: 'handoff',
    label: `${TRACKER_LABEL} & delivery`,
    fieldKeys: [
      'easyvista_ticket_id', 'easyvista_submitted_by', 'jira_number', 'release_number',
      'release_notes', 'has_resubmission', 'latest_resubmission_easyvista_ticket_id',
    ],
  },
  {
    key: 'dates',
    label: 'Dates & audit',
    fieldKeys: [
      'created_at', 'status_update_at', 'latest_status_update', 'latest_status_update_at',
      'duplicate_reference', 'fingerprint',
    ],
  },
  {
    key: 'reportRequest',
    label: 'Report request',
    fieldKeys: [
      'is_new_dashboard', 'existing_report_link', 'changes_requested', 'needed_data',
      'measures_and_sources', 'primary_contact', 'report_usage_frequency', 'department',
      'assigned_to_name', 'level_of_effort', 'completed_at', 'approved_at', 'approved_by_name',
    ],
  },
  { key: UNGROUPED_FIELD_GROUP, label: 'Other fields', fieldKeys: [] },
];

const EXPORT_GROUP_BY_FIELD_KEY = new Map();
for (const group of EXPORT_FIELD_GROUPS) {
  for (const fieldKey of group.fieldKeys) {
    EXPORT_GROUP_BY_FIELD_KEY.set(fieldKey, group.key);
  }
}

/** The field's group key, or UNGROUPED_FIELD_GROUP when nobody claimed it. */
function exportFieldGroup(fieldKey) {
  return EXPORT_GROUP_BY_FIELD_KEY.get(fieldKey) || UNGROUPED_FIELD_GROUP;
}

const ADMIN_EXPORT_FIELDS = buildAdminExportFields().map((field) => ({
  ...field,
  group: exportFieldGroup(field.key),
}));
const ADMIN_EXPORT_FIELDS_BY_KEY = new Map(ADMIN_EXPORT_FIELDS.map((field) => [field.key, field]));

module.exports = {
  buildAdminExportFields,
  ADMIN_EXPORT_FIELDS,
  ADMIN_EXPORT_FIELDS_BY_KEY,
  EXPORT_FIELD_GROUPS,
  UNGROUPED_FIELD_GROUP,
  exportFieldGroup,
};
