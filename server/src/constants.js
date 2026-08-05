// ── The downstream ticketing system, as users see it ────────────────────────
//
// Every user-visible mention of the system approved tickets are handed off to —
// API error messages, spreadsheet column headers, status-history entries — goes
// through this label. The portal integrates with EasyVista today, but the UI
// deliberately does not say so: the tool is expected to be replaced, and when it
// is, this line is the change.
//
// DISPLAY name only. The integration's own identifiers keep the vendor name on
// purpose: the `easyvista_ticket_id` column, the `easyvista-preview` route, the
// `EASYVISTA_*` environment variables and `src/easyvista.js` all stay.
// The client has its own copy (client/src/constants/tracker.js) — change both.
const TRACKER_LABEL = 'Service Desk';

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
  // Labels are display-only; the aliases are what an imported spreadsheet column
  // is matched against, so they keep the old spellings and gain the new ones.
  { key: 'easyvista_ticket_id', label: `${TRACKER_LABEL} Number`, aliases: ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id', 'service_desk_number', 'service_desk_ticket'] },
  { key: 'reviewer', label: 'Reviewer', aliases: ['reviewer'] },
  { key: 'decision_notes', label: 'Decision Notes', aliases: ['decision_notes'] },
  { key: 'enhancement_request_type', label: 'Enhancement Request Type', aliases: ['enhancement_request_type', 'request_type'] },
  { key: 'priority_level', label: 'Priority', aliases: ['priority_level', 'priority'] },
  { key: 'application_name', label: 'Application', aliases: ['application_name', 'application'] },
  { key: 'easyvista_submitted_by', label: `${TRACKER_LABEL} Submitted By`, aliases: ['easyvista_submitted_by', 'submitted_by_easyvista', 'service_desk_submitted_by'] },
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
// Keep in sync with the client's STATUS_TO_CLEANUP (client/src/constants/adminConstants.js).
const SUBMISSION_TO_CLEANUP_STATUS = {
  New: 'Not Started',
  Approved: 'In Progress',
  Submitted: 'In Progress',
  Deployed: 'Completed',
  Retired: 'Completed',
};

// Allow-list of admin table column keys and filter keys for per-admin view
// preferences. Keep in sync with the client registries ADMIN_TABLE_COLUMNS and
// ADMIN_FILTER_FIELDS (client/src/constants/adminConstants.js). Unknown keys are
// dropped server-side, so drift fails safe (a stale key simply won't render).
const ADMIN_VIEW_COLUMN_KEYS = [
  'id',
  'reportedDate',
  'statusUpdate',
  'type',
  'summary',
  'status',
  'cleanupStatus',
  'isPublic',
  'easyvista',
  'jiraCard',
  'policyPremium',
  'directImpact',
  'policiesImpacted',
  'frequency',
  'application',
];
const ADMIN_VIEW_FILTER_KEYS = [
  'statuses',
  'retiredFilter',
  'types',
  'cleanupRequired',
  'cleanupStatuses',
  'search',
  'requester',
  'submittedBy',
  'createdVia',
  'year',
  'inJira',
  'workaround',
  'easyvistaNumber',
  'jiraNumber',
  'releaseNumber',
  'application',
];

// ── Application roles ───────────────────────────────────────────────────────
// What a person may do IN ONE APPLICATION's queue. Ordered weakest first, and
// the order is load-bearing: a role confers everything the roles before it do,
// so "at least viewer" is an index comparison rather than a list of exceptions.
//
// Deliberately a short code-level catalog rather than a lookup table: unlike
// statuses or priorities, a role means nothing without the code paths that honour
// it, so a row someone added by hand could only ever be a role that does nothing.
//
//   viewer — read the application's queue and its tickets; export. Changes nothing.
//   admin  — everything in that application: edit, status, attachments, redirect,
//            EasyVista, public visibility, retire, bulk.
//
// Portal super users are NOT in this list. That is a flag on the users row and it
// spans every application — one bypass, one place to audit.
// The application-scope filter value meaning "tickets with no application set".
// A sentinel rather than an empty string, because empty already means "every
// application" — and a literal application could never be named this.
const UNASSIGNED_APPLICATION = '__unassigned__';

const APPLICATION_ROLES = ['viewer', 'admin'];
const APPLICATION_ROLE_ADMIN = 'admin';
const APPLICATION_ROLE_VIEWER = 'viewer';

/** Position in the ladder, or -1 for anything unrecognised (which grants nothing). */
function applicationRoleRank(role) {
  return APPLICATION_ROLES.indexOf(String(role || '').trim().toLowerCase());
}

/** True when `role` confers at least what `minimum` confers. Unknown roles fail closed. */
function applicationRoleAtLeast(role, minimum) {
  const held = applicationRoleRank(role);
  const needed = applicationRoleRank(minimum);
  return held >= 0 && needed >= 0 && held >= needed;
}

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
  TRACKER_LABEL,
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
  ADMIN_VIEW_COLUMN_KEYS,
  ADMIN_VIEW_FILTER_KEYS,
  UNASSIGNED_APPLICATION,
  APPLICATION_ROLES,
  APPLICATION_ROLE_ADMIN,
  APPLICATION_ROLE_VIEWER,
  applicationRoleRank,
  applicationRoleAtLeast,
  LOOKUP_TABLES,
};
