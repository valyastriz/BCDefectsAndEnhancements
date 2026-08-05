// ── Row/detail mapping utilities ────────────────────────────────────────────
import { RETIRED_STATUS, STATUS_TO_CLEANUP } from '../constants/adminConstants';

/**
 * Map an API detail response into an editable form object.
 */
export function editableFromDetail(detail) {
  if (!detail) return null;
  const cleanupTagType = detail.cleanup_tag_type || (detail.is_cleanup ? 'cleanup_only' : '');
  return {
    type: detail.type || 'defect',
    is_cleanup: Boolean(detail.is_cleanup),
    cleanup_status: detail.cleanup_status || STATUS_TO_CLEANUP[detail.status] || 'Not Started',
    cleanup_tag_type: cleanupTagType,
    // No invented fallback: every ticket has an application, and a wrong guess
    // here would silently retarget the ticket on the next save.
    application_name: detail.application_name || '',
    policy_num: detail.policy_num || '',
    account_num: detail.account_num || '',
    transaction_num: detail.transaction_num || '',
    screen_title: detail.screen_title || '',
    summary_of_issue: detail.summary_of_issue || '',
    steps_to_reproduce: detail.steps_to_reproduce || '',
    what_happened_exact_details: detail.what_happened_exact_details || '',
    request: detail.request || '',
    date_time_of_error: detail.date_time_of_error ? detail.date_time_of_error.slice(0, 16) : '',
    desired_completion_date: detail.desired_completion_date
      ? detail.desired_completion_date.slice(0, 10)
      : '',
    status: detail.status || 'New',
    reviewer: detail.reviewer || '',
    decision_notes: detail.decision_notes || '',
    fingerprint: detail.fingerprint || '',
    impact_details: detail.impact_details || '',
    impact_notes: detail.impact_notes || '',
    policy_premium_impact:
      detail.policy_premium_impact === null || detail.policy_premium_impact === undefined
        ? ''
        : String(detail.policy_premium_impact),
    direct_dollar_impact:
      detail.direct_dollar_impact === null || detail.direct_dollar_impact === undefined
        ? ''
        : String(detail.direct_dollar_impact),
    policies_affected_count:
      detail.policies_affected_count === null || detail.policies_affected_count === undefined
        ? ''
        : String(detail.policies_affected_count),
    occurrence_count:
      detail.occurrence_count === null || detail.occurrence_count === undefined
        ? ''
        : String(detail.occurrence_count),
    occurrence_timeframe_count:
      detail.occurrence_timeframe_count === null || detail.occurrence_timeframe_count === undefined
        ? ''
        : String(detail.occurrence_timeframe_count),
    occurrence_timeframe: detail.occurrence_timeframe || '',
    enhancement_request_type: detail.enhancement_request_type || '',
    priority_level: detail.priority_level || '3 - Medium',
    jira_number: detail.jira_number || '',
    easyvista_submitted_by: detail.easyvista_submitted_by || '',
    release_number: detail.release_number || '',
    release_notes: detail.release_notes || '',
    logged_defect: Boolean(detail.logged_defect),
    duplicate_of: detail.duplicate_reference || detail.duplicate_of || '',
    is_retired: Boolean(detail.is_retired),
    is_public: Boolean(detail.is_public),
    needs_workaround: Boolean(detail.needs_workaround),
    workaround_provided: Boolean(detail.workaround_provided),
  };
}

/**
 * Normalize an API row for consistent table display.
 */
export function normalizeAdminRow(row) {
  if (!row) return row;
  const isCleanup = Boolean(row.is_cleanup);
  const baseStatus = row.defect_enhancement_status || row.status || 'New';
  const isRetired = Boolean(row.is_retired) || String(baseStatus) === RETIRED_STATUS;
  const cleanupStatus = isCleanup
    ? (row.cleanup_status || STATUS_TO_CLEANUP[baseStatus] || 'Not Started')
    : null;

  return {
    ...row,
    status: baseStatus,
    defect_enhancement_status: baseStatus,
    is_retired: isRetired,
    is_cleanup: isCleanup,
    cleanup_status: cleanupStatus,
    cleanup_status_display: cleanupStatus || 'No Cleanup',
    is_resubmission: Boolean(row.is_resubmission),
    resubmission_of_submission_id: row.resubmission_of_submission_id || null,
    resubmission_of_easyvista_ticket_id: row.resubmission_of_easyvista_ticket_id || null,
    has_resubmission: Boolean(row.has_resubmission),
    latest_resubmission_submission_id: row.latest_resubmission_submission_id || null,
    latest_resubmission_easyvista_ticket_id: row.latest_resubmission_easyvista_ticket_id || null,
    needs_workaround: Boolean(row.needs_workaround),
    workaround_provided: Boolean(row.workaround_provided),
  };
}

/**
 * Determine the display type string for a row.
 */
export function inlineDisplayType(row) {
  if (!row) return 'defect';
  if (row.is_cleanup) {
    if (row.cleanup_tag_type === 'cleanup_only') return 'Cleanup Only';
    if (row.cleanup_tag_type === 'enhancement') return 'enhancement';
    if (row.cleanup_tag_type === 'defect') return 'defect';
    return 'Cleanup Only';
  }
  return row.type || 'defect';
}

/**
 * Build a PUT payload from an editable form object.
 */
export function buildAdminUpdatePayload(editValue) {
  if (!editValue) return null;
  return {
    ...editValue,
    is_retired: Boolean(editValue.is_retired),
    duplicate_of: editValue.duplicate_of,
    easyvista_submitted_by: editValue.easyvista_submitted_by,
    date_time_of_error: editValue.date_time_of_error || null,
    desired_completion_date: editValue.desired_completion_date || null,
  };
}

/**
 * Check whether the current modal edit differs from the saved detail.
 */
export function hasPendingModalChanges(detailValue, editValue) {
  if (!detailValue || !editValue) return false;
  const currentEdit = editableFromDetail(normalizeAdminRow(detailValue));
  const currentPayload = buildAdminUpdatePayload(currentEdit);
  const draftPayload = buildAdminUpdatePayload(editValue);
  return JSON.stringify(currentPayload) !== JSON.stringify(draftPayload);
}
