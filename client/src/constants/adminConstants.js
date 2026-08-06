// ── Admin dashboard constants ───────────────────────────────────────────────

import { TRACKER_LABEL } from './tracker';

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

// Every list the Manage Metadata page can show, in the order it shows them.
//
// `feeds` names the surfaces the list actually drives. It is on the registry
// rather than written into the page because the page is the only reader, and a
// list added here without saying what it feeds is a list nobody can judge before
// changing. `readOnly` marks a list the app writes itself.
//
// Adding a list is one entry here plus its LOOKUP_TABLES row on the server
// (server/src/constants.js) — nothing else.
export const ADMIN_META_CATEGORIES = [
  {
    key: 'statuses',
    label: 'Defect/Enhancement Statuses',
    endpointCategory: 'statuses',
    optionsKey: 'statuses',
    supportsRetired: true,
    feeds: 'The Status column and Triage tab in the admin queue, the Status filter, and the four-stop track on the public board.',
    note: 'A switched-off status stays in the Status filter so admins can still find old tickets on it and move them somewhere current.',
  },
  {
    key: 'types',
    label: 'Submission Types',
    endpointCategory: 'types',
    optionsKey: 'types',
    supportsRetired: false,
    feeds: `The Defect / Enhancement choice on the submit form, and which fields the ${TRACKER_LABEL} hand-off requires.`,
  },
  {
    key: 'cleanupStatuses',
    label: 'Cleanup Statuses',
    endpointCategory: 'cleanup-statuses',
    optionsKey: 'cleanupStatuses',
    supportsRetired: false,
    feeds: 'The Cleanup Status column and its filter, for tickets tracked as cleanup work.',
  },
  {
    key: 'cleanupTagTypes',
    label: 'Cleanup Tag Types',
    endpointCategory: 'cleanup-tag-types',
    optionsKey: 'cleanupTagTypes',
    supportsRetired: false,
    feeds: `How a cleanup task is tagged once it is raised — set by the Add-a-ticket dialog and the ${TRACKER_LABEL} hand-off, not typed in.`,
  },
  {
    key: 'applications',
    label: 'Applications',
    endpointCategory: 'applications',
    optionsKey: 'applications',
    supportsRetired: false,
    feeds: 'Which queue a ticket belongs to — the submit form, the queue scope strip, redirect targets, and every per-application role on the Access page.',
    note: 'Adding an application here makes it available to grant on the Access page and to redirect tickets into.',
  },
  {
    key: 'enhancementRequestTypes',
    label: 'Enhancement Request Types',
    endpointCategory: 'enhancement-request-types',
    optionsKey: 'enhancementRequestTypes',
    supportsRetired: false,
    feeds: `The Request Type dropdown on enhancements — required before an enhancement can go to the ${TRACKER_LABEL}.`,
  },
  {
    key: 'priorityLevels',
    label: 'Priority Levels',
    endpointCategory: 'priority-levels',
    optionsKey: 'priorityLevels',
    supportsRetired: false,
    feeds: `The Priority dropdown on the Triage tab, and the priority sent with every ${TRACKER_LABEL} submission.`,
  },
  // Feeds a live dropdown but had no panel until this page was rebuilt, so nobody
  // could change it.
  {
    key: 'occurrenceTimeframes',
    label: 'Occurrence Timeframes',
    endpointCategory: 'occurrence-timeframes',
    optionsKey: 'occurrenceTimeframes',
    supportsRetired: false,
    feeds: 'The Time Frame dropdown on the Impact tab — the "per" in "40 times per week".',
  },
  {
    key: 'levelsOfEffort',
    label: 'Levels of Effort',
    endpointCategory: 'levels-of-effort',
    optionsKey: 'levelsOfEffort',
    supportsRetired: false,
    feeds: 'The Level of Effort dropdown on a report request’s Delivery tab — how big a piece of work an analyst judged it to be.',
  },
  {
    key: 'submissionSources',
    label: 'Submission Sources',
    endpointCategory: 'submission-sources',
    optionsKey: 'submissionSources',
    supportsRetired: false,
    readOnly: 'The app writes these itself when a ticket is created, so they are shown for reference rather than edited.',
    feeds: 'The Created Via column and filter — how each ticket got into the portal.',
  },
];

export const ADMIN_FILTERS_STORAGE_KEY = 'bc.admin.filters';
export const ADMIN_RETIRED_FILTER_STORAGE_KEY = 'bc.admin.retiredFilter';
// Local cache for the per-admin view (which columns/filters show + column order).
// The server is the source of truth; this just avoids a flash before it loads.
export const ADMIN_VIEW_PREFS_STORAGE_KEY = 'bc.admin.viewPrefs';

// ── Per-admin view registries ───────────────────────────────────────────────
// Canonical column registry for the admin submissions table. `key` is the stable
// identifier persisted in view preferences; `sortKey` maps into SORT_COLS (null =
// not sortable); `exportKey` is the export field this column shows, which is what
// lets the export dialog offer "what's on screen" as a real answer rather than a
// hardcoded list (null = the column has no single export field behind it). Keep
// keys in sync with the server allow-list ADMIN_VIEW_COLUMN_KEYS
// (server/src/constants.js). Default view = every column visible, in this order.
export const ADMIN_TABLE_COLUMNS = [
  { key: 'id', label: 'ID', sortKey: 'id', exportKey: 'id' },
  { key: 'reportedDate', label: 'Reported / Updated', sortKey: 'reportedDate', exportKey: 'created_at' },
  { key: 'statusUpdate', label: 'Status Update', sortKey: 'statusUpdate', exportKey: 'status_update_at' },
  { key: 'type', label: 'Type', sortKey: 'type', exportKey: 'type' },
  { key: 'summary', label: 'Summary', sortKey: 'summary', exportKey: 'summary_of_issue' },
  { key: 'status', label: 'Defect/Enhancement Status', sortKey: 'status', exportKey: 'status' },
  { key: 'cleanupStatus', label: 'Cleanup Status', sortKey: null, exportKey: 'cleanup_status' },
  { key: 'isPublic', label: 'Public', sortKey: 'isPublic', exportKey: 'is_public' },
  { key: 'easyvista', label: `${TRACKER_LABEL} #`, sortKey: 'easyvista', exportKey: 'easyvista_ticket_id' },
  { key: 'jiraCard', label: 'JIRA Card #', sortKey: 'jiraCard', exportKey: 'jira_number' },
  { key: 'policyPremium', label: 'Policy Premium ($)', sortKey: 'policyPremium', exportKey: 'policy_premium_impact' },
  { key: 'directImpact', label: 'Direct Impact ($)', sortKey: 'directImpact', exportKey: 'direct_dollar_impact' },
  { key: 'policiesImpacted', label: 'Policies Impacted', sortKey: 'policiesImpacted', exportKey: 'policies_affected_count' },
  { key: 'frequency', label: 'Frequency', sortKey: 'frequency', exportKey: 'occurrence_rate' },
  // Which application's queue a ticket belongs to. Off by default because the
  // summary cell already tags it — this is the dedicated column for anyone who
  // wants to scan a merged, multi-application queue by that alone.
  { key: 'application', label: 'Application', sortKey: null, exportKey: 'application_name' },
  // Who is working it. Only meaningful on a report request — a defect is handed
  // to the Service Desk rather than to a person — so it is off the default view
  // and on by default in the report queue's own set below.
  { key: 'assignedTo', label: 'Assigned To', sortKey: null, exportKey: 'assigned_to_name' },
];

/** The export fields behind a set of visible column keys, in registry order. */
export function exportKeysForColumns(columnKeys = []) {
  const visible = new Set(columnKeys);
  return ADMIN_TABLE_COLUMNS
    .filter((column) => visible.has(column.key) && column.exportKey)
    .map((column) => column.exportKey);
}

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
  { key: 'submittedBy', label: `Submitted by (${TRACKER_LABEL})` },
  { key: 'createdVia', label: 'Created Via' },
  { key: 'year', label: 'Year' },
  { key: 'inJira', label: 'In JIRA' },
  { key: 'workaround', label: 'Workaround' },
  { key: 'easyvistaNumber', label: `${TRACKER_LABEL} #` },
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
// The REPORT-REQUEST queue's own default set, and the reason the two queues do
// not share a saved view at all.
//
// Three of the defaults above are meaningless here and one is missing. A report
// request has no Service Desk number and no JIRA card — it is built in the portal,
// not handed downstream — and no cleanup status, because a cleanup is a defect
// with a flag. What it does have, and what nothing else has, is somebody it is
// assigned to. One saved view serving both kinds means customising either one
// spoils the other, so the server stores two.
export const DEFAULT_VISIBLE_REPORT_COLUMN_KEYS = [
  'id',
  'reportedDate',
  'summary',
  'status',
  'assignedTo',
  'isPublic',
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
  { key: 'easyvista', label: `${TRACKER_LABEL} #`, type: 'text' },
  { key: 'jiraCard', label: 'JIRA Card #', type: 'text' },
  { key: 'releaseNum', label: 'Release #', type: 'text' },
  { key: 'requester', label: 'Requester', type: 'text' },
  { key: 'submittedBy', label: `Submitted by (${TRACKER_LABEL})`, type: 'text' },
  { key: 'inJira', label: 'In JIRA', type: 'bool' },
  { key: 'policyPremium', label: 'Policy Premium ($)', type: 'number' },
  { key: 'directImpact', label: 'Direct Impact ($)', type: 'number' },
  { key: 'policiesImpacted', label: 'Policies Impacted', type: 'number' },
  { key: 'frequency', label: 'Frequency', type: 'number' },
];

// Direction wording per field type lives in utils/sortShared.js — the public
// status board sorts by the same rules, so the wording is shared rather than
// duplicated per surface.
