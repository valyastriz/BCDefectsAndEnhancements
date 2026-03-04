const ENHANCEMENT_REQUEST_TYPES = [
  'Build-PPM Funded Project',
  'Build-Small Enhancement',
  'Build-Small Project (Not PPM Funded)',
  'Run-Compliance/Regulatory/Rate Revision',
  'Run-Other Operational Work',
];

const DEFAULT_DEFECT_ENHANCEMENT_STATUSES = [
  'New',
  'Approved',
  'Redirected',
  'Backlog - Monitoring Impact',
  'Future Consideration',
  'Deferred – Not in Current Scope',
  'Rejected',
  'Duplicate',
  'Submitted',
  'Deployed',
];
const RETIRED_STATUS = 'Retired';
const DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES, RETIRED_STATUS];
const DEFAULT_SUBMISSION_TYPES = ['defect', 'enhancement'];
const DEFAULT_APPLICATIONS = ['Billing Center', 'Policy Center'];
const DEFAULT_ENHANCEMENT_REQUEST_TYPES = [...ENHANCEMENT_REQUEST_TYPES];
const DEFAULT_PRIORITY_LEVELS = ['1 - Urgent', '2 - High', '3 - Medium', '4 - Low'];
const DEFAULT_SUBMISSION_SOURCES = [
  'rep_form',
  'admin_backdated',
  'admin_cleanup',
  'admin_excel_import',
  'admin_manual',
  'admin_easyvista_resubmission',
];
const DEFECT_ENHANCEMENT_STATUSES = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES];
const DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED];

const IMPORT_COLUMN_TARGETS = [
  { key: 'created_by', label: 'Requester Name', aliases: ['created_by', 'requester_name', 'requester', 'submitted_by_name'] },
  { key: 'created_by_email', label: 'Requester Email', aliases: ['created_by_email', 'requester_email', 'email'] },
  { key: 'summary_of_issue', label: 'Summary', aliases: ['summary_of_issue', 'summary', 'title', 'issue_summary'] },
  { key: 'status', label: 'Status', aliases: ['status', 'defect_enhancement_status'] },
  { key: 'policy_num', label: 'Policy # Column', aliases: ['policy_num', 'policy_number'] },
  { key: 'account_num', label: 'Account # Column', aliases: ['account_num', 'account_number'] },
  {
    key: 'combined_policy_account',
    label: 'Combined Policy/Account Column',
    aliases: ['policy_account', 'policy_account_num', 'policy_account_number', 'policy_or_account'],
  },
  { key: 'transaction_num', label: 'Transaction #', aliases: ['transaction_num', 'transaction_number'] },
  { key: 'screen_title', label: 'Screen Title', aliases: ['screen_title', 'screen'] },
  { key: 'steps_to_reproduce', label: 'Steps to Reproduce', aliases: ['steps_to_reproduce', 'steps'] },
  {
    key: 'what_happened_exact_details',
    label: 'Description',
    aliases: ['what_happened_exact_details', 'description', 'details'],
  },
  { key: 'request', label: 'Request', aliases: ['request', 'requested_change'] },
  {
    key: 'date_time_of_error',
    label: 'Date/Time of Error',
    aliases: ['date_time_of_error', 'error_datetime', 'error_date_time', 'date_of_error'],
  },
  {
    key: 'desired_completion_date',
    label: 'Desired Completion Date',
    aliases: ['desired_completion_date', 'target_date'],
  },
  { key: 'impact_details', label: 'Impact Details', aliases: ['impact_details'] },
  { key: 'impact_notes', label: 'Impact Notes', aliases: ['impact_notes'] },
  { key: 'policy_premium_impact', label: 'Policy Premium Impact', aliases: ['policy_premium_impact'] },
  { key: 'direct_dollar_impact', label: 'Direct Dollar Impact', aliases: ['direct_dollar_impact'] },
  { key: 'policies_affected_count', label: 'Policies Affected Count', aliases: ['policies_affected_count'] },
  { key: 'jira_number', label: 'JIRA Number', aliases: ['jira_number', 'jira'] },
  { key: 'release_number', label: 'Release Number', aliases: ['release_number', 'release'] },
  { key: 'release_notes', label: 'Release Notes', aliases: ['release_notes'] },
  { key: 'easyvista_ticket_id', label: 'EASYVISTA Number', aliases: ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id'] },
  { key: 'reviewer', label: 'Reviewer', aliases: ['reviewer'] },
  { key: 'decision_notes', label: 'Decision Notes', aliases: ['decision_notes'] },
  { key: 'enhancement_request_type', label: 'Enhancement Request Type', aliases: ['enhancement_request_type', 'request_type'] },
  { key: 'priority_level', label: 'Priority', aliases: ['priority_level', 'priority'] },
  { key: 'application_name', label: 'Application', aliases: ['application_name', 'application'] },
  { key: 'easyvista_submitted_by', label: 'EasyVista Submitted By', aliases: ['easyvista_submitted_by', 'submitted_by_easyvista'] },
  { key: 'is_public', label: 'Public', aliases: ['is_public', 'public'] },
  { key: 'is_retired', label: 'Retired', aliases: ['is_retired', 'retired'] },
  { key: 'is_cleanup', label: 'Cleanup', aliases: ['is_cleanup', 'cleanup'] },
  { key: 'cleanup_status', label: 'Cleanup Status', aliases: ['cleanup_status'] },
  { key: 'cleanup_tag_type', label: 'Cleanup Tag Type', aliases: ['cleanup_tag_type', 'cleanup_type'] },
  { key: 'type', label: 'Type', aliases: ['type', 'ticket_type', 'defect_or_enhancement'] },
  { key: 'created_at', label: 'Created At', aliases: ['created_at', 'reported_at', 'submitted_at', 'date_submitted'] },
  { key: 'closed_date', label: 'Closed Date', aliases: ['closed_date', 'closed_at', 'date_closed'] },
  { key: 'updated_at', label: 'Updated At', aliases: ['updated_at', 'status_update_at', 'last_updated_at'] },
];

const DEFAULT_CLEANUP_STATUSES = ['Not Started', 'In Progress', 'Completed'];
const DEFAULT_CLEANUP_TAG_TYPES = ['defect', 'enhancement', 'cleanup_only'];
const CLEANUP_STATUSES = [...DEFAULT_CLEANUP_STATUSES];
const CLEANUP_TAG_TYPES = [...DEFAULT_CLEANUP_TAG_TYPES];
const CLEANUP_TO_SUBMISSION_STATUS = {
  'Not Started': 'New',
  'In Progress': 'Approved',
  Completed: 'Deployed',
};
const SUBMISSION_TO_CLEANUP_STATUS = {
  New: 'Not Started',
  Approved: 'In Progress',
  Submitted: 'In Progress',
  Deployed: 'Completed',
};

const LOOKUP_TABLES = {
  statuses: {
    table: 'defect_enhancement_statuses',
    modelName: 'DefectEnhancementStatus',
    hasRetiredFlag: true,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'status_id',
  },
  types: {
    table: 'submission_types',
    modelName: 'SubmissionType',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    submissionIdColumn: 'type_id',
  },
  'cleanup-statuses': {
    table: 'cleanup_statuses',
    modelName: 'CleanupStatus',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'cleanup_status_id',
  },
  'cleanup-tag-types': {
    table: 'cleanup_tag_types',
    modelName: 'CleanupTagType',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    submissionIdColumn: 'cleanup_tag_type_id',
  },
  applications: {
    table: 'applications',
    modelName: 'Application',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'application_id',
  },
  'enhancement-request-types': {
    table: 'enhancement_request_types',
    modelName: 'EnhancementRequestType',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'enhancement_request_type_id',
  },
  'priority-levels': {
    table: 'priority_levels',
    modelName: 'PriorityLevel',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'priority_level_id',
  },
  'submission-sources': {
    table: 'submission_sources',
    modelName: 'SubmissionSource',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    submissionIdColumn: 'created_via_id',
  },
  'occurrence-timeframes': {
    table: 'occurrence_timeframes',
    modelName: 'OccurrenceTimeframe',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'occurrence_timeframe_id',
  },
};

module.exports = {
  ENHANCEMENT_REQUEST_TYPES,
  DEFAULT_DEFECT_ENHANCEMENT_STATUSES,
  RETIRED_STATUS,
  DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED,
  DEFAULT_SUBMISSION_TYPES,
  DEFAULT_APPLICATIONS,
  DEFAULT_ENHANCEMENT_REQUEST_TYPES,
  DEFAULT_PRIORITY_LEVELS,
  DEFAULT_SUBMISSION_SOURCES,
  DEFECT_ENHANCEMENT_STATUSES,
  DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED,
  IMPORT_COLUMN_TARGETS,
  DEFAULT_CLEANUP_STATUSES,
  DEFAULT_CLEANUP_TAG_TYPES,
  CLEANUP_STATUSES,
  CLEANUP_TAG_TYPES,
  CLEANUP_TO_SUBMISSION_STATUS,
  SUBMISSION_TO_CLEANUP_STATUS,
  LOOKUP_TABLES,
};
