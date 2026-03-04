// ── Default form state factories ────────────────────────────────────────────

/**
 * Return a fresh backdated-ticket form with sensible defaults.
 */
export function defaultBackdatedForm(defaultRequester = '') {
  return {
    created_via: 'admin_backdated',
    type: 'defect',
    status: 'New',
    is_cleanup: false,
    cleanup_status: 'New',
    created_by: String(defaultRequester || '').trim() || 'Admin',
    created_by_email: '',
    application_name: 'Billing Center',
    summary_of_issue: '',
    screen_title: '',
    request: '',
    impact_notes: '',
    policy_premium_impact: '',
    direct_dollar_impact: '',
    policies_affected_count: '',
    reported_at: '',
    desired_completion_date: '',
    jira_number: '',
    release_number: '',
    easyvista_ticket_id: '',
    easyvista_submitted_by: '',
    status_dates: {
      Approved: '',
      Rejected: '',
      Duplicate: '',
      Submitted: '',
      Deployed: '',
      Retired: '',
    },
  };
}

/**
 * Return a fresh cleanup-task form with sensible defaults.
 */
export function defaultCleanupForm(currentUser) {
  return {
    created_via: 'admin_cleanup',
    type: 'defect',
    is_cleanup: true,
    cleanup_status: 'New',
    cleanup_tag_type: 'cleanup_only',
    submit_to_easyvista: false,
    created_by: String(currentUser || '').trim() || 'Admin',
    created_by_email: '',
    application_name: 'Billing Center',
    summary_of_issue: '',
    description: '',
    what_happened_exact_details: '',
    screen_title: '',
    steps_to_reproduce: '',
    request: '',
    date_of_error: '',
    time_of_error: '',
    date_time_of_error: '',
    desired_completion_date: '',
    impact_details: '',
    enhancement_request_type: '',
    priority_level: '3 - Medium',
    impact_notes: '',
    policy_premium_impact: '',
    direct_dollar_impact: '',
    policies_affected_count: '',
    policy_num: '',
    account_num: '',
    transaction_num: '',
    jira_number: '',
    release_number: '',
    easyvista_ticket_id: '',
    easyvista_submitted_by: '',
  };
}
