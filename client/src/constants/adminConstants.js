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

// Headline statuses on the whole-queue scope strip. Deliberately FIXED rather
// than derived from the data so the cards never reorder between loads; every
// other status is summed into the strip's expandable "other statuses" card.
export const SCOPE_STRIP_STATUSES = ['New', 'Approved', 'Submitted', 'Deployed'];

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
  { key: 'id', label: 'ID', sortKey: 'id' },
  { key: 'reportedDate', label: 'Reported / Updated', sortKey: 'reportedDate' },
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
  // Which application's queue a ticket belongs to. Off by default because the
  // summary cell already tags it — this is the dedicated column for anyone who
  // wants to scan a merged, multi-application queue by that alone.
  { key: 'application', label: 'Application', sortKey: null },
];

// Canonical filter registry — keys match the filter fields in buildDefaultFilters()
// and the FiltersBar controls. Keep in sync with the server allow-list
// ADMIN_VIEW_FILTER_KEYS. Default view = every filter visible, in this order.
export const ADMIN_FILTER_FIELDS = [
  { key: 'statuses', label: 'Defect/Enhancement Status' },
  { key: 'retiredFilter', label: 'Retired' },
  { key: 'application', label: 'Application' },
  { key: 'types', label: 'Type' },
  { key: 'cleanupRequired', label: 'Cleanup Required' },
  { key: 'cleanupStatuses', label: 'Cleanup Status' },
  { key: 'search', label: 'Search' },
  { key: 'requester', label: 'Requester' },
  { key: 'submittedBy', label: 'Submitted by (EasyVista)' },
  { key: 'createdVia', label: 'Created Via' },
  { key: 'year', label: 'Year' },
  { key: 'inJira', label: 'In JIRA' },
  { key: 'workaround', label: 'Workaround' },
  { key: 'easyvistaNumber', label: 'EASYVISTA #' },
  { key: 'jiraNumber', label: 'JIRA #' },
  { key: 'releaseNumber', label: 'Release #' },
];

// Every key the registries know about. These are the sanitize allow-lists for
// saved view preferences and MUST stay complete — the default visible sets below
// are deliberately smaller, and an admin's saved view may legitimately contain
// any registry key (a saved view holding `policyPremium` must survive a reload
// even though it is no longer a default column).
export const ALL_COLUMN_KEYS = ADMIN_TABLE_COLUMNS.map((c) => c.key);
export const ALL_FILTER_KEYS = ADMIN_FILTER_FIELDS.map((f) => f.key);

// Default visible columns for an admin who has never customized their view:
// identity, dates, the issue itself, and the four inline-editable fields. The
// read-only reporting columns (statusUpdate as its own column, the three money
// columns, frequency) stay available through Customize View. `reportedDate`
// renders both the reported and last-status-update dates in one cell.
export const DEFAULT_VISIBLE_COLUMN_KEYS = [
  'id',
  'reportedDate',
  'summary',
  'status',
  'cleanupStatus',
  'isPublic',
  'easyvista',
  'jiraCard',
];
export const DEFAULT_VISIBLE_FILTER_KEYS = ALL_FILTER_KEYS;

// ── Filter groups (drives the grouped filter panel) ─────────────────────────
// `search` and `retiredFilter` are intentionally absent: they live in the command
// row (a free-text search box and the Active/Retired/All scope control) because
// they are the most-used filter and the one that changes the meaning of every
// count on the page. Every other ADMIN_FILTER_FIELDS key appears exactly once
// here — a key missing from both places would be unreachable.
export const ADMIN_FILTER_GROUPS = [
  { key: 'ticket', label: 'Ticket', filterKeys: ['statuses', 'types', 'year', 'workaround'] },
  { key: 'cleanup', label: 'Cleanup', filterKeys: ['cleanupRequired', 'cleanupStatuses'] },
  { key: 'people', label: 'People & source', filterKeys: ['requester', 'submittedBy', 'createdVia'] },
  { key: 'refs', label: 'References', filterKeys: ['easyvistaNumber', 'jiraNumber', 'releaseNumber', 'inJira'] },
];

// Filters that render in the command row rather than the grouped panel.
// `application` joins them for the same reason `retiredFilter` is there: for
// someone who administers more than one application it is a scope, not a filter
// — it decides which queue you are looking at, so every count on the page means
// something different depending on it. It renders only when the caller can
// actually see more than one application.
export const COMMAND_ROW_FILTER_KEYS = ['search', 'retiredFilter', 'application'];

// The application-scope value meaning "tickets with no application set". Only a
// super user sees any, so only they are offered it. Mirrors
// UNASSIGNED_APPLICATION in server/src/constants.js.
export const UNASSIGNED_APPLICATION = '__unassigned__';

// What a PINNED scope of "every application" is stored as. The live filter uses
// '' for all applications, but a stored '' is indistinguishable from no pin at
// all — and those mean different things: one is a decision to see everything,
// the other is a blank slate that falls back to the home application.
export const ALL_APPLICATIONS_SCOPE = '__all__';

export const SORT_COLS = {
  id:               { asc: 'id_asc',                      desc: 'id_desc' },
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

// ── Sort registry (drives the header sort control) ───────────────────────────
// Sorting is deliberately NOT tied to which columns are visible: every sortable
// field is reachable here even when its column is hidden. `type` selects the
// direction wording — "Newest first" is meaningless for Summary — and mirrors the
// comparator the server uses for that field (compareText / compareNum /
// compareBool in server/src/services/submissionService.js). Keys index SORT_COLS.
export const SORT_FIELDS = [
  { key: 'statusUpdate', label: 'Last status update', type: 'date' },
  { key: 'reportedDate', label: 'Reported date', type: 'date' },
  { key: 'id', label: 'ID', type: 'number' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'summary', label: 'Summary', type: 'text' },
  { key: 'status', label: 'Defect/Enhancement Status', type: 'text' },
  { key: 'isPublic', label: 'Public', type: 'bool' },
  { key: 'easyvista', label: 'EasyVista', type: 'text' },
  { key: 'jiraCard', label: 'JIRA Card #', type: 'text' },
  { key: 'releaseNum', label: 'Release #', type: 'text' },
  { key: 'requester', label: 'Requester', type: 'text' },
  { key: 'submittedBy', label: 'Submitted by (EasyVista)', type: 'text' },
  { key: 'inJira', label: 'In JIRA', type: 'bool' },
  { key: 'policyPremium', label: 'Policy Premium ($)', type: 'number' },
  { key: 'directImpact', label: 'Direct Impact ($)', type: 'number' },
  { key: 'policiesImpacted', label: 'Policies Impacted', type: 'number' },
  { key: 'frequency', label: 'Frequency', type: 'number' },
];

// Direction wording per field type lives in utils/sortShared.js — the public
// status board sorts by the same rules, so the wording is shared rather than
// duplicated per surface.
