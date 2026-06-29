// ── Admin dashboard constants ───────────────────────────────────────────────

export const RETIRED_STATUS = 'Retired';
export const CLEANUP_ONLY_STATUS = 'Cleanup Only';
export const CLEANUP_MARKED_STATUS = 'Cleanup Marked';

export const STATUS_TO_CLEANUP = {
  New: 'Not Started',
  Approved: 'In Progress',
  Submitted: 'In Progress',
  Deployed: 'Completed',
  Retired: 'Completed',
};

export const ADMIN_META_CATEGORIES = [
  { key: 'statuses', label: 'Defect/Enhancement Statuses', endpointCategory: 'statuses', optionsKey: 'statuses', supportsRetired: true },
  { key: 'types', label: 'Submission Types', endpointCategory: 'types', optionsKey: 'types', supportsRetired: false },
  { key: 'cleanupStatuses', label: 'Cleanup Statuses', endpointCategory: 'cleanup-statuses', optionsKey: 'cleanupStatuses', supportsRetired: false },
  { key: 'cleanupTagTypes', label: 'Cleanup Tag Types', endpointCategory: 'cleanup-tag-types', optionsKey: 'cleanupTagTypes', supportsRetired: false },
  { key: 'applications', label: 'Applications', endpointCategory: 'applications', optionsKey: 'applications', supportsRetired: false },
  { key: 'enhancementRequestTypes', label: 'Enhancement Request Types', endpointCategory: 'enhancement-request-types', optionsKey: 'enhancementRequestTypes', supportsRetired: false },
  { key: 'priorityLevels', label: 'Priority Levels', endpointCategory: 'priority-levels', optionsKey: 'priorityLevels', supportsRetired: false },
  { key: 'submissionSources', label: 'Submission Sources', endpointCategory: 'submission-sources', optionsKey: 'submissionSources', supportsRetired: false },
];

export const ADMIN_FILTERS_STORAGE_KEY = 'bc.admin.filters';
export const ADMIN_RETIRED_FILTER_STORAGE_KEY = 'bc.admin.retiredFilter';
// Local cache for the per-admin view (which columns/filters show + column order).
// The server is the source of truth; this just avoids a flash before it loads.
export const ADMIN_VIEW_PREFS_STORAGE_KEY = 'bc.admin.viewPrefs';

// ── Per-admin view registries ───────────────────────────────────────────────
// Canonical column registry for the admin submissions table. `key` is the stable
// identifier persisted in view preferences; `sortKey` maps into SORT_COLS (null =
// not sortable). Keep keys in sync with the server allow-list ADMIN_VIEW_COLUMN_KEYS
// (server/src/constants.js). Default view = every column visible, in this order.
export const ADMIN_TABLE_COLUMNS = [
  { key: 'reportedDate', label: 'Reported Date', sortKey: 'reportedDate' },
  { key: 'statusUpdate', label: 'Status Update', sortKey: 'statusUpdate' },
  { key: 'type', label: 'Type', sortKey: 'type' },
  { key: 'summary', label: 'Summary', sortKey: 'summary' },
  { key: 'status', label: 'Defect/Enhancement Status', sortKey: 'status' },
  { key: 'cleanupStatus', label: 'Cleanup Status', sortKey: null },
  { key: 'isPublic', label: 'Public', sortKey: 'isPublic' },
  { key: 'easyvista', label: 'EasyVista', sortKey: 'easyvista' },
  { key: 'jiraCard', label: 'JIRA Card #', sortKey: 'jiraCard' },
  { key: 'policyPremium', label: 'Policy Premium ($)', sortKey: 'policyPremium' },
  { key: 'directImpact', label: 'Direct Impact ($)', sortKey: 'directImpact' },
  { key: 'policiesImpacted', label: 'Policies Impacted', sortKey: 'policiesImpacted' },
  { key: 'frequency', label: 'Frequency', sortKey: 'frequency' },
];

// Canonical filter registry — keys match the filter fields in buildDefaultFilters()
// and the FiltersBar controls. Keep in sync with the server allow-list
// ADMIN_VIEW_FILTER_KEYS. Default view = every filter visible, in this order.
export const ADMIN_FILTER_FIELDS = [
  { key: 'statuses', label: 'Defect/Enhancement Status' },
  { key: 'retiredFilter', label: 'Retired' },
  { key: 'types', label: 'Type' },
  { key: 'cleanupRequired', label: 'Cleanup Required' },
  { key: 'cleanupStatuses', label: 'Cleanup Status' },
  { key: 'search', label: 'Search' },
  { key: 'requester', label: 'Requester' },
  { key: 'submittedBy', label: 'Submitted by (EasyVista)' },
  { key: 'createdVia', label: 'Created Via' },
  { key: 'year', label: 'Year' },
  { key: 'inJira', label: 'In JIRA' },
  { key: 'easyvistaNumber', label: 'EASYVISTA #' },
  { key: 'jiraNumber', label: 'JIRA #' },
  { key: 'releaseNumber', label: 'Release #' },
];

export const DEFAULT_VISIBLE_COLUMN_KEYS = ADMIN_TABLE_COLUMNS.map((c) => c.key);
export const DEFAULT_VISIBLE_FILTER_KEYS = ADMIN_FILTER_FIELDS.map((f) => f.key);

export const SORT_COLS = {
  reportedDate:     { asc: 'created_asc',                 desc: 'created_desc' },
  statusUpdate:     { asc: 'updated_asc',                 desc: 'updated_desc' },
  type:             { asc: 'type_asc',                    desc: 'type_desc' },
  requester:        { asc: 'requester_asc',               desc: 'requester_desc' },
  summary:          { asc: 'summary_asc',                 desc: 'summary_desc' },
  status:           { asc: 'status_asc',                  desc: 'status_desc' },
  isPublic:         { asc: 'public_asc',                  desc: 'public_desc' },
  inJira:           { asc: 'logged_defect_asc',           desc: 'logged_defect_desc' },
  jiraCard:         { asc: 'jira_number_asc',             desc: 'jira_number_desc' },
  releaseNum:       { asc: 'release_number_asc',          desc: 'release_number_desc' },
  policyPremium:    { asc: 'policy_premium_impact_asc',   desc: 'policy_premium_impact_desc' },
  directImpact:     { asc: 'direct_dollar_impact_asc',    desc: 'direct_dollar_impact_desc' },
  policiesImpacted: { asc: 'policies_affected_count_asc', desc: 'policies_affected_count_desc' },
  frequency:        { asc: 'frequency_asc',               desc: 'frequency_desc' },
  easyvista:        { asc: 'easyvista_asc',               desc: 'easyvista_desc' },
  submittedBy:      { asc: 'submitted_by_asc',            desc: 'submitted_by_desc' },
};
