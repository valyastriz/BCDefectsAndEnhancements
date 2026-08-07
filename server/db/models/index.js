const { DataTypes, Op } = require('sequelize');

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
  'Retired',
  // The report-request words. One status table for every request type — which
  // set a type may hold is `statusesForRequestType` in src/constants.js, and
  // these three belong to report requests alone. Appended so seedLookup gives
  // them sort orders after every existing value.
  'In progress',
  'Delivered',
  'On hold',
];

// Kept in step with src/constants.js DEFAULT_SUBMISSION_TYPES, which this file
// deliberately does not import (db/ has no dependency on src/).
const DEFAULT_SUBMISSION_TYPES = ['defect', 'enhancement', 'report'];
const DEFAULT_LEVELS_OF_EFFORT = [
  'S — up to 2 days',
  'M — up to a week',
  'L — up to a month',
  'XL — more than a month',
];
const DEFAULT_CLEANUP_STATUSES = ['Not Started', 'In Progress', 'Completed'];
const DEFAULT_CLEANUP_TAG_TYPES = ['defect', 'enhancement', 'cleanup_only'];
const DEFAULT_APPLICATIONS = ['Billing Center', 'Policy Center'];
const DEFAULT_ENHANCEMENT_REQUEST_TYPES = [
  'Build-PPM Funded Project',
  'Build-Small Enhancement',
  'Build-Small Project (Not PPM Funded)',
  'Run-Compliance/Regulatory/Rate Revision',
  'Run-Other Operational Work',
];
const DEFAULT_PRIORITY_LEVELS = ['1 - Urgent', '2 - High', '3 - Medium', '4 - Low'];
const DEFAULT_SUBMISSION_SOURCES = [
  'rep_form',
  'admin_backdated',
  'admin_cleanup',
  'admin_excel_import',
  'admin_manual',
  'admin_easyvista_resubmission',
];
const DEFAULT_OCCURRENCE_TIMEFRAMES = ['Day', 'Week', 'Month', 'Quarter', 'Year'];

function defineModels(sequelize) {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    // Kept as-is: the existing admin login reads it (routes/authRoutes.js), so
    // leaving it alone means no seeded account or live session breaks. Triage
    // rights now come from user_application_roles + is_super_user instead.
    role: { type: DataTypes.STRING, allowNull: false },
    // The identity provider's stable key for this person (Active Directory
    // objectGUID or UPN) — what SSO upserts against, so a person keeps their
    // history through a name or email change. Nullable because today's accounts
    // are local-only.
    //
    // Deliberately NOT `unique: true` here even though it must be unique: SQLite
    // cannot ALTER TABLE ... ADD COLUMN ... UNIQUE, so declaring it on the model
    // makes the migration fail outright on the local/sqljs path ("Cannot add a
    // UNIQUE column") while succeeding on Postgres. The uniqueness is created as
    // a raw CREATE UNIQUE INDEX instead — see RAW_UNIQUE_INDEXES.
    external_id: { type: DataTypes.TEXT, allowNull: true },
    display_name: { type: DataTypes.TEXT },
    email: { type: DataTypes.TEXT },
    // Sees every application's queue. Deliberately a column rather than a role
    // string so the fail-closed scoping has exactly one bypass to audit.
    is_super_user: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { tableName: 'users', timestamps: false });

  const AdminViewPreference = sequelize.define('AdminViewPreference', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    columns_json: { type: DataTypes.TEXT }, // JSON: ordered array of visible column keys
    filters_json: { type: DataTypes.TEXT }, // JSON: array of visible filter keys
    // The application queue this admin PINNED as their default, by name — or the
    // "all applications" sentinel. Distinct from the two above, which record
    // which controls are visible rather than what they are set to.
    //
    // A pin, deliberately, not a memory of the last selection: switching scope to
    // glance at another team's queue should not silently rewrite where you land
    // tomorrow. Empty/absent means "no pin", and the client falls back to the
    // home application.
    pinned_application: { type: DataTypes.TEXT },
    updated_at: { type: DataTypes.TEXT },
  }, { tableName: 'admin_view_preferences', timestamps: false });

  const Submission = sequelize.define('Submission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    created_at: { type: DataTypes.TEXT, allowNull: false },
    updated_at: { type: DataTypes.TEXT, allowNull: false },
    created_via_id: { type: DataTypes.INTEGER, allowNull: true },
    created_by: { type: DataTypes.TEXT, allowNull: false },
    created_by_email: { type: DataTypes.TEXT, allowNull: false },
    // The reporter, by id. This is what "my reports" resolves against — never
    // the free-text `created_by` above, because a rename or a typo would
    // silently unlink someone's whole history and two people share a name.
    // Null on every historic row and on anything filed without a session: those
    // tickets belong to nobody, which is the truth rather than a guess.
    reporter_user_id: { type: DataTypes.INTEGER, allowNull: true },
    type_id: { type: DataTypes.INTEGER, allowNull: true },
    // The application whose queue owns triage RIGHT NOW. A redirect moves this;
    // submission_routings is the ledger of who held it before.
    application_id: { type: DataTypes.INTEGER, allowNull: true },
    // What the EasyVista incident was actually raised under, snapshotted at send
    // time. Deliberately NOT derived from application_id, because a redirect
    // after the send would then silently rewrite what was transmitted. Null
    // until a send happens.
    easyvista_application_id: { type: DataTypes.INTEGER, allowNull: true },
    policy_num: { type: DataTypes.TEXT },
    account_num: { type: DataTypes.TEXT },
    transaction_num: { type: DataTypes.TEXT },
    screen_title: { type: DataTypes.TEXT, allowNull: false },
    summary_of_issue: { type: DataTypes.TEXT, allowNull: false },
    steps_to_reproduce: { type: DataTypes.TEXT, allowNull: false },
    what_happened_exact_details: { type: DataTypes.TEXT, allowNull: false },
    request: { type: DataTypes.TEXT, allowNull: false },
    date_time_of_error: { type: DataTypes.TEXT, allowNull: false },
    status_id: { type: DataTypes.INTEGER, allowNull: true },
    reviewer: { type: DataTypes.TEXT },
    decision_notes: { type: DataTypes.TEXT },
    fingerprint: { type: DataTypes.TEXT },
    duplicate_reference: { type: DataTypes.TEXT },
    duplicate_of: { type: DataTypes.INTEGER },
    easyvista_ticket_id: { type: DataTypes.TEXT },
    desired_completion_date: { type: DataTypes.TEXT },
    impact_details: { type: DataTypes.TEXT },
    impact_notes: { type: DataTypes.TEXT },
    // Money. DECIMAL, deliberately, not REAL — and the distinction is not
    // academic: Sequelize's REAL is single-precision (float4) on Postgres, about
    // seven significant digits, so the STORED value was wrong:
    //
    //     1234567.89  ->  1234567.875          (displays as $1,234,567.88)
    //       99999.99  ->  99999.9921875
    //           0.07  ->  0.07000000029802322
    //
    // SQLite's REAL is a double, which is why this never reproduced locally and
    // only ever damaged the hosted data. The export writes these values straight
    // into a spreadsheet, so the damage was visible there as well as a cent adrift
    // on screen.
    //
    // Cost of the change: `pg` returns `numeric` as a STRING, and Sequelize's
    // Postgres DECIMAL.parse passes it through unchanged. `mapSubmission`
    // (helpers/mappers.js) coerces both back to numbers so the JSON contract
    // stays numeric on every dialect — every submission response and socket
    // payload goes through that one mapper, so that is the only place it is
    // needed. Do not read these columns around it.
    policy_premium_impact: { type: DataTypes.DECIMAL(14, 2) },
    direct_dollar_impact: { type: DataTypes.DECIMAL(14, 2) },
    policies_affected_count: { type: DataTypes.INTEGER },
    logged_defect: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Raised by the rep on the submit form: they are blocked now and need a
    // workaround ahead of the developer queue. Two columns rather than one so
    // handling the request does not erase the fact that it was made —
    // `needs_workaround` is the rep's ask, `workaround_provided` is the team
    // closing it out. "Open request" therefore means the first without the
    // second.
    needs_workaround: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    workaround_provided: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    enhancement_request_type_id: { type: DataTypes.INTEGER, allowNull: true },
    priority_level_id: { type: DataTypes.INTEGER, allowNull: true },
    jira_number: { type: DataTypes.TEXT },
    release_number: { type: DataTypes.TEXT },
    release_notes: { type: DataTypes.TEXT },
    // What was actually delivered, in the analyst's words. The report-request
    // counterpart to release_notes, which is deploy language a report request
    // never uses — nothing ships, so there is no release to note.
    delivery_notes: { type: DataTypes.TEXT },
    is_cleanup: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    cleanup_status_id: { type: DataTypes.INTEGER, allowNull: true },
    cleanup_tag_type_id: { type: DataTypes.INTEGER, allowNull: true },
    easyvista_submitted_by: { type: DataTypes.TEXT },
    is_resubmission: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    resubmission_of_submission_id: { type: DataTypes.INTEGER },
    resubmission_of_easyvista_ticket_id: { type: DataTypes.TEXT },
    has_resubmission: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    latest_resubmission_submission_id: { type: DataTypes.INTEGER },
    latest_resubmission_easyvista_ticket_id: { type: DataTypes.TEXT },
    is_retired: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_public: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    occurrence_count: { type: DataTypes.INTEGER, allowNull: true },
    occurrence_timeframe_count: { type: DataTypes.INTEGER, allowNull: true },
    occurrence_timeframe_id: { type: DataTypes.INTEGER, allowNull: true },
    occurrence_rate: { type: DataTypes.REAL, allowNull: true },

    // ── Report requests (plan.md §4 Phase 1) ────────────────────────────────
    // Every one of these is nullable and null on every existing row, so the
    // migration cannot change what any current ticket means.
    //
    // Plain columns on purpose, not a JSON blob and not an EAV table: the
    // confirmed field list is a SAMPLE and will move, so adding a field has to
    // stay a one-line migration plus a form control. An EAV design buys
    // flexibility nobody asked for and makes every read worse.
    //
    // Three of the requester's fields are NOT here because they already have a
    // column: Title is `summary_of_issue`, Description is
    // `what_happened_exact_details` (which the import layer already labels
    // "Description"), "what's not working" is `request`, and Requested
    // Implementation Date is `desired_completion_date`. A second column for any
    // of them would be the same defect the source list has, where Complete,
    // Completed and Complete Date are three fields for one fact.

    // Requester's half.
    is_new_dashboard: { type: DataTypes.INTEGER, allowNull: true },
    needed_data: { type: DataTypes.TEXT, allowNull: true },
    measures_and_sources: { type: DataTypes.TEXT, allowNull: true },
    primary_contact: { type: DataTypes.TEXT, allowNull: true },
    // Where to find the report a change is being asked for. Takes a link or, when
    // there is no link, wherever the requester opens it from.
    existing_report_link: { type: DataTypes.TEXT, allowNull: true },
    changes_requested: { type: DataTypes.TEXT, allowNull: true },
    report_usage_frequency: { type: DataTypes.TEXT, allowNull: true },
    department: { type: DataTypes.TEXT, allowNull: true },

    // Analyst's half.
    // A user id, never a name: a rename must not silently unlink someone's work.
    assigned_to: { type: DataTypes.INTEGER, allowNull: true },
    level_of_effort_id: { type: DataTypes.INTEGER, allowNull: true },
    // ONE timestamp. `Complete` and `Completed` are derived from it and are not
    // stored — see mapSubmission.
    completed_at: { type: DataTypes.TEXT, allowNull: true },
    // Who said go, and when. The approver is a NAME rather than an id because
    // they are usually not a portal user — a manager who replied to an email —
    // so there is no id to hold. The accountability is `approval_recorded_by`,
    // which IS an id and is filled in by the server, never by the client: a typed
    // name with nobody behind it is a claim, not a record.
    approved_at: { type: DataTypes.TEXT, allowNull: true },
    approved_by_name: { type: DataTypes.TEXT, allowNull: true },
    approval_recorded_by: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'submissions',
    timestamps: false,
    indexes: [
      { name: 'idx_submissions_status_id', fields: ['status_id'] },
      { name: 'idx_submissions_type_id', fields: ['type_id'] },
      { name: 'idx_submissions_public', fields: ['is_public'] },
      // Both added for the scoping queries: every admin read now filters by the
      // applications the caller administers, and "my reports" filters by reporter.
      { name: 'idx_submissions_application_id', fields: ['application_id'] },
      { name: 'idx_submissions_reporter_user_id', fields: ['reporter_user_id'] },
      // Both added for the throughput page: it groups by assignee and windows by
      // completion date, and neither is a column the queue ever filtered on.
      { name: 'idx_submissions_assigned_to', fields: ['assigned_to'] },
      { name: 'idx_submissions_completed_at', fields: ['completed_at'] },
    ],
  });

  const Attachment = sequelize.define('Attachment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    submission_id: { type: DataTypes.INTEGER, allowNull: false },
    filename: { type: DataTypes.TEXT, allowNull: false },
    mime_type: { type: DataTypes.TEXT, allowNull: false },
    file_path: { type: DataTypes.TEXT, allowNull: false },
    uploaded_at: { type: DataTypes.TEXT, allowNull: false },
    uploaded_by_role: { type: DataTypes.TEXT, allowNull: false },
    // What this file IS, when it is not a screenshot. Null on every existing row
    // and on every screenshot, so the Files tab keeps behaving exactly as it
    // does; 'approval' marks the evidence behind a report request's go-ahead,
    // which the Delivery pane lists separately.
    //
    // One nullable column on the table screenshots already use, rather than a
    // second attachments table: one upload path, one delete path, one storage
    // helper. Adding another purpose later stays a one-word change.
    purpose: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'attachments',
    timestamps: false,
    indexes: [{ name: 'idx_attachments_submission_id', fields: ['submission_id'] }],
  });

  const SubmissionStatusEvent = sequelize.define('SubmissionStatusEvent', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    submission_id: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false },
    changed_at: { type: DataTypes.TEXT, allowNull: false },
    changed_by: { type: DataTypes.TEXT },
  }, {
    tableName: 'submission_status_events',
    timestamps: false,
    indexes: [
      { name: 'idx_status_events_submission_id', fields: ['submission_id'] },
      { name: 'idx_status_events_status', fields: ['status'] },
    ],
  });

  // One vector per (submission, scope) for AI semantic search. Vectors are
  // stored as a JSON float array in a TEXT column so this works identically on
  // SQLite (local) and Postgres (prod) with no pgvector dependency. content_hash
  // lets the indexer skip re-embedding when the source text is unchanged.
  const SubmissionEmbedding = sequelize.define('SubmissionEmbedding', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    submission_id: { type: DataTypes.INTEGER, allowNull: false },
    scope: { type: DataTypes.TEXT, allowNull: false }, // 'admin' | 'public'
    model: { type: DataTypes.TEXT, allowNull: false },
    content_hash: { type: DataTypes.TEXT, allowNull: false },
    vector: { type: DataTypes.TEXT, allowNull: false }, // JSON: array of floats
    updated_at: { type: DataTypes.TEXT, allowNull: false },
  }, {
    tableName: 'submission_embeddings',
    timestamps: false,
    // The (submission_id, scope) uniqueness is intentionally NOT a model
    // `unique: true` index. On SQLite, sync({ alter: true }) rebuilds this table
    // on every run and, reading a composite unique index back via describeTable,
    // mis-derives it into spurious standalone UNIQUE constraints on the
    // individual columns (submission_id AND scope) — which rejects the intended
    // second scope row and breaks the two-rows-per-ticket design. So this table
    // is synced WITHOUT alter (see migrateWithModels) and its composite
    // uniqueness is created with a raw, dialect-portable CREATE UNIQUE INDEX IF
    // NOT EXISTS (see ensureEmbeddingUniqueIndex). Keep the non-unique scope
    // index here.
    indexes: [
      { name: 'idx_submission_embeddings_scope', fields: ['scope'] },
    ],
  });

  const ExcelImportRun = sequelize.define('ExcelImportRun', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    created_at: { type: DataTypes.TEXT, allowNull: false },
    created_by: { type: DataTypes.TEXT },
    file_name: { type: DataTypes.TEXT, allowNull: false },
    sheet_name: { type: DataTypes.TEXT },
    import_mode: { type: DataTypes.TEXT, allowNull: false },
    total_rows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    valid_rows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    invalid_rows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    inserted_rows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    dry_run: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.TEXT, allowNull: false },
    summary_message: { type: DataTypes.TEXT },
    errors_json: { type: DataTypes.TEXT },
  }, {
    tableName: 'excel_import_runs',
    timestamps: false,
    indexes: [{ name: 'idx_excel_import_runs_created_at', fields: ['created_at'] }],
  });

  const DefectEnhancementStatus = sequelize.define('DefectEnhancementStatus', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_retired: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'defect_enhancement_statuses', timestamps: false });

  const SubmissionType = sequelize.define('SubmissionType', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'submission_types', timestamps: false });

  const CleanupStatus = sequelize.define('CleanupStatus', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'cleanup_statuses', timestamps: false });

  const CleanupTagType = sequelize.define('CleanupTagType', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'cleanup_tag_types', timestamps: false });

  const Application = sequelize.define('Application', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // Which EasyVista catalog THIS application's tickets are raised in.
    //
    // Per application, not global, because the outbound payload's repurposed
    // field names (helpers/easyVistaPayload.js) belong to one specific catalog.
    // With a single global catalog, adding an application through Manage
    // Metadata gave it a queue, access and a board lane while its tickets would
    // have posted silently into the first application's catalog. Absent means
    // NOT CONFIGURED, and the send is refused rather than misrouted.
    easyvista_catalog_guid: { type: DataTypes.TEXT },
    easyvista_catalog_code: { type: DataTypes.TEXT },
    // This application takes REPORT REQUESTS ONLY, and a reporting analyst created
    // it by typing a name in.
    //
    // Why a column and not a convention: an application is a queue, and the submit
    // form offers it. Without a flag, a rep filing a DEFECT could pick "Marketing
    // Analytics" — a system the portal does not otherwise track — and the ticket
    // would land in a queue with no defect admins, visible to nobody who could work
    // it. The flag is what keeps it off the defect and enhancement pickers, and the
    // endpoints refuse the combination rather than trusting the client to.
    //
    // 0 on every application that existed before this, so nothing changes for them:
    // Billing Center and Policy Center take every type, and so does `Other`.
    reports_only: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { tableName: 'applications', timestamps: false });

  const EnhancementRequestType = sequelize.define('EnhancementRequestType', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'enhancement_request_types', timestamps: false });

  const PriorityLevel = sequelize.define('PriorityLevel', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'priority_levels', timestamps: false });

  const SubmissionSource = sequelize.define('SubmissionSource', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'submission_sources', timestamps: false });

  const OccurrenceTimeframe = sequelize.define('OccurrenceTimeframe', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    days_equivalent: { type: DataTypes.REAL, allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'occurrence_timeframes', timestamps: false });

  const LevelOfEffort = sequelize.define('LevelOfEffort', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, { tableName: 'levels_of_effort', timestamps: false });

  // ── Report request delivery ───────────────────────────────────────────────
  // Analyst hours, one row per sitting.
  //
  // NOT a column on submissions, and the distinction is the whole design: hours
  // accumulate across sittings AND across people, so a single number would be
  // overwritten by whoever saved last, and "who actually did the work" would be
  // unanswerable. `Duration` on a request is SUM(hours) computed on read — it
  // cannot drift from these rows because it IS these rows.
  //
  // No unique constraint: many rows per submission is the point, and one person
  // can legitimately log twice on the same day.
  const RequestTimeEntry = sequelize.define('RequestTimeEntry', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    submission_id: { type: DataTypes.INTEGER, allowNull: false },
    // Whose hours these are. This is what the throughput page groups by, so it
    // is an id: crediting work to a typed name would break on a rename.
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    // DECIMAL for the same reason money is. This project has already had
    // single-precision float silently corrupt stored values on the hosted
    // database (see plan.md, "Money columns were single-precision floats") — 7.5
    // is no safer than 7.55, and these numbers get summed.
    hours: { type: DataTypes.DECIMAL(6, 2), allowNull: false },
    // The day the work happened, not the day it was typed in. An analyst
    // catching up on Friday for Tuesday's work belongs in Tuesday, and the
    // throughput page windows on this.
    worked_on: { type: DataTypes.TEXT, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.TEXT, allowNull: false },
  }, {
    tableName: 'request_time_entries',
    timestamps: false,
    indexes: [
      { name: 'idx_request_time_entries_submission_id', fields: ['submission_id'] },
      { name: 'idx_request_time_entries_user_id', fields: ['user_id'] },
      { name: 'idx_request_time_entries_worked_on', fields: ['worked_on'] },
    ],
  });

  // Who has held a request, and who moved it.
  //
  // `submissions.assigned_to` is the CURRENT holder — cheap to query and to index
  // for "my queue". This is the audit trail, and it cannot be reconstructed after
  // the fact, which is why it ships with the feature rather than later. Without
  // it, reassignment silently erases everyone who held a request before the last
  // person.
  const RequestAssignment = sequelize.define('RequestAssignment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    submission_id: { type: DataTypes.INTEGER, allowNull: false },
    // Null records an UNASSIGNMENT — someone taking the request off a person
    // without giving it to another — which is a real event and not the absence
    // of one.
    assigned_to: { type: DataTypes.INTEGER, allowNull: true },
    assigned_by: { type: DataTypes.INTEGER, allowNull: true },
    assigned_at: { type: DataTypes.TEXT, allowNull: false },
  }, {
    tableName: 'request_assignments',
    timestamps: false,
    indexes: [
      { name: 'idx_request_assignments_submission_id', fields: ['submission_id'] },
      { name: 'idx_request_assignments_assigned_to', fields: ['assigned_to'] },
    ],
  });

  // ── Access control ────────────────────────────────────────────────────────
  // Triage rights are per application: a row here is a grant, and NO ROW IS NO
  // ACCESS. The admin queue fails closed on that — an admin with no rows sees no
  // tickets, never all of them.
  //
  // The (user_id, application_id) uniqueness is created as a raw composite index
  // by ensureCompositeUniqueIndexes, NOT as a model-level composite `unique`.
  // On SQLite, sync({ alter: true }) reads a composite unique index back through
  // describeTable and mis-derives it into standalone per-column UNIQUE
  // constraints — which here would mean UNIQUE(user_id), i.e. one application per
  // admin for ever. Same trap already documented on SubmissionEmbedding.
  const UserApplicationRole = sequelize.define('UserApplicationRole', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    application_id: { type: DataTypes.INTEGER, allowNull: false },
    role: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'admin' },
    // Which request type this grant covers. '' means EVERY type, so every row
    // that exists today keeps working untouched and the migration changes nobody's
    // access. An analyst is simply an admin grant narrowed to one type
    // (plan.md §4 open question 4) — one table, additive, no second place to ask
    // the same question.
    //
    // '' RATHER THAN NULL, deliberately. The uniqueness below is now
    // (user_id, application_id, request_type), and both SQLite and Postgres treat
    // NULLs in a unique index as distinct from each other — so a nullable column
    // here would let the same person hold two conflicting all-types grants on one
    // application and silently lose the guarantee the index exists for.
    //
    // Read only through roleInApplication / canMutateApplication. Nothing else
    // should be interpreting this column.
    request_type: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    granted_at: { type: DataTypes.TEXT, allowNull: false },
    granted_by: { type: DataTypes.TEXT },
  }, {
    tableName: 'user_application_roles',
    timestamps: false,
    indexes: [
      { name: 'idx_user_application_roles_user_id', fields: ['user_id'] },
      { name: 'idx_user_application_roles_application_id', fields: ['application_id'] },
    ],
  });

  // Maps an Active Directory group to an application role. Where a mapping
  // exists it wins over a hand-set user_application_roles row, so access follows
  // someone changing team instead of relying on a human remembering to revoke
  // it. Empty until the AD group names are known; the app works without it.
  //
  // (application_id, group_name) uniqueness: raw composite index, same reason.
  const ApplicationAdGroup = sequelize.define('ApplicationAdGroup', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    application_id: { type: DataTypes.INTEGER, allowNull: false },
    group_name: { type: DataTypes.TEXT, allowNull: false },
    role: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'admin' },
    is_active: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  }, {
    tableName: 'application_ad_groups',
    timestamps: false,
    indexes: [
      { name: 'idx_application_ad_groups_application_id', fields: ['application_id'] },
      { name: 'idx_application_ad_groups_group_name', fields: ['group_name'] },
    ],
  });

  // ── Routing ledger ────────────────────────────────────────────────────────
  // One row per hand-off of a ticket between application queues. The submission
  // itself MOVES (its application_id and status change) — it is never copied,
  // because a copy would give the reporter two tickets for one problem. This
  // table is the record of who held it when, and it is what lets a past owner
  // still SEE a ticket they handed on while being unable to change it.
  //
  // No unique constraint: many rows per submission is the whole point, and a
  // ticket may legitimately come back (A → B → A).
  const SubmissionRouting = sequelize.define('SubmissionRouting', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    submission_id: { type: DataTypes.INTEGER, allowNull: false },
    // Null marks the original filing rather than a hand-off, so the ledger reads
    // as a complete custody chain instead of starting mid-story.
    from_application_id: { type: DataTypes.INTEGER, allowNull: true },
    to_application_id: { type: DataTypes.INTEGER, allowNull: false },
    // The status the ticket was in at the moment it moved. Preserved because the
    // move resets the live status to New, and the losing team still needs to see
    // "it was Approved when you sent it".
    status_at_handoff: { type: DataTypes.TEXT },
    // Optional note to the receiving admin. Immutable once written — it records
    // what someone said when they said it, not a scratchpad. INTERNAL: never
    // added to PUBLIC_SUBMISSION_FIELDS and never sent to the public AI summary.
    note: { type: DataTypes.TEXT },
    routed_at: { type: DataTypes.TEXT, allowNull: false },
    routed_by: { type: DataTypes.TEXT },
  }, {
    tableName: 'submission_routings',
    timestamps: false,
    indexes: [
      { name: 'idx_submission_routings_submission_id', fields: ['submission_id'] },
      // Drives "tickets my queue handed on", which is how a past owner still
      // sees them.
      { name: 'idx_submission_routings_from_application_id', fields: ['from_application_id'] },
      { name: 'idx_submission_routings_to_application_id', fields: ['to_application_id'] },
    ],
  });

  return {
    User,
    AdminViewPreference,
    Submission,
    Attachment,
    SubmissionStatusEvent,
    SubmissionEmbedding,
    ExcelImportRun,
    DefectEnhancementStatus,
    SubmissionType,
    CleanupStatus,
    CleanupTagType,
    Application,
    EnhancementRequestType,
    PriorityLevel,
    SubmissionSource,
    OccurrenceTimeframe,
    LevelOfEffort,
    RequestTimeEntry,
    RequestAssignment,
    UserApplicationRole,
    ApplicationAdGroup,
    SubmissionRouting,
  };
}

async function seedLookup(model, values, { retiredValue = null } = {}) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const where = { name: value };
    const defaults = {
      name: value,
      sort_order: index + 1,
      is_active: 1,
    };
    if (retiredValue !== null) {
      defaults.is_retired = value === retiredValue ? 1 : 0;
    }

    await model.findOrCreate({ where, defaults });
  }
}

// Every uniqueness constraint the schema relies on that CANNOT be declared on
// the model, with the reason it can't. All are created as raw
// CREATE UNIQUE INDEX IF NOT EXISTS statements: idempotent, and valid on both
// SQLite (local) and Postgres (hosted).
//
// Two distinct dialect problems land here, and they need different handling:
//
//   1. Composite unique on a model index — SQLite's sync({ alter: true })
//      rebuilds the table, reads the composite index back through describeTable
//      and mis-derives it into standalone per-column UNIQUE constraints. On
//      user_application_roles that would mean UNIQUE(user_id), silently capping
//      every admin at one application. These tables therefore also skip `alter`
//      entirely (`skipAlterModel`), getting a plain CREATE TABLE IF NOT EXISTS
//      that never rebuilds.
//
//   2. Single-column unique added to an EXISTING table — SQLite rejects
//      `ALTER TABLE ... ADD COLUMN ... UNIQUE` outright ("Cannot add a UNIQUE
//      column"), so declaring it on the model breaks migration on the local path
//      while succeeding on Postgres. The column is declared plain and gets its
//      index here. These tables still need `alter` (that is how their other new
//      columns arrive), so `skipAlterModel` is null.
const RAW_UNIQUE_INDEXES = [
  {
    skipAlterModel: 'SubmissionEmbedding',
    index: 'idx_submission_embeddings_unique',
    table: 'submission_embeddings',
    columns: ['submission_id', 'scope'],
  },
  {
    skipAlterModel: 'UserApplicationRole',
    // A third column, so one person can hold an all-types grant AND a narrower
    // one on the same application. `replaces` names the two-column index this
    // supersedes: leaving it in place would keep rejecting the second row, and
    // CREATE INDEX IF NOT EXISTS cannot notice that.
    index: 'idx_user_application_roles_unique_v2',
    replaces: ['idx_user_application_roles_unique'],
    table: 'user_application_roles',
    columns: ['user_id', 'application_id', 'request_type'],
  },
  {
    skipAlterModel: 'ApplicationAdGroup',
    index: 'idx_application_ad_groups_unique',
    table: 'application_ad_groups',
    columns: ['application_id', 'group_name'],
  },
  {
    // Case 2: users is an existing table gaining several columns, so it must
    // still be altered — only the uniqueness moves out here.
    skipAlterModel: null,
    index: 'idx_users_external_id_unique',
    table: 'users',
    columns: ['external_id'],
  },
];

const NO_ALTER_MODEL_NAMES = new Set(
  RAW_UNIQUE_INDEXES.map((entry) => entry.skipAlterModel).filter(Boolean),
);

function uniqueIndexSql({ index, table, columns }) {
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  return `CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON "${table}" (${columnList})`;
}

async function ensureRawUniqueIndexes(sequelize) {
  for (const entry of RAW_UNIQUE_INDEXES) {
    for (const stale of entry.replaces || []) {
      await sequelize.query(`DROP INDEX IF EXISTS "${stale}"`);
    }
    await sequelize.query(uniqueIndexSql(entry));
  }
}

/**
 * Add a column to a table that is synced WITHOUT `alter`.
 *
 * The tables in NO_ALTER_MODEL_NAMES get a plain CREATE TABLE IF NOT EXISTS, so
 * a new column on one of them never reaches a database that already has the
 * table — the model would declare a column the rows do not have, and every read
 * would fail. Postgres has ADD COLUMN IF NOT EXISTS and SQLite does not, so the
 * portable form is to ask what is there first.
 */
async function ensureColumn(sequelize, table, column, definition) {
  const queryInterface = sequelize.getQueryInterface();
  let described;
  try {
    described = await queryInterface.describeTable(table);
  } catch {
    // No table yet — the model's own sync will create it with the column.
    return false;
  }
  if (described[column]) return false;
  await queryInterface.addColumn(table, column, definition);
  return true;
}

// Kept as a named export because the embeddings backfill calls it directly after
// its own plain SubmissionEmbedding.sync(), so the constraint the upsert relies
// on is present regardless of which path created the table.
async function ensureEmbeddingUniqueIndex(sequelize) {
  const entry = RAW_UNIQUE_INDEXES.find((candidate) => candidate.skipAlterModel === 'SubmissionEmbedding');
  await sequelize.query(uniqueIndexSql(entry));
}

async function migrateWithModels(sequelize, models) {
  await sequelize.authenticate();

  // Sync every model with alter:true EXCEPT the ones whose composite uniqueness
  // SQLite's alter-rebuild would corrupt (NO_ALTER_MODEL_NAMES). Those get a
  // plain sync — CREATE TABLE IF NOT EXISTS, never a rebuild. Every raw unique
  // index is then (re)created below, after all columns exist.
  // There are no model associations, so per-model sync is equivalent to a single
  // sequelize.sync() here.
  for (const [name, model] of Object.entries(models)) {
    if (NO_ALTER_MODEL_NAMES.has(name)) {
      await model.sync();
    } else {
      await model.sync({ alter: true });
    }
  }
  // user_application_roles is synced without `alter`, so its new type-scope
  // column has to be added by hand — and BEFORE the unique index below, which
  // now includes it.
  await ensureColumn(sequelize, 'user_application_roles', 'request_type', {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
  });

  await ensureRawUniqueIndexes(sequelize);

  await seedLookup(models.DefectEnhancementStatus, DEFAULT_DEFECT_ENHANCEMENT_STATUSES, { retiredValue: 'Retired' });
  await seedLookup(models.SubmissionType, DEFAULT_SUBMISSION_TYPES);
  await seedLookup(models.CleanupStatus, DEFAULT_CLEANUP_STATUSES);
  await seedLookup(models.CleanupTagType, DEFAULT_CLEANUP_TAG_TYPES);
  await seedLookup(models.Application, DEFAULT_APPLICATIONS);
  await seedLookup(models.EnhancementRequestType, DEFAULT_ENHANCEMENT_REQUEST_TYPES);
  await seedLookup(models.PriorityLevel, DEFAULT_PRIORITY_LEVELS);
  await seedLookup(models.SubmissionSource, DEFAULT_SUBMISSION_SOURCES);
  await seedLookup(models.LevelOfEffort, DEFAULT_LEVELS_OF_EFFORT);

  // Seed occurrence timeframes with days_equivalent values
  for (let i = 0; i < DEFAULT_OCCURRENCE_TIMEFRAMES.length; i++) {
    const name = DEFAULT_OCCURRENCE_TIMEFRAMES[i];
    const daysMap = { Day: 1, Week: 7, Month: 30.44, Quarter: 91.31, Year: 365.25 };
    await models.OccurrenceTimeframe.findOrCreate({
      where: { name },
      defaults: { name, days_equivalent: daysMap[name], sort_order: i + 1, is_active: 1 },
    });
  }
}

module.exports = {
  defineModels,
  migrateWithModels,
  ensureEmbeddingUniqueIndex,
  ensureRawUniqueIndexes,
  RAW_UNIQUE_INDEXES,
};
