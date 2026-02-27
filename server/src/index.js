const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const cors = require('cors');
const dotenv = require('dotenv');
const XLSX = require('xlsx');
const { Server } = require('socket.io');
const { ensureAdmin } = require('./auth');
const { submitToEasyVista } = require('./easyvista');

dotenv.config();

const dbApi = require('../db');

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

const DEFECT_ENHANCEMENT_STATUSES = [
  'New',
  'Approved',
  'Backlog - Monitoring Impact',
  'Future Consideration',
  'Deferred – Not in Current Scope',
  'Rejected',
  'Duplicate',
  'Submitted',
  'Deployed',
];
const DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED = [...DEFECT_ENHANCEMENT_STATUSES, 'Retired'];

const IMPORT_COLUMN_TARGETS = [
  { key: 'created_by', label: 'Requester Name', aliases: ['created_by', 'requester_name', 'requester', 'submitted_by_name'] },
  { key: 'created_by_email', label: 'Requester Email', aliases: ['created_by_email', 'requester_email', 'email'] },
  { key: 'summary_of_issue', label: 'Summary', aliases: ['summary_of_issue', 'summary', 'title', 'issue_summary'] },
  { key: 'status', label: 'Status', aliases: ['status', 'defect_enhancement_status'] },
  { key: 'policy_num', label: 'Policy # Column', aliases: ['policy_num', 'policy_number'] },
  { key: 'account_num', label: 'Account # Column', aliases: ['account_num', 'account_number'] },
  {
    key: 'combined_policy_account',
    label: 'Combined Policy/Account Column',
    aliases: ['policy_account', 'policy_account_num', 'policy_account_number', 'policy_or_account'],
  },
  { key: 'transaction_num', label: 'Transaction #', aliases: ['transaction_num', 'transaction_number'] },
  { key: 'screen_title', label: 'Screen Title', aliases: ['screen_title', 'screen'] },
  { key: 'steps_to_reproduce', label: 'Steps to Reproduce', aliases: ['steps_to_reproduce', 'steps'] },
  {
    key: 'what_happened_exact_details',
    label: 'Description',
    aliases: ['what_happened_exact_details', 'description', 'details'],
  },
  { key: 'request', label: 'Request', aliases: ['request', 'requested_change'] },
  {
    key: 'date_time_of_error',
    label: 'Date/Time of Error',
    aliases: ['date_time_of_error', 'error_datetime', 'error_date_time', 'date_of_error'],
  },
  {
    key: 'desired_completion_date',
    label: 'Desired Completion Date',
    aliases: ['desired_completion_date', 'target_date'],
  },
  { key: 'impact_details', label: 'Impact Details', aliases: ['impact_details'] },
  { key: 'impact_notes', label: 'Impact Notes', aliases: ['impact_notes'] },
  { key: 'policy_premium_impact', label: 'Policy Premium Impact', aliases: ['policy_premium_impact'] },
  { key: 'direct_dollar_impact', label: 'Direct Dollar Impact', aliases: ['direct_dollar_impact'] },
  { key: 'policies_affected_count', label: 'Policies Affected Count', aliases: ['policies_affected_count'] },
  { key: 'jira_number', label: 'JIRA Number', aliases: ['jira_number', 'jira'] },
  { key: 'release_number', label: 'Release Number', aliases: ['release_number', 'release'] },
  { key: 'release_notes', label: 'Release Notes', aliases: ['release_notes'] },
  { key: 'easyvista_ticket_id', label: 'EASYVISTA Number', aliases: ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id'] },
  { key: 'reviewer', label: 'Reviewer', aliases: ['reviewer'] },
  { key: 'decision_notes', label: 'Decision Notes', aliases: ['decision_notes'] },
  { key: 'enhancement_request_type', label: 'Enhancement Request Type', aliases: ['enhancement_request_type', 'request_type'] },
  { key: 'priority_level', label: 'Priority', aliases: ['priority_level', 'priority'] },
  { key: 'application_name', label: 'Application', aliases: ['application_name', 'application'] },
  { key: 'easyvista_submitted_by', label: 'EasyVista Submitted By', aliases: ['easyvista_submitted_by', 'submitted_by_easyvista'] },
  { key: 'is_public', label: 'Public', aliases: ['is_public', 'public'] },
  { key: 'is_retired', label: 'Retired', aliases: ['is_retired', 'retired'] },
  { key: 'is_cleanup', label: 'Cleanup', aliases: ['is_cleanup', 'cleanup'] },
  { key: 'cleanup_status', label: 'Cleanup Status', aliases: ['cleanup_status'] },
  { key: 'cleanup_tag_type', label: 'Cleanup Tag Type', aliases: ['cleanup_tag_type', 'cleanup_type'] },
  { key: 'type', label: 'Type', aliases: ['type', 'ticket_type', 'defect_or_enhancement'] },
  { key: 'created_at', label: 'Created At', aliases: ['created_at', 'reported_at', 'submitted_at', 'date_submitted'] },
  { key: 'closed_date', label: 'Closed Date', aliases: ['closed_date', 'closed_at', 'date_closed'] },
  { key: 'updated_at', label: 'Updated At', aliases: ['updated_at', 'status_update_at', 'last_updated_at'] },
];

const CLEANUP_STATUSES = ['Not Started', 'In Progress', 'Completed'];
const CLEANUP_TAG_TYPES = ['defect', 'enhancement', 'cleanup_only'];
const CLEANUP_TO_SUBMISSION_STATUS = {
  'Not Started': 'New',
  'In Progress': 'Approved',
  Completed: 'Deployed',
};
const SUBMISSION_TO_CLEANUP_STATUS = {
  New: 'Not Started',
  Approved: 'In Progress',
  Submitted: 'In Progress',
  Deployed: 'Completed',
};

function toBooleanSql(value) {
  return value ? 1 : 0;
}

function mapSubmission(row) {
  if (!row) return null;
  const isCleanup = Boolean(row.is_cleanup);
  const baseStatus = row.status || 'New';
  const isRetired = Boolean(row.is_retired) || String(baseStatus) === 'Retired';
  const cleanupStatus = isCleanup
    ? (row.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[baseStatus] || 'Not Started')
    : null;

  return {
    ...row,
    status: baseStatus,
    defect_enhancement_status: baseStatus,
    is_public: Boolean(row.is_public),
    is_retired: isRetired,
    is_cleanup: isCleanup,
    cleanup_status: cleanupStatus,
    cleanup_status_display: cleanupStatus || 'No Cleanup',
    cleanup_tag_type: row.cleanup_tag_type || null,
    is_resubmission: Boolean(row.is_resubmission),
    resubmission_of_submission_id: row.resubmission_of_submission_id || null,
    resubmission_of_easyvista_ticket_id: row.resubmission_of_easyvista_ticket_id || null,
    has_resubmission: Boolean(row.has_resubmission),
    latest_resubmission_submission_id: row.latest_resubmission_submission_id || null,
    latest_resubmission_easyvista_ticket_id: row.latest_resubmission_easyvista_ticket_id || null,
  };
}

function toSortableTimestamp(value, fallback) {
  const parsed = new Date(value || fallback || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function buildStatusTimeline(submission, rawEvents) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const isCleanupOnly = Boolean(submission?.is_cleanup)
    && String(submission?.cleanup_tag_type || '').trim().toLowerCase() === 'cleanup_only';
  const normalized = events
    .filter((event) => event && event.status)
    .map((event) => ({
      id: event.id,
      submission_id: event.submission_id ?? submission.id,
      status: String(event.status).trim(),
      changed_at: event.changed_at || submission.updated_at,
      changed_by: event.changed_by || null,
    }));

  const hasCleanupStatusEvent = normalized.some(
    (event) => String(event.status || '').startsWith('Cleanup Status:'),
  );

  const hasCreatedEvent = normalized.some((event) => {
    const value = String(event.status || '').trim();
    if (value === 'New') return true;
    if (isCleanupOnly && value.startsWith('Cleanup Status:')) return true;
    return false;
  });

  if (!hasCreatedEvent && submission.created_at) {
    normalized.push({
      id: `synthetic-created-${submission.id}`,
      submission_id: submission.id,
      status: isCleanupOnly ? 'Cleanup Status: New Cleanup item created' : 'New',
      changed_at: submission.created_at,
      changed_by: 'system-synthesized',
    });
  }

  const currentStatus = String(submission.status || '').trim();
  const hasCurrentStatus = normalized.some((event) => {
    const value = String(event.status || '').trim();
    if (!value) return false;
    if (value === currentStatus) return true;
    if (value === `Defect/Enhancement Status: ${currentStatus}`) return true;
    if (isCleanupOnly && value.startsWith('Cleanup Status:')) return true;
    if (isCleanupOnly && value === 'Defect/Enhancement Status: Switched to Cleanup Only') return true;
    return false;
  });

  if (currentStatus && !hasCurrentStatus) {
    if (!isCleanupOnly) {
      normalized.push({
        id: `synthetic-current-${submission.id}`,
        submission_id: submission.id,
        status: currentStatus,
        changed_at: submission.updated_at || submission.created_at || new Date().toISOString(),
        changed_by: submission.reviewer || 'system-synthesized',
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const event of normalized) {
    const key = [event.status, event.changed_at, event.changed_by || ''].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }

  return deduped.sort((left, right) => {
    const byTime = toSortableTimestamp(right.changed_at, submission.updated_at)
      - toSortableTimestamp(left.changed_at, submission.updated_at);
    if (byTime !== 0) return byTime;

    const leftId = Number(left.id);
    const rightId = Number(right.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId)) {
      return rightId - leftId;
    }
    return String(right.id).localeCompare(String(left.id));
  });
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

function normalizeCleanupTagType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CLEANUP_TAG_TYPES.includes(normalized) ? normalized : null;
}

function normalizeImportHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeStatusToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeImportRow(raw) {
  const normalized = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const normalizedKey = normalizeImportHeader(key);
    if (!normalizedKey || Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) {
      continue;
    }
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function suggestImportMappings(headers = []) {
  const normalizedLookup = new Map();
  for (const header of headers) {
    normalizedLookup.set(normalizeImportHeader(header), header);
  }

  const suggested = {};
  for (const target of IMPORT_COLUMN_TARGETS) {
    const matchedAlias = target.aliases.find((alias) => normalizedLookup.has(alias));
    suggested[target.key] = matchedAlias ? normalizedLookup.get(matchedAlias) : '';
  }
  return suggested;
}

function normalizeColumnMappings(columnMappings) {
  if (!columnMappings || typeof columnMappings !== 'object') return {};
  const normalized = {};
  for (const target of IMPORT_COLUMN_TARGETS) {
    const raw = columnMappings[target.key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    normalized[target.key] = normalizeImportHeader(trimmed);
  }
  return normalized;
}

function getMappedImportValue(row, targetKey, aliases, columnMappings, fallback = null) {
  const mappedHeader = columnMappings?.[targetKey];
  const keys = [];
  if (mappedHeader) keys.push(mappedHeader);
  if (Array.isArray(aliases)) keys.push(...aliases);
  return getImportValue(row, keys, fallback);
}

function getImportValue(row, aliases, fallback = null) {
  const keys = Array.isArray(aliases) ? aliases : [aliases];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return fallback;
}

function parseImportBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

function parseImportNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function splitIdentifierTokens(value) {
  if (value === null || value === undefined) return [];
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split(/[\n,;\t|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function classifyIdentifierToken(token) {
  const normalized = String(token || '').trim().replace(/\s+/g, '');
  if (!normalized) return { kind: 'unknown', value: '' };
  if (/^\d{7}(-\d{2})?$/.test(normalized)) {
    return { kind: 'policy', value: normalized };
  }
  const accountDigits = normalized.replace(/[^\d]/g, '');
  if (accountDigits.length === 10) {
    return { kind: 'account', value: accountDigits };
  }
  return { kind: 'unknown', value: normalized };
}

function dedupeValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parsePolicyAndAccountNumbers(row, options = {}) {
  const columnMappings = normalizeColumnMappings(options?.columnMappings || {});
  const combinedValue = getMappedImportValue(
    row,
    'combined_policy_account',
    ['policy_account', 'policy_account_num', 'policy_account_number', 'policy_or_account'],
    columnMappings,
    '',
  );

  const policyCandidates = [
    getMappedImportValue(row, 'policy_num', ['policy_num', 'policy_number'], columnMappings, ''),
    combinedValue,
  ];
  const accountCandidates = [
    getMappedImportValue(row, 'account_num', ['account_num', 'account_number'], columnMappings, ''),
    combinedValue,
  ];

  const policyValues = [];
  const accountValues = [];

  for (const candidate of policyCandidates) {
    for (const token of splitIdentifierTokens(candidate)) {
      const parsed = classifyIdentifierToken(token);
      if (parsed.kind === 'policy') {
        policyValues.push(parsed.value);
      } else if (parsed.kind === 'account') {
        accountValues.push(parsed.value);
      }
    }
  }

  for (const candidate of accountCandidates) {
    for (const token of splitIdentifierTokens(candidate)) {
      const parsed = classifyIdentifierToken(token);
      if (parsed.kind === 'account') {
        accountValues.push(parsed.value);
      } else if (parsed.kind === 'policy') {
        policyValues.push(parsed.value);
      }
    }
  }

  const uniquePolicies = dedupeValues(policyValues);
  const uniqueAccounts = dedupeValues(accountValues);

  return {
    policyNum: uniquePolicies.length > 0 ? uniquePolicies.join(', ') : null,
    accountNum: uniqueAccounts.length > 0 ? uniqueAccounts.join(', ') : null,
  };
}

app.post('/api/admin/submissions/import-xlsx/analyze', ensureAdmin, tempUpload.single('file'), async (req, res) => {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx or .xls).' });
  }

  const extension = path.extname(uploadedFile.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(extension)) {
    fs.rmSync(uploadedFile.path, { force: true });
    return res.status(400).json({ error: 'Unsupported file type. Please upload .xlsx or .xls.' });
  }

  try {
    const workbook = XLSX.readFile(uploadedFile.path, { cellDates: true, cellText: true });
    const requestedSheet = String(req.body?.sheet || req.query?.sheet || '').trim();
    const sheetName = requestedSheet && workbook.SheetNames.includes(requestedSheet)
      ? requestedSheet
      : workbook.SheetNames[0];

    if (!sheetName) {
      return res.status(400).json({ error: 'No worksheet found in the uploaded file.' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'The worksheet is empty. Add header row and data rows.' });
    }

    const headers = Object.keys(rawRows[0] || {});
    const normalizedHeaders = headers.map((header) => normalizeImportHeader(header));
    const suggestedMappings = suggestImportMappings(headers);
    const normalizedSuggestedMappings = normalizeColumnMappings(suggestedMappings);

    const applicationAliases = ['application_name', 'application'];
    const mappedApplicationHeader = normalizedSuggestedMappings.application_name || '';
    const hasApplicationColumn = Boolean(mappedApplicationHeader)
      || applicationAliases.some((alias) => normalizedHeaders.includes(alias));

    const unknownStatusesSet = new Set();
    rawRows.forEach((rawRow) => {
      const row = normalizeImportRow(rawRow);
      const rawStatus = String(
        getMappedImportValue(
          row,
          'status',
          ['status', 'defect_enhancement_status'],
          normalizedSuggestedMappings,
          '',
        ) || '',
      ).trim();
      if (!rawStatus) return;
      if (!DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED.includes(rawStatus)) {
        unknownStatusesSet.add(rawStatus);
      }
    });

    return res.json({
      sheet: sheetName,
      headers,
      mappingTargets: IMPORT_COLUMN_TARGETS.map((target) => ({ key: target.key, label: target.label })),
      suggestedMappings,
      requiresApplicationDefault: !hasApplicationColumn,
      unknownStatuses: Array.from(unknownStatusesSet),
      allowedStatuses: DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED,
      previewRows: Math.min(rawRows.length, 5),
      totalRows: rawRows.length,
    });
  } finally {
    fs.rmSync(uploadedFile.path, { force: true });
  }
});

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
  await dbApi.init();

  const db = {
    get: async (sql, params = []) => {
      const rows = await dbApi.query(sql, params);
      return rows[0] || null;
    },
    all: async (sql, params = []) => dbApi.query(sql, params),
    run: async (sql, params = []) => {
      const result = await dbApi.execute(sql, params);
      return {
        lastID: result.lastInsertId,
        changes: result.rowCount,
      };
    },
    close: async () => {},
  };

  return handler(db);
}

function parseErrorsJson(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
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

app.get('/api/admin/submissions/import-xlsx/history', ensureAdmin, async (req, res) => {
  const requestedLimit = Number.parseInt(String(req.query?.limit || '10'), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 50)
    : 10;

  return withDb(async (db) => {
    const rows = await db.all(
      `
      SELECT *
      FROM excel_import_runs
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ?
    `,
      [limit],
    );

    return res.json(rows.map(mapExcelImportRun));
  });
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
    return res.status(400).json({ error: 'Requester Name is required' });
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
        created_at, updated_at, created_via, created_by, created_by_email, type, application_name,
        policy_num, account_num, transaction_num, screen_title, summary_of_issue,
        steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
        status, reviewer, decision_notes, fingerprint, duplicate_of, easyvista_ticket_id,
        desired_completion_date, impact_details, enhancement_request_type, priority_level, jira_number, is_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, NULL, 0)
    `,
      [
        now,
        now,
        'rep_form',
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
               s.status, s.easyvista_ticket_id, s.jira_number, s.is_public, s.is_retired,
               s.is_resubmission, s.resubmission_of_submission_id, s.resubmission_of_easyvista_ticket_id,
               s.has_resubmission, s.latest_resubmission_submission_id, s.latest_resubmission_easyvista_ticket_id,
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
  const {
    status,
    statuses,
    type,
    search,
    requester,
    submittedBy,
    createdVia,
    retiredFilter,
    year,
    inJira,
    jiraNumber,
    releaseNumber,
    sort,
  } = req.query;

  return withDb(async (db) => {
    const clauses = [];
    const params = [];

    const statusList = String(statuses || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const cleanupOnlySelected = statusList.includes('Cleanup Only');
    const cleanupMarkedSelected = statusList.includes('Cleanup Marked');
    const normalizedStatuses = statusList
      .filter((value) => value !== 'Cleanup Only' && value !== 'Cleanup Marked')
      .map((value) => CLEANUP_TO_SUBMISSION_STATUS[value] || value);
    const normalizedStatus = CLEANUP_TO_SUBMISSION_STATUS[String(status || '').trim()] || status;

    if (retiredFilter !== 'retired_only' && statusList.length > 0) {
      const statusClauses = [];
      if (normalizedStatuses.length > 0) {
        statusClauses.push(`status IN (${normalizedStatuses.map(() => '?').join(',')})`);
        params.push(...normalizedStatuses);
      }
      if (cleanupOnlySelected) {
        statusClauses.push("(COALESCE(is_cleanup, 0) = 1 AND COALESCE(cleanup_tag_type, '') = 'cleanup_only')");
      }
      if (cleanupMarkedSelected) {
        statusClauses.push('COALESCE(is_cleanup, 0) = 1');
      }
      if (statusClauses.length > 0) {
        clauses.push(`(${statusClauses.join(' OR ')})`);
      }
    } else if (retiredFilter !== 'retired_only' && normalizedStatus) {
      if (normalizedStatus === 'Cleanup Only') {
        clauses.push("(COALESCE(is_cleanup, 0) = 1 AND COALESCE(cleanup_tag_type, '') = 'cleanup_only')");
      } else if (normalizedStatus === 'Cleanup Marked') {
        clauses.push('COALESCE(is_cleanup, 0) = 1');
      } else {
        clauses.push('status = ?');
        params.push(normalizedStatus);
      }
    }
    if (type) {
      if (String(type).toLowerCase() === 'cleanup') {
        clauses.push('COALESCE(is_cleanup, 0) = 1');
      } else {
        clauses.push('type = ?');
        params.push(type);
      }
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
    if (createdVia) {
      const normalizedCreatedVia = String(createdVia || '').trim().toLowerCase();
      const allowedCreatedVia = [
        'rep_form',
        'admin_excel_import',
        'admin_backdated',
        'admin_cleanup',
        'admin_manual',
        'admin_easyvista_resubmission',
      ];
      if (allowedCreatedVia.includes(normalizedCreatedVia)) {
        clauses.push('created_via = ?');
        params.push(normalizedCreatedVia);
      }
    }
    if (retiredFilter === 'retired_only') {
      clauses.push("(COALESCE(is_retired, 0) = 1 OR status = 'Retired')");
    } else if (retiredFilter === 'non_retired') {
      clauses.push("(COALESCE(is_retired, 0) = 0 AND status <> 'Retired')");
    }
    if (year) {
      clauses.push('SUBSTR(created_at, 1, 4) = ?');
      params.push(String(year).trim());
    }
    if (inJira === 'yes') {
      clauses.push('COALESCE(logged_defect, 0) = 1');
    } else if (inJira === 'no') {
      clauses.push('COALESCE(logged_defect, 0) = 0');
    }
    if (jiraNumber) {
      clauses.push("COALESCE(jira_number, '') LIKE ?");
      params.push(`%${jiraNumber}%`);
    }
    if (releaseNumber) {
      clauses.push("COALESCE(release_number, '') LIKE ?");
      params.push(`%${releaseNumber}%`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sortMap = {
      updated_desc: 'status_update_at DESC',
      updated_asc: 'status_update_at ASC',
      created_desc: 'created_at DESC',
      created_asc: 'created_at ASC',
      requester_asc: 'created_by COLLATE NOCASE ASC',
      requester_desc: 'created_by COLLATE NOCASE DESC',
      submitted_by_asc: 'COALESCE(easyvista_submitted_by, \'\') COLLATE NOCASE ASC',
      submitted_by_desc: 'COALESCE(easyvista_submitted_by, \'\') COLLATE NOCASE DESC',
      policy_premium_impact_desc: 'COALESCE(policy_premium_impact, 0) DESC',
      policy_premium_impact_asc: 'COALESCE(policy_premium_impact, 0) ASC',
      direct_dollar_impact_desc: 'COALESCE(direct_dollar_impact, 0) DESC',
      direct_dollar_impact_asc: 'COALESCE(direct_dollar_impact, 0) ASC',
      policies_affected_count_desc: 'COALESCE(policies_affected_count, 0) DESC',
      policies_affected_count_asc: 'COALESCE(policies_affected_count, 0) ASC',
      logged_defect_desc: 'COALESCE(logged_defect, 0) DESC',
      logged_defect_asc: 'COALESCE(logged_defect, 0) ASC',
      jira_number_asc: "COALESCE(jira_number, '') COLLATE NOCASE ASC",
      jira_number_desc: "COALESCE(jira_number, '') COLLATE NOCASE DESC",
      type_asc: 'type COLLATE NOCASE ASC',
      type_desc: 'type COLLATE NOCASE DESC',
      summary_asc: 'summary_of_issue COLLATE NOCASE ASC',
      summary_desc: 'summary_of_issue COLLATE NOCASE DESC',
      status_asc: 'status COLLATE NOCASE ASC',
      status_desc: 'status COLLATE NOCASE DESC',
      public_asc: 'COALESCE(is_public, 0) ASC',
      public_desc: 'COALESCE(is_public, 0) DESC',
      release_number_asc: "COALESCE(release_number, '') COLLATE NOCASE ASC",
      release_number_desc: "COALESCE(release_number, '') COLLATE NOCASE DESC",
      easyvista_asc: "COALESCE(easyvista_ticket_id, '') COLLATE NOCASE ASC",
      easyvista_desc: "COALESCE(easyvista_ticket_id, '') COLLATE NOCASE DESC",
    };
    const orderBy = sortMap[String(sort || '')] || sortMap.updated_desc;

    const rows = await db.all(
      `
      SELECT id, created_at, updated_at, created_by, created_by_email, type, application_name,
             policy_num, account_num, transaction_num, screen_title, summary_of_issue,
              status, reviewer, decision_notes, easyvista_ticket_id, easyvista_submitted_by, is_public, is_retired,
                  impact_notes, policy_premium_impact, direct_dollar_impact, policies_affected_count,
                  jira_number, logged_defect, release_number, release_notes, is_cleanup, cleanup_status, cleanup_tag_type,
              created_via,
                  is_resubmission, resubmission_of_submission_id, resubmission_of_easyvista_ticket_id,
                  has_resubmission, latest_resubmission_submission_id, latest_resubmission_easyvista_ticket_id,
                  (
                    SELECT MAX(e.changed_at)
                    FROM submission_status_events e
                    WHERE e.submission_id = submissions.id
                      AND (
                        e.status = 'Retired'
                        OR e.status = 'Unretired'
                        OR e.status = status
                        OR e.status = ('Defect/Enhancement Status: ' || status)
                      )
                  ) AS status_update_at
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
      ORDER BY changed_at DESC, id DESC
    `,
      [req.params.id],
    );

    const timeline = buildStatusTimeline(submission, status_events);

    return res.json({
      ...mapSubmission(submission),
      attachments,
      status_events: timeline,
    });
  });
});

app.post('/api/admin/submissions', ensureAdmin, async (req, res) => {
  const allowedStatuses = DEFECT_ENHANCEMENT_STATUSES;
  const historicalStatuses = [...allowedStatuses, 'Retired'];
  const body = req.body || {};
  const isCleanup = Boolean(body.is_cleanup);
  const cleanupTagType = normalizeCleanupTagType(body.cleanup_tag_type);
  const requestedType = String(body.type || '').trim().toLowerCase();
  const normalizedRequestedType = ['defect', 'enhancement'].includes(requestedType) ? requestedType : null;
  const effectiveType = isCleanup
    ? (cleanupTagType === 'enhancement' ? 'enhancement' : (normalizedRequestedType || 'defect'))
    : normalizedRequestedType;
  const requestedCreatedVia = String(body.created_via || '').trim().toLowerCase();
  const createdVia = ['admin_backdated', 'admin_cleanup', 'admin_manual'].includes(requestedCreatedVia)
    ? requestedCreatedVia
    : 'admin_manual';

  if (!['defect', 'enhancement'].includes(effectiveType)) {
    return res.status(400).json({ error: 'Invalid submission type' });
  }
  if (isBlank(body.created_by)) {
    return res.status(400).json({ error: 'Requester Name is required' });
  }
  if (isBlank(body.summary_of_issue)) {
    return res.status(400).json({ error: 'Summary of Issue is required' });
  }

  const requestedCleanupStatus = String(body.cleanup_status || '').trim();
  const cleanupStatus = isCleanup
    ? (CLEANUP_STATUSES.includes(requestedCleanupStatus) ? requestedCleanupStatus : 'Not Started')
    : null;
  const finalStatus = allowedStatuses.includes(body.status) ? body.status : 'New';

  const createdAt = body.created_at ? toIsoOrNow(body.created_at) : new Date().toISOString();
  const updatedAt = new Date().toISOString();

  // status_events: array of { status, changed_at } for backdated history
  const rawEvents = Array.isArray(body.status_events) ? body.status_events : [];

  return withDb(async (db) => {
    const insert = await db.run(
      `INSERT INTO submissions (
        created_at, updated_at, created_via, created_by, created_by_email, type, application_name,
        policy_num, account_num, transaction_num, screen_title, summary_of_issue,
        steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
        status, reviewer, decision_notes, fingerprint, duplicate_of, easyvista_ticket_id,
        desired_completion_date, impact_details, enhancement_request_type, priority_level,
        jira_number, release_number, release_notes, is_cleanup, cleanup_status, cleanup_tag_type, easyvista_submitted_by, is_public, is_retired, logged_defect
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        createdAt,
        updatedAt,
        createdVia,
        String(body.created_by).trim(),
        String(body.created_by_email || '-').trim() || '-',
        effectiveType,
        String(body.application_name || 'Billing Center').trim() || 'Billing Center',
        body.policy_num || null,
        body.account_num || null,
        body.transaction_num || null,
        String(body.screen_title || '-').trim() || '-',
        String(body.summary_of_issue).trim(),
        String(body.steps_to_reproduce || '-').trim() || '-',
        String(body.what_happened_exact_details || '-').trim() || '-',
        String(body.request || '-').trim() || '-',
        body.date_time_of_error ? toIsoOrNow(body.date_time_of_error) : createdAt,
        finalStatus,
        body.reviewer || null,
        body.decision_notes || null,
        null,
        null,
        body.easyvista_ticket_id ? String(body.easyvista_ticket_id).trim() : null,
        body.desired_completion_date ? toIsoOrNow(body.desired_completion_date) : null,
        body.impact_details || null,
        body.enhancement_request_type || null,
        body.priority_level || (effectiveType === 'enhancement' ? '3 - Medium' : null),
        body.jira_number ? String(body.jira_number).trim() : null,
        body.release_number ? String(body.release_number).trim() : null,
        body.release_notes || null,
        toBooleanSql(isCleanup),
        cleanupStatus,
        cleanupTagType,
        String(body.easyvista_submitted_by || '').trim() || 'Unknown',
        toBooleanSql(body.is_public),
        0,
        toBooleanSql(body.logged_defect),
      ],
    );

    const subId = insert.lastID;

    // Insert backdated status events in chronological order
    const eventsToInsert = rawEvents
      .filter((e) => e?.status && e?.changed_at)
      .map((e) => {
        const statusInput = String(e.status || '').trim();
        const mappedStatus = isCleanup
          ? (CLEANUP_TO_SUBMISSION_STATUS[statusInput] || statusInput)
          : statusInput;
        return {
          status: mappedStatus,
          changed_at: toIsoOrNow(e.changed_at),
        };
      })
      .filter((e) => historicalStatuses.includes(e.status))
      .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

    // Always ensure the "created" / initial New event is present at the start
    const shouldUseCleanupCreatedEvent = isCleanup
      && cleanupTagType === 'cleanup_only'
      && cleanupStatus === 'Not Started';

    if (eventsToInsert.length === 0 || eventsToInsert[0].status !== 'New') {
      await logStatusChange(
        db,
        subId,
        shouldUseCleanupCreatedEvent ? 'Cleanup Status: New Cleanup item created' : 'New',
        req.session?.user?.username || 'admin',
        createdAt,
      );
    }

    for (const ev of eventsToInsert) {
      await logStatusChange(db, subId, ev.status, req.session?.user?.username || 'admin', ev.changed_at);
    }

    // If final status isn't covered by provided events, log it now
    const coveredStatuses = new Set(eventsToInsert.map((e) => e.status));
    if (!coveredStatuses.has(finalStatus) && finalStatus !== 'New') {
      await logStatusChange(db, subId, finalStatus, req.session?.user?.username || 'admin', updatedAt);
    }

    const formatTypeLabel = (value) => (String(value || '').trim().toLowerCase() === 'enhancement'
      ? 'Enhancement'
      : 'Defect');
    const formatCleanupTagTypeLabel = (value) => {
      const normalizedValue = String(value || '').trim().toLowerCase();
      if (normalizedValue === 'cleanup_only') return 'Cleanup Only';
      if (normalizedValue === 'enhancement') return 'Enhancement + Cleanup';
      if (normalizedValue === 'defect') return 'Defect + Cleanup';
      return 'None';
    };

    await logStatusChange(
      db,
      subId,
      `Type: ${formatTypeLabel(effectiveType)}`,
      req.session?.user?.username || 'admin',
      updatedAt,
    );

    if (isCleanup) {
      await logStatusChange(
        db,
        subId,
        'Cleanup Task: Checked',
        req.session?.user?.username || 'admin',
        updatedAt,
      );
    }

    if (cleanupTagType) {
      await logStatusChange(
        db,
        subId,
        `Cleanup Tag: Added (${formatCleanupTagTypeLabel(cleanupTagType)})`,
        req.session?.user?.username || 'admin',
        updatedAt,
      );
    }

    const created = await db.get('SELECT * FROM submissions WHERE id = ?', [subId]);
    emitAdminNotification('submission:new', mapSubmission(created));
    return res.status(201).json(mapSubmission(created));
  });
});

app.put('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  const allowedStatuses = DEFECT_ENHANCEMENT_STATUSES;
  const body = req.body || {};

  return withDb(async (db) => {
    const existing = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const incomingDuplicateReference =
      body.duplicate_reference ?? body.duplicate_of ?? existing.duplicate_reference ?? existing.duplicate_of;
    const duplicateReference = isBlank(incomingDuplicateReference)
      ? null
      : String(incomingDuplicateReference).trim();
    const duplicateOfNumeric =
      duplicateReference && /^\d+$/.test(duplicateReference) ? Number(duplicateReference) : null;
    const policyPremiumImpact = isBlank(body.policy_premium_impact)
      ? null
      : Number(body.policy_premium_impact);
    const directDollarImpact = isBlank(body.direct_dollar_impact)
      ? null
      : Number(body.direct_dollar_impact);
    const policiesAffectedCount = isBlank(body.policies_affected_count)
      ? null
      : Number(body.policies_affected_count);

    const isCleanup =
      typeof body.is_cleanup === 'boolean' ? body.is_cleanup : Boolean(existing.is_cleanup);

    const hasCleanupTagType = Object.prototype.hasOwnProperty.call(body, 'cleanup_tag_type');
    const incomingCleanupTagType = normalizeCleanupTagType(body.cleanup_tag_type);
    const existingCleanupTagType = normalizeCleanupTagType(existing.cleanup_tag_type);

    const requestedCleanupStatus = String(body.cleanup_status || '').trim();
    const nextCleanupStatus = isCleanup
      ? (CLEANUP_STATUSES.includes(requestedCleanupStatus)
          ? requestedCleanupStatus
          : (existing.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[existing.status] || 'Not Started'))
      : null;

    const nextCleanupTagType = isCleanup
      ? (hasCleanupTagType ? incomingCleanupTagType : existingCleanupTagType)
      : null;

    const nextType = isCleanup
      ? (nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect')
      : (body.type ?? existing.type);
    const normalizedExistingStatus = allowedStatuses.includes(String(existing.status || '').trim())
      ? String(existing.status || '').trim()
      : 'New';
    const existingRetired = Boolean(existing.is_retired) || String(existing.status || '') === 'Retired';
    const nextIsRetired =
      typeof body.is_retired === 'boolean' ? body.is_retired : existingRetired;

    const next = {
      type: nextType,
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
      status: body.status ?? normalizedExistingStatus,
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
      impact_notes: body.impact_notes ?? existing.impact_notes,
      policy_premium_impact:
        Number.isFinite(policyPremiumImpact) ? policyPremiumImpact : existing.policy_premium_impact,
      direct_dollar_impact:
        Number.isFinite(directDollarImpact) ? directDollarImpact : existing.direct_dollar_impact,
      policies_affected_count:
        Number.isFinite(policiesAffectedCount)
          ? Math.trunc(policiesAffectedCount)
          : existing.policies_affected_count,
      logged_defect:
        typeof body.logged_defect === 'boolean' ? body.logged_defect : Boolean(existing.logged_defect),
      enhancement_request_type:
        body.enhancement_request_type ?? existing.enhancement_request_type,
      priority_level: body.priority_level ?? existing.priority_level,
      jira_number: body.jira_number ?? existing.jira_number,
      release_number: body.release_number ?? existing.release_number,
      release_notes: body.release_notes ?? existing.release_notes,
      is_cleanup: isCleanup,
      cleanup_status: nextCleanupStatus,
      cleanup_tag_type: nextCleanupTagType,
      is_retired: nextIsRetired,
      duplicate_reference: duplicateReference,
      duplicate_of: duplicateOfNumeric,
      is_public:
        typeof body.is_public === 'boolean' ? body.is_public : Boolean(existing.is_public),
    };

    if (!allowedStatuses.includes(next.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!['defect', 'enhancement'].includes(next.type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const isEditingEnhancementRequestType = Object.prototype.hasOwnProperty.call(
      body,
      'enhancement_request_type',
    );
    if (
      next.type === 'enhancement' &&
      isEditingEnhancementRequestType &&
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
        impact_notes = ?,
        policy_premium_impact = ?,
        direct_dollar_impact = ?,
        policies_affected_count = ?,
        logged_defect = ?,
        enhancement_request_type = ?,
        priority_level = ?,
        jira_number = ?,
        release_number = ?,
        release_notes = ?,
        is_cleanup = ?,
        cleanup_status = ?,
        cleanup_tag_type = ?,
        is_retired = ?,
        duplicate_reference = ?,
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
        next.impact_notes,
        next.policy_premium_impact,
        next.direct_dollar_impact,
        next.policies_affected_count,
        toBooleanSql(next.logged_defect),
        next.enhancement_request_type,
        next.priority_level,
        next.jira_number,
        next.release_number,
        next.release_notes,
        toBooleanSql(next.is_cleanup),
        next.cleanup_status,
        next.cleanup_tag_type,
        toBooleanSql(next.is_retired),
        next.duplicate_reference,
        next.duplicate_of,
        toBooleanSql(next.is_public),
        req.params.id,
      ],
    );

    const statusChanged = String(next.status || '') !== String(existing.status || '');
    const retiredStateChanged = Boolean(next.is_retired) !== Boolean(existing.is_retired);
    const cleanupStatusChanged =
      Boolean(next.is_cleanup) !== Boolean(existing.is_cleanup)
      || String(next.cleanup_status || '') !== String(existing.cleanup_status || '');
    const wasCleanupOnly =
      Boolean(existing.is_cleanup) && String(existing.cleanup_tag_type || '') === 'cleanup_only';
    const isCleanupOnlyNow = Boolean(next.is_cleanup) && String(next.cleanup_tag_type || '') === 'cleanup_only';
    const switchedToCleanupOnly =
      isCleanupOnlyNow
      && !wasCleanupOnly;
    const transitionCleanupTagType = String(next.cleanup_tag_type || '').trim();
    const transitionType = String(next.type || '').trim();
    const switchedFromCleanupOnly =
      wasCleanupOnly
      && !isCleanupOnlyNow
      && (
        (Boolean(next.is_cleanup) && ['defect', 'enhancement'].includes(transitionCleanupTagType))
        || (!Boolean(next.is_cleanup) && ['defect', 'enhancement'].includes(transitionType))
      );
    const switchedFromCleanupOnlyTarget = Boolean(next.is_cleanup)
      ? transitionCleanupTagType
      : transitionType;
    const switchedFromCleanupOnlyLabel = switchedFromCleanupOnlyTarget === 'enhancement'
      ? 'Enhancement'
      : 'Defect';
    const switchedFromCleanupOnlyMessage = Boolean(next.is_cleanup)
      ? `Defect/Enhancement Status: Switched to ${switchedFromCleanupOnlyLabel} and Cleanup type`
      : `Defect/Enhancement Status: Switched to ${switchedFromCleanupOnlyLabel} only`;
    const resolveEffectiveType = (typeValue, isCleanupValue, cleanupTagTypeValue) => {
      if (Boolean(isCleanupValue)) {
        return String(cleanupTagTypeValue || '').trim().toLowerCase() === 'enhancement'
          ? 'enhancement'
          : 'defect';
      }
      return String(typeValue || '').trim().toLowerCase() === 'enhancement'
        ? 'enhancement'
        : 'defect';
    };
    const existingEffectiveType = resolveEffectiveType(
      existing.type,
      existing.is_cleanup,
      existingCleanupTagType,
    );
    const nextEffectiveType = resolveEffectiveType(
      next.type,
      next.is_cleanup,
      nextCleanupTagType,
    );
    const typeChanged = nextEffectiveType !== existingEffectiveType;
    const formatTypeLabel = (value) => (String(value || '').trim().toLowerCase() === 'enhancement'
      ? 'Enhancement'
      : 'Defect');
    const formatTypeStateLabel = (effectiveTypeValue, isCleanupValue, cleanupTagTypeValue) => {
      const normalizedCleanupTagType = String(cleanupTagTypeValue || '').trim().toLowerCase();
      if (Boolean(isCleanupValue)) {
        if (normalizedCleanupTagType === 'cleanup_only') return 'Cleanup Only';
        return String(effectiveTypeValue || '').trim().toLowerCase() === 'enhancement'
          ? 'Enhancement + Cleanup'
          : 'Defect + Cleanup';
      }
      return formatTypeLabel(effectiveTypeValue);
    };
    const cleanupOnlyStatusReset =
      isCleanupOnlyNow
      && statusChanged
      && String(next.status || '') === 'New';
    const logCleanupOnlyTransition = switchedToCleanupOnly || cleanupOnlyStatusReset;

    if (logCleanupOnlyTransition) {
      await logStatusChange(
        db,
        Number(req.params.id),
        'Defect/Enhancement Status: Switched to Cleanup Only',
        req.session?.user?.username || null,
        updatedAt,
      );
    } else if (switchedFromCleanupOnly) {
      await logStatusChange(
        db,
        Number(req.params.id),
        switchedFromCleanupOnlyMessage,
        req.session?.user?.username || null,
        updatedAt,
      );
    } else if (statusChanged) {
      await logStatusChange(
        db,
        Number(req.params.id),
        `Defect/Enhancement Status: ${next.status}`,
        req.session?.user?.username || null,
        updatedAt,
      );
    }

    if (retiredStateChanged) {
      await logStatusChange(
        db,
        Number(req.params.id),
        next.is_retired ? 'Retired' : 'Unretired',
        req.session?.user?.username || null,
        updatedAt,
      );
    }

    if (cleanupStatusChanged) {
      const cleanupLabel = next.is_cleanup ? (next.cleanup_status || 'Not Started') : 'No Cleanup';
      const skipRedundantCleanupNotStarted =
        logCleanupOnlyTransition && cleanupLabel === 'Not Started';
      if (!skipRedundantCleanupNotStarted) {
        await logStatusChange(
          db,
          Number(req.params.id),
          `Cleanup Status: ${cleanupLabel}`,
          req.session?.user?.username || null,
          updatedAt,
        );
      }
    }

    if (typeChanged) {
      const previousTypeStateLabel = formatTypeStateLabel(
        existingEffectiveType,
        existing.is_cleanup,
        existingCleanupTagType,
      );
      const nextTypeStateLabel = formatTypeStateLabel(
        nextEffectiveType,
        next.is_cleanup,
        nextCleanupTagType,
      );
      await logStatusChange(
        db,
        Number(req.params.id),
        `Type Changed: From (${previousTypeStateLabel}) to (${nextTypeStateLabel})`,
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

app.post('/api/admin/submissions/import-xlsx', ensureAdmin, tempUpload.single('file'), async (req, res) => {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'Please upload an Excel file (.xlsx or .xls).' });
  }

  const extension = path.extname(uploadedFile.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(extension)) {
    fs.rmSync(uploadedFile.path, { force: true });
    return res.status(400).json({ error: 'Unsupported file type. Please upload .xlsx or .xls.' });
  }

  const requestedImportMode = String(req.body?.importMode || req.query?.importMode || '').trim().toLowerCase();
  const importMode = ['defect', 'enhancement', 'cleanup'].includes(requestedImportMode)
    ? requestedImportMode
    : null;
  if (!importMode) {
    fs.rmSync(uploadedFile.path, { force: true });
    return res.status(400).json({
      error: 'Choose import type: Defect, Enhancement, or Cleanup.',
    });
  }

  let columnMappings = {};
  try {
    if (req.body?.columnMappings) {
      columnMappings = typeof req.body.columnMappings === 'string'
        ? JSON.parse(req.body.columnMappings)
        : req.body.columnMappings;
    }
  } catch {
    columnMappings = {};
  }
  const normalizedColumnMappings = normalizeColumnMappings(columnMappings);

  const defaultApplicationNameRaw = String(req.body?.defaultApplicationName || '').trim();
  const defaultApplicationName = ['Billing Center', 'Policy Center'].includes(defaultApplicationNameRaw)
    ? defaultApplicationNameRaw
    : '';

  let statusValueMappings = {};
  try {
    if (req.body?.statusValueMappings) {
      statusValueMappings = typeof req.body.statusValueMappings === 'string'
        ? JSON.parse(req.body.statusValueMappings)
        : req.body.statusValueMappings;
    }
  } catch {
    statusValueMappings = {};
  }
  const normalizedStatusValueMappings = {};
  if (statusValueMappings && typeof statusValueMappings === 'object') {
    for (const [rawKey, rawValue] of Object.entries(statusValueMappings)) {
      const fromKey = normalizeStatusToken(rawKey);
      const toStatus = String(rawValue || '').trim();
      if (!fromKey) continue;
      if (!DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED.includes(toStatus)) continue;
      normalizedStatusValueMappings[fromKey] = toStatus;
    }
  }

  try {
    const workbook = XLSX.readFile(uploadedFile.path, {
      cellDates: true,
      cellText: true,
    });

    const requestedSheet = String(req.body?.sheet || req.query?.sheet || '').trim();
    const sheetName = requestedSheet && workbook.SheetNames.includes(requestedSheet)
      ? requestedSheet
      : workbook.SheetNames[0];

    if (!sheetName) {
      return res.status(400).json({ error: 'No worksheet found in the uploaded file.' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      raw: false,
      blankrows: false,
    });

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'The worksheet is empty. Add header row and data rows.' });
    }

    const availableHeaders = Object.keys(rawRows[0] || {});
    const normalizedHeaders = availableHeaders.map((header) => normalizeImportHeader(header));
    const knownIdentifierHeaders = [
      'policy_num',
      'policy_number',
      'account_num',
      'account_number',
      'policy_account',
      'policy_account_num',
      'policy_account_number',
      'policy_or_account',
    ];
    const hasAutoIdentifierMapping = knownIdentifierHeaders.some((header) => normalizedHeaders.includes(header));
    const normalizedMappedCombinedHeader = normalizedColumnMappings.combined_policy_account || '';
    const normalizedMappedApplicationHeader = normalizedColumnMappings.application_name || '';
    const hasAutoApplicationMapping = ['application_name', 'application'].some((header) => normalizedHeaders.includes(header));

    if (normalizedMappedApplicationHeader && !normalizedHeaders.includes(normalizedMappedApplicationHeader)) {
      return res.status(400).json({
        error: 'Mapped Application column was not found in this file. Please select a valid column name.',
        mappingRequired: true,
        mappingField: 'applicationColumn',
        availableHeaders,
      });
    }

    if (!hasAutoApplicationMapping && !normalizedMappedApplicationHeader && !defaultApplicationName) {
      return res.status(400).json({
        error: 'No Application column was detected. Please choose a default application before importing.',
        mappingRequired: true,
        mappingField: 'defaultApplicationName',
        availableApplications: ['Billing Center', 'Policy Center'],
      });
    }

    if (normalizedMappedCombinedHeader && !normalizedHeaders.includes(normalizedMappedCombinedHeader)) {
      return res.status(400).json({
        error: 'Mapped combined Policy/Account column was not found in this file. Please select a valid column name.',
        mappingRequired: true,
        mappingField: 'combinedPolicyAccountColumn',
        availableHeaders,
      });
    }

    if (!hasAutoIdentifierMapping && !normalizedMappedCombinedHeader) {
      return res.status(400).json({
        error: 'Could not auto-map Policy/Account columns. Please choose the combined Policy/Account column and retry.',
        mappingRequired: true,
        mappingField: 'combinedPolicyAccountColumn',
        availableHeaders,
      });
    }

    const dryRun = ['1', 'true', 'yes'].includes(String(req.body?.dryRun || req.query?.dryRun || '').trim().toLowerCase());
    const preparedRows = [];
    const errors = [];
    const unknownStatusesDetected = new Set();

    rawRows.forEach((rawRow, index) => {
      const rowNumber = index + 2;
      const row = normalizeImportRow(rawRow);
      const identifiers = parsePolicyAndAccountNumbers(row, {
        columnMappings: normalizedColumnMappings,
      });

      const createdByRaw = String(getMappedImportValue(row, 'created_by', ['created_by', 'requester_name', 'requester', 'submitted_by_name'], normalizedColumnMappings, '') || '').trim();
      const summaryOfIssueRaw = String(getMappedImportValue(row, 'summary_of_issue', ['summary_of_issue', 'summary', 'title', 'issue_summary'], normalizedColumnMappings, '') || '').trim();
      const createdBy = createdByRaw || '-';
      const summaryOfIssue = summaryOfIssueRaw || '-';
      const requestedType = String(getMappedImportValue(row, 'type', ['type', 'ticket_type', 'defect_or_enhancement'], normalizedColumnMappings, 'defect') || 'defect').trim().toLowerCase();

      const statusInput = String(getMappedImportValue(row, 'status', ['status', 'defect_enhancement_status'], normalizedColumnMappings, '') || '').trim();
      let importedStatus = 'New';
      if (!statusInput) {
        importedStatus = 'New';
      } else if (DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED.includes(statusInput)) {
        importedStatus = statusInput;
      } else {
        const mappedStatus = normalizedStatusValueMappings[normalizeStatusToken(statusInput)] || '';
        if (mappedStatus && DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED.includes(mappedStatus)) {
          importedStatus = mappedStatus;
        } else {
          unknownStatusesDetected.add(statusInput);
          errors.push(`Row ${rowNumber}: unrecognized status "${statusInput}". Map this status before importing.`);
          return;
        }
      }
      const importedIsRetired = parseImportBoolean(getMappedImportValue(row, 'is_retired', ['is_retired', 'retired'], normalizedColumnMappings, false), false)
        || importedStatus === 'Retired';
      const finalStatus = importedStatus === 'Retired' ? 'New' : importedStatus;

      const rowCleanupTagType = normalizeCleanupTagType(getMappedImportValue(row, 'cleanup_tag_type', ['cleanup_tag_type', 'cleanup_type'], normalizedColumnMappings, null));
      const inferredCleanup = parseImportBoolean(getMappedImportValue(row, 'is_cleanup', ['is_cleanup', 'cleanup'], normalizedColumnMappings, false), false) || Boolean(rowCleanupTagType);
      const isCleanup = importMode === 'cleanup' ? true : inferredCleanup;
      const requestedCleanupStatus = String(getMappedImportValue(row, 'cleanup_status', ['cleanup_status'], normalizedColumnMappings, '') || '').trim();
      const cleanupStatus = isCleanup
        ? (CLEANUP_STATUSES.includes(requestedCleanupStatus) ? requestedCleanupStatus : 'Not Started')
        : null;
      const effectiveCleanupTagType = isCleanup
        ? (importMode === 'cleanup' ? 'cleanup_only' : (rowCleanupTagType || 'cleanup_only'))
        : null;

      let effectiveType = ['defect', 'enhancement'].includes(requestedType) ? requestedType : 'defect';
      if (importMode === 'defect') {
        effectiveType = 'defect';
      } else if (importMode === 'enhancement') {
        effectiveType = 'enhancement';
      } else if (isCleanup) {
        effectiveType = effectiveCleanupTagType === 'enhancement' ? 'enhancement' : 'defect';
      }

      const finalIsCleanup = importMode === 'cleanup' ? true : isCleanup;
      const finalCleanupTagType = finalIsCleanup ? effectiveCleanupTagType : null;
      const finalCleanupStatus = finalIsCleanup ? cleanupStatus : null;

      const applicationValue = String(getMappedImportValue(row, 'application_name', ['application_name', 'application'], normalizedColumnMappings, '') || '').trim();
      let applicationName = applicationValue;
      if (!applicationName) {
        applicationName = defaultApplicationName || 'Billing Center';
      }
      const createdAt = toIsoOrNow(getMappedImportValue(row, 'created_at', ['created_at', 'reported_at', 'submitted_at', 'date_submitted'], normalizedColumnMappings, null));
      const closedDateRaw = getMappedImportValue(row, 'closed_date', ['closed_date', 'closed_at', 'date_closed'], normalizedColumnMappings, null);
      const updatedAtRaw = getMappedImportValue(row, 'updated_at', ['updated_at', 'status_update_at', 'last_updated_at'], normalizedColumnMappings, null);
      const updatedAtSource = closedDateRaw || updatedAtRaw || createdAt;
      const updatedAt = toIsoOrNow(updatedAtSource);

      const dateTimeOfErrorRaw = getMappedImportValue(row, 'date_time_of_error', ['date_time_of_error', 'error_datetime', 'error_date_time', 'date_of_error'], normalizedColumnMappings, null);
      const dateTimeOfError = dateTimeOfErrorRaw ? toIsoOrNow(dateTimeOfErrorRaw) : createdAt;

      const enhancementRequestTypeRaw = getMappedImportValue(
        row,
        'enhancement_request_type',
        ['enhancement_request_type', 'request_type'],
        normalizedColumnMappings,
        null,
      );
      const enhancementRequestType = isBlank(enhancementRequestTypeRaw)
        ? null
        : String(enhancementRequestTypeRaw).trim();
      const priorityLevelRaw = getMappedImportValue(row, 'priority_level', ['priority_level', 'priority'], normalizedColumnMappings, null);
      const priorityLevel = isBlank(priorityLevelRaw)
        ? (effectiveType === 'enhancement' ? '3 - Medium' : null)
        : String(priorityLevelRaw).trim();

      preparedRows.push({
        rowNumber,
        created_at: createdAt,
        updated_at: updatedAt,
        created_by: createdBy,
        created_by_email: String(getMappedImportValue(row, 'created_by_email', ['created_by_email', 'requester_email', 'email'], normalizedColumnMappings, '-') || '-').trim() || '-',
        type: effectiveType,
        application_name: applicationName,
        policy_num: identifiers.policyNum,
        account_num: identifiers.accountNum,
        transaction_num: isBlank(getMappedImportValue(row, 'transaction_num', ['transaction_num', 'transaction_number'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'transaction_num', ['transaction_num', 'transaction_number'], normalizedColumnMappings, '')).trim(),
        screen_title: String(getMappedImportValue(row, 'screen_title', ['screen_title', 'screen'], normalizedColumnMappings, '-') || '-').trim() || '-',
        summary_of_issue: summaryOfIssue,
        steps_to_reproduce: String(getMappedImportValue(row, 'steps_to_reproduce', ['steps_to_reproduce', 'steps'], normalizedColumnMappings, '-') || '-').trim() || '-',
        what_happened_exact_details: String(getMappedImportValue(row, 'what_happened_exact_details', ['what_happened_exact_details', 'description', 'details'], normalizedColumnMappings, '-') || '-').trim() || '-',
        request: String(getMappedImportValue(row, 'request', ['request', 'requested_change'], normalizedColumnMappings, '-') || '-').trim() || '-',
        date_time_of_error: dateTimeOfError,
        status: finalStatus,
        reviewer: isBlank(getMappedImportValue(row, 'reviewer', ['reviewer'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'reviewer', ['reviewer'], normalizedColumnMappings, '')).trim(),
        decision_notes: isBlank(getMappedImportValue(row, 'decision_notes', ['decision_notes'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'decision_notes', ['decision_notes'], normalizedColumnMappings, '')).trim(),
        desired_completion_date: isBlank(getMappedImportValue(row, 'desired_completion_date', ['desired_completion_date', 'target_date'], normalizedColumnMappings, null))
          ? null
          : toIsoOrNow(getMappedImportValue(row, 'desired_completion_date', ['desired_completion_date', 'target_date'], normalizedColumnMappings, null)),
        impact_details: isBlank(getMappedImportValue(row, 'impact_details', ['impact_details'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'impact_details', ['impact_details'], normalizedColumnMappings, '')).trim(),
        impact_notes: isBlank(getMappedImportValue(row, 'impact_notes', ['impact_notes'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'impact_notes', ['impact_notes'], normalizedColumnMappings, '')).trim(),
        policy_premium_impact: parseImportNumber(getMappedImportValue(row, 'policy_premium_impact', ['policy_premium_impact'], normalizedColumnMappings, null)),
        direct_dollar_impact: parseImportNumber(getMappedImportValue(row, 'direct_dollar_impact', ['direct_dollar_impact'], normalizedColumnMappings, null)),
        policies_affected_count: parseImportNumber(getMappedImportValue(row, 'policies_affected_count', ['policies_affected_count'], normalizedColumnMappings, null)),
        logged_defect: parseImportBoolean(getMappedImportValue(row, 'logged_defect', ['logged_defect', 'in_jira'], normalizedColumnMappings, false), false),
        enhancement_request_type: enhancementRequestType,
        priority_level: priorityLevel,
        jira_number: isBlank(getMappedImportValue(row, 'jira_number', ['jira_number', 'jira'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'jira_number', ['jira_number', 'jira'], normalizedColumnMappings, '')).trim(),
        release_number: isBlank(getMappedImportValue(row, 'release_number', ['release_number', 'release'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'release_number', ['release_number', 'release'], normalizedColumnMappings, '')).trim(),
        release_notes: isBlank(getMappedImportValue(row, 'release_notes', ['release_notes'], normalizedColumnMappings, null)) ? null : String(getMappedImportValue(row, 'release_notes', ['release_notes'], normalizedColumnMappings, '')).trim(),
        easyvista_ticket_id: isBlank(getMappedImportValue(row, 'easyvista_ticket_id', ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id'], normalizedColumnMappings, null))
          ? null
          : String(getMappedImportValue(row, 'easyvista_ticket_id', ['easyvista_ticket_id', 'easyvista_ticket', 'easyvista_number', 'easyvista_id', 'ticket_id'], normalizedColumnMappings, '')).trim(),
        is_cleanup: finalIsCleanup,
        cleanup_status: finalCleanupStatus,
        cleanup_tag_type: finalCleanupTagType,
        easyvista_submitted_by: String(getMappedImportValue(row, 'easyvista_submitted_by', ['easyvista_submitted_by', 'submitted_by_easyvista'], normalizedColumnMappings, 'Unknown') || 'Unknown').trim() || 'Unknown',
        is_public: parseImportBoolean(getMappedImportValue(row, 'is_public', ['is_public', 'public'], normalizedColumnMappings, false), false),
        is_retired: importedIsRetired,
        imported_status_label: importedStatus,
      });
    });

    const responseBase = {
      importMode,
      sheet: sheetName,
      totalRows: rawRows.length,
      validRows: preparedRows.length,
      invalidRows: errors.length,
      insertedRows: 0,
      dryRun,
      errors: errors.slice(0, 100),
      unknownStatuses: Array.from(unknownStatusesDetected),
    };

    if (unknownStatusesDetected.size > 0) {
      return res.status(400).json({
        error: 'Some status values do not match available statuses. Please map them and retry.',
        mappingRequired: true,
        mappingField: 'statusValueMappings',
        unknownStatuses: Array.from(unknownStatusesDetected),
        allowedStatuses: DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED,
      });
    }

    return withDb(async (db) => {
      const changedBy = req.session?.user?.username || 'admin';
      let insertedRows = 0;
      const insertionErrors = [];

      if (!dryRun && preparedRows.length > 0) {
        for (const row of preparedRows) {
          try {
            const insertColumns = [
              'created_at', 'updated_at', 'created_via', 'created_by', 'created_by_email', 'type', 'application_name',
              'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
              'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
              'status', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_of', 'easyvista_ticket_id',
              'desired_completion_date', 'impact_details', 'enhancement_request_type', 'priority_level',
              'jira_number', 'release_number', 'release_notes', 'is_cleanup', 'cleanup_status', 'cleanup_tag_type',
              'easyvista_submitted_by', 'is_public', 'is_retired', 'logged_defect',
            ];
            const insertValues = [
              row.created_at,
              row.updated_at,
              'admin_excel_import',
              row.created_by,
              row.created_by_email,
              row.type,
              row.application_name,
              row.policy_num,
              row.account_num,
              row.transaction_num,
              row.screen_title,
              row.summary_of_issue,
              row.steps_to_reproduce,
              row.what_happened_exact_details,
              row.request,
              row.date_time_of_error,
              row.status,
              row.reviewer,
              row.decision_notes,
              null,
              null,
              row.easyvista_ticket_id,
              row.desired_completion_date,
              row.impact_details,
              row.enhancement_request_type,
              row.priority_level,
              row.jira_number,
              row.release_number,
              row.release_notes,
              toBooleanSql(row.is_cleanup),
              row.cleanup_status,
              row.cleanup_tag_type,
              row.easyvista_submitted_by,
              toBooleanSql(row.is_public),
              toBooleanSql(row.is_retired),
              toBooleanSql(row.logged_defect),
            ];
            const placeholders = insertColumns.map(() => '?').join(',');

            const insert = await db.run(
              `INSERT INTO submissions (
                ${insertColumns.join(', ')}
              ) VALUES (${placeholders})`,
              insertValues,
            );

            const submissionId = insert.lastID;
            await logStatusChange(db, submissionId, 'New', changedBy, row.created_at);
            if (row.status !== 'New') {
              await logStatusChange(db, submissionId, row.status, changedBy, row.updated_at);
            }
            if (row.is_retired) {
              await logStatusChange(db, submissionId, 'Retired', changedBy, row.updated_at);
            }

            insertedRows += 1;
          } catch (rowError) {
            const rawMessage = String(rowError?.message || 'Unable to import this row.');
            const normalizedMessage = rawMessage.toLowerCase();
            if (normalizedMessage.includes('values for') && normalizedMessage.includes('columns')) {
              insertionErrors.push(
                `Row ${row.rowNumber}: import template mismatch (field count vs value count). Please contact support; this row was skipped.`,
              );
              continue;
            }
            insertionErrors.push(
              `Row ${row.rowNumber}: ${rawMessage}`,
            );
          }
        }
      }

      if (!dryRun && insertedRows > 0) {
        emitAdminNotification('submissions:bulk-imported', {
          insertedRows,
          totalRows: rawRows.length,
        });
      }

      const combinedErrors = [...responseBase.errors, ...insertionErrors].slice(0, 100);
      const invalidRows = responseBase.invalidRows + insertionErrors.length;
      const status = dryRun
        ? (invalidRows > 0 ? 'partial' : 'success')
        : insertedRows === 0
          ? 'error'
          : invalidRows > 0
            ? 'partial'
            : 'success';
      const summaryMessage = dryRun
        ? `Dry run complete: ${responseBase.validRows} valid row(s), ${invalidRows} invalid row(s).`
        : `Import complete: ${insertedRows} of ${responseBase.totalRows} row(s) added.${invalidRows > 0 ? ` Skipped ${invalidRows} invalid row(s).` : ''}`;

      const historyInsert = await db.run(
        `
        INSERT INTO excel_import_runs (
          created_at, created_by, file_name, sheet_name, import_mode,
          total_rows, valid_rows, invalid_rows, inserted_rows, dry_run,
          status, summary_message, errors_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          new Date().toISOString(),
          changedBy,
          String(uploadedFile.originalname || 'upload.xlsx'),
          sheetName,
          importMode,
          responseBase.totalRows,
          responseBase.validRows,
          invalidRows,
          insertedRows,
          toBooleanSql(dryRun),
          status,
          summaryMessage,
          JSON.stringify(combinedErrors),
        ],
      );
      const historyEntry = await db.get('SELECT * FROM excel_import_runs WHERE id = ?', [historyInsert.lastID]);

      return res.json({
        ...responseBase,
        invalidRows,
        insertedRows,
        errors: combinedErrors,
        historyEntry: mapExcelImportRun(historyEntry),
      });
    });
  } finally {
    fs.rmSync(uploadedFile.path, { force: true });
  }
});

app.post('/api/admin/submissions/:id/submit-easyvista', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const submission = await db.get('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const isResubmissionRequest = !isBlank(submission.easyvista_ticket_id);
    const draftPayload =
      req.body && typeof req.body.draft === 'object' && req.body.draft !== null ? req.body.draft : null;

    const source = {
      ...submission,
    };

    if (isResubmissionRequest && draftPayload) {
      const allowedStatuses = DEFECT_ENHANCEMENT_STATUSES;
      const hasCleanupTagType = Object.prototype.hasOwnProperty.call(draftPayload, 'cleanup_tag_type');
      const incomingCleanupTagType = normalizeCleanupTagType(draftPayload.cleanup_tag_type);
      const existingCleanupTagType = normalizeCleanupTagType(submission.cleanup_tag_type);
      const isCleanup =
        typeof draftPayload.is_cleanup === 'boolean'
          ? draftPayload.is_cleanup
          : Boolean(submission.is_cleanup);
      const requestedCleanupStatus = String(draftPayload.cleanup_status || '').trim();
      const nextCleanupStatus = isCleanup
        ? (CLEANUP_STATUSES.includes(requestedCleanupStatus)
            ? requestedCleanupStatus
            : (submission.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[submission.status] || 'Not Started'))
        : null;
      const nextCleanupTagType = isCleanup
        ? (hasCleanupTagType ? incomingCleanupTagType : existingCleanupTagType)
        : null;
      const requestedType = String(draftPayload.type || '').trim().toLowerCase();
      const nextType = isCleanup
        ? (nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect')
        : (['defect', 'enhancement'].includes(requestedType) ? requestedType : submission.type);
      const requestedStatus = String(draftPayload.status || '').trim();
      const nextStatus = allowedStatuses.includes(requestedStatus) ? requestedStatus : submission.status;

      const policyPremiumImpact = isBlank(draftPayload.policy_premium_impact)
        ? null
        : Number(draftPayload.policy_premium_impact);
      const directDollarImpact = isBlank(draftPayload.direct_dollar_impact)
        ? null
        : Number(draftPayload.direct_dollar_impact);
      const policiesAffectedCount = isBlank(draftPayload.policies_affected_count)
        ? null
        : Number(draftPayload.policies_affected_count);

      source.type = nextType;
      source.status = nextStatus;
      source.is_cleanup = isCleanup;
      source.cleanup_status = nextCleanupStatus;
      source.cleanup_tag_type = nextCleanupTagType;
      source.application_name = draftPayload.application_name ?? submission.application_name;
      source.policy_num = draftPayload.policy_num ?? submission.policy_num;
      source.account_num = draftPayload.account_num ?? submission.account_num;
      source.transaction_num = draftPayload.transaction_num ?? submission.transaction_num;
      source.screen_title = draftPayload.screen_title ?? submission.screen_title;
      source.summary_of_issue = draftPayload.summary_of_issue ?? submission.summary_of_issue;
      source.steps_to_reproduce = draftPayload.steps_to_reproduce ?? submission.steps_to_reproduce;
      source.what_happened_exact_details =
        draftPayload.what_happened_exact_details ?? submission.what_happened_exact_details;
      source.request = draftPayload.request ?? submission.request;
      source.date_time_of_error = draftPayload.date_time_of_error
        ? toIsoOrNow(draftPayload.date_time_of_error)
        : (draftPayload.date_time_of_error === null ? null : submission.date_time_of_error);
      source.reviewer = draftPayload.reviewer ?? submission.reviewer;
      source.decision_notes = draftPayload.decision_notes ?? submission.decision_notes;
      source.fingerprint = draftPayload.fingerprint ?? submission.fingerprint;
      source.desired_completion_date = draftPayload.desired_completion_date === ''
        ? null
        : draftPayload.desired_completion_date
          ? toIsoOrNow(draftPayload.desired_completion_date)
          : submission.desired_completion_date;
      source.impact_details = draftPayload.impact_details ?? submission.impact_details;
      source.impact_notes = draftPayload.impact_notes ?? submission.impact_notes;
      source.policy_premium_impact = Number.isFinite(policyPremiumImpact)
        ? policyPremiumImpact
        : submission.policy_premium_impact;
      source.direct_dollar_impact = Number.isFinite(directDollarImpact)
        ? directDollarImpact
        : submission.direct_dollar_impact;
      source.policies_affected_count = Number.isFinite(policiesAffectedCount)
        ? Math.trunc(policiesAffectedCount)
        : submission.policies_affected_count;
      source.logged_defect =
        typeof draftPayload.logged_defect === 'boolean'
          ? draftPayload.logged_defect
          : Boolean(submission.logged_defect);
      source.enhancement_request_type = Object.prototype.hasOwnProperty.call(
        draftPayload,
        'enhancement_request_type',
      )
        ? (isBlank(draftPayload.enhancement_request_type)
            ? null
            : draftPayload.enhancement_request_type)
        : submission.enhancement_request_type;
      source.priority_level = draftPayload.priority_level ?? submission.priority_level;
      source.jira_number = draftPayload.jira_number ?? submission.jira_number;
      source.release_number = draftPayload.release_number ?? submission.release_number;
      source.release_notes = draftPayload.release_notes ?? submission.release_notes;
      source.duplicate_reference = draftPayload.duplicate_of ?? submission.duplicate_reference;
      source.is_public =
        typeof draftPayload.is_public === 'boolean'
          ? draftPayload.is_public
          : Boolean(submission.is_public);
      source.is_retired =
        typeof draftPayload.is_retired === 'boolean'
          ? draftPayload.is_retired
          : Boolean(submission.is_retired);

      if (source.type === 'enhancement' && isBlank(source.priority_level)) {
        source.priority_level = '3 - Medium';
      }
    }

    if (source.is_cleanup && source.cleanup_tag_type === 'cleanup_only') {
      return res.status(400).json({
        error: 'Cleanup Only tasks cannot be submitted to EasyVista. Tag as Defect or Enhancement first.',
      });
    }

    const effectiveType = source.cleanup_tag_type === 'enhancement' ? 'enhancement' : 'defect';

    const missing = [];
    if (effectiveType === 'enhancement') {
      if (isBlank(source.impact_details)) {
        missing.push('Impact Details');
      }
      if (
        isBlank(source.enhancement_request_type) ||
        !ENHANCEMENT_REQUEST_TYPES.includes(source.enhancement_request_type)
      ) {
        missing.push('Request Type');
      }
    }

    if (effectiveType === 'defect') {
      if (isBlank(source.summary_of_issue)) {
        missing.push('Summary of Issue');
      }
      if (isBlank(source.screen_title)) {
        missing.push('Screen Title');
      }
      if (isBlank(source.what_happened_exact_details)) {
        missing.push('Description');
      }
    }

    if (missing.length > 0) {
      const typeLabel = effectiveType === 'enhancement' ? 'Enhancement' : 'Defect';
      return res.status(400).json({
        error: `${typeLabel} cannot be submitted. Missing required fields: ${missing.join(', ')}`,
      });
    }

    const result = await submitToEasyVista({ ...source, type: effectiveType });

    const updatedAt = new Date().toISOString();
    const easyVistaSubmittedBy = req.session?.user?.username || null;

    if (!isResubmissionRequest) {
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
        resubmission: false,
        submission: mapSubmission(updated),
      });
    }

    const created = await db.run(
      `
      INSERT INTO submissions (
        created_at, updated_at, created_via, created_by, created_by_email, type, application_name,
        policy_num, account_num, transaction_num, screen_title, summary_of_issue,
        steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
        status, reviewer, decision_notes, fingerprint, duplicate_reference, duplicate_of,
        easyvista_ticket_id, desired_completion_date, impact_details, impact_notes,
        policy_premium_impact, direct_dollar_impact, policies_affected_count, logged_defect,
        enhancement_request_type, priority_level, jira_number, release_number, release_notes,
        is_cleanup, cleanup_status, cleanup_tag_type, easyvista_submitted_by,
        is_resubmission, resubmission_of_submission_id, resubmission_of_easyvista_ticket_id,
        has_resubmission, latest_resubmission_submission_id, latest_resubmission_easyvista_ticket_id,
        is_public, is_retired
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `,
      [
        updatedAt,
        updatedAt,
        'admin_easyvista_resubmission',
        source.created_by,
        source.created_by_email,
        effectiveType,
        source.application_name,
        source.policy_num,
        source.account_num,
        source.transaction_num,
        source.screen_title,
        source.summary_of_issue,
        source.steps_to_reproduce,
        source.what_happened_exact_details,
        source.request,
        source.date_time_of_error,
        'Submitted',
        source.reviewer,
        source.decision_notes,
        source.fingerprint,
        source.duplicate_reference,
        source.duplicate_of,
        result.ticketId,
        source.desired_completion_date,
        source.impact_details,
        source.impact_notes,
        source.policy_premium_impact,
        source.direct_dollar_impact,
        source.policies_affected_count,
        toBooleanSql(source.logged_defect),
        source.enhancement_request_type,
        source.priority_level,
        source.jira_number,
        source.release_number,
        source.release_notes,
        toBooleanSql(source.is_cleanup),
        source.cleanup_status,
        source.cleanup_tag_type,
        easyVistaSubmittedBy,
        1,
        submission.id,
        submission.easyvista_ticket_id,
        0,
        null,
        null,
        toBooleanSql(source.is_public),
        toBooleanSql(source.is_retired),
      ],
    );

    const resubmissionId = Number(created.lastID);

    const existingAttachments = await db.all(
      'SELECT filename, mime_type, file_path, uploaded_by_role FROM attachments WHERE submission_id = ?',
      [submission.id],
    );
    for (const attachment of existingAttachments) {
      await db.run(
        `
        INSERT INTO attachments (
          submission_id, filename, mime_type, file_path, uploaded_at, uploaded_by_role
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
        [
          resubmissionId,
          attachment.filename,
          attachment.mime_type,
          attachment.file_path,
          updatedAt,
          attachment.uploaded_by_role,
        ],
      );
    }

    await db.run(
      `
      UPDATE submissions
      SET
        has_resubmission = 1,
        latest_resubmission_submission_id = ?,
        latest_resubmission_easyvista_ticket_id = ?,
        updated_at = ?
      WHERE id = ?
    `,
      [resubmissionId, result.ticketId, updatedAt, submission.id],
    );

    await logStatusChange(
      db,
      submission.id,
      `Resubmission: From (EasyVista ${submission.easyvista_ticket_id}) to (EasyVista ${result.ticketId}) as Submission #${resubmissionId}`,
      easyVistaSubmittedBy,
      updatedAt,
    );
    await logStatusChange(
      db,
      resubmissionId,
      `Resubmission: From (EasyVista ${submission.easyvista_ticket_id}) to (EasyVista ${result.ticketId}), Origin Submission #${submission.id}`,
      easyVistaSubmittedBy,
      updatedAt,
    );
    await logStatusChange(db, resubmissionId, 'Submitted', easyVistaSubmittedBy, updatedAt);

    const newSubmission = await db.get('SELECT * FROM submissions WHERE id = ?', [resubmissionId]);
    const updatedOriginal = await db.get('SELECT * FROM submissions WHERE id = ?', [submission.id]);

    emitAdminNotification('submission:resubmitted-easyvista', {
      original_submission: mapSubmission(updatedOriginal),
      resubmission: mapSubmission(newSubmission),
    });

    return res.json({
      ticketId: result.ticketId,
      source: result.source,
      resubmission: true,
      originalSubmissionId: submission.id,
      submission: mapSubmission(newSubmission),
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
