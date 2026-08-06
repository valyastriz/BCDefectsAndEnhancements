/**
 * Detail modal tab registry.
 *
 * Lives outside a component file because react-refresh/only-export-components
 * rejects non-constant exports (arrays/objects) alongside a component.
 */

export const DETAIL_TABS = {
  triage: 'triage',
  impact: 'impact',
  report: 'report',
  files: 'files',
  history: 'history',
  easyvista: 'easyvista',
  // Takes the sixth slot for a report request, where easyvista sits for every
  // other type — a report request is finished in the portal and never handed on.
  delivery: 'delivery',
};

/**
 * Which tab owns each label produced by `easyVistaMissingRequirements`
 * (useDetailModal), so a blocked send can flag the tab holding the empty field
 * instead of leaving the admin to hunt for it.
 */
export const EASYVISTA_REQUIREMENT_SECTION = {
  'Impact Details': DETAIL_TABS.impact,
  'Request Type': DETAIL_TABS.impact,
  'Desired Completion Date': DETAIL_TABS.impact,
  'Summary of Issue': DETAIL_TABS.report,
  'Screen Title': DETAIL_TABS.report,
  Description: DETAIL_TABS.report,
};

/** The `edit` key each requirement label refers to, so the field can be flagged. */
export const EASYVISTA_REQUIREMENT_FIELD = {
  'Impact Details': 'impact_details',
  'Request Type': 'enhancement_request_type',
  'Desired Completion Date': 'desired_completion_date',
  'Summary of Issue': 'summary_of_issue',
  'Screen Title': 'screen_title',
  Description: 'what_happened_exact_details',
};

/** Label → the control's own label in the modal, for the blocked-field editors. */
export const EASYVISTA_REQUIREMENT_LABEL = {
  'Impact Details': 'Impact Details',
  'Request Type': 'Request Type',
  'Desired Completion Date': 'Desired Completion Date',
  'Summary of Issue': 'Summary',
  'Screen Title': 'Screen Title',
  Description: 'Exact Details / What Happened',
};
