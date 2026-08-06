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
  // ── Report requests (appended, and appended on purpose) ───────────────────
  // These three are the report-request vocabulary's own words. They are seeded
  // into the SAME table as the ten above, and `statusesForRequestType` below is
  // what keeps them apart. Appended rather than slotted in beside their
  // defect-side equivalents so `seedLookup` gives them sort orders after every
  // existing value — an existing row keeps whatever order it already has, so
  // inserting mid-list would only collide.
  'In progress',
  'Delivered',
  'On hold',
];
const RETIRED_STATUS = 'Retired';
const DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES, RETIRED_STATUS];

// ── Report-request statuses ──────────────────────────────────────────────────
//
// The nine words a requester reads on a report request, in the order they are
// offered (owner-confirmed 2026-08-06). Six of them are the defect list's own
// rows — "Approved" means the same thing on both, which is what the owner meant
// by "most statuses can transfer" — and three are new.
//
// WHY THIS IS A REGISTRY AND NOT A SECOND TABLE. `submissions.status_id` points
// at `defect_enhancement_statuses`. A second status table would mean either a
// second status column on `submissions` (two columns for one fact — the exact
// defect the source field list has with Complete / Completed / Complete Date) or
// an id whose meaning depends on the row's type, which cannot be joined or
// foreign-keyed. Scoping the OFFERED SET instead keeps one column, one FK and one
// join, and costs three seeded rows. The requester's experience is identical: a
// report request offers exactly these nine and nothing else.
//
// Kept in step with client/src/constants/statusConstants.js, which mirrors both
// lists and the same function for the dropdowns.
const REPORT_REQUEST_STATUSES = [
  'New',
  'Approved',
  'In progress',
  'Delivered',
  'On hold',
  'Rejected',
  'Duplicate',
  'Redirected',
  RETIRED_STATUS,
];

// The three that belong to report requests ALONE. Everything else in the status
// table is offered to every type, including a value an admin adds on the Metadata
// page — so adding one keeps working exactly as it does today.
const REPORT_ONLY_STATUSES = ['In progress', 'Delivered', 'On hold'];

/** The status a delivered report request holds. The throughput page's own word. */
const REPORT_DELIVERED_STATUS = 'Delivered';

const lowerSet = (values) => new Set(values.map((value) => String(value).trim().toLowerCase()));

/**
 * Which statuses this request type may hold, out of the ones the table has.
 *
 * Takes the live list rather than reaching for the database, so it is a pure
 * function both a route and a test can call, and so a switched-off value stays
 * switched off for both types.
 *
 * A report request gets the nine in REGISTRY order — the order they read in, not
 * the table's sort order, which is a defect-side sequence. Every other type gets
 * the table minus the three report-only words.
 */
function statusesForRequestType(type, statuses) {
  const list = (Array.isArray(statuses) ? statuses : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (String(type || '').trim().toLowerCase() !== SUBMISSION_TYPE_REPORT) {
    const reportOnly = lowerSet(REPORT_ONLY_STATUSES);
    return list.filter((name) => !reportOnly.has(name.toLowerCase()));
  }
  const present = new Map(list.map((name) => [name.toLowerCase(), name]));
  return REPORT_REQUEST_STATUSES
    .map((name) => present.get(name.toLowerCase()))
    .filter(Boolean);
}
// `report` is the third request type (plan.md §4 Phase 1). It is a lookup value
// like the other two, not an enum: the Metadata page manages this list, and
// server/src/routes/submissionRoutes.js validates against it at run time.
const SUBMISSION_TYPE_REPORT = 'report';
const DEFAULT_SUBMISSION_TYPES = ['defect', 'enhancement', SUBMISSION_TYPE_REPORT];

// How often a requested report will be used. A fixed cadence scale rather than a
// managed lookup: it is not a database-managed entity the way an application is,
// and free text would give an analyst "Daily", "daily" and "every day" as three
// different answers. The client offers exactly these and the server refuses
// anything else, so one list governs both.
const REPORT_USAGE_FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'One-off'];

// Seed values for the new Levels of Effort lookup. A starting point the Metadata
// page can rename or switch off — not a closed set.
const DEFAULT_LEVELS_OF_EFFORT = [
  'S — up to 2 days',
  'M — up to a week',
  'L — up to a month',
  'XL — more than a month',
];
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
  { key: 'request', label: 'Request', aliases: ['request', 'requested_change', 'request_details'] },
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
  // The report-request counterpart. Importable because a backdated sheet is
  // exactly where delivery notes already exist: a team switching to this portal
  // is carrying over requests that were built and handed over somewhere else, and
  // dropping the one column that says what was handed over would lose the point
  // of the record. `delivered_notes` and `delivery_note` are there because a
  // hand-maintained sheet will have been titled by a person, not by this list.
  {
    key: 'delivery_notes',
    label: 'Delivery Notes',
    aliases: ['delivery_notes', 'delivery_note', 'delivered_notes', 'what_was_delivered'],
  },
  // Labels are display-only; the aliases are what an imported spreadsheet column
  // is matched against, so they keep the old spellings and gain the new ones.
  { key: 'easyvista_ticket_id', label: `${TRACKER_LABEL} Number`, aliases: ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id', 'service_desk_number', 'service_desk_ticket'] },
  { key: 'reviewer', label: 'Reviewer', aliases: ['reviewer'] },
  { key: 'decision_notes', label: 'Decision Notes', aliases: ['decision_notes'] },
  { key: 'enhancement_request_type', label: 'Enhancement Request Type', aliases: ['enhancement_request_type', 'request_type'] },
  { key: 'priority_level', label: 'Priority', aliases: ['priority_level', 'priority'] },
  { key: 'application_name', label: 'Application', aliases: ['application_name', 'application'] },
  { key: 'easyvista_submitted_by', label: `${TRACKER_LABEL} Submitted By`, aliases: ['easyvista_submitted_by', 'submitted_by_easyvista', 'service_desk_submitted_by', 'submitted_to_service_desk_by', 'submitted_to_ev_by'] },
  { key: 'is_public', label: 'Public', aliases: ['is_public', 'public'] },
  { key: 'is_retired', label: 'Retired', aliases: ['is_retired', 'retired'] },
  { key: 'is_cleanup', label: 'Cleanup', aliases: ['is_cleanup', 'cleanup'] },
  { key: 'cleanup_status', label: 'Cleanup Status', aliases: ['cleanup_status'] },
  { key: 'cleanup_tag_type', label: 'Cleanup Tag Type', aliases: ['cleanup_tag_type', 'cleanup_type'] },
  { key: 'type', label: 'Type', aliases: ['type', 'ticket_type', 'defect_or_enhancement'] },
  { key: 'created_at', label: 'Created At', aliases: ['created_at', 'reported_at', 'reported_date', 'submitted_at', 'date_submitted'] },
  { key: 'closed_date', label: 'Closed Date', aliases: ['closed_date', 'closed_at', 'date_closed'] },
  { key: 'updated_at', label: 'Updated At', aliases: ['updated_at', 'status_update_at', 'last_updated_at'] },
  // ── Report requests ─────────────────────────────────────────────────────────
  // Written only on a row whose Type is `report` (importRoutes), so mapping one of
  // these onto a sheet of defects loads nothing rather than nonsense. The aliases
  // include the source field list's own column names, since that spreadsheet is
  // where a sheet of historical report requests would come from.
  {
    key: 'is_new_dashboard',
    label: 'New Dashboard Request?',
    aliases: ['is_new_dashboard', 'new_dashboard_request', 'new_dashboard', 'new_or_change'],
  },
  { key: 'needed_data', label: 'Needed Data', aliases: ['needed_data', 'list_needed_data', 'data_needed'] },
  {
    key: 'measures_and_sources',
    label: 'Measures & Data Sources',
    aliases: ['measures_and_sources', 'list_of_measures_data_sources', 'measures_data_sources', 'measures'],
  },
  {
    key: 'primary_contact',
    label: 'Primary Contact',
    aliases: ['primary_contact', 'primary_contact_for_dashboard', 'dashboard_contact'],
  },
  {
    key: 'existing_report_link',
    label: 'Existing Report',
    aliases: ['existing_report_link', 'existing_report', 'report_link', 'which_report'],
  },
  {
    key: 'changes_requested',
    label: 'Changes Requested',
    aliases: ['changes_requested', 'list_changes_requested', 'requested_changes'],
  },
  {
    key: 'report_usage_frequency',
    label: 'Usage Frequency',
    aliases: ['report_usage_frequency', 'how_often_will_this_be_used', 'usage_frequency', 'frequency'],
  },
  {
    key: 'department',
    label: 'Department',
    aliases: ['department', 'what_dept_is_this_for', 'dept', 'requesting_department'],
  },
  {
    key: 'completed_at',
    label: 'Complete Date',
    aliases: ['completed_at', 'complete_date', 'completed_date', 'date_completed', 'delivered_date'],
  },
  // ── The analyst's half of a report request ──────────────────────────────────
  // A history sheet knows who worked a request, how big it was, who signed it off
  // and how long it took. All four import; three of them are plain values, and the
  // two that are not are the reason this block has its own note:
  //
  //   `assigned_to` arrives as a NAME and is stored as a user id. It is resolved
  //   against the portal's own users and refused if it is unknown, ambiguous, or
  //   somebody with no grant on the row's application — never stored as text, and
  //   never guessed. What it could not place is reported per row.
  //
  //   `hours_logged` is `Duration`, which is not a column at all: it becomes ONE
  //   time entry, credited to the resolved assignee on the day the request
  //   completed. Hours have to belong to a person and a day, so a row with no
  //   assignee keeps its number out of the ledger and says so.
  {
    key: 'level_of_effort',
    label: 'Level of Effort',
    aliases: ['level_of_effort', 'level_of_effort_id', 'loe', 'effort', 'complexity'],
  },
  {
    key: 'assigned_to',
    label: 'Assigned To',
    aliases: ['assigned_to', 'assignee', 'assigned', 'analyst', 'owner'],
  },
  {
    key: 'hours_logged',
    label: 'Hours Logged',
    aliases: ['hours_logged', 'hours', 'duration', 'time_spent'],
  },
  {
    key: 'approved_at',
    label: 'Approved Date',
    aliases: ['approved_at', 'approved_date', 'approval_date', 'date_approved'],
  },
  {
    key: 'approved_by_name',
    label: 'Approved By',
    aliases: ['approved_by_name', 'approved_by', 'report_dashboard_approval', 'approval'],
  },
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
  // Who is working it. A report request is assigned to a person; a defect is
  // handed to the Service Desk, which is why this arrives with the report queue's
  // own column set rather than as one more column on the shared one.
  'assignedTo',
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

// The ladder, weakest first — the ORDER is the comparison, so anything appended
// here outranks everything before it.
//
// `manager` is a rank above admin, added for the reporting throughput page: it
// answers "may this person see the team's numbers, and not just their own"
// (plan.md §4 Phase 1, mockup 3). It is per application, like the others, and the
// super-user flag still outranks it everywhere.
//
// It is NOT the fourth role the plan ruled out. That question was about analysts,
// and its answer stands: an analyst is an admin grant narrowed to a request type
// (`user_application_roles.request_type`). Rank and type-scoping are different
// axes and they compose.
const APPLICATION_ROLES = ['viewer', 'admin', 'manager'];
const APPLICATION_ROLE_ADMIN = 'admin';
const APPLICATION_ROLE_VIEWER = 'viewer';
const APPLICATION_ROLE_MANAGER = 'manager';

// ── The ACCOUNT role (users.role) ────────────────────────────────────────────
// A different axis from the per-application roles above. This one is the door:
// whether an account may sign in at all, and whether it reaches the admin side.
// The per-application grants decide what it administers once inside.
//
//   'admin' — may sign in and may reach /api/admin/*, subject to its grants
//   'rep'   — may sign in and NOTHING else: files requests, tracks its own, and
//             is refused by ensureAdmin like any stranger. This is the seat SSO
//             will fill for everybody who is not on a triage team; it exists as
//             a local login now because a report request has to be attributable
//             to somebody before "only the person who filed it may see it" can
//             mean anything.
//
// Anything else cannot sign in. Keep this list closed: it is the allow-list, and
// a role that is merely unrecognised must fail closed rather than fall through.
const ACCOUNT_ROLE_ADMIN = 'admin';
const ACCOUNT_ROLE_REP = 'rep';
const ACCOUNT_ROLES_THAT_MAY_SIGN_IN = [ACCOUNT_ROLE_ADMIN, ACCOUNT_ROLE_REP];

/** May an account with this `users.role` sign in at all? */
function accountMaySignIn(role) {
  return ACCOUNT_ROLES_THAT_MAY_SIGN_IN.includes(String(role || '').trim().toLowerCase());
}

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
  'levels-of-effort': {
    table: 'levels_of_effort',
    modelName: 'LevelOfEffort',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'level_of_effort_id',
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
  ACCOUNT_ROLE_ADMIN,
  ACCOUNT_ROLE_REP,
  ACCOUNT_ROLES_THAT_MAY_SIGN_IN,
  accountMaySignIn,
  APPLICATION_ROLE_ADMIN,
  APPLICATION_ROLE_VIEWER,
  APPLICATION_ROLE_MANAGER,
  applicationRoleRank,
  applicationRoleAtLeast,
  LOOKUP_TABLES,
  SUBMISSION_TYPE_REPORT,
  REPORT_USAGE_FREQUENCIES,
  REPORT_REQUEST_STATUSES,
  REPORT_ONLY_STATUSES,
  REPORT_DELIVERED_STATUS,
  statusesForRequestType,
  DEFAULT_LEVELS_OF_EFFORT,
};
