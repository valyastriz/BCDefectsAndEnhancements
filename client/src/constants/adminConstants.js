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
