const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const { initDb } = require('./db');
const { ensureAdmin } = require('./auth');
const { submitToEasyVista } = require('./easyvista');

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-me';
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const tempUploadDir = path.join(uploadsRoot, 'tmp');

fs.mkdirSync(tempUploadDir, { recursive: true });

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true,
  },
});

const sessionMiddleware = session({
  name: 'bc_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
});

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use('/uploads', express.static(uploadsRoot));

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const role = socket.request?.session?.user?.role;
  if (role === 'admin') {
    socket.join('admins');
  }
  socket.join('public-watchers');
});

function emitAdminNotification(event, payload) {
  io.to('admins').emit('admin:notification', {
    event,
    payload,
    at: new Date().toISOString(),
  });
}

function emitPublicUpdate(payload) {
  io.to('public-watchers').emit('public:update', {
    payload,
    at: new Date().toISOString(),
  });
}

const tempUpload = multer({
  dest: tempUploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

const ENHANCEMENT_REQUEST_TYPES = [
  'Build-PPM Funded Project',
  'Build-Small Enhancement',
  'Build-Small Project (Not PPM Funded)',
  'Run-Compliance/Regulatory/Rate Revision',
  'Run-Other Operational Work',
];

function toBooleanSql(value) {
  return value ? 1 : 0;
}

function mapSubmission(row) {
  if (!row) return null;
  return {
    ...row,
    is_public: Boolean(row.is_public),
  };
}

function toIsoOrNow(input) {
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function isBlank(value) {
  return String(value ?? '').trim().length === 0;
}

function defectDateTimeIso(body) {
  if (!isBlank(body.date_time_of_error)) {
    return toIsoOrNow(body.date_time_of_error);
  }

  const dateValue = String(body.date_of_error || '').trim();
  if (!dateValue) {
    return null;
  }

  const timeValue = String(body.time_of_error || '').trim() || '00:00';
  const parsed = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

async function withDb(handler) {
  const db = await initDb();
  try {
    return await handler(db);
  } finally {
    await db.close();
  }
}

async function persistUploadedFiles(db, submissionId, files, uploadedByRole) {
  if (!files || files.length === 0) return [];

  const destDir = path.join(uploadsRoot, String(submissionId));
  fs.mkdirSync(destDir, { recursive: true });

  const inserted = [];

  for (const file of files) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalName = `${Date.now()}-${safeName}`;
    const finalPath = path.join(destDir, finalName);
    fs.renameSync(file.path, finalPath);

    const uploadedAt = new Date().toISOString();
    const result = await db.run(
      `
      INSERT INTO attachments (submission_id, filename, mime_type, file_path, uploaded_at, uploaded_by_role)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [
        submissionId,
        file.originalname,
        file.mimetype || 'application/octet-stream',
        path.relative(path.join(__dirname, '..'), finalPath).replaceAll('\\\\', '/'),
        uploadedAt,
        uploadedByRole,
      ],
    );

    inserted.push({
      id: result.lastID,
      submission_id: submissionId,
      filename: file.originalname,
      mime_type: file.mimetype || 'application/octet-stream',
      file_path: path.relative(path.join(__dirname, '..'), finalPath).replaceAll('\\\\', '/'),
      uploaded_at: uploadedAt,
      uploaded_by_role: uploadedByRole,
    });
  }

  return inserted;
}

async function logStatusChange(db, submissionId, status, changedBy, changedAt) {
  await db.run(
    `
    INSERT INTO submission_status_events (submission_id, status, changed_at, changed_by)
    VALUES (?, ?, ?, ?)
  `,
    [submissionId, status, changedAt || new Date().toISOString(), changedBy || null],
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  return withDb(async (db) => {
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || user.role !== 'admin') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };

    return res.json({
      user: req.session.user,
    });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bc_sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ user: null });
  }

  return res.json({ user: req.session.user });
});

app.post('/api/submissions', tempUpload.array('attachments', 3), async (req, res) => {
  const {
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
    date_of_error,
    time_of_error,
    desired_completion_date,
  } = req.body;

  if (!['defect', 'enhancement'].includes(type)) {
    return res.status(400).json({ error: 'Invalid submission type' });
  }

  if (isBlank(created_by)) {
    return res.status(400).json({ error: 'Requestor Name is required' });
  }

  let normalized = {
    created_by: String(created_by).trim(),
    created_by_email: String(created_by_email || '-').trim() || '-',
    type,
    application_name: String(application_name || '').trim() || 'Billing Center',
    policy_num: policy_num || null,
    account_num: account_num || null,
    transaction_num: transaction_num || null,
    screen_title: String(screen_title || '').trim(),
    summary_of_issue: String(summary_of_issue || '').trim(),
    steps_to_reproduce: String(steps_to_reproduce || '').trim(),
    what_happened_exact_details: String(what_happened_exact_details || '').trim(),
    request: String(request || '').trim(),
    date_time_of_error: toIsoOrNow(date_time_of_error),
    desired_completion_date: desired_completion_date || null,
  };

  if (type === 'defect') {
    const defectDateTime = defectDateTimeIso({ date_time_of_error, date_of_error, time_of_error });
    if (!defectDateTime) {
      return res.status(400).json({ error: 'Date of error is required' });
    }

    if (isBlank(summary_of_issue) || isBlank(screen_title) || isBlank(what_happened_exact_details)) {
      return res.status(400).json({
        error:
          'Summary of Issue, Screen Title, and What Happened (Exact Details) are required for defects',
      });
    }

    if (!req.files || req.files.length < 1) {
      return res.status(400).json({ error: 'At least one screenshot is required for defects' });
    }

    normalized = {
      ...normalized,
      application_name: normalized.application_name || 'Billing Center',
      steps_to_reproduce: normalized.steps_to_reproduce || '-',
      request: normalized.request || '-',
      date_time_of_error: defectDateTime,
      desired_completion_date: null,
    };
  }

  if (type === 'enhancement') {
    if (isBlank(summary_of_issue) || isBlank(request) || isBlank(desired_completion_date)) {
      return res.status(400).json({
        error:
          'Summary, Request Details, and Desired Completion Date are required for enhancements',
      });
    }

    normalized = {
      ...normalized,
      application_name: 'Billing Center',
      policy_num: null,
      account_num: null,
      transaction_num: null,
      screen_title: '-',
      steps_to_reproduce: '-',
      what_happened_exact_details: '-',
      date_time_of_error: toIsoOrNow(date_time_of_error),
      desired_completion_date: toIsoOrNow(desired_completion_date),
      priority_level: '3 - Medium',
    };
  }

  return withDb(async (db) => {
    const now = new Date().toISOString();
    const insert = await db.run(
      `
      INSERT INTO submissions (
        created_at, updated_at, created_by, created_by_email, type, application_name,
        policy_num, account_num, transaction_num, screen_title, summary_of_issue,
        steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
        status, reviewer, decision_notes, fingerprint, duplicate_of, easyvista_ticket_id,
        desired_completion_date, impact_details, enhancement_request_type, priority_level, jira_number, is_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, 0)
    `,
      [
        now,
        now,
        normalized.created_by,
        normalized.created_by_email,
        normalized.type,
        normalized.application_name,
        normalized.policy_num,
        normalized.account_num,
        normalized.transaction_num,
        normalized.screen_title,
        normalized.summary_of_issue,
        normalized.steps_to_reproduce,
        normalized.what_happened_exact_details,
        normalized.request,
        normalized.date_time_of_error,
        normalized.desired_completion_date,
        normalized.priority_level || null,
      ],
    );

    await persistUploadedFiles(db, insert.lastID, req.files || [], 'rep');
    await logStatusChange(db, insert.lastID, 'New', normalized.created_by || 'rep', now);

    const created = await db.get('SELECT * FROM submissions WHERE id = ?', [insert.lastID]);
    emitAdminNotification('submission:new', mapSubmission(created));

    return res.status(201).json({
      id: insert.lastID,
      message: 'Submission created',
    });
  });
});

app.get('/api/public/submissions', async (_req, res) => {
  return withDb(async (db) => {
    const rows = await db.all(
      `
      SELECT s.id, s.created_at, s.updated_at, s.created_by, s.type, s.application_name,
             s.policy_num, s.account_num, s.summary_of_issue,
             s.what_happened_exact_details, s.request,
             s.status, s.easyvista_ticket_id, s.is_public,
             (
               SELECT e.changed_at
               FROM submission_status_events e
               WHERE e.submission_id = s.id
               ORDER BY e.changed_at DESC
               LIMIT 1
             ) AS latest_status_changed_at,
             (
               SELECT e.status
               FROM submission_status_events e
               WHERE e.submission_id = s.id
               ORDER BY e.changed_at DESC
               LIMIT 1
             ) AS latest_status_value,
             (
               SELECT MAX(e.changed_at)
               FROM submission_status_events e
               WHERE e.submission_id = s.id AND e.status = 'Submitted'
             ) AS submitted_status_at,
             (
               SELECT MAX(e.changed_at)
               FROM submission_status_events e
               WHERE e.submission_id = s.id AND e.status = 'Deployed'
             ) AS deployed_status_at,
             (
               SELECT MAX(e.changed_at)
               FROM submission_status_events e
               WHERE e.submission_id = s.id AND e.status = 'Duplicate'
             ) AS duplicate_status_at,
             (
               SELECT MAX(e.changed_at)
               FROM submission_status_events e
               WHERE e.submission_id = s.id AND e.status = 'Retired'
             ) AS retired_status_at
      FROM submissions s
      WHERE s.is_public = 1
      ORDER BY updated_at DESC
    `,
    );

    res.json(rows.map(mapSubmission));
  });
});

app.get('/api/public/submissions/:id', async (req, res) => {
  return withDb(async (db) => {
    const submission = await db.get(
      `SELECT * FROM submissions WHERE id = ? AND is_public = 1`,
      [req.params.id],
    );

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const attachments = await db.all(
      'SELECT * FROM attachments WHERE submission_id = ? ORDER BY uploaded_at DESC',
      [req.params.id],
    );

    return res.json({
      ...mapSubmission(submission),
      attachments,
    });
  });
});

app.get('/api/admin/submissions', ensureAdmin, async (req, res) => {
  const { status, statuses, type, search, requester, submittedBy, sort } = req.query;

  return withDb(async (db) => {
    const clauses = [];
    const params = [];

    const statusList = String(statuses || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (statusList.length > 0) {
      clauses.push(`status IN (${statusList.map(() => '?').join(',')})`);
      params.push(...statusList);
    } else if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (type) {
      clauses.push('type = ?');
      params.push(type);
    }
    if (search) {
      clauses.push('(COALESCE(policy_num, \'\') LIKE ? OR COALESCE(account_num, \'\') LIKE ? OR summary_of_issue LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (requester) {
      clauses.push('created_by LIKE ?');
      params.push(`%${requester}%`);
    }
    if (submittedBy) {
      clauses.push('COALESCE(easyvista_submitted_by, \'\') LIKE ?');
      params.push(`%${submittedBy}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sortMap = {
      updated_desc: 'updated_at DESC',
      updated_asc: 'updated_at ASC',
      created_desc: 'created_at DESC',
      created_asc: 'created_at ASC',
      requester_asc: 'created_by COLLATE NOCASE ASC',
      requester_desc: 'created_by COLLATE NOCASE DESC',
      submitted_by_asc: 'COALESCE(easyvista_submitted_by, \'\') COLLATE NOCASE ASC',
      submitted_by_desc: 'COALESCE(easyvista_submitted_by, \'\') COLLATE NOCASE DESC',
    };
    const orderBy = sortMap[String(sort || '')] || sortMap.updated_desc;

    const rows = await db.all(
      `
      SELECT id, created_at, updated_at, created_by, created_by_email, type, application_name,
             policy_num, account_num, transaction_num, screen_title, summary_of_issue,
             status, reviewer, decision_notes, easyvista_ticket_id, easyvista_submitted_by, is_public
      FROM submissions
      ${where}
      ORDER BY ${orderBy}
    `,
      params,
    );

    return res.json(rows.map(mapSubmission));
  });
});

app.get('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const submission = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const attachments = await db.all(
      'SELECT * FROM attachments WHERE submission_id = ? ORDER BY uploaded_at DESC',
      [req.params.id],
    );

    const status_events = await db.all(
      `
      SELECT id, submission_id, status, changed_at, changed_by
      FROM submission_status_events
      WHERE submission_id = ?
      ORDER BY changed_at DESC
    `,
      [req.params.id],
    );

    return res.json({
      ...mapSubmission(submission),
      attachments,
      status_events,
    });
  });
});

app.put('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  const allowedStatuses = ['New', 'Approved', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired'];
  const body = req.body || {};

  return withDb(async (db) => {
    const existing = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const next = {
      type: body.type ?? existing.type,
      application_name: body.application_name ?? existing.application_name,
      policy_num: body.policy_num ?? existing.policy_num,
      account_num: body.account_num ?? existing.account_num,
      transaction_num: body.transaction_num ?? existing.transaction_num,
      screen_title: body.screen_title ?? existing.screen_title,
      summary_of_issue: body.summary_of_issue ?? existing.summary_of_issue,
      steps_to_reproduce: body.steps_to_reproduce ?? existing.steps_to_reproduce,
      what_happened_exact_details:
        body.what_happened_exact_details ?? existing.what_happened_exact_details,
      request: body.request ?? existing.request,
      date_time_of_error: body.date_time_of_error
        ? toIsoOrNow(body.date_time_of_error)
        : existing.date_time_of_error,
      status: body.status ?? existing.status,
      reviewer: body.reviewer ?? existing.reviewer,
      decision_notes: body.decision_notes ?? existing.decision_notes,
      fingerprint: body.fingerprint ?? existing.fingerprint,
      desired_completion_date:
        body.desired_completion_date === ''
          ? null
          : body.desired_completion_date
            ? toIsoOrNow(body.desired_completion_date)
            : existing.desired_completion_date,
      impact_details: body.impact_details ?? existing.impact_details,
      enhancement_request_type:
        body.enhancement_request_type ?? existing.enhancement_request_type,
      priority_level: body.priority_level ?? existing.priority_level,
      jira_number: body.jira_number ?? existing.jira_number,
      duplicate_of:
        body.duplicate_of === '' || body.duplicate_of === null
          ? null
          : body.duplicate_of ?? existing.duplicate_of,
      is_public:
        typeof body.is_public === 'boolean' ? body.is_public : Boolean(existing.is_public),
    };

    if (!allowedStatuses.includes(next.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!['defect', 'enhancement'].includes(next.type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    if (
      next.type === 'enhancement' &&
      next.enhancement_request_type &&
      !ENHANCEMENT_REQUEST_TYPES.includes(next.enhancement_request_type)
    ) {
      return res.status(400).json({ error: 'Invalid enhancement request type' });
    }

    if (next.type === 'enhancement' && isBlank(next.priority_level)) {
      next.priority_level = '3 - Medium';
    }

    const updatedAt = new Date().toISOString();
    await db.run(
      `
      UPDATE submissions
      SET
        updated_at = ?,
        type = ?,
        application_name = ?,
        policy_num = ?,
        account_num = ?,
        transaction_num = ?,
        screen_title = ?,
        summary_of_issue = ?,
        steps_to_reproduce = ?,
        what_happened_exact_details = ?,
        request = ?,
        date_time_of_error = ?,
        status = ?,
        reviewer = ?,
        decision_notes = ?,
        fingerprint = ?,
        desired_completion_date = ?,
        impact_details = ?,
        enhancement_request_type = ?,
        priority_level = ?,
        jira_number = ?,
        duplicate_of = ?,
        is_public = ?
      WHERE id = ?
    `,
      [
        updatedAt,
        next.type,
        next.application_name,
        next.policy_num,
        next.account_num,
        next.transaction_num,
        next.screen_title,
        next.summary_of_issue,
        next.steps_to_reproduce,
        next.what_happened_exact_details,
        next.request,
        next.date_time_of_error,
        next.status,
        next.reviewer,
        next.decision_notes,
        next.fingerprint,
        next.desired_completion_date,
        next.impact_details,
        next.enhancement_request_type,
        next.priority_level,
        next.jira_number,
        next.duplicate_of,
        toBooleanSql(next.is_public),
        req.params.id,
      ],
    );

    if (next.status !== existing.status) {
      await logStatusChange(
        db,
        Number(req.params.id),
        next.status,
        req.session?.user?.username || null,
        updatedAt,
      );
    }

    const saved = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    emitAdminNotification('submission:updated', mapSubmission(saved));
    if (saved.is_public) {
      emitPublicUpdate(mapSubmission(saved));
    }

    return res.json(mapSubmission(saved));
  });
});

app.post(
  '/api/admin/submissions/:id/attachments',
  ensureAdmin,
  tempUpload.array('attachments', 10),
  async (req, res) => {
    return withDb(async (db) => {
      const existing = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
      if (!existing) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      const created = await persistUploadedFiles(db, existing.id, req.files || [], 'admin');

      await db.run('UPDATE submissions SET updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        existing.id,
      ]);

      emitAdminNotification('attachment:added', {
        submission_id: existing.id,
        count: created.length,
      });

      return res.status(201).json(created);
    });
  },
);

app.delete('/api/admin/attachments/:id', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const attachment = await db.get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const absolute = path.join(__dirname, '..', attachment.file_path);
    if (fs.existsSync(absolute)) {
      fs.rmSync(absolute, { force: true });
    }

    await db.run('DELETE FROM attachments WHERE id = ?', [req.params.id]);
    await db.run('UPDATE submissions SET updated_at = ? WHERE id = ?', [
      new Date().toISOString(),
      attachment.submission_id,
    ]);

    emitAdminNotification('attachment:removed', {
      id: attachment.id,
      submission_id: attachment.submission_id,
    });

    return res.json({ ok: true });
  });
});

app.post('/api/admin/submissions/:id/submit-easyvista', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const submission = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.type === 'enhancement') {
      const missing = [];
      if (isBlank(submission.impact_details)) {
        missing.push('Impact Details');
      }
      if (
        isBlank(submission.enhancement_request_type) ||
        !ENHANCEMENT_REQUEST_TYPES.includes(submission.enhancement_request_type)
      ) {
        missing.push('Request Type');
      }

      if (missing.length > 0) {
        return res.status(400).json({
          error: `Enhancement cannot be submitted. Missing required fields: ${missing.join(', ')}`,
        });
      }
    }

    const result = await submitToEasyVista(submission);

    const updatedAt = new Date().toISOString();
    const easyVistaSubmittedBy = req.session?.user?.username || null;
    await db.run(
      `
      UPDATE submissions
      SET easyvista_ticket_id = ?, status = 'Submitted', updated_at = ?, easyvista_submitted_by = ?
      WHERE id = ?
    `,
      [result.ticketId, updatedAt, easyVistaSubmittedBy, submission.id],
    );

    if (submission.status !== 'Submitted') {
      await logStatusChange(db, submission.id, 'Submitted', easyVistaSubmittedBy, updatedAt);
    }

    const updated = await db.get('SELECT * FROM submissions WHERE id = ?', [submission.id]);
    emitAdminNotification('submission:submitted-easyvista', mapSubmission(updated));

    return res.json({
      ticketId: result.ticketId,
      source: result.source,
      submission: mapSubmission(updated),
    });
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
