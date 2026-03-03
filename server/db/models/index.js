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
      { name: 'idx_submissions_status', fields: ['status'] },
      { name: 'idx_submissions_type', fields: ['type'] },
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
    Submission,
    Attachment,
    SubmissionStatusEvent,
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

function normalizeLookupValue(value) {
  return String(value || '').trim().toLowerCase();
}

async function runLookupBackfill(models, config) {
  const Submission = models.Submission;
  const LookupModel = models[config.lookupModelKey];
  if (!Submission || !LookupModel) return;

  const lookupRows = await LookupModel.findAll({
    attributes: ['id', 'name'],
    raw: true,
  });
  const lookupByName = new Map(
    lookupRows.map((row) => [normalizeLookupValue(row.name), row]),
  );

  const submissionsNeedingId = await Submission.findAll({
    attributes: ['id', config.idColumn, config.textColumn],
    where: { [config.idColumn]: null },
    raw: true,
  });

  for (const submission of submissionsNeedingId) {
    const normalizedText = normalizeLookupValue(submission[config.textColumn]);
    if (!normalizedText) continue;
    const matchedLookup = lookupByName.get(normalizedText);
    if (!matchedLookup) continue;

    await Submission.update(
      { [config.idColumn]: matchedLookup.id },
      { where: { id: submission.id } },
    );
  }

  if (config.defaultName) {
    const normalizedDefault = normalizeLookupValue(config.defaultName);
    const defaultLookup = lookupByName.get(normalizedDefault) || null;
    if (defaultLookup) {
      await Submission.update(
        { [config.idColumn]: defaultLookup.id },
        { where: { [config.idColumn]: null } },
      );
    }
  }

  const submissionsWithId = await Submission.findAll({
    attributes: ['id', config.idColumn, config.textColumn],
    where: {
      [config.idColumn]: { [Op.ne]: null },
    },
    raw: true,
  });

  const lookupById = new Map(
    lookupRows
      .map((row) => [Number(row.id), row])
      .filter(([id]) => Number.isFinite(id)),
  );

  for (const submission of submissionsWithId) {
    const lookupId = Number(submission[config.idColumn]);
    if (!Number.isFinite(lookupId)) continue;
    const matchedLookup = lookupById.get(lookupId);
    if (!matchedLookup) continue;

    const currentText = String(submission[config.textColumn] || '').trim();
    const expectedText = String(matchedLookup.name || '').trim();
    if (currentText === expectedText) continue;

    await Submission.update(
      { [config.textColumn]: matchedLookup.name },
      { where: { id: submission.id } },
    );
  }
}

async function backfillLookupIds(models) {
  const Submission = models.Submission;
  const SubmissionStatusEvent = models.SubmissionStatusEvent;
  if (!Submission || !SubmissionStatusEvent) return;

  const mappings = [
    { idColumn: 'created_via_id', textColumn: 'created_via', lookupModelKey: 'SubmissionSource', defaultName: 'rep_form' },
    { idColumn: 'type_id', textColumn: 'type', lookupModelKey: 'SubmissionType', defaultName: 'defect' },
    { idColumn: 'application_id', textColumn: 'application_name', lookupModelKey: 'Application', defaultName: 'Billing Center' },
    { idColumn: 'status_id', textColumn: 'status', lookupModelKey: 'DefectEnhancementStatus', defaultName: 'New' },
    { idColumn: 'cleanup_status_id', textColumn: 'cleanup_status', lookupModelKey: 'CleanupStatus', defaultName: null },
    { idColumn: 'cleanup_tag_type_id', textColumn: 'cleanup_tag_type', lookupModelKey: 'CleanupTagType', defaultName: null },
    { idColumn: 'enhancement_request_type_id', textColumn: 'enhancement_request_type', lookupModelKey: 'EnhancementRequestType', defaultName: null },
    { idColumn: 'priority_level_id', textColumn: 'priority_level', lookupModelKey: 'PriorityLevel', defaultName: null },
  ];

  for (const mapping of mappings) {
    await runLookupBackfill(models, mapping);
  }

  const duplicateReferenceBackfillRows = await Submission.findAll({
    attributes: ['id', 'duplicate_of', 'duplicate_reference'],
    where: {
      duplicate_reference: null,
      duplicate_of: { [Op.ne]: null },
    },
    raw: true,
  });

  for (const row of duplicateReferenceBackfillRows) {
    await Submission.update(
      { duplicate_reference: String(row.duplicate_of) },
      { where: { id: row.id } },
    );
  }

  const existingEventRows = await SubmissionStatusEvent.findAll({
    attributes: ['submission_id'],
    raw: true,
  });
  const submissionIdsWithEvents = new Set(
    existingEventRows
      .map((row) => Number(row.submission_id))
      .filter((id) => Number.isFinite(id)),
  );

  const submissions = await Submission.findAll({
    attributes: ['id', 'status', 'updated_at'],
    raw: true,
  });

  for (const submission of submissions) {
    const submissionId = Number(submission.id);
    if (!Number.isFinite(submissionId)) continue;
    if (submissionIdsWithEvents.has(submissionId)) continue;

    await SubmissionStatusEvent.create({
      submission_id: submissionId,
      status: submission.status,
      changed_at: submission.updated_at,
      changed_by: 'system-migrated',
    });
  }
}

async function migrateWithModels(sequelize, models) {
  await sequelize.authenticate();
  await sequelize.sync();

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

  await backfillLookupIds(models);
}

module.exports = {
  defineModels,
  migrateWithModels,
};
