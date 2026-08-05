// ── Default form state factories ────────────────────────────────────────────

/** The status-timeline stops the Add-a-ticket dialog offers, in the order it shows
 *  them. Historical mode only: a new ticket has reached exactly one stop. */
export const ADD_TICKET_STATUS_STOPS = [
  'Approved',
  'Submitted',
  'Deployed',
  'Rejected',
  'Duplicate',
  'Retired',
];

/** What `created_via` a ticket added through the dialog is recorded as. New tickets
 *  are indistinguishable from a rep's in every other way, so the source is the only
 *  record that an admin typed it. */
export const ADD_TICKET_CREATED_VIA = {
  new: 'admin_manual',
  hist: 'admin_backdated',
};

/**
 * Return a fresh Add-a-ticket form.
 *
 * One factory for both modes and all three types: the dialog shows a subset of
 * these fields depending on mode/type/tag, and the fields it hides keep whatever
 * was typed into them, so flipping a segment and flipping back does not erase
 * work. Nothing outside the visible subset is ever sent (see buildAddTicketPayload).
 *
 * @param {string} defaultRequester - who to credit when the admin does not say
 * @param {string} defaultApplication - the application to preselect; the caller
 *   passes the first of its own lookup list rather than a hardcoded name.
 */
export function defaultAddTicketForm(defaultRequester = '', defaultApplication = '') {
  return {
    // Mode / type / tag — the three answers that reshape everything below.
    mode: 'new',
    type: 'defect',
    cleanup_tag_type: 'cleanup_only',
    submit_to_easyvista: false,

    created_via: ADD_TICKET_CREATED_VIA.new,
    status: 'New',
    cleanup_status: '',
    created_by: String(defaultRequester || '').trim() || 'Admin',
    created_by_email: '',
    application_name: String(defaultApplication || '').trim(),
    reported_at: '',

    summary_of_issue: '',
    description: '',

    // Defect branch
    screen_title: '',
    date_of_error: '',
    time_of_error: '',
    policy_num: '',
    account_num: '',
    transaction_num: '',
    what_happened_exact_details: '',
    steps_to_reproduce: '',

    // Enhancement branch
    request: '',
    enhancement_request_type: '',
    desired_completion_date: '',
    priority_level: '',
    impact_details: '',

    // Historical only — where the ticket already went
    easyvista_ticket_id: '',
    easyvista_submitted_by: '',
    jira_number: '',
    release_number: '',

    // Historical only — the dates it reached each stop
    status_dates: ADD_TICKET_STATUS_STOPS.reduce((acc, stop) => {
      acc[stop] = '';
      return acc;
    }, {}),

    // Impact figures the triage team would otherwise add later
    impact_notes: '',
    policy_premium_impact: '',
    direct_dollar_impact: '',
    policies_affected_count: '',
  };
}
