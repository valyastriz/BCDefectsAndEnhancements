const { SUBMISSION_TO_CLEANUP_STATUS } = require('../constants');
const { parseErrorsJson } = require('./db');

/**
 * A money column as JSON should see it: a number, or null.
 *
 * The DECIMAL columns (policy_premium_impact, direct_dollar_impact) come back as
 * STRINGS on Postgres — `pg` returns `numeric` as text and Sequelize's Postgres
 * DECIMAL.parse passes it through to preserve precision — while SQLite hands back
 * a number. Coercing here is what keeps one JSON contract across both dialects,
 * so no client has to know which database it is talking to.
 *
 * Null and blank stay null rather than becoming 0: "no figure given" and "zero
 * dollars" are different answers, and the queue's impact totals must not count
 * the first as the second.
 */
function toMoneyNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapSubmission(row) {
  if (!row) return null;
  const resolvedStatus = row.model_status_name || row.status || 'New';
  const resolvedType = row.model_type_name || row.type || 'defect';
  const resolvedApplicationName = row.model_application_name || row.application_name || 'Billing Center';
  const resolvedCleanupStatus = row.model_cleanup_status_name || row.cleanup_status || null;
  const resolvedCleanupTagType = row.model_cleanup_tag_type_name || row.cleanup_tag_type || null;
  const resolvedEnhancementRequestType =
    row.model_enhancement_request_type_name || row.enhancement_request_type || null;
  const resolvedPriorityLevel = row.model_priority_level_name || row.priority_level || null;
  const resolvedCreatedVia = row.model_created_via_name || row.created_via || '';
  const isCleanup = Boolean(row.is_cleanup);
  const baseStatus = resolvedStatus;
  const isRetired = Boolean(row.is_retired) || String(baseStatus) === 'Retired';
  // Gated display value (null when is_cleanup=false); used for cleanup_status_display
  const cleanupStatusDisplay = isCleanup
    ? (resolvedCleanupStatus || SUBMISSION_TO_CLEANUP_STATUS[baseStatus] || 'Not Started')
    : null;

  return {
    ...row,
    type: resolvedType,
    application_name: resolvedApplicationName,
    status: baseStatus,
    defect_enhancement_status: baseStatus,
    is_public: Boolean(row.is_public),
    needs_workaround: Boolean(row.needs_workaround),
    workaround_provided: Boolean(row.workaround_provided),
    is_retired: isRetired,
    is_cleanup: isCleanup,
    // Always expose the stored name so the edit form can restore it after is_cleanup toggling
    cleanup_status: resolvedCleanupStatus,
    cleanup_status_display: cleanupStatusDisplay || 'No Cleanup',
    cleanup_tag_type: resolvedCleanupTagType,
    enhancement_request_type: resolvedEnhancementRequestType,
    priority_level: resolvedPriorityLevel,
    created_via: resolvedCreatedVia,
    is_resubmission: Boolean(row.is_resubmission),
    resubmission_of_submission_id: row.resubmission_of_submission_id || null,
    resubmission_of_easyvista_ticket_id: row.resubmission_of_easyvista_ticket_id || null,
    has_resubmission: Boolean(row.has_resubmission),
    latest_resubmission_submission_id: row.latest_resubmission_submission_id || null,
    latest_resubmission_easyvista_ticket_id: row.latest_resubmission_easyvista_ticket_id || null,
    occurrence_count: row.occurrence_count ?? null,
    occurrence_timeframe_count: row.occurrence_timeframe_count ?? null,
    occurrence_timeframe: row.model_occurrence_timeframe_name || row.occurrence_timeframe || null,
    occurrence_rate: row.occurrence_rate ?? null,

    // ── Recurrences ─────────────────────────────────────────────────────────
    // Aggregates, not the log: the rows themselves carry reporter names, notes
    // and policy numbers and are served only by the admin endpoint. Counts are
    // coerced because a column added by a migration reads back null on every row
    // that predates it, and the queue sorts on these — null would sort as its own
    // thing rather than as zero.
    recurrence_count: Number(row.recurrence_count || 0),
    last_recurrence_at: row.last_recurrence_at || null,
    recurrence_challenged: Boolean(row.recurrence_challenged),
    open_workaround_requests: Number(row.open_workaround_requests || 0),
    regression_of_submission_id: row.regression_of_submission_id || null,
    // Tri-state, so Boolean() would be wrong: 0 claimed, 1 confirmed, -1 rejected
    // on review. "Nobody has checked yet" and "we checked and it is not one" are
    // different answers and the banner says which.
    regression_claim_confirmed: Number(row.regression_claim_confirmed || 0),
    has_regression: Boolean(row.has_regression),
    latest_regression_submission_id: row.latest_regression_submission_id || null,
    rejection_reason: row.model_rejection_reason_name || row.rejection_reason || null,
    // DECIMAL arrives as a string on Postgres and a number on SQLite — see
    // toMoneyNumber. Neither field is on PUBLIC_SUBMISSION_FIELDS, so this only
    // ever shapes admin payloads.
    policy_premium_impact: toMoneyNumber(row.policy_premium_impact),
    direct_dollar_impact: toMoneyNumber(row.direct_dollar_impact),

    // ── Report requests ─────────────────────────────────────────────────────
    // `is_new_dashboard` stays TRI-STATE. Boolean() would turn "not a report
    // request" into "a change to an existing report", which is a different
    // answer, so null survives as null.
    is_new_dashboard: row.is_new_dashboard === null || row.is_new_dashboard === undefined
      ? null
      : Boolean(row.is_new_dashboard),
    level_of_effort: row.model_level_of_effort_name || row.level_of_effort || null,

    // DERIVED, never stored. The source field list had `Complete`, `Completed`
    // and `Complete Date` — three fields for one fact, which is three chances for
    // them to disagree. There is one timestamp, and these read off it.
    is_complete: Boolean(row.completed_at),
    // Approval needs BOTH a name and a date to count: a name with no date is
    // half-typed, not an approval.
    is_approved: Boolean(row.approved_at && row.approved_by_name),
  };
}

// Explicit allow-list of fields safe to expose on the public status board.
// Everything else (created_by_email, reviewer, decision_notes, impact_notes,
// dollar-impact figures, fingerprint, etc.) is intentionally withheld.
const PUBLIC_SUBMISSION_FIELDS = [
  'id',
  'type',
  'status',
  'summary_of_issue',
  'what_happened_exact_details',
  'request',
  'created_by',
  'application_name',
  'policy_num',
  'account_num',
  'easyvista_ticket_id',
  'jira_number',
  'created_at',
  'updated_at',
  'is_retired',
  'latest_status_changed_at',
  'latest_status_value',
  // The board's four-stop track needs a date under each stop reached. These are
  // derived timestamps, not new information — every one of them is already
  // implied by the status history the board renders. The last two belong to the
  // report-request track (Reported → Approved → In progress → Delivered), which
  // shares its first two stops with the defect one.
  'approved_status_at',
  'submitted_status_at',
  'deployed_status_at',
  'in_progress_status_at',
  'delivered_status_at',
  'duplicate_status_at',
  'retired_status_at',
  // ── Recurrences: the AGGREGATE only ─────────────────────────────────────
  // "11 people have reported this since 3 June" is itself a reason not to file
  // a duplicate, so the count belongs on the public surfaces. The LOG does not,
  // and must not be added here: its rows carry reporter names, free-text notes
  // and policy/account numbers, and it is served exclusively by
  // GET /api/admin/submissions/:id/recurrences behind ensureAdmin.
  //
  // `has_regression` rides along so the board can say "reported again after the
  // fix" — a fact about the ticket, carrying no reporter's name with it. The
  // pointer `latest_regression_submission_id` stays off: a ticket the reader may
  // not be allowed to see should not have its id advertised here.
  'recurrence_count',
  'last_recurrence_at',
  'has_regression',
];

function mapPublicSubmission(row) {
  const mapped = mapSubmission(row);
  if (!mapped) return null;
  const result = {};
  for (const field of PUBLIC_SUBMISSION_FIELDS) {
    if (mapped[field] !== undefined) result[field] = mapped[field];
  }
  return result;
}

function mapExcelImportRun(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    created_at: row.created_at,
    created_by: row.created_by || null,
    file_name: row.file_name || '',
    sheet_name: row.sheet_name || '',
    import_mode: row.import_mode || '',
    total_rows: Number(row.total_rows || 0),
    valid_rows: Number(row.valid_rows || 0),
    invalid_rows: Number(row.invalid_rows || 0),
    inserted_rows: Number(row.inserted_rows || 0),
    dry_run: Boolean(row.dry_run),
    status: row.status || 'partial',
    summary_message: row.summary_message || '',
    errors: parseErrorsJson(row.errors_json),
  };
}

function toExportCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value;
}

module.exports = {
  mapSubmission,
  mapPublicSubmission,
  mapExcelImportRun,
  toExportCellValue,
  toMoneyNumber,
};
