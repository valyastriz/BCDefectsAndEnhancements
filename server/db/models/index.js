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
    role: { type: DataTypes.STRING, allowNull: false },
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
    type_id: { type: DataTypes.INTEGER, allowNull: true },
    application_id: { type: DataTypes.INTEGER, allowNull: true },
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

// Composite unique index for submission_embeddings, created dialect-safely.
// It is created here with a raw CREATE UNIQUE INDEX IF NOT EXISTS rather than as
// a model `unique: true` index because sync({ alter: true }) mis-derives a
// composite unique index into standalone per-column UNIQUE constraints on SQLite
// (see the SubmissionEmbedding model comment). This statement is idempotent and
// valid on both SQLite and Postgres. Called after the schema sync on
// migrate/app boot and after the backfill's plain SubmissionEmbedding.sync(),
// so the constraint the upsert relies on is always present regardless of which
// path created the table.
async function ensureEmbeddingUniqueIndex(sequelize) {
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS "idx_submission_embeddings_unique" '
    + 'ON "submission_embeddings" ("submission_id", "scope")',
  );
}

async function migrateWithModels(sequelize, models) {
  await sequelize.authenticate();

  // Sync every model with alter:true EXCEPT submission_embeddings. That table's
  // composite (submission_id, scope) uniqueness is corrupted by SQLite's
  // alter-rebuild (see the SubmissionEmbedding model comment), so it gets a
  // plain sync (CREATE TABLE IF NOT EXISTS, never a rebuild) and its unique
  // index is created separately below. There are no model associations, so
  // per-model sync is equivalent to a single sequelize.sync() here.
  for (const model of Object.values(models)) {
    if (model === models.SubmissionEmbedding) {
      await model.sync();
    } else {
      await model.sync({ alter: true });
    }
  }
  await ensureEmbeddingUniqueIndex(sequelize);

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
};
