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
];

const DEFAULT_SUBMISSION_TYPES = ['defect', 'enhancement'];
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
    policy_premium_impact: { type: DataTypes.REAL },
    direct_dollar_impact: { type: DataTypes.REAL },
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
    index: 'idx_user_application_roles_unique',
    table: 'user_application_roles',
    columns: ['user_id', 'application_id'],
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
    await sequelize.query(uniqueIndexSql(entry));
  }
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
  await ensureRawUniqueIndexes(sequelize);

  await seedLookup(models.DefectEnhancementStatus, DEFAULT_DEFECT_ENHANCEMENT_STATUSES, { retiredValue: 'Retired' });
  await seedLookup(models.SubmissionType, DEFAULT_SUBMISSION_TYPES);
  await seedLookup(models.CleanupStatus, DEFAULT_CLEANUP_STATUSES);
  await seedLookup(models.CleanupTagType, DEFAULT_CLEANUP_TAG_TYPES);
  await seedLookup(models.Application, DEFAULT_APPLICATIONS);
  await seedLookup(models.EnhancementRequestType, DEFAULT_ENHANCEMENT_REQUEST_TYPES);
  await seedLookup(models.PriorityLevel, DEFAULT_PRIORITY_LEVELS);
  await seedLookup(models.SubmissionSource, DEFAULT_SUBMISSION_SOURCES);

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
