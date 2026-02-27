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

function statusSeedStatements() {
  return DEFAULT_DEFECT_ENHANCEMENT_STATUSES.map((statusValue, index) => {
    const escaped = String(statusValue).replace(/'/g, "''");
    const isRetired = statusValue === 'Retired' ? 1 : 0;
    return `
    INSERT INTO defect_enhancement_statuses (name, sort_order, is_retired, is_active)
    SELECT '${escaped}', ${index + 1}, ${isRetired}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM defect_enhancement_statuses WHERE name = '${escaped}'
    )
  `;
  });
}

function submissionTypeSeedStatements() {
  return DEFAULT_SUBMISSION_TYPES.map((typeValue, index) => {
    const escaped = String(typeValue).replace(/'/g, "''");
    return `
    INSERT INTO submission_types (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM submission_types WHERE name = '${escaped}'
    )
  `;
  });
}

function cleanupStatusSeedStatements() {
  return DEFAULT_CLEANUP_STATUSES.map((statusValue, index) => {
    const escaped = String(statusValue).replace(/'/g, "''");
    return `
    INSERT INTO cleanup_statuses (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM cleanup_statuses WHERE name = '${escaped}'
    )
  `;
  });
}

function cleanupTagTypeSeedStatements() {
  return DEFAULT_CLEANUP_TAG_TYPES.map((tagValue, index) => {
    const escaped = String(tagValue).replace(/'/g, "''");
    return `
    INSERT INTO cleanup_tag_types (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM cleanup_tag_types WHERE name = '${escaped}'
    )
  `;
  });
}

function applicationSeedStatements() {
  return DEFAULT_APPLICATIONS.map((value, index) => {
    const escaped = String(value).replace(/'/g, "''");
    return `
    INSERT INTO applications (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM applications WHERE name = '${escaped}'
    )
  `;
  });
}

function enhancementRequestTypeSeedStatements() {
  return DEFAULT_ENHANCEMENT_REQUEST_TYPES.map((value, index) => {
    const escaped = String(value).replace(/'/g, "''");
    return `
    INSERT INTO enhancement_request_types (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM enhancement_request_types WHERE name = '${escaped}'
    )
  `;
  });
}

function priorityLevelSeedStatements() {
  return DEFAULT_PRIORITY_LEVELS.map((value, index) => {
    const escaped = String(value).replace(/'/g, "''");
    return `
    INSERT INTO priority_levels (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM priority_levels WHERE name = '${escaped}'
    )
  `;
  });
}

function submissionSourceSeedStatements() {
  return DEFAULT_SUBMISSION_SOURCES.map((value, index) => {
    const escaped = String(value).replace(/'/g, "''");
    return `
    INSERT INTO submission_sources (name, sort_order, is_active)
    SELECT '${escaped}', ${index + 1}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM submission_sources WHERE name = '${escaped}'
    )
  `;
  });
}

function sqliteSchema() {
  return [
    `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'rep'))
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_via TEXT NOT NULL DEFAULT 'rep_form',
      created_via_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      type TEXT NOT NULL,
      type_id INTEGER NOT NULL,
      application_name TEXT NOT NULL,
      application_id INTEGER NOT NULL,
      policy_num TEXT,
      account_num TEXT,
      transaction_num TEXT,
      screen_title TEXT NOT NULL,
      summary_of_issue TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      what_happened_exact_details TEXT NOT NULL,
      request TEXT NOT NULL,
      date_time_of_error TEXT NOT NULL,
      status TEXT NOT NULL,
      status_id INTEGER NOT NULL,
      reviewer TEXT,
      decision_notes TEXT,
      fingerprint TEXT,
      duplicate_reference TEXT,
      duplicate_of INTEGER,
      easyvista_ticket_id TEXT,
      desired_completion_date TEXT,
      impact_details TEXT,
      impact_notes TEXT,
      policy_premium_impact REAL,
      direct_dollar_impact REAL,
      policies_affected_count INTEGER,
      logged_defect INTEGER NOT NULL DEFAULT 0,
      enhancement_request_type TEXT,
      enhancement_request_type_id INTEGER,
      priority_level TEXT,
      priority_level_id INTEGER,
      jira_number TEXT,
      release_number TEXT,
      release_notes TEXT,
      is_cleanup INTEGER NOT NULL DEFAULT 0,
      cleanup_status TEXT,
      cleanup_status_id INTEGER,
      cleanup_tag_type TEXT,
      cleanup_tag_type_id INTEGER,
      easyvista_submitted_by TEXT,
      is_resubmission INTEGER NOT NULL DEFAULT 0,
      resubmission_of_submission_id INTEGER,
      resubmission_of_easyvista_ticket_id TEXT,
      has_resubmission INTEGER NOT NULL DEFAULT 0,
      latest_resubmission_submission_id INTEGER,
      latest_resubmission_easyvista_ticket_id TEXT,
      is_retired INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (duplicate_of) REFERENCES submissions(id),
      FOREIGN KEY (resubmission_of_submission_id) REFERENCES submissions(id),
      FOREIGN KEY (latest_resubmission_submission_id) REFERENCES submissions(id),
      FOREIGN KEY (created_via_id) REFERENCES submission_sources(id),
      FOREIGN KEY (type_id) REFERENCES submission_types(id),
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (status_id) REFERENCES defect_enhancement_statuses(id),
      FOREIGN KEY (cleanup_status_id) REFERENCES cleanup_statuses(id),
      FOREIGN KEY (cleanup_tag_type_id) REFERENCES cleanup_tag_types(id),
      FOREIGN KEY (enhancement_request_type_id) REFERENCES enhancement_request_types(id),
      FOREIGN KEY (priority_level_id) REFERENCES priority_levels(id)
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS excel_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      created_by TEXT,
      file_name TEXT NOT NULL,
      sheet_name TEXT,
      import_mode TEXT NOT NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      invalid_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      dry_run INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      summary_message TEXT,
      errors_json TEXT
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('admin', 'rep')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS defect_enhancement_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_retired INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS cleanup_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS cleanup_tag_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS enhancement_request_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS priority_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    'CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public)',
    'CREATE INDEX IF NOT EXISTS idx_attachments_submission_id ON attachments(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_submission_id ON submission_status_events(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_status ON submission_status_events(status)',
    'CREATE INDEX IF NOT EXISTS idx_excel_import_runs_created_at ON excel_import_runs(created_at)',
    ...statusSeedStatements(),
    ...submissionTypeSeedStatements(),
    ...cleanupStatusSeedStatements(),
    ...cleanupTagTypeSeedStatements(),
    ...applicationSeedStatements(),
    ...enhancementRequestTypeSeedStatements(),
    ...priorityLevelSeedStatements(),
    ...submissionSourceSeedStatements(),
    `
    INSERT INTO submission_status_events (submission_id, status, changed_at, changed_by)
    SELECT s.id, s.status, s.updated_at, 'system-migrated'
    FROM submissions s
    WHERE NOT EXISTS (
      SELECT 1 FROM submission_status_events e WHERE e.submission_id = s.id
    )
  `,
  ];
}

function postgresSchema() {
  return [
    `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'rep'))
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_via TEXT NOT NULL DEFAULT 'rep_form',
      created_via_id INTEGER NOT NULL REFERENCES submission_sources(id),
      created_by TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      type TEXT NOT NULL,
      type_id INTEGER NOT NULL REFERENCES submission_types(id),
      application_name TEXT NOT NULL,
      application_id INTEGER NOT NULL REFERENCES applications(id),
      policy_num TEXT,
      account_num TEXT,
      transaction_num TEXT,
      screen_title TEXT NOT NULL,
      summary_of_issue TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      what_happened_exact_details TEXT NOT NULL,
      request TEXT NOT NULL,
      date_time_of_error TEXT NOT NULL,
      status TEXT NOT NULL,
      status_id INTEGER NOT NULL REFERENCES defect_enhancement_statuses(id),
      reviewer TEXT,
      decision_notes TEXT,
      fingerprint TEXT,
      duplicate_reference TEXT,
      duplicate_of INTEGER REFERENCES submissions(id),
      easyvista_ticket_id TEXT,
      desired_completion_date TEXT,
      impact_details TEXT,
      impact_notes TEXT,
      policy_premium_impact NUMERIC(14, 2),
      direct_dollar_impact NUMERIC(14, 2),
      policies_affected_count INTEGER,
      logged_defect INTEGER NOT NULL DEFAULT 0,
      enhancement_request_type TEXT,
      enhancement_request_type_id INTEGER REFERENCES enhancement_request_types(id),
      priority_level TEXT,
      priority_level_id INTEGER REFERENCES priority_levels(id),
      jira_number TEXT,
      release_number TEXT,
      release_notes TEXT,
      is_cleanup INTEGER NOT NULL DEFAULT 0,
      cleanup_status TEXT,
      cleanup_status_id INTEGER REFERENCES cleanup_statuses(id),
      cleanup_tag_type TEXT,
      cleanup_tag_type_id INTEGER REFERENCES cleanup_tag_types(id),
      easyvista_submitted_by TEXT,
      is_resubmission INTEGER NOT NULL DEFAULT 0,
      resubmission_of_submission_id INTEGER REFERENCES submissions(id),
      resubmission_of_easyvista_ticket_id TEXT,
      has_resubmission INTEGER NOT NULL DEFAULT 0,
      latest_resubmission_submission_id INTEGER REFERENCES submissions(id),
      latest_resubmission_easyvista_ticket_id TEXT,
      is_retired INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS excel_import_runs (
      id SERIAL PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT,
      file_name TEXT NOT NULL,
      sheet_name TEXT,
      import_mode TEXT NOT NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      valid_rows INTEGER NOT NULL DEFAULT 0,
      invalid_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      dry_run INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      summary_message TEXT,
      errors_json TEXT
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('admin', 'rep'))
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_status_events (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS defect_enhancement_statuses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_retired INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS cleanup_statuses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS cleanup_tag_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS enhancement_request_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS priority_levels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_sources (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    'CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public)',
    'CREATE INDEX IF NOT EXISTS idx_attachments_submission_id ON attachments(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_submission_id ON submission_status_events(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_status ON submission_status_events(status)',
    'CREATE INDEX IF NOT EXISTS idx_excel_import_runs_created_at ON excel_import_runs(created_at)',
    ...statusSeedStatements(),
    ...submissionTypeSeedStatements(),
    ...cleanupStatusSeedStatements(),
    ...cleanupTagTypeSeedStatements(),
    ...applicationSeedStatements(),
    ...enhancementRequestTypeSeedStatements(),
    ...priorityLevelSeedStatements(),
    ...submissionSourceSeedStatements(),
    `
    INSERT INTO submission_status_events (submission_id, status, changed_at, changed_by)
    SELECT s.id, s.status, s.updated_at, 'system-migrated'
    FROM submissions s
    WHERE NOT EXISTS (
      SELECT 1 FROM submission_status_events e WHERE e.submission_id = s.id
    )
  `,
  ];
}

function getSchemaStatements(provider) {
  return provider === 'postgres' ? postgresSchema() : sqliteSchema();
}

function getPostMigrateStatements(provider) {
  if (provider === 'postgres') {
    return [
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS duplicate_reference TEXT',
      "ALTER TABLE submissions ADD COLUMN IF NOT EXISTS created_via TEXT NOT NULL DEFAULT 'rep_form'",
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS impact_notes TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS policy_premium_impact NUMERIC(14, 2)',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS direct_dollar_impact NUMERIC(14, 2)',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS policies_affected_count INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS logged_defect INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS release_number TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS release_notes TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_cleanup INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS cleanup_status TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS cleanup_tag_type TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_resubmission INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resubmission_of_submission_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resubmission_of_easyvista_ticket_id TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS has_resubmission INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS latest_resubmission_submission_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS latest_resubmission_easyvista_ticket_id TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_retired INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS created_via_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS type_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS application_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS cleanup_status_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS cleanup_tag_type_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS enhancement_request_type_id INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS priority_level_id INTEGER',
      `
      CREATE TABLE IF NOT EXISTS defect_enhancement_statuses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_retired INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS submission_types (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS cleanup_statuses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS cleanup_tag_types (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS enhancement_request_types (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS priority_levels (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      CREATE TABLE IF NOT EXISTS submission_sources (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `,
      `
      UPDATE submissions
      SET is_retired = CASE
        WHEN status = 'Retired' THEN 1
        ELSE COALESCE(is_retired, 0)
      END
    `,
      `
      UPDATE submissions
      SET status = COALESCE((
        SELECT REPLACE(e.status, 'Defect/Enhancement Status: ', '')
        FROM submission_status_events e
        WHERE e.submission_id = submissions.id
          AND e.status LIKE 'Defect/Enhancement Status:%'
          AND REPLACE(e.status, 'Defect/Enhancement Status: ', '') <> 'Retired'
          AND e.changed_at < COALESCE((
            SELECT MAX(r.changed_at)
            FROM submission_status_events r
            WHERE r.submission_id = submissions.id
              AND (r.status = 'Retired' OR r.status = 'Defect/Enhancement Status: Retired')
          ), '9999-12-31T23:59:59.999Z')
        ORDER BY e.changed_at DESC, e.id DESC
        LIMIT 1
      ), 'New')
      WHERE status = 'Retired'
    `,
      `
      UPDATE submissions
      SET duplicate_reference = duplicate_of::text
      WHERE duplicate_reference IS NULL AND duplicate_of IS NOT NULL
    `,
      'ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check',
      'ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_type_check',
        ...statusSeedStatements(),
        ...submissionTypeSeedStatements(),
        ...cleanupStatusSeedStatements(),
        ...cleanupTagTypeSeedStatements(),
        ...applicationSeedStatements(),
        ...enhancementRequestTypeSeedStatements(),
        ...priorityLevelSeedStatements(),
        ...submissionSourceSeedStatements(),
      `
      UPDATE submissions
      SET created_via_id = (
        SELECT id FROM submission_sources s
        WHERE LOWER(s.name) = LOWER(submissions.created_via)
        LIMIT 1
      )
      WHERE created_via_id IS NULL
    `,
      `
      UPDATE submissions
      SET type_id = (
        SELECT id FROM submission_types s
        WHERE LOWER(s.name) = LOWER(submissions.type)
        LIMIT 1
      )
      WHERE type_id IS NULL
    `,
      `
      UPDATE submissions
      SET application_id = (
        SELECT id FROM applications s
        WHERE LOWER(s.name) = LOWER(submissions.application_name)
        LIMIT 1
      )
      WHERE application_id IS NULL
    `,
      `
      UPDATE submissions
      SET status_id = (
        SELECT id FROM defect_enhancement_statuses s
        WHERE LOWER(s.name) = LOWER(submissions.status)
        LIMIT 1
      )
      WHERE status_id IS NULL
    `,
      `
      UPDATE submissions
      SET cleanup_status_id = (
        SELECT id FROM cleanup_statuses s
        WHERE LOWER(s.name) = LOWER(submissions.cleanup_status)
        LIMIT 1
      )
      WHERE cleanup_status_id IS NULL AND cleanup_status IS NOT NULL
    `,
      `
      UPDATE submissions
      SET cleanup_tag_type_id = (
        SELECT id FROM cleanup_tag_types s
        WHERE LOWER(s.name) = LOWER(submissions.cleanup_tag_type)
        LIMIT 1
      )
      WHERE cleanup_tag_type_id IS NULL AND cleanup_tag_type IS NOT NULL
    `,
      `
      UPDATE submissions
      SET enhancement_request_type_id = (
        SELECT id FROM enhancement_request_types s
        WHERE LOWER(s.name) = LOWER(submissions.enhancement_request_type)
        LIMIT 1
      )
      WHERE enhancement_request_type_id IS NULL AND enhancement_request_type IS NOT NULL
    `,
      `
      UPDATE submissions
      SET priority_level_id = (
        SELECT id FROM priority_levels s
        WHERE LOWER(s.name) = LOWER(submissions.priority_level)
        LIMIT 1
      )
      WHERE priority_level_id IS NULL AND priority_level IS NOT NULL
    `,
      `
      UPDATE submissions
      SET created_via_id = COALESCE(
        created_via_id,
        (SELECT id FROM submission_sources s WHERE LOWER(s.name) = LOWER(submissions.created_via) LIMIT 1),
        (SELECT id FROM submission_sources s WHERE LOWER(s.name) = 'rep_form' LIMIT 1)
      )
      WHERE created_via_id IS NULL
    `,
      `
      UPDATE submissions
      SET type_id = COALESCE(
        type_id,
        (SELECT id FROM submission_types s WHERE LOWER(s.name) = LOWER(submissions.type) LIMIT 1),
        (SELECT id FROM submission_types s WHERE LOWER(s.name) = 'defect' LIMIT 1)
      )
      WHERE type_id IS NULL
    `,
      `
      UPDATE submissions
      SET application_id = COALESCE(
        application_id,
        (SELECT id FROM applications s WHERE LOWER(s.name) = LOWER(submissions.application_name) LIMIT 1),
        (SELECT id FROM applications s WHERE LOWER(s.name) = 'billing center' LIMIT 1)
      )
      WHERE application_id IS NULL
    `,
      `
      UPDATE submissions
      SET status_id = COALESCE(
        status_id,
        (SELECT id FROM defect_enhancement_statuses s WHERE LOWER(s.name) = LOWER(submissions.status) LIMIT 1),
        (SELECT id FROM defect_enhancement_statuses s WHERE LOWER(s.name) = 'new' LIMIT 1)
      )
      WHERE status_id IS NULL
    `,
      `
      UPDATE submissions
      SET created_via = COALESCE((SELECT s.name FROM submission_sources s WHERE s.id = submissions.created_via_id), created_via)
      WHERE created_via_id IS NOT NULL
    `,
      `
      UPDATE submissions
      SET type = COALESCE((SELECT s.name FROM submission_types s WHERE s.id = submissions.type_id), type)
      WHERE type_id IS NOT NULL
    `,
      `
      UPDATE submissions
      SET application_name = COALESCE((SELECT s.name FROM applications s WHERE s.id = submissions.application_id), application_name)
      WHERE application_id IS NOT NULL
    `,
      `
      UPDATE submissions
      SET status = COALESCE((SELECT s.name FROM defect_enhancement_statuses s WHERE s.id = submissions.status_id), status)
      WHERE status_id IS NOT NULL
    `,
      'ALTER TABLE submissions ALTER COLUMN created_via_id SET NOT NULL',
      'ALTER TABLE submissions ALTER COLUMN type_id SET NOT NULL',
      'ALTER TABLE submissions ALTER COLUMN application_id SET NOT NULL',
      'ALTER TABLE submissions ALTER COLUMN status_id SET NOT NULL',
    ];
  }

  return [
    'ALTER TABLE submissions ADD COLUMN duplicate_reference TEXT',
    "ALTER TABLE submissions ADD COLUMN created_via TEXT NOT NULL DEFAULT 'rep_form'",
    'ALTER TABLE submissions ADD COLUMN impact_notes TEXT',
    'ALTER TABLE submissions ADD COLUMN policy_premium_impact REAL',
    'ALTER TABLE submissions ADD COLUMN direct_dollar_impact REAL',
    'ALTER TABLE submissions ADD COLUMN policies_affected_count INTEGER',
    'ALTER TABLE submissions ADD COLUMN logged_defect INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE submissions ADD COLUMN release_number TEXT',
    'ALTER TABLE submissions ADD COLUMN release_notes TEXT',
    'ALTER TABLE submissions ADD COLUMN is_cleanup INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE submissions ADD COLUMN cleanup_status TEXT',
    'ALTER TABLE submissions ADD COLUMN cleanup_tag_type TEXT',
    'ALTER TABLE submissions ADD COLUMN is_resubmission INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE submissions ADD COLUMN resubmission_of_submission_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN resubmission_of_easyvista_ticket_id TEXT',
    'ALTER TABLE submissions ADD COLUMN has_resubmission INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE submissions ADD COLUMN latest_resubmission_submission_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN latest_resubmission_easyvista_ticket_id TEXT',
    'ALTER TABLE submissions ADD COLUMN is_retired INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE submissions ADD COLUMN created_via_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN type_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN application_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN status_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN cleanup_status_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN cleanup_tag_type_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN enhancement_request_type_id INTEGER',
    'ALTER TABLE submissions ADD COLUMN priority_level_id INTEGER',
    `
    UPDATE submissions
    SET is_retired = CASE
      WHEN status = 'Retired' THEN 1
      ELSE COALESCE(is_retired, 0)
    END
  `,
    `
    UPDATE submissions
    SET status = COALESCE((
      SELECT REPLACE(e.status, 'Defect/Enhancement Status: ', '')
      FROM submission_status_events e
      WHERE e.submission_id = submissions.id
        AND e.status LIKE 'Defect/Enhancement Status:%'
        AND REPLACE(e.status, 'Defect/Enhancement Status: ', '') <> 'Retired'
        AND e.changed_at < COALESCE((
          SELECT MAX(r.changed_at)
          FROM submission_status_events r
          WHERE r.submission_id = submissions.id
            AND (r.status = 'Retired' OR r.status = 'Defect/Enhancement Status: Retired')
        ), '9999-12-31T23:59:59.999Z')
      ORDER BY e.changed_at DESC, e.id DESC
      LIMIT 1
    ), 'New')
    WHERE status = 'Retired'
  `,
    `
    UPDATE submissions
    SET duplicate_reference = CAST(duplicate_of AS TEXT)
    WHERE duplicate_reference IS NULL AND duplicate_of IS NOT NULL
  `,
    `
    CREATE TABLE IF NOT EXISTS defect_enhancement_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_retired INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS cleanup_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS cleanup_tag_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS enhancement_request_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS priority_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    `
    CREATE TABLE IF NOT EXISTS submission_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `,
    ...statusSeedStatements(),
    ...submissionTypeSeedStatements(),
    ...cleanupStatusSeedStatements(),
    ...cleanupTagTypeSeedStatements(),
    ...applicationSeedStatements(),
    ...enhancementRequestTypeSeedStatements(),
    ...priorityLevelSeedStatements(),
    ...submissionSourceSeedStatements(),
    `
    UPDATE submissions
    SET created_via_id = (
      SELECT id FROM submission_sources s
      WHERE LOWER(s.name) = LOWER(submissions.created_via)
      LIMIT 1
    )
    WHERE created_via_id IS NULL
  `,
    `
    UPDATE submissions
    SET type_id = (
      SELECT id FROM submission_types s
      WHERE LOWER(s.name) = LOWER(submissions.type)
      LIMIT 1
    )
    WHERE type_id IS NULL
  `,
    `
    UPDATE submissions
    SET application_id = (
      SELECT id FROM applications s
      WHERE LOWER(s.name) = LOWER(submissions.application_name)
      LIMIT 1
    )
    WHERE application_id IS NULL
  `,
    `
    UPDATE submissions
    SET status_id = (
      SELECT id FROM defect_enhancement_statuses s
      WHERE LOWER(s.name) = LOWER(submissions.status)
      LIMIT 1
    )
    WHERE status_id IS NULL
  `,
    `
    UPDATE submissions
    SET cleanup_status_id = (
      SELECT id FROM cleanup_statuses s
      WHERE LOWER(s.name) = LOWER(submissions.cleanup_status)
      LIMIT 1
    )
    WHERE cleanup_status_id IS NULL AND cleanup_status IS NOT NULL
  `,
    `
    UPDATE submissions
    SET cleanup_tag_type_id = (
      SELECT id FROM cleanup_tag_types s
      WHERE LOWER(s.name) = LOWER(submissions.cleanup_tag_type)
      LIMIT 1
    )
    WHERE cleanup_tag_type_id IS NULL AND cleanup_tag_type IS NOT NULL
  `,
    `
    UPDATE submissions
    SET enhancement_request_type_id = (
      SELECT id FROM enhancement_request_types s
      WHERE LOWER(s.name) = LOWER(submissions.enhancement_request_type)
      LIMIT 1
    )
    WHERE enhancement_request_type_id IS NULL AND enhancement_request_type IS NOT NULL
  `,
    `
    UPDATE submissions
    SET priority_level_id = (
      SELECT id FROM priority_levels s
      WHERE LOWER(s.name) = LOWER(submissions.priority_level)
      LIMIT 1
    )
    WHERE priority_level_id IS NULL AND priority_level IS NOT NULL
  `,
    `
    UPDATE submissions
    SET created_via_id = COALESCE(
      created_via_id,
      (SELECT id FROM submission_sources s WHERE LOWER(s.name) = LOWER(submissions.created_via) LIMIT 1),
      (SELECT id FROM submission_sources s WHERE LOWER(s.name) = 'rep_form' LIMIT 1)
    )
    WHERE created_via_id IS NULL
  `,
    `
    UPDATE submissions
    SET type_id = COALESCE(
      type_id,
      (SELECT id FROM submission_types s WHERE LOWER(s.name) = LOWER(submissions.type) LIMIT 1),
      (SELECT id FROM submission_types s WHERE LOWER(s.name) = 'defect' LIMIT 1)
    )
    WHERE type_id IS NULL
  `,
    `
    UPDATE submissions
    SET application_id = COALESCE(
      application_id,
      (SELECT id FROM applications s WHERE LOWER(s.name) = LOWER(submissions.application_name) LIMIT 1),
      (SELECT id FROM applications s WHERE LOWER(s.name) = 'billing center' LIMIT 1)
    )
    WHERE application_id IS NULL
  `,
    `
    UPDATE submissions
    SET status_id = COALESCE(
      status_id,
      (SELECT id FROM defect_enhancement_statuses s WHERE LOWER(s.name) = LOWER(submissions.status) LIMIT 1),
      (SELECT id FROM defect_enhancement_statuses s WHERE LOWER(s.name) = 'new' LIMIT 1)
    )
    WHERE status_id IS NULL
  `,
    `
    UPDATE submissions
    SET created_via = COALESCE((SELECT s.name FROM submission_sources s WHERE s.id = submissions.created_via_id), created_via)
    WHERE created_via_id IS NOT NULL
  `,
    `
    UPDATE submissions
    SET type = COALESCE((SELECT s.name FROM submission_types s WHERE s.id = submissions.type_id), type)
    WHERE type_id IS NOT NULL
  `,
    `
    UPDATE submissions
    SET application_name = COALESCE((SELECT s.name FROM applications s WHERE s.id = submissions.application_id), application_name)
    WHERE application_id IS NOT NULL
  `,
    `
    UPDATE submissions
    SET status = COALESCE((SELECT s.name FROM defect_enhancement_statuses s WHERE s.id = submissions.status_id), status)
    WHERE status_id IS NOT NULL
  `,
    'PRAGMA foreign_keys = OFF',
    'DROP TABLE IF EXISTS submissions__status_migration',
    `
    CREATE TABLE submissions__status_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_via TEXT NOT NULL DEFAULT 'rep_form',
      created_via_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      type TEXT NOT NULL,
      type_id INTEGER NOT NULL,
      application_name TEXT NOT NULL,
      application_id INTEGER NOT NULL,
      policy_num TEXT,
      account_num TEXT,
      transaction_num TEXT,
      screen_title TEXT NOT NULL,
      summary_of_issue TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      what_happened_exact_details TEXT NOT NULL,
      request TEXT NOT NULL,
      date_time_of_error TEXT NOT NULL,
      status TEXT NOT NULL,
      status_id INTEGER NOT NULL,
      reviewer TEXT,
      decision_notes TEXT,
      fingerprint TEXT,
      duplicate_reference TEXT,
      duplicate_of INTEGER,
      easyvista_ticket_id TEXT,
      desired_completion_date TEXT,
      impact_details TEXT,
      impact_notes TEXT,
      policy_premium_impact REAL,
      direct_dollar_impact REAL,
      policies_affected_count INTEGER,
      logged_defect INTEGER NOT NULL DEFAULT 0,
      enhancement_request_type TEXT,
      enhancement_request_type_id INTEGER,
      priority_level TEXT,
      priority_level_id INTEGER,
      jira_number TEXT,
      release_number TEXT,
      release_notes TEXT,
      is_cleanup INTEGER NOT NULL DEFAULT 0,
      cleanup_status TEXT,
      cleanup_status_id INTEGER,
      cleanup_tag_type TEXT,
      cleanup_tag_type_id INTEGER,
      easyvista_submitted_by TEXT,
      is_resubmission INTEGER NOT NULL DEFAULT 0,
      resubmission_of_submission_id INTEGER,
      resubmission_of_easyvista_ticket_id TEXT,
      has_resubmission INTEGER NOT NULL DEFAULT 0,
      latest_resubmission_submission_id INTEGER,
      latest_resubmission_easyvista_ticket_id TEXT,
      is_retired INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (duplicate_of) REFERENCES submissions(id),
      FOREIGN KEY (resubmission_of_submission_id) REFERENCES submissions(id),
      FOREIGN KEY (latest_resubmission_submission_id) REFERENCES submissions(id),
      FOREIGN KEY (created_via_id) REFERENCES submission_sources(id),
      FOREIGN KEY (type_id) REFERENCES submission_types(id),
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (status_id) REFERENCES defect_enhancement_statuses(id),
      FOREIGN KEY (cleanup_status_id) REFERENCES cleanup_statuses(id),
      FOREIGN KEY (cleanup_tag_type_id) REFERENCES cleanup_tag_types(id),
      FOREIGN KEY (enhancement_request_type_id) REFERENCES enhancement_request_types(id),
      FOREIGN KEY (priority_level_id) REFERENCES priority_levels(id)
    )
  `,
    `
    INSERT INTO submissions__status_migration (
      id,
      created_at,
      updated_at,
      created_via,
      created_via_id,
      created_by,
      created_by_email,
      type,
      type_id,
      application_name,
      application_id,
      policy_num,
      account_num,
      transaction_num,
      screen_title,
      summary_of_issue,
      steps_to_reproduce,
      what_happened_exact_details,
      request,
      date_time_of_error,
      status,
      status_id,
      reviewer,
      decision_notes,
      fingerprint,
      duplicate_reference,
      duplicate_of,
      easyvista_ticket_id,
      desired_completion_date,
      impact_details,
      impact_notes,
      policy_premium_impact,
      direct_dollar_impact,
      policies_affected_count,
      logged_defect,
      enhancement_request_type,
      enhancement_request_type_id,
      priority_level,
      priority_level_id,
      jira_number,
      release_number,
      release_notes,
      is_cleanup,
      cleanup_status,
      cleanup_status_id,
      cleanup_tag_type,
      cleanup_tag_type_id,
      easyvista_submitted_by,
      is_resubmission,
      resubmission_of_submission_id,
      resubmission_of_easyvista_ticket_id,
      has_resubmission,
      latest_resubmission_submission_id,
      latest_resubmission_easyvista_ticket_id,
      is_retired,
      is_public
    )
    SELECT
      id,
      created_at,
      updated_at,
      created_via,
      created_via_id,
      created_by,
      created_by_email,
      type,
      type_id,
      application_name,
      application_id,
      policy_num,
      account_num,
      transaction_num,
      screen_title,
      summary_of_issue,
      steps_to_reproduce,
      what_happened_exact_details,
      request,
      date_time_of_error,
      status,
      status_id,
      reviewer,
      decision_notes,
      fingerprint,
      duplicate_reference,
      duplicate_of,
      easyvista_ticket_id,
      desired_completion_date,
      impact_details,
      impact_notes,
      policy_premium_impact,
      direct_dollar_impact,
      policies_affected_count,
      logged_defect,
      enhancement_request_type,
      enhancement_request_type_id,
      priority_level,
      priority_level_id,
      jira_number,
      release_number,
      release_notes,
      is_cleanup,
      cleanup_status,
      cleanup_status_id,
      cleanup_tag_type,
      cleanup_tag_type_id,
      easyvista_submitted_by,
      is_resubmission,
      resubmission_of_submission_id,
      resubmission_of_easyvista_ticket_id,
      has_resubmission,
      latest_resubmission_submission_id,
      latest_resubmission_easyvista_ticket_id,
      is_retired,
      is_public
    FROM submissions
  `,
    'DROP TABLE submissions',
    'ALTER TABLE submissions__status_migration RENAME TO submissions',
    'CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public)',
    'PRAGMA foreign_keys = ON',
  ];
}

module.exports = {
  getSchemaStatements,
  getPostMigrateStatements,
};
