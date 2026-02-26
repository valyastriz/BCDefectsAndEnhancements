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
      status TEXT NOT NULL CHECK (status IN ('New', 'Approved', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired')),
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
      easyvista_submitted_by TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (duplicate_of) REFERENCES submissions(id)
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
      status TEXT NOT NULL CHECK (status IN ('New', 'Approved', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired')),
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
      easyvista_submitted_by TEXT,
      is_public INTEGER NOT NULL DEFAULT 0
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
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS impact_notes TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS policy_premium_impact NUMERIC(14, 2)',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS direct_dollar_impact NUMERIC(14, 2)',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS policies_affected_count INTEGER',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS logged_defect INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS release_number TEXT',
      'ALTER TABLE submissions ADD COLUMN IF NOT EXISTS release_notes TEXT',
      `
      UPDATE submissions
      SET duplicate_reference = duplicate_of::text
      WHERE duplicate_reference IS NULL AND duplicate_of IS NOT NULL
    `,
    ];
  }

  return [
    'ALTER TABLE submissions ADD COLUMN duplicate_reference TEXT',
    'ALTER TABLE submissions ADD COLUMN impact_notes TEXT',
    'ALTER TABLE submissions ADD COLUMN policy_premium_impact REAL',
    'ALTER TABLE submissions ADD COLUMN direct_dollar_impact REAL',
    'ALTER TABLE submissions ADD COLUMN policies_affected_count INTEGER',
    'ALTER TABLE submissions ADD COLUMN logged_defect INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE submissions ADD COLUMN release_number TEXT',
    'ALTER TABLE submissions ADD COLUMN release_notes TEXT',
    `
    UPDATE submissions
    SET duplicate_reference = CAST(duplicate_of AS TEXT)
    WHERE duplicate_reference IS NULL AND duplicate_of IS NOT NULL
  `,
  ];
}

module.exports = {
  getSchemaStatements,
  getPostMigrateStatements,
};
