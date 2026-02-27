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
      created_by TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('defect', 'enhancement')),
      application_name TEXT NOT NULL,
      policy_num TEXT,
      account_num TEXT,
      transaction_num TEXT,
      screen_title TEXT NOT NULL,
      summary_of_issue TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      what_happened_exact_details TEXT NOT NULL,
      request TEXT NOT NULL,
      date_time_of_error TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('New', 'Approved', 'Backlog - Monitoring Impact', 'Future Consideration', 'Deferred – Not in Current Scope', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired')),
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
      priority_level TEXT,
      jira_number TEXT,
      release_number TEXT,
      release_notes TEXT,
      is_cleanup INTEGER NOT NULL DEFAULT 0,
      cleanup_status TEXT,
      cleanup_tag_type TEXT,
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
      FOREIGN KEY (latest_resubmission_submission_id) REFERENCES submissions(id)
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
    'CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public)',
    'CREATE INDEX IF NOT EXISTS idx_attachments_submission_id ON attachments(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_submission_id ON submission_status_events(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_status ON submission_status_events(status)',
    'CREATE INDEX IF NOT EXISTS idx_excel_import_runs_created_at ON excel_import_runs(created_at)',
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
      created_by TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('defect', 'enhancement')),
      application_name TEXT NOT NULL,
      policy_num TEXT,
      account_num TEXT,
      transaction_num TEXT,
      screen_title TEXT NOT NULL,
      summary_of_issue TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      what_happened_exact_details TEXT NOT NULL,
      request TEXT NOT NULL,
      date_time_of_error TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('New', 'Approved', 'Backlog - Monitoring Impact', 'Future Consideration', 'Deferred – Not in Current Scope', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired')),
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
      priority_level TEXT,
      jira_number TEXT,
      release_number TEXT,
      release_notes TEXT,
      is_cleanup INTEGER NOT NULL DEFAULT 0,
      cleanup_status TEXT,
      cleanup_tag_type TEXT,
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
    'CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type)',
    'CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public)',
    'CREATE INDEX IF NOT EXISTS idx_attachments_submission_id ON attachments(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_submission_id ON submission_status_events(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_status_events_status ON submission_status_events(status)',
    'CREATE INDEX IF NOT EXISTS idx_excel_import_runs_created_at ON excel_import_runs(created_at)',
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
      `
      ALTER TABLE submissions
      ADD CONSTRAINT submissions_status_check
      CHECK (
        status IN (
          'New',
          'Approved',
          'Backlog - Monitoring Impact',
          'Future Consideration',
          'Deferred – Not in Current Scope',
          'Rejected',
          'Duplicate',
          'Submitted',
          'Deployed',
          'Retired'
        )
      )
    `,
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
    'PRAGMA foreign_keys = OFF',
    'DROP TABLE IF EXISTS submissions__status_migration',
    `
    CREATE TABLE submissions__status_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_via TEXT NOT NULL DEFAULT 'rep_form',
      created_by TEXT NOT NULL,
      created_by_email TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('defect', 'enhancement')),
      application_name TEXT NOT NULL,
      policy_num TEXT,
      account_num TEXT,
      transaction_num TEXT,
      screen_title TEXT NOT NULL,
      summary_of_issue TEXT NOT NULL,
      steps_to_reproduce TEXT NOT NULL,
      what_happened_exact_details TEXT NOT NULL,
      request TEXT NOT NULL,
      date_time_of_error TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('New', 'Approved', 'Backlog - Monitoring Impact', 'Future Consideration', 'Deferred – Not in Current Scope', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired')),
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
      priority_level TEXT,
      jira_number TEXT,
      release_number TEXT,
      release_notes TEXT,
      is_cleanup INTEGER NOT NULL DEFAULT 0,
      cleanup_status TEXT,
      cleanup_tag_type TEXT,
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
      FOREIGN KEY (latest_resubmission_submission_id) REFERENCES submissions(id)
    )
  `,
    `
    INSERT INTO submissions__status_migration (
      id,
      created_at,
      updated_at,
      created_via,
      created_by,
      created_by_email,
      type,
      application_name,
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
      priority_level,
      jira_number,
      release_number,
      release_notes,
      is_cleanup,
      cleanup_status,
      cleanup_tag_type,
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
      created_by,
      created_by_email,
      type,
      application_name,
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
      priority_level,
      jira_number,
      release_number,
      release_notes,
      is_cleanup,
      cleanup_status,
      cleanup_tag_type,
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
