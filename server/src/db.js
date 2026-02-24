const path = require('path');
const fs = require('fs');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.db');

async function ensureSubmissionColumns(db) {
  const columns = await db.all('PRAGMA table_info(submissions)');
  const columnNames = new Set(columns.map((column) => column.name));

  const addIfMissing = async (name, definition) => {
    if (!columnNames.has(name)) {
      await db.exec(`ALTER TABLE submissions ADD COLUMN ${name} ${definition}`);
    }
  };

  await addIfMissing('desired_completion_date', 'TEXT');
  await addIfMissing('impact_details', 'TEXT');
  await addIfMissing('enhancement_request_type', 'TEXT');
  await addIfMissing('priority_level', 'TEXT');
  await addIfMissing('jira_number', 'TEXT');
  await addIfMissing('easyvista_submitted_by', 'TEXT');
}

async function ensureRetiredStatusSupport(db) {
  const table = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'submissions'");
  const sql = String(table?.sql || '');
  if (sql.includes("'Retired'")) {
    return;
  }

  await db.exec('PRAGMA foreign_keys = OFF;');
  await db.exec('BEGIN TRANSACTION;');

  try {
    await db.exec(`
      CREATE TABLE submissions_new (
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
        duplicate_of INTEGER,
        easyvista_ticket_id TEXT,
        desired_completion_date TEXT,
        impact_details TEXT,
        enhancement_request_type TEXT,
        priority_level TEXT,
        jira_number TEXT,
        easyvista_submitted_by TEXT,
        is_public INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (duplicate_of) REFERENCES submissions(id)
      );
    `);

    await db.exec(`
      INSERT INTO submissions_new (
        id, created_at, updated_at, created_by, created_by_email, type, application_name,
        policy_num, account_num, transaction_num, screen_title, summary_of_issue,
        steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
        status, reviewer, decision_notes, fingerprint, duplicate_of, easyvista_ticket_id,
        desired_completion_date, impact_details, enhancement_request_type, priority_level,
        jira_number, easyvista_submitted_by, is_public
      )
      SELECT
        id, created_at, updated_at, created_by, created_by_email, type, application_name,
        policy_num, account_num, transaction_num, screen_title, summary_of_issue,
        steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
        status, reviewer, decision_notes, fingerprint, duplicate_of, easyvista_ticket_id,
        desired_completion_date, impact_details, enhancement_request_type, priority_level,
        jira_number, easyvista_submitted_by, is_public
      FROM submissions;
    `);

    await db.exec('DROP TABLE submissions;');
    await db.exec('ALTER TABLE submissions_new RENAME TO submissions;');

    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  } finally {
    await db.exec('PRAGMA foreign_keys = ON;');
  }

  await db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public);');
}

async function backfillStatusHistory(db) {
  const rows = await db.all(
    `
    SELECT s.id, s.status, s.updated_at
    FROM submissions s
    LEFT JOIN submission_status_events e ON e.submission_id = s.id
    GROUP BY s.id
    HAVING COUNT(e.id) = 0
  `,
  );

  for (const row of rows) {
    await db.run(
      `
      INSERT INTO submission_status_events (submission_id, status, changed_at, changed_by)
      VALUES (?, ?, ?, ?)
    `,
      [row.id, row.status, row.updated_at || new Date().toISOString(), 'system-migrated'],
    );
  }
}

async function initDb() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec('PRAGMA foreign_keys = ON;');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'rep'))
    );

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
      duplicate_of INTEGER,
      easyvista_ticket_id TEXT,
      desired_completion_date TEXT,
      impact_details TEXT,
      enhancement_request_type TEXT,
      priority_level TEXT,
      jira_number TEXT,
      easyvista_submitted_by TEXT,
      is_public INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (duplicate_of) REFERENCES submissions(id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('admin', 'rep')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submission_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_type ON submissions(type);
    CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(is_public);
    CREATE INDEX IF NOT EXISTS idx_attachments_submission_id ON attachments(submission_id);
    CREATE INDEX IF NOT EXISTS idx_status_events_submission_id ON submission_status_events(submission_id);
    CREATE INDEX IF NOT EXISTS idx_status_events_status ON submission_status_events(status);
  `);

  await ensureSubmissionColumns(db);
  await ensureRetiredStatusSupport(db);
  await backfillStatusHistory(db);

  return db;
}

module.exports = {
  initDb,
  DB_PATH,
};
