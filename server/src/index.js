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

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGINS = String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((value) => String(value || '').trim())
  .filter(Boolean);
const CLIENT_ORIGIN = CLIENT_ORIGINS[0] || 'http://localhost:5173';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-change-me';
const SESSION_COOKIE_SAME_SITE = String(
  process.env.SESSION_COOKIE_SAME_SITE || (IS_PRODUCTION ? 'none' : 'lax'),
).toLowerCase();
const SESSION_COOKIE_SECURE = String(process.env.SESSION_COOKIE_SECURE || (IS_PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';
const SESSION_COOKIE_DOMAIN = String(process.env.SESSION_COOKIE_DOMAIN || '').trim() || null;

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || 'attachments').trim();
const SUPABASE_STORAGE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_STORAGE_BUCKET);

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const tempUploadDir = path.join(uploadsRoot, 'tmp');

fs.mkdirSync(tempUploadDir, { recursive: true });

if (IS_PRODUCTION || SESSION_COOKIE_SECURE) {
  app.set('trust proxy', 1);
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  return CLIENT_ORIGINS.includes(String(origin || '').trim());
}

function corsOriginHandler(origin, callback) {
  if (isAllowedCorsOrigin(origin)) {
    return callback(null, true);
  }
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
}

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS,
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
    sameSite: SESSION_COOKIE_SAME_SITE,
    secure: SESSION_COOKIE_SECURE,
    maxAge: 1000 * 60 * 60 * 8,
    ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
  },
});

app.use(
  cors({
    origin: corsOriginHandler,
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
];
const RETIRED_STATUS = 'Retired';
const DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES, RETIRED_STATUS];
const DEFAULT_SUBMISSION_TYPES = ['defect', 'enhancement'];
const DEFAULT_APPLICATIONS = ['Billing Center', 'Policy Center'];
const DEFAULT_ENHANCEMENT_REQUEST_TYPES = [...ENHANCEMENT_REQUEST_TYPES];
const DEFAULT_PRIORITY_LEVELS = ['1 - Urgent', '2 - High', '3 - Medium', '4 - Low'];
const DEFAULT_SUBMISSION_SOURCES = [
  'rep_form',
  'admin_backdated',
  'admin_cleanup',
  'admin_excel_import',
  'admin_manual',
  'admin_easyvista_resubmission',
];
const DEFECT_ENHANCEMENT_STATUSES = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES];
const DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED = [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED];

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

const DEFAULT_CLEANUP_STATUSES = ['Not Started', 'In Progress', 'Completed'];
const DEFAULT_CLEANUP_TAG_TYPES = ['defect', 'enhancement', 'cleanup_only'];
const CLEANUP_STATUSES = [...DEFAULT_CLEANUP_STATUSES];
const CLEANUP_TAG_TYPES = [...DEFAULT_CLEANUP_TAG_TYPES];
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
  const resolvedStatus = row.model_status_name || row.status || 'New';
  const resolvedType = row.model_type_name || row.type || 'defect';
  const resolvedApplicationName = row.model_application_name || row.application_name || 'Billing Center';
  const resolvedCleanupStatus = row.model_cleanup_status_name || row.cleanup_status || null;
  const resolvedCleanupTagType = row.model_cleanup_tag_type_name || row.cleanup_tag_type || null;
  const resolvedEnhancementRequestType =
    row.model_enhancement_request_type_name || row.enhancement_request_type || null;
  const resolvedPriorityLevel = row.model_priority_level_name || row.priority_level || null;
  const resolvedCreatedVia = row.model_created_via_name || row.created_via || 'rep_form';
  const isCleanup = Boolean(row.is_cleanup);
  const baseStatus = resolvedStatus;
  const isRetired = Boolean(row.is_retired) || String(baseStatus) === 'Retired';
  // Gated display value (null when is_cleanup=false); used for cleanup_status_display
  const cleanupStatusDisplay = isCleanup
    ? (resolvedCleanupStatus || SUBMISSION_TO_CLEANUP_STATUS[baseStatus] || 'New')
    : null;

  return {
    ...row,
    type: resolvedType,
    application_name: resolvedApplicationName,
    status: baseStatus,
    defect_enhancement_status: baseStatus,
    is_public: Boolean(row.is_public),
    is_retired: isRetired,
    is_cleanup: isCleanup,
    // Always expose the stored name so the edit form can restore it after is_cleanup toggling
    cleanup_status: resolvedCleanupStatus,
    cleanup_status_display: cleanupStatusDisplay || 'No Cleanup',
    cleanup_tag_type: resolvedCleanupTagType,
    enhancement_request_type: resolvedEnhancementRequestType,
    priority_level: resolvedPriorityLevel,
    created_via: resolvedCreatedVia,
    is_resubmission: Boolean(row.is_resubmission),
    resubmission_of_submission_id: row.resubmission_of_submission_id || null,
    resubmission_of_easyvista_ticket_id: row.resubmission_of_easyvista_ticket_id || null,
    has_resubmission: Boolean(row.has_resubmission),
    latest_resubmission_submission_id: row.latest_resubmission_submission_id || null,
    latest_resubmission_easyvista_ticket_id: row.latest_resubmission_easyvista_ticket_id || null,
    occurrence_count: row.occurrence_count ?? null,
    occurrence_timeframe_count: row.occurrence_timeframe_count ?? null,
    occurrence_timeframe: row.model_occurrence_timeframe_name || row.occurrence_timeframe || null,
    occurrence_rate: row.occurrence_rate ?? null,
  };
}

function buildAdminExportFields() {
  return [
    { key: 'id', label: 'Submission ID', value: (row) => row.id },
    { key: 'created_at', label: 'Reported Date', value: (row) => row.created_at },
    { key: 'status_update_at', label: 'Status Update Date', value: (row) => row.status_update_at },
    { key: 'latest_status_update', label: 'Latest Status Update', value: (row) => row.latest_status_update },
    { key: 'latest_status_update_at', label: 'Latest Status Update Date', value: (row) => row.latest_status_update_at },
    { key: 'type', label: 'Type', value: (row) => row.type },
    { key: 'status', label: 'Defect/Enhancement Status', value: (row) => row.status },
    { key: 'is_cleanup', label: 'Is Cleanup', value: (row) => Boolean(row.is_cleanup) ? 'Yes' : 'No' },
    { key: 'cleanup_status', label: 'Cleanup Status', value: (row) => row.cleanup_status },
    { key: 'cleanup_tag_type', label: 'Cleanup Tag Type', value: (row) => row.cleanup_tag_type },
    { key: 'is_public', label: 'Public', value: (row) => Boolean(row.is_public) ? 'Yes' : 'No' },
    { key: 'is_retired', label: 'Retired', value: (row) => Boolean(row.is_retired) ? 'Yes' : 'No' },
    { key: 'summary_of_issue', label: 'Summary', value: (row) => row.summary_of_issue },
    { key: 'what_happened_exact_details', label: 'What Happened (Exact Details)', value: (row) => row.what_happened_exact_details },
    { key: 'request', label: 'Request Details', value: (row) => row.request },
    { key: 'created_by', label: 'Requester Name', value: (row) => row.created_by },
    { key: 'created_by_email', label: 'Requester Email', value: (row) => row.created_by_email },
    { key: 'reviewer', label: 'Reviewer', value: (row) => row.reviewer },
    { key: 'created_via', label: 'Created Via', value: (row) => row.created_via },
    { key: 'application_name', label: 'Application', value: (row) => row.application_name },
    { key: 'policy_num', label: 'Policy Number', value: (row) => row.policy_num },
    { key: 'account_num', label: 'Account Number', value: (row) => row.account_num },
    { key: 'transaction_num', label: 'Transaction Number', value: (row) => row.transaction_num },
    { key: 'screen_title', label: 'Screen Title', value: (row) => row.screen_title },
    { key: 'steps_to_reproduce', label: 'Steps to Reproduce', value: (row) => row.steps_to_reproduce },
    { key: 'date_time_of_error', label: 'Date/Time of Error', value: (row) => row.date_time_of_error },
    { key: 'desired_completion_date', label: 'Desired Completion Date', value: (row) => row.desired_completion_date },
    { key: 'impact_details', label: 'Impact Details', value: (row) => row.impact_details },
    { key: 'impact_notes', label: 'Impact Notes', value: (row) => row.impact_notes },
    { key: 'policy_premium_impact', label: 'Policy Premium Impact ($)', value: (row) => row.policy_premium_impact },
    { key: 'direct_dollar_impact', label: 'Direct Dollar Impact ($)', value: (row) => row.direct_dollar_impact },
    { key: 'policies_affected_count', label: 'Policies Affected Count', value: (row) => row.policies_affected_count },
    { key: 'enhancement_request_type', label: 'Enhancement Request Type', value: (row) => row.enhancement_request_type },
    { key: 'priority_level', label: 'Priority Level', value: (row) => row.priority_level },
    { key: 'jira_number', label: 'JIRA Number', value: (row) => row.jira_number },
    { key: 'easyvista_ticket_id', label: 'EasyVista Ticket', value: (row) => row.easyvista_ticket_id },
    { key: 'easyvista_submitted_by', label: 'Submitted to EV By', value: (row) => row.easyvista_submitted_by },
    { key: 'release_number', label: 'Release Number', value: (row) => row.release_number },
    { key: 'release_notes', label: 'Release Notes', value: (row) => row.release_notes },
    { key: 'decision_notes', label: 'Decision Notes', value: (row) => row.decision_notes },
    { key: 'fingerprint', label: 'Fingerprint', value: (row) => row.fingerprint },
    { key: 'duplicate_reference', label: 'Duplicate Reference', value: (row) => row.duplicate_reference || row.duplicate_of },
    { key: 'has_resubmission', label: 'Has Resubmission', value: (row) => Boolean(row.has_resubmission) ? 'Yes' : 'No' },
    { key: 'latest_resubmission_easyvista_ticket_id', label: 'Latest Resubmission Ticket', value: (row) => row.latest_resubmission_easyvista_ticket_id },
    { key: 'occurrence_count', label: 'Occurrence Count', value: (row) => row.occurrence_count },
    { key: 'occurrence_timeframe_count', label: 'Occurrence Timeframe #', value: (row) => row.occurrence_timeframe_count },
    { key: 'occurrence_timeframe', label: 'Occurrence Timeframe', value: (row) => row.occurrence_timeframe },
    { key: 'occurrence_rate', label: 'Occurrence Rate (per month)', value: (row) => row.occurrence_rate != null ? Number(row.occurrence_rate).toFixed(2) : '' },
  ];
}

const ADMIN_EXPORT_FIELDS = buildAdminExportFields();
const ADMIN_EXPORT_FIELDS_BY_KEY = new Map(ADMIN_EXPORT_FIELDS.map((field) => [field.key, field]));

function toExportCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value;
}

// Build a single id→name map from a lookup model
async function buildIdNameMap(Model) {
  if (!Model) return new Map();
  try {
    const lookupRows = await Model.findAll({ attributes: ['id', 'name'], raw: true });
    return new Map(lookupRows.map((r) => [Number(r.id), String(r.name || '').trim()]));
  } catch { return new Map(); }
}

// Load all lookup id→name maps in parallel from DB models
async function buildAllLookupMaps(dbModels) {
  const [
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  ] = await Promise.all([
    buildIdNameMap(dbModels.DefectEnhancementStatus),
    buildIdNameMap(dbModels.SubmissionType),
    buildIdNameMap(dbModels.CleanupTagType),
    buildIdNameMap(dbModels.CleanupStatus),
    buildIdNameMap(dbModels.Application),
    buildIdNameMap(dbModels.EnhancementRequestType),
    buildIdNameMap(dbModels.PriorityLevel),
    buildIdNameMap(dbModels.SubmissionSource),
    buildIdNameMap(dbModels.OccurrenceTimeframe),
  ]);
  return {
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  };
}

// Augment a raw Submission row with text names resolved from FK _id columns
function hydrateRowFromMaps(row, maps) {
  const {
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  } = maps;
  return {
    ...row,
    status: statusIdToName.get(Number(row.status_id)) || '',
    type: typeIdToName.get(Number(row.type_id)) || '',
    cleanup_tag_type: cleanupTagTypeIdToName.get(Number(row.cleanup_tag_type_id)) || '',
    cleanup_status: cleanupStatusIdToName.get(Number(row.cleanup_status_id)) || '',
    application_name: applicationIdToName.get(Number(row.application_id)) || '',
    enhancement_request_type: enhancementRequestTypeIdToName.get(Number(row.enhancement_request_type_id)) || '',
    priority_level: priorityLevelIdToName.get(Number(row.priority_level_id)) || '',
    created_via: createdViaIdToName.get(Number(row.created_via_id)) || '',
    occurrence_timeframe: occurrenceTimeframeIdToName.get(Number(row.occurrence_timeframe_id)) || '',
  };
}

async function listFilteredAdminSubmissions(db, query = {}) {
  const {
    status,
    statuses,
    type,
    types,
    cleanupRequired,
    cleanupStatuses,
    search,
    requester,
    submittedBy,
    createdVia,
    retiredFilter,
    year,
    inJira,
    jiraNumber,
    easyvistaNumber,
    releaseNumber,
    sort,
  } = query;

  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;

  if (!Submission) {
    throw new Error('Submission model is not available');
  }

  const {
    statusIdToName,
    typeIdToName,
    cleanupTagTypeIdToName,
    cleanupStatusIdToName,
    applicationIdToName,
    enhancementRequestTypeIdToName,
    priorityLevelIdToName,
    createdViaIdToName,
    occurrenceTimeframeIdToName,
  } = await buildAllLookupMaps(dbModels);

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

  const createdViaFilter = createdVia ? String(createdVia || '').trim().toLowerCase() : '';
  const lookupCreatedViaId = createdViaFilter
    ? await getLookupIdByName(db, 'submission_sources', createdViaFilter, { lowercase: true })
    : null;

  const containsIgnoreCase = (value, needle) => String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
  const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
  const compareNum = (a, b) => Number(a || 0) - Number(b || 0);
  const compareBool = (a, b) => Number(Boolean(a)) - Number(Boolean(b));

  const rawRows = await Submission.findAll({ raw: true });

  // Augment each row with text names resolved from _id FK columns
  const maps = { statusIdToName, typeIdToName, cleanupTagTypeIdToName, cleanupStatusIdToName, applicationIdToName, enhancementRequestTypeIdToName, priorityLevelIdToName, createdViaIdToName, occurrenceTimeframeIdToName };
  const rows = rawRows.map((row) => hydrateRowFromMaps(row, maps));

  const filteredRows = rows.filter((row) => {
    const rowStatus = String(row.status || '').trim();
    const rowIsCleanup = Boolean(row.is_cleanup);
    const rowCleanupTagType = String(row.cleanup_tag_type || '').trim();

    if (retiredFilter !== 'retired_only' && statusList.length > 0) {
      // Cleanup-only rows don't have a meaningful D/E status — exclude them from statusMatch
      const statusMatch = normalizedStatuses.includes(rowStatus) && !(rowIsCleanup && rowCleanupTagType === 'cleanup_only');
      const cleanupOnlyMatch = cleanupOnlySelected && rowIsCleanup && rowCleanupTagType === 'cleanup_only';
      const cleanupMarkedMatch = cleanupMarkedSelected && rowIsCleanup;
      if (!(statusMatch || cleanupOnlyMatch || cleanupMarkedMatch)) return false;
    } else if (retiredFilter !== 'retired_only' && normalizedStatus) {
      if (normalizedStatus === 'Cleanup Only') {
        if (!(rowIsCleanup && rowCleanupTagType === 'cleanup_only')) return false;
      } else if (normalizedStatus === 'Cleanup Marked') {
        if (!rowIsCleanup) return false;
      } else if (rowStatus !== normalizedStatus || (rowIsCleanup && rowCleanupTagType === 'cleanup_only')) {
        return false;
      }
    }

    if (type) {
      if (String(type).toLowerCase() === 'cleanup') {
        if (!rowIsCleanup) return false;
      } else if (
        String(row.type || '') !== String(type) ||
        (rowIsCleanup && rowCleanupTagType === 'cleanup_only')
      ) {
        return false;
      }
    }

    const typesList = String(types || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (typesList.length > 0) {
      const cleanupOnlyTypeSelected = typesList.some((v) =>
        ['cleanup only', 'cleanup_only', 'cleanup'].includes(v.toLowerCase()));
      const regularTypes = typesList
        .filter((v) => !['cleanup only', 'cleanup_only', 'cleanup'].includes(v.toLowerCase()))
        .map((v) => v.toLowerCase());
      // Cleanup-only rows have a stale type from before they became cleanup-only — exclude them from regular type matching
      const matchesRegularType = regularTypes.length > 0 &&
        regularTypes.includes(String(row.type || '').toLowerCase()) &&
        !(rowIsCleanup && rowCleanupTagType === 'cleanup_only');
      const matchesCleanupOnly = cleanupOnlyTypeSelected && rowIsCleanup && rowCleanupTagType === 'cleanup_only';
      if (!(matchesRegularType || matchesCleanupOnly)) return false;
    }

    if (cleanupRequired === 'yes' && !rowIsCleanup) return false;
    if (cleanupRequired === 'no' && rowIsCleanup) return false;

    const cleanupStatusesList = String(cleanupStatuses || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (cleanupStatusesList.length > 0) {
      if (!rowIsCleanup) return false;
      if (!cleanupStatusesList.includes(String(row.cleanup_status || '').trim())) return false;
    }

    if (search) {
      const searchValue = String(search || '');
      const searchMatch = containsIgnoreCase(row.policy_num, searchValue)
        || containsIgnoreCase(row.account_num, searchValue)
        || containsIgnoreCase(row.summary_of_issue, searchValue);
      if (!searchMatch) return false;
    }

    if (requester && !containsIgnoreCase(row.created_by, requester)) {
      return false;
    }

    if (submittedBy && !containsIgnoreCase(row.easyvista_submitted_by, submittedBy)) {
      return false;
    }

    if (createdViaFilter) {
      if (!lookupCreatedViaId) return false;
      if (Number(row.created_via_id) !== Number(lookupCreatedViaId)) return false;
    }

    if (retiredFilter === 'retired_only') {
      if (!(Boolean(row.is_retired) || rowStatus === 'Retired')) return false;
    } else if (retiredFilter === 'non_retired') {
      if (Boolean(row.is_retired) || rowStatus === 'Retired') return false;
    }

    if (year && String(row.created_at || '').slice(0, 4) !== String(year).trim()) {
      return false;
    }

    if (inJira === 'yes' && !Boolean(row.logged_defect)) return false;
    if (inJira === 'no' && Boolean(row.logged_defect)) return false;

    if (jiraNumber && !containsIgnoreCase(row.jira_number, jiraNumber)) return false;
    if (easyvistaNumber && !containsIgnoreCase(row.easyvista_ticket_id, easyvistaNumber)) return false;
    if (releaseNumber && !containsIgnoreCase(row.release_number, releaseNumber)) return false;

    return true;
  });

  const filteredIds = filteredRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const statusUpdateAtById = new Map();
  const latestStatusEventById = new Map();

  if (SubmissionStatusEvent && filteredIds.length > 0) {
    const events = await SubmissionStatusEvent.findAll({
      where: { submission_id: filteredIds },
      attributes: ['id', 'submission_id', 'status', 'changed_at'],
      raw: true,
    });

    const submissionById = new Map(filteredRows.map((row) => [Number(row.id), row]));
    for (const event of events) {
      const submissionId = Number(event.submission_id);
      const row = submissionById.get(submissionId);
      if (!row) continue;

      const statusValue = String(event.status || '');
      const currentStatus = String(row.status || '');
      const eligible = statusValue === 'Retired'
        || statusValue === 'Unretired'
        || statusValue === currentStatus
        || statusValue === `Defect/Enhancement Status: ${currentStatus}`;

      if (eligible) {
        const currentMax = statusUpdateAtById.get(submissionId);
        if (!currentMax || new Date(event.changed_at).getTime() > new Date(currentMax).getTime()) {
          statusUpdateAtById.set(submissionId, event.changed_at);
        }
      }

      const latest = latestStatusEventById.get(submissionId);
      const nextChangedAt = new Date(event.changed_at || 0).getTime();
      const latestChangedAt = new Date(latest?.changed_at || 0).getTime();
      if (!latest || nextChangedAt > latestChangedAt || (nextChangedAt === latestChangedAt && Number(event.id) > Number(latest.id || 0))) {
        latestStatusEventById.set(submissionId, event);
      }
    }
  }

  const enrichedRows = filteredRows.map((row) => {
    const rowId = Number(row.id);
    const statusUpdateAt = statusUpdateAtById.get(rowId) || row.updated_at;
    const latestStatusEvent = latestStatusEventById.get(rowId);
    return {
      ...row,
      status_update_at: statusUpdateAt,
      latest_status_update: latestStatusEvent?.status || row.status || '',
      latest_status_update_at: latestStatusEvent?.changed_at || statusUpdateAt,
    };
  });

  const sortKey = String(sort || 'updated_desc');
  const comparatorMap = {
    updated_desc: (a, b) => compareText(b.status_update_at, a.status_update_at),
    updated_asc: (a, b) => compareText(a.status_update_at, b.status_update_at),
    created_desc: (a, b) => compareText(b.created_at, a.created_at),
    created_asc: (a, b) => compareText(a.created_at, b.created_at),
    requester_asc: (a, b) => compareText(a.created_by, b.created_by),
    requester_desc: (a, b) => compareText(b.created_by, a.created_by),
    submitted_by_asc: (a, b) => compareText(a.easyvista_submitted_by, b.easyvista_submitted_by),
    submitted_by_desc: (a, b) => compareText(b.easyvista_submitted_by, a.easyvista_submitted_by),
    policy_premium_impact_desc: (a, b) => compareNum(b.policy_premium_impact, a.policy_premium_impact),
    policy_premium_impact_asc: (a, b) => compareNum(a.policy_premium_impact, b.policy_premium_impact),
    direct_dollar_impact_desc: (a, b) => compareNum(b.direct_dollar_impact, a.direct_dollar_impact),
    direct_dollar_impact_asc: (a, b) => compareNum(a.direct_dollar_impact, b.direct_dollar_impact),
    policies_affected_count_desc: (a, b) => compareNum(b.policies_affected_count, a.policies_affected_count),
    policies_affected_count_asc: (a, b) => compareNum(a.policies_affected_count, b.policies_affected_count),
    logged_defect_desc: (a, b) => compareBool(b.logged_defect, a.logged_defect),
    logged_defect_asc: (a, b) => compareBool(a.logged_defect, b.logged_defect),
    jira_number_asc: (a, b) => compareText(a.jira_number, b.jira_number),
    jira_number_desc: (a, b) => compareText(b.jira_number, a.jira_number),
    type_asc: (a, b) => compareText(a.type, b.type),
    type_desc: (a, b) => compareText(b.type, a.type),
    summary_asc: (a, b) => compareText(a.summary_of_issue, b.summary_of_issue),
    summary_desc: (a, b) => compareText(b.summary_of_issue, a.summary_of_issue),
    status_asc: (a, b) => compareText(a.status, b.status),
    status_desc: (a, b) => compareText(b.status, a.status),
    public_asc: (a, b) => compareBool(a.is_public, b.is_public),
    public_desc: (a, b) => compareBool(b.is_public, a.is_public),
    release_number_asc: (a, b) => compareText(a.release_number, b.release_number),
    release_number_desc: (a, b) => compareText(b.release_number, a.release_number),
    easyvista_asc: (a, b) => compareText(a.easyvista_ticket_id, b.easyvista_ticket_id),
    easyvista_desc: (a, b) => compareText(b.easyvista_ticket_id, a.easyvista_ticket_id),
    frequency_asc: (a, b) => compareNum(a.occurrence_rate, b.occurrence_rate),
    frequency_desc: (a, b) => compareNum(b.occurrence_rate, a.occurrence_rate),
  };

  const comparator = comparatorMap[sortKey] || comparatorMap.updated_desc;
  enrichedRows.sort(comparator);
  return enrichedRows.map(mapSubmission);
}

const SUBMISSION_LOOKUP_JOINS = `
  LEFT JOIN defect_enhancement_statuses st ON st.id = s.status_id
  LEFT JOIN submission_types ty ON ty.id = s.type_id
  LEFT JOIN cleanup_statuses cs ON cs.id = s.cleanup_status_id
  LEFT JOIN cleanup_tag_types ct ON ct.id = s.cleanup_tag_type_id
  LEFT JOIN applications app ON app.id = s.application_id
  LEFT JOIN enhancement_request_types ert ON ert.id = s.enhancement_request_type_id
  LEFT JOIN priority_levels pl ON pl.id = s.priority_level_id
  LEFT JOIN submission_sources src ON src.id = s.created_via_id
`;

const SUBMISSION_LOOKUP_SELECT = `
  st.name AS model_status_name,
  ty.name AS model_type_name,
  cs.name AS model_cleanup_status_name,
  ct.name AS model_cleanup_tag_type_name,
  app.name AS model_application_name,
  ert.name AS model_enhancement_request_type_name,
  pl.name AS model_priority_level_name,
  src.name AS model_created_via_name
`;

async function getSubmissionByIdWithLookups(db, submissionId, { publicOnly = false } = {}) {
  const dbModels = dbApi.getModels() || {};
  const Submission = dbModels.Submission;
  if (!Submission) {
    throw new Error('Submission model is not initialized');
  }

  const where = {
    id: Number(submissionId),
    ...(publicOnly ? { is_public: 1 } : {}),
  };
  const submission = await Submission.findOne({ where, raw: true });
  if (!submission) return null;

  const lookupConfigs = [
    {
      idColumn: 'status_id',
      table: 'defect_enhancement_statuses',
      targetKey: 'model_status_name',
    },
    {
      idColumn: 'type_id',
      table: 'submission_types',
      targetKey: 'model_type_name',
    },
    {
      idColumn: 'cleanup_status_id',
      table: 'cleanup_statuses',
      targetKey: 'model_cleanup_status_name',
    },
    {
      idColumn: 'cleanup_tag_type_id',
      table: 'cleanup_tag_types',
      targetKey: 'model_cleanup_tag_type_name',
    },
    {
      idColumn: 'application_id',
      table: 'applications',
      targetKey: 'model_application_name',
    },
    {
      idColumn: 'enhancement_request_type_id',
      table: 'enhancement_request_types',
      targetKey: 'model_enhancement_request_type_name',
    },
    {
      idColumn: 'priority_level_id',
      table: 'priority_levels',
      targetKey: 'model_priority_level_name',
    },
    {
      idColumn: 'created_via_id',
      table: 'submission_sources',
      targetKey: 'model_created_via_name',
    },
    {
      idColumn: 'occurrence_timeframe_id',
      table: 'occurrence_timeframes',
      targetKey: 'model_occurrence_timeframe_name',
    },
  ];

  const hydrated = { ...submission };
  for (const config of lookupConfigs) {
    const lookupId = hydrated[config.idColumn];
    if (lookupId == null) {
      hydrated[config.targetKey] = null;
      continue;
    }

    const LookupModel = getLookupModelByTable(config.table);
    if (!LookupModel) {
      throw new Error(`Lookup model not initialized for ${config.table}`);
    }
    const row = await LookupModel.findByPk(Number(lookupId), {
      attributes: ['name'],
      raw: true,
    });
    hydrated[config.targetKey] = row?.name || null;
  }

  return hydrated;
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

// Occurrence rate per month (30.44 days).
const TIMEFRAME_DAYS = { day: 1, week: 7, month: 30.44, quarter: 91.31, year: 365.25 };
function calculateOccurrenceRate(count, timeframeCount, timeframeUnit) {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(timeframeCount) || timeframeCount <= 0) return null;
  const unitKey = String(timeframeUnit || '').trim().toLowerCase();
  const daysPerUnit = TIMEFRAME_DAYS[unitKey];
  if (!daysPerUnit) return null;
  const totalDays = timeframeCount * daysPerUnit;
  // Rate = occurrences per 30.44 days (month)
  return (count / totalDays) * 30.44;
}

function normalizeCleanupTagType(value, allowedCleanupTagTypes = DEFAULT_CLEANUP_TAG_TYPES) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowedCleanupTagTypes.includes(normalized) ? normalized : null;
}

async function getDefectEnhancementStatuses(db, { includeRetired = false } = {}) {
  try {
    const dbModels = dbApi.getModels() || {};
    const DefectEnhancementStatus = dbModels.DefectEnhancementStatus;
    if (!DefectEnhancementStatus) throw new Error('DefectEnhancementStatus model is not initialized');
    const rows = await DefectEnhancementStatus.findAll({
      where: { is_active: 1 },
      attributes: ['name', 'is_retired'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    if (names.length === 0) {
      return includeRetired
        ? [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED]
        : [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES];
    }
    if (includeRetired) {
      return names;
    }
    return (rows || [])
      .filter((row) => !Boolean(row.is_retired) && String(row.name || '').trim().toLowerCase() !== RETIRED_STATUS.toLowerCase())
      .map((row) => String(row.name || '').trim())
      .filter(Boolean);
  } catch {
    return includeRetired
      ? [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED]
      : [...DEFAULT_DEFECT_ENHANCEMENT_STATUSES];
  }
}

async function getSubmissionTypes(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const SubmissionType = dbModels.SubmissionType;
    if (!SubmissionType) throw new Error('SubmissionType model is not initialized');
    const rows = await SubmissionType.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_SUBMISSION_TYPES];
  } catch {
    return [...DEFAULT_SUBMISSION_TYPES];
  }
}

async function getCleanupStatuses(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const CleanupStatus = dbModels.CleanupStatus;
    if (!CleanupStatus) throw new Error('CleanupStatus model is not initialized');
    const rows = await CleanupStatus.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_CLEANUP_STATUSES];
  } catch {
    return [...DEFAULT_CLEANUP_STATUSES];
  }
}

async function getCleanupTagTypes(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const CleanupTagType = dbModels.CleanupTagType;
    if (!CleanupTagType) throw new Error('CleanupTagType model is not initialized');
    const rows = await CleanupTagType.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_CLEANUP_TAG_TYPES];
  } catch {
    return [...DEFAULT_CLEANUP_TAG_TYPES];
  }
}

async function getApplications(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const Application = dbModels.Application;
    if (!Application) throw new Error('Application model is not initialized');
    const rows = await Application.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_APPLICATIONS];
  } catch {
    return [...DEFAULT_APPLICATIONS];
  }
}

async function getEnhancementRequestTypes(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const EnhancementRequestType = dbModels.EnhancementRequestType;
    if (!EnhancementRequestType) throw new Error('EnhancementRequestType model is not initialized');
    const rows = await EnhancementRequestType.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_ENHANCEMENT_REQUEST_TYPES];
  } catch {
    return [...DEFAULT_ENHANCEMENT_REQUEST_TYPES];
  }
}

async function getPriorityLevels(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const PriorityLevel = dbModels.PriorityLevel;
    if (!PriorityLevel) throw new Error('PriorityLevel model is not initialized');
    const rows = await PriorityLevel.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_PRIORITY_LEVELS];
  } catch {
    return [...DEFAULT_PRIORITY_LEVELS];
  }
}

async function getSubmissionSources(db) {
  try {
    const dbModels = dbApi.getModels() || {};
    const SubmissionSource = dbModels.SubmissionSource;
    if (!SubmissionSource) throw new Error('SubmissionSource model is not initialized');
    const rows = await SubmissionSource.findAll({
      where: { is_active: 1 },
      attributes: ['name'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const names = (rows || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean);
    return names.length > 0 ? names : [...DEFAULT_SUBMISSION_SOURCES];
  } catch {
    return [...DEFAULT_SUBMISSION_SOURCES];
  }
}

async function getLookupIdByName(db, table, value, { lowercase = false } = {}) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return null;

  const dbModels = dbApi.getModels() || {};
  const tableToModel = {
    submission_sources: dbModels.SubmissionSource,
    submission_types: dbModels.SubmissionType,
    applications: dbModels.Application,
    defect_enhancement_statuses: dbModels.DefectEnhancementStatus,
    cleanup_statuses: dbModels.CleanupStatus,
    cleanup_tag_types: dbModels.CleanupTagType,
    enhancement_request_types: dbModels.EnhancementRequestType,
    priority_levels: dbModels.PriorityLevel,
    occurrence_timeframes: dbModels.OccurrenceTimeframe,
  };

  const model = tableToModel[table];
  if (!model) {
    throw new Error(`Lookup model not initialized for ${table}`);
  }
  const rows = await model.findAll({ attributes: ['id', 'name'], raw: true });
  const target = lowercase ? normalizedValue.toLowerCase() : normalizedValue;
  const match = rows.find((row) => {
    const candidate = String(row.name || '').trim();
    return lowercase ? candidate.toLowerCase() === target : candidate === target;
  });
  return match?.id ? Number(match.id) : null;
}

function getLookupModelByTable(table) {
  const dbModels = dbApi.getModels() || {};
  const tableToModel = {
    submission_sources: dbModels.SubmissionSource,
    submission_types: dbModels.SubmissionType,
    applications: dbModels.Application,
    defect_enhancement_statuses: dbModels.DefectEnhancementStatus,
    cleanup_statuses: dbModels.CleanupStatus,
    cleanup_tag_types: dbModels.CleanupTagType,
    enhancement_request_types: dbModels.EnhancementRequestType,
    priority_levels: dbModels.PriorityLevel,
    occurrence_timeframes: dbModels.OccurrenceTimeframe,
  };
  return tableToModel[table] || null;
}

async function resolveSubmissionLookupIds(db, payload) {
  return {
    created_via_id: await getLookupIdByName(db, 'submission_sources', payload.created_via, { lowercase: true }),
    type_id: await getLookupIdByName(db, 'submission_types', payload.type, { lowercase: true }),
    application_id: await getLookupIdByName(db, 'applications', payload.application_name),
    status_id: await getLookupIdByName(db, 'defect_enhancement_statuses', payload.status),
    cleanup_status_id: await getLookupIdByName(db, 'cleanup_statuses', payload.cleanup_status),
    cleanup_tag_type_id: await getLookupIdByName(db, 'cleanup_tag_types', payload.cleanup_tag_type, { lowercase: true }),
    enhancement_request_type_id: await getLookupIdByName(db, 'enhancement_request_types', payload.enhancement_request_type),
    priority_level_id: await getLookupIdByName(db, 'priority_levels', payload.priority_level),
  };
}

// Hydrate text fields from FK IDs — the DB stores only _id columns, no redundant text columns.
async function resolveExistingLookupFields(existing) {
  const dbModels = dbApi.getModels() || {};

  async function getNameById(model, id, { lowercase = false } = {}) {
    if (!id || !model) return null;
    const row = await model.findByPk(Number(id), { attributes: ['name'], raw: true });
    const name = row?.name ? String(row.name).trim() : null;
    return name && lowercase ? name.toLowerCase() : name;
  }

  const [type, status, cleanupStatus, cleanupTagType, createdVia, applicationName, enhancementRequestType, priorityLevel, occurrenceTimeframe] = await Promise.all([
    getNameById(dbModels.SubmissionType, existing.type_id, { lowercase: true }),
    getNameById(dbModels.DefectEnhancementStatus, existing.status_id),
    getNameById(dbModels.CleanupStatus, existing.cleanup_status_id),
    getNameById(dbModels.CleanupTagType, existing.cleanup_tag_type_id, { lowercase: true }),
    getNameById(dbModels.SubmissionSource, existing.created_via_id, { lowercase: true }),
    getNameById(dbModels.Application, existing.application_id),
    getNameById(dbModels.EnhancementRequestType, existing.enhancement_request_type_id),
    getNameById(dbModels.PriorityLevel, existing.priority_level_id),
    getNameById(dbModels.OccurrenceTimeframe, existing.occurrence_timeframe_id),
  ]);

  return {
    ...existing,
    type: type ?? null,
    status: status ?? null,
    cleanup_status: cleanupStatus ?? null,
    cleanup_tag_type: cleanupTagType ?? null,
    created_via: createdVia ?? null,
    application_name: applicationName ?? null,
    enhancement_request_type: enhancementRequestType ?? null,
    priority_level: priorityLevel ?? null,
    occurrence_timeframe: occurrenceTimeframe ?? null,
  };
}

function collectMissingLookupIds(lookupIds, checks = []) {
  return checks
    .filter((check) => check?.required)
    .filter((check) => !lookupIds?.[check.idKey])
    .map((check) => check.label);
}

function formatMissingLookupError(missingFields) {
  return `Unresolved metadata values for: ${missingFields.join(', ')}. Update metadata options and retry.`;
}

const LOOKUP_TABLES = {
  statuses: {
    table: 'defect_enhancement_statuses',
    modelName: 'DefectEnhancementStatus',
    hasRetiredFlag: true,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'status_id',
  },
  types: {
    table: 'submission_types',
    modelName: 'SubmissionType',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    submissionIdColumn: 'type_id',
  },
  'cleanup-statuses': {
    table: 'cleanup_statuses',
    modelName: 'CleanupStatus',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'cleanup_status_id',
  },
  'cleanup-tag-types': {
    table: 'cleanup_tag_types',
    modelName: 'CleanupTagType',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    submissionIdColumn: 'cleanup_tag_type_id',
  },
  applications: {
    table: 'applications',
    modelName: 'Application',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'application_id',
  },
  'enhancement-request-types': {
    table: 'enhancement_request_types',
    modelName: 'EnhancementRequestType',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'enhancement_request_type_id',
  },
  'priority-levels': {
    table: 'priority_levels',
    modelName: 'PriorityLevel',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'priority_level_id',
  },
  'submission-sources': {
    table: 'submission_sources',
    modelName: 'SubmissionSource',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim().toLowerCase(),
    submissionIdColumn: 'created_via_id',
  },
  'occurrence-timeframes': {
    table: 'occurrence_timeframes',
    modelName: 'OccurrenceTimeframe',
    hasRetiredFlag: false,
    normalize: (value) => String(value || '').trim(),
    submissionIdColumn: 'occurrence_timeframe_id',
  },
};

function resolveLookupCategory(categoryParam) {
  const key = String(categoryParam || '').trim().toLowerCase();
  return LOOKUP_TABLES[key] ? { key, ...LOOKUP_TABLES[key] } : null;
}

function resolveLookupModel(category) {
  if (!category?.modelName) return null;
  const dbModels = dbApi.getModels() || {};
  return dbModels[category.modelName] || null;
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
    const allowedStatuses = await withDb(async (db) => getDefectEnhancementStatuses(db, { includeRetired: true }));

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
      if (!allowedStatuses.includes(rawStatus)) {
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
      allowedStatuses,
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

function sanitizeUploadFilename(fileName) {
  return String(fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildSupabaseObjectPath(submissionId, originalName) {
  const safeName = sanitizeUploadFilename(originalName);
  const uniquePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${submissionId}/${uniquePrefix}-${safeName}`;
}

function encodeStoragePath(pathValue) {
  return String(pathValue || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildSupabasePublicUrl(objectPath) {
  const baseUrl = String(SUPABASE_URL || '').replace(/\/+$/, '');
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${encodeStoragePath(objectPath)}`;
}

async function uploadFileToSupabaseStorage(tempFilePath, submissionId, originalName, mimeType) {
  if (!SUPABASE_STORAGE_ENABLED) return null;

  const objectPath = buildSupabaseObjectPath(submissionId, originalName);
  const uploadUrl = `${String(SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${encodeStoragePath(objectPath)}`;
  const fileBuffer = fs.readFileSync(tempFilePath);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(bodyText || `Supabase storage upload failed (${response.status})`);
  }

  return {
    objectPath,
    publicUrl: buildSupabasePublicUrl(objectPath),
  };
}

function extractSupabaseObjectPathFromUrl(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const marker = `/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    const encodedPath = parsed.pathname.slice(index + marker.length);
    if (!encodedPath) return null;
    return encodedPath
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

async function deleteSupabaseStoredFileByUrl(filePath) {
  if (!SUPABASE_STORAGE_ENABLED) return false;

  const objectPath = extractSupabaseObjectPathFromUrl(filePath);
  if (!objectPath) return false;

  const deleteUrl = `${String(SUPABASE_URL).replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${encodeStoragePath(objectPath)}`;
  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  if (!response.ok && response.status !== 404) {
    const bodyText = await response.text();
    throw new Error(bodyText || `Supabase storage delete failed (${response.status})`);
  }

  return true;
}

async function persistUploadedFiles(db, submissionId, files, uploadedByRole) {
  if (!files || files.length === 0) return [];

  const dbModels = dbApi.getModels() || {};
  const Attachment = dbModels.Attachment;
  if (!Attachment) {
    throw new Error('Attachment model is not initialized');
  }

  const destDir = path.join(uploadsRoot, String(submissionId));
  if (!SUPABASE_STORAGE_ENABLED) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const inserted = [];

  for (const file of files) {
    let storedPath = '';
    try {
      if (SUPABASE_STORAGE_ENABLED) {
        const uploaded = await uploadFileToSupabaseStorage(
          file.path,
          submissionId,
          file.originalname,
          file.mimetype,
        );
        storedPath = uploaded.publicUrl;
      } else {
        const safeName = sanitizeUploadFilename(file.originalname);
        const finalName = `${Date.now()}-${safeName}`;
        const finalPath = path.join(destDir, finalName);
        fs.renameSync(file.path, finalPath);
        storedPath = path.relative(path.join(__dirname, '..'), finalPath).replaceAll('\\', '/');
      }
    } finally {
      if (fs.existsSync(file.path)) {
        fs.rmSync(file.path, { force: true });
      }
    }

    const uploadedAt = new Date().toISOString();
    const createdAttachment = await Attachment.create({
      submission_id: submissionId,
      filename: file.originalname,
      mime_type: file.mimetype || 'application/octet-stream',
      file_path: storedPath,
      uploaded_at: uploadedAt,
      uploaded_by_role: uploadedByRole,
    });
    const insertedId = Number(createdAttachment.id);

    inserted.push({
      id: insertedId,
      submission_id: submissionId,
      filename: file.originalname,
      mime_type: file.mimetype || 'application/octet-stream',
      file_path: storedPath,
      uploaded_at: uploadedAt,
      uploaded_by_role: uploadedByRole,
    });
  }

  return inserted;
}

async function logStatusChange(db, submissionId, status, changedBy, changedAt) {
  const dbModels = dbApi.getModels() || {};
  const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
  if (!SubmissionStatusEvent) {
    throw new Error('SubmissionStatusEvent model is not initialized');
  }

  await SubmissionStatusEvent.create({
    submission_id: submissionId,
    status,
    changed_at: changedAt || new Date().toISOString(),
    changed_by: changedBy || null,
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/meta/options', async (_req, res) => {
  return withDb(async (db) => {
    const submissionTypes = await getSubmissionTypes(db);
    const defectEnhancementStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const defectEnhancementStatusesWithRetired = await getDefectEnhancementStatuses(db, { includeRetired: true });
    const cleanupStatuses = await getCleanupStatuses(db);
    const cleanupTagTypes = await getCleanupTagTypes(db);
    const applications = await getApplications(db);
    const enhancementRequestTypes = await getEnhancementRequestTypes(db);
    const priorityLevels = await getPriorityLevels(db);
    const submissionSources = await getSubmissionSources(db);

    return res.json({
      submissionTypes,
      defectEnhancementStatuses,
      defectEnhancementStatusesWithRetired,
      cleanupStatuses,
      cleanupTagTypes,
      applications,
      enhancementRequestTypes,
      priorityLevels,
      submissionSources,
    });
  });
});

app.get('/api/admin/meta/options', ensureAdmin, async (_req, res) => {
  return withDb(async (db) => {
    const mapRow = (row, hasRetiredFlag) => ({
      id: Number(row.id),
      name: String(row.name || ''),
      sortOrder: Number(row.sort_order || 0),
      isActive: Boolean(row.is_active),
      ...(hasRetiredFlag ? { isRetired: Boolean(row.is_retired) } : {}),
    });

    const fetchRows = async (categoryKey) => {
      const category = resolveLookupCategory(categoryKey);
      if (!category) return [];
      const LookupModel = resolveLookupModel(category);
      if (!LookupModel) {
        throw new Error(`Lookup model is not initialized for ${category.key}`);
      }
      const rows = await LookupModel.findAll({
        attributes: ['id', 'name', 'sort_order', 'is_active', ...(category.hasRetiredFlag ? ['is_retired'] : [])],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
        raw: true,
      });
      return (rows || []).map((row) => ({
        ...mapRow(row, category.hasRetiredFlag),
      }));
    };

    return res.json({
      statuses: await fetchRows('statuses'),
      types: await fetchRows('types'),
      cleanupStatuses: await fetchRows('cleanup-statuses'),
      cleanupTagTypes: await fetchRows('cleanup-tag-types'),
      applications: await fetchRows('applications'),
      enhancementRequestTypes: await fetchRows('enhancement-request-types'),
      priorityLevels: await fetchRows('priority-levels'),
      submissionSources: await fetchRows('submission-sources'),
      occurrenceTimeframes: await fetchRows('occurrence-timeframes'),
    });
  });
});

app.post('/api/admin/meta/:category', ensureAdmin, async (req, res) => {
  const category = resolveLookupCategory(req.params.category);
  if (!category) {
    return res.status(400).json({ error: 'Invalid metadata category' });
  }

  return withDb(async (db) => {
    const LookupModel = resolveLookupModel(category);
    if (!LookupModel) {
      return res.status(500).json({ error: `Lookup model is not initialized for ${category.key}` });
    }
    const normalizedName = category.normalize(req.body?.name);
    if (!normalizedName) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const existing = (await LookupModel.findAll({ attributes: ['id', 'name'], raw: true })).find(
      (row) => String(row.name || '').trim().toLowerCase() === normalizedName.toLowerCase(),
    );
    if (existing) {
      return res.status(409).json({ error: 'Value already exists' });
    }

    const nextSort = ((await LookupModel.findAll({ attributes: ['sort_order'], raw: true }))
      .reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0) + 1);
    const isRetired = category.hasRetiredFlag && Boolean(req.body?.isRetired);

    const created = (await LookupModel.create({
      name: normalizedName,
      sort_order: nextSort,
      is_active: 1,
      ...(category.hasRetiredFlag ? { is_retired: toBooleanSql(isRetired) } : {}),
    })).toJSON();

    return res.status(201).json({
      id: Number(created.id),
      name: String(created.name || ''),
      sortOrder: Number(created.sort_order || 0),
      isActive: Boolean(created.is_active),
      ...(category.hasRetiredFlag ? { isRetired: Boolean(created.is_retired) } : {}),
    });
  });
});

app.put('/api/admin/meta/:category/:id', ensureAdmin, async (req, res) => {
  const category = resolveLookupCategory(req.params.category);
  if (!category) {
    return res.status(400).json({ error: 'Invalid metadata category' });
  }

  const recordId = Number.parseInt(String(req.params.id || ''), 10);
  if (!Number.isFinite(recordId) || recordId <= 0) {
    return res.status(400).json({ error: 'Invalid metadata id' });
  }

  return withDb(async (db) => {
    const LookupModel = resolveLookupModel(category);
    if (!LookupModel) {
      return res.status(500).json({ error: `Lookup model is not initialized for ${category.key}` });
    }
    const existing = await LookupModel.findByPk(recordId, { raw: true });
    if (!existing) {
      return res.status(404).json({ error: 'Metadata entry not found' });
    }

    const isProtectedRetiredStatus = category.key === 'statuses'
      && (Boolean(existing.is_retired) || String(existing.name || '').trim().toLowerCase() === 'retired');
    if (isProtectedRetiredStatus) {
      return res.status(400).json({ error: 'Retired status is system-protected and cannot be modified' });
    }

    const nextNameRaw = Object.prototype.hasOwnProperty.call(req.body || {}, 'name')
      ? category.normalize(req.body?.name)
      : String(existing.name || '');
    if (!nextNameRaw) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const duplicate = (await LookupModel.findAll({ attributes: ['id', 'name'], raw: true })).find(
      (row) => Number(row.id) !== recordId
        && String(row.name || '').trim().toLowerCase() === nextNameRaw.toLowerCase(),
    );
    if (duplicate) {
      return res.status(409).json({ error: 'Value already exists' });
    }

    const nextIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'isActive')
      ? toBooleanSql(Boolean(req.body?.isActive))
      : toBooleanSql(Boolean(existing.is_active));
    const nextSortOrder = Object.prototype.hasOwnProperty.call(req.body || {}, 'sortOrder')
      ? Number(req.body?.sortOrder || 0)
      : Number(existing.sort_order || 0);
    const nextIsRetired = category.hasRetiredFlag
      ? (Object.prototype.hasOwnProperty.call(req.body || {}, 'isRetired')
        ? toBooleanSql(Boolean(req.body?.isRetired))
        : toBooleanSql(Boolean(existing.is_retired)))
      : null;

    const updatePayload = {
      name: nextNameRaw,
      sort_order: nextSortOrder,
      is_active: nextIsActive,
      ...(category.hasRetiredFlag ? { is_retired: nextIsRetired } : {}),
    };

    await LookupModel.update(updatePayload, { where: { id: recordId } });

    const updated = await LookupModel.findByPk(recordId, {
      attributes: ['id', 'name', 'sort_order', 'is_active', ...(category.hasRetiredFlag ? ['is_retired'] : [])],
      raw: true,
    });

    return res.json({
      id: Number(updated.id),
      name: String(updated.name || ''),
      sortOrder: Number(updated.sort_order || 0),
      isActive: Boolean(updated.is_active),
      ...(category.hasRetiredFlag ? { isRetired: Boolean(updated.is_retired) } : {}),
    });
  });
});

app.post('/api/admin/meta/:category/reorder', ensureAdmin, async (req, res) => {
  const category = resolveLookupCategory(req.params.category);
  if (!category) {
    return res.status(400).json({ error: 'Invalid metadata category' });
  }

  const orderedIds = Array.isArray(req.body?.orderedIds)
    ? req.body.orderedIds.map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isFinite(value) && value > 0)
    : [];

  if (orderedIds.length === 0) {
    return res.status(400).json({ error: 'orderedIds is required' });
  }

  return withDb(async (db) => {
    const LookupModel = resolveLookupModel(category);
    if (!LookupModel) {
      return res.status(500).json({ error: `Lookup model is not initialized for ${category.key}` });
    }
    const rows = await LookupModel.findAll({
      attributes: ['id'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
    const existingIds = rows.map((row) => Number(row.id));
    const existingSet = new Set(existingIds);

    for (const idValue of orderedIds) {
      if (!existingSet.has(idValue)) {
        return res.status(400).json({ error: `Unknown metadata id: ${idValue}` });
      }
    }

    const remaining = existingIds.filter((idValue) => !orderedIds.includes(idValue));
    const finalOrder = [...orderedIds, ...remaining];

    for (let index = 0; index < finalOrder.length; index += 1) {
      await LookupModel.update({ sort_order: index + 1 }, { where: { id: finalOrder[index] } });
    }

    const refreshed = await LookupModel.findAll({
      attributes: ['id', 'name', 'sort_order', 'is_active', ...(category.hasRetiredFlag ? ['is_retired'] : [])],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });

    return res.json(
      refreshed.map((row) => ({
        id: Number(row.id),
        name: String(row.name || ''),
        sortOrder: Number(row.sort_order || 0),
        isActive: Boolean(row.is_active),
        ...(category.hasRetiredFlag ? { isRetired: Boolean(row.is_retired) } : {}),
      })),
    );
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  await dbApi.init();
  const dbModels = dbApi.getModels() || {};
  const User = dbModels.User;
  if (!User) {
    return res.status(500).json({ error: 'User model is not initialized' });
  }

  const user = await User.findOne({ where: { username } });
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

  await dbApi.init();
  const dbModels = dbApi.getModels() || {};
  const ExcelImportRun = dbModels.ExcelImportRun;
  if (!ExcelImportRun) {
    return res.status(500).json({ error: 'ExcelImportRun model is not initialized' });
  }

  const rows = await ExcelImportRun.findAll({
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit,
    raw: true,
  });

  return res.json(rows.map(mapExcelImportRun));
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

  const allowedSubmissionTypes = await withDb(async (db) => getSubmissionTypes(db));
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!allowedSubmissionTypes.includes(normalizedType)) {
    return res.status(400).json({ error: 'Invalid submission type' });
  }

  if (isBlank(created_by)) {
    return res.status(400).json({ error: 'Requester Name is required' });
  }

  let normalized = {
    created_by: String(created_by).trim(),
    created_by_email: String(created_by_email || '-').trim() || '-',
    type: normalizedType,
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

  if (normalizedType === 'defect') {
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

  if (normalizedType === 'enhancement') {
    if (isBlank(summary_of_issue) || isBlank(request)) {
      return res.status(400).json({
        error:
          'Summary and Request Details are required for enhancements',
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
      desired_completion_date: desired_completion_date ? toIsoOrNow(desired_completion_date) : null,
      priority_level: '3 - Medium',
    };
  }

  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    if (!Submission) {
      return res.status(500).json({ error: 'Submission model is not available' });
    }
    const now = new Date().toISOString();
    const lookupIds = await resolveSubmissionLookupIds(db, {
      created_via: 'rep_form',
      type: normalized.type,
      application_name: normalized.application_name,
      status: 'New',
      cleanup_status: null,
      cleanup_tag_type: null,
      enhancement_request_type: null,
      priority_level: normalized.priority_level || null,
    });
    const missingLookupFields = collectMissingLookupIds(lookupIds, [
      { idKey: 'created_via_id', label: 'Created Via', required: true },
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: normalized.type === 'enhancement' && !isBlank(normalized.priority_level),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }
    const createPayload = {
      created_at: now,
      updated_at: now,
      created_via_id: lookupIds.created_via_id,
      created_by: normalized.created_by,
      created_by_email: normalized.created_by_email,
      type_id: lookupIds.type_id,
      application_id: lookupIds.application_id,
      policy_num: normalized.policy_num,
      account_num: normalized.account_num,
      transaction_num: normalized.transaction_num,
      screen_title: normalized.screen_title,
      summary_of_issue: normalized.summary_of_issue,
      steps_to_reproduce: normalized.steps_to_reproduce,
      what_happened_exact_details: normalized.what_happened_exact_details,
      request: normalized.request,
      date_time_of_error: normalized.date_time_of_error,
      status_id: lookupIds.status_id,
      reviewer: null,
      decision_notes: null,
      fingerprint: null,
      duplicate_of: null,
      easyvista_ticket_id: null,
      desired_completion_date: normalized.desired_completion_date,
      impact_details: null,
      enhancement_request_type_id: null,
      priority_level_id: lookupIds.priority_level_id,
      jira_number: null,
      is_public: 0,
    };

    const createdSubmission = await Submission.create(createPayload);
    const submissionId = Number(createdSubmission.id);

    await persistUploadedFiles(db, submissionId, req.files || [], 'rep');
    await logStatusChange(db, submissionId, 'New', normalized.created_by || 'rep', now);

    const created = await getSubmissionByIdWithLookups(db, submissionId);
    emitAdminNotification('submission:new', mapSubmission(created));

    return res.status(201).json({
      id: submissionId,
      message: 'Submission created',
    });
  });
});

app.get('/api/public/submissions', async (_req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
    if (!Submission) {
      return res.status(500).json({ error: 'Submission model is not initialized' });
    }

    const rawRows = await Submission.findAll({
      where: { is_public: 1 },
      raw: true,
    });

    // Hydrate text fields from FK IDs (DB stores only _id columns, no redundant text columns)
    const lookupMaps = await buildAllLookupMaps(dbModels);
    const rows = rawRows.map((row) => hydrateRowFromMaps(row, lookupMaps));

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
    const events = SubmissionStatusEvent
      ? await SubmissionStatusEvent.findAll({
        where: { submission_id: ids },
        attributes: ['submission_id', 'status', 'changed_at'],
        raw: true,
      })
      : [];
    const bySubmissionId = new Map();
    for (const event of events) {
      const submissionId = Number(event.submission_id);
      if (!bySubmissionId.has(submissionId)) bySubmissionId.set(submissionId, []);
      bySubmissionId.get(submissionId).push(event);
    }

    const enrichedRows = rows.map((row) => {
      const submissionEvents = bySubmissionId.get(Number(row.id)) || [];
      const sortedEvents = [...submissionEvents].sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
      const latest = sortedEvents[0] || null;
      const maxByStatus = (status) => {
        const matches = sortedEvents.filter((event) => String(event.status || '') === status);
        return matches.length > 0 ? matches.reduce((max, event) => (
          !max || new Date(event.changed_at) > new Date(max) ? event.changed_at : max
        ), null) : null;
      };

      return {
        ...row,
        latest_status_changed_at: latest?.changed_at || null,
        latest_status_value: latest?.status || null,
        submitted_status_at: maxByStatus('Submitted'),
        deployed_status_at: maxByStatus('Deployed'),
        duplicate_status_at: maxByStatus('Duplicate'),
        retired_status_at: maxByStatus('Retired'),
      };
    });

    enrichedRows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return res.json(enrichedRows.map(mapSubmission));
  });
});

app.get('/api/public/submissions/:id', async (req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Attachment = dbModels.Attachment;
    if (!Attachment) {
      return res.status(500).json({ error: 'Attachment model is not available' });
    }
    const submission = await getSubmissionByIdWithLookups(db, req.params.id, { publicOnly: true });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const attachments = await Attachment.findAll({
      where: { submission_id: Number(req.params.id) },
      order: [['uploaded_at', 'DESC']],
      raw: true,
    });

    return res.json({
      ...mapSubmission(submission),
      attachments,
    });
  });
});

app.get('/api/admin/submissions', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const rows = await listFilteredAdminSubmissions(db, req.query);
    return res.json(rows);
  });
});

app.get('/api/admin/submissions/export-xlsx', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const rows = await listFilteredAdminSubmissions(db, req.query);
    const requestedFieldKeys = String(req.query.fields || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const selectedFields = requestedFieldKeys.length > 0
      ? requestedFieldKeys.map((key) => ADMIN_EXPORT_FIELDS_BY_KEY.get(key)).filter(Boolean)
      : ADMIN_EXPORT_FIELDS;

    if (selectedFields.length === 0) {
      return res.status(400).json({ error: 'No valid export fields were selected.' });
    }

    const headerRow = selectedFields.map((field) => field.label);
    const bodyRows = rows.map((row) => selectedFields.map((field) => toExportCellValue(field.value(row))));
    const worksheet = XLSX.utils.aoa_to_sheet([headerRow, ...bodyRows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Admin Submissions');

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `admin-submissions-export-${stamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(buffer);
  });
});

app.get('/api/admin/submissions/export-fields', ensureAdmin, async (_req, res) => {
  return res.json({
    fields: ADMIN_EXPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  });
});

app.get('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const submissionId = Number.parseInt(String(req.params.id || ''), 10);
    if (!Number.isFinite(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }

    const dbModels = dbApi.getModels() || {};
    const Attachment = dbModels.Attachment;
    const SubmissionStatusEvent = dbModels.SubmissionStatusEvent;
    if (!Attachment || !SubmissionStatusEvent) {
      return res.status(500).json({ error: 'Required models are not available' });
    }
    const submission = await getSubmissionByIdWithLookups(db, submissionId);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const attachments = await Attachment.findAll({
      where: { submission_id: submissionId },
      order: [['uploaded_at', 'DESC']],
      raw: true,
    });

    const status_events = await SubmissionStatusEvent.findAll({
      where: { submission_id: submissionId },
      attributes: ['id', 'submission_id', 'status', 'changed_at', 'changed_by'],
      order: [['changed_at', 'DESC'], ['id', 'DESC']],
      raw: true,
    });

    const timeline = buildStatusTimeline(submission, status_events);

    return res.json({
      ...mapSubmission(submission),
      attachments,
      status_events: timeline,
    });
  });
});

app.post('/api/admin/submissions', ensureAdmin, async (req, res) => {
  const body = req.body || {};
  const requestedCreatedVia = String(body.created_via || '').trim().toLowerCase();
  if (isBlank(body.created_by)) {
    return res.status(400).json({ error: 'Requester Name is required' });
  }
  if (isBlank(body.summary_of_issue)) {
    return res.status(400).json({ error: 'Summary of Issue is required' });
  }

  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    if (!Submission) {
      return res.status(500).json({ error: 'Submission model is not available' });
    }
    const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const historicalStatuses = await getDefectEnhancementStatuses(db, { includeRetired: true });
    const allowedSubmissionTypes = await getSubmissionTypes(db);
    const allowedSubmissionSources = await getSubmissionSources(db);
    const allowedCleanupStatuses = await getCleanupStatuses(db);
    const allowedCleanupTagTypes = await getCleanupTagTypes(db);
    const createdVia = allowedSubmissionSources.includes(requestedCreatedVia)
      ? requestedCreatedVia
      : (allowedSubmissionSources.includes('admin_manual') ? 'admin_manual' : (allowedSubmissionSources[0] || 'admin_manual'));

    const isCleanup = Boolean(body.is_cleanup);
    const cleanupTagType = normalizeCleanupTagType(body.cleanup_tag_type, allowedCleanupTagTypes);
    const requestedType = String(body.type || '').trim().toLowerCase();
    const normalizedRequestedType = allowedSubmissionTypes.includes(requestedType) ? requestedType : null;
    const effectiveType = isCleanup
      ? (cleanupTagType === 'enhancement' ? 'enhancement' : (normalizedRequestedType || 'defect'))
      : normalizedRequestedType;

    if (!allowedSubmissionTypes.includes(String(effectiveType || '').trim().toLowerCase())) {
      return res.status(400).json({ error: 'Invalid submission type' });
    }

    const requestedCleanupStatus = String(body.cleanup_status || '').trim();
    const cleanupStatus = isCleanup
      ? (allowedCleanupStatuses.includes(requestedCleanupStatus) ? requestedCleanupStatus : 'New')
      : null;
    const requestedFinalStatus = String(body.status || '').trim();
    const finalStatus = allowedStatuses.includes(requestedFinalStatus) ? requestedFinalStatus : 'New';

    const createdAt = body.created_at ? toIsoOrNow(body.created_at) : new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const rawEvents = Array.isArray(body.status_events) ? body.status_events : [];
    const resolvedApplicationName = String(body.application_name || 'Billing Center').trim() || 'Billing Center';
    const resolvedEnhancementRequestType = body.enhancement_request_type || null;
    const resolvedPriorityLevel = body.priority_level || (effectiveType === 'enhancement' ? '3 - Medium' : null);
    const lookupIds = await resolveSubmissionLookupIds(db, {
      created_via: createdVia,
      type: effectiveType,
      application_name: resolvedApplicationName,
      status: finalStatus,
      cleanup_status: cleanupStatus,
      cleanup_tag_type: cleanupTagType,
      enhancement_request_type: resolvedEnhancementRequestType,
      priority_level: resolvedPriorityLevel,
    });
    const missingLookupFields = collectMissingLookupIds(lookupIds, [
      { idKey: 'created_via_id', label: 'Created Via', required: true },
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      { idKey: 'cleanup_status_id', label: 'Cleanup Status', required: isCleanup && !isBlank(cleanupStatus) },
      { idKey: 'cleanup_tag_type_id', label: 'Cleanup Tag Type', required: isCleanup && !isBlank(cleanupTagType) },
      {
        idKey: 'enhancement_request_type_id',
        label: 'Enhancement Request Type',
        required: !isBlank(resolvedEnhancementRequestType),
      },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: effectiveType === 'enhancement' && !isBlank(resolvedPriorityLevel),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }

    const insertColumns = [
      'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
      'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
      'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
      'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_of', 'easyvista_ticket_id',
      'desired_completion_date', 'impact_details', 'enhancement_request_type_id', 'priority_level_id',
      'jira_number', 'release_number', 'release_notes', 'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id',
      'easyvista_submitted_by', 'is_public', 'is_retired', 'logged_defect',
    ];
    const insertValues = [
      createdAt,
      updatedAt,
      lookupIds.created_via_id,
      String(body.created_by).trim(),
      String(body.created_by_email || '-').trim() || '-',
      lookupIds.type_id,
      lookupIds.application_id,
      body.policy_num || null,
      body.account_num || null,
      body.transaction_num || null,
      String(body.screen_title || '-').trim() || '-',
      String(body.summary_of_issue).trim(),
      String(body.steps_to_reproduce || '-').trim() || '-',
      String(body.what_happened_exact_details || '-').trim() || '-',
      String(body.request || '-').trim() || '-',
      body.date_time_of_error ? toIsoOrNow(body.date_time_of_error) : createdAt,
      lookupIds.status_id,
      body.reviewer || null,
      body.decision_notes || null,
      null,
      null,
      body.easyvista_ticket_id ? String(body.easyvista_ticket_id).trim() : null,
      body.desired_completion_date ? toIsoOrNow(body.desired_completion_date) : null,
      body.impact_details || null,
      lookupIds.enhancement_request_type_id,
      lookupIds.priority_level_id,
      body.jira_number ? String(body.jira_number).trim() : null,
      body.release_number ? String(body.release_number).trim() : null,
      body.release_notes || null,
      toBooleanSql(isCleanup),
      lookupIds.cleanup_status_id,
      lookupIds.cleanup_tag_type_id,
      String(body.easyvista_submitted_by || '').trim() || 'Unknown',
      toBooleanSql(body.is_public),
      0,
      toBooleanSql(body.logged_defect),
    ];
    const payload = insertColumns.reduce((acc, column, index) => {
      acc[column] = insertValues[index];
      return acc;
    }, {});
    const createdSubmission = await Submission.create(payload);
    const subId = Number(createdSubmission.id);

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

    const created = await getSubmissionByIdWithLookups(db, subId);
    emitAdminNotification('submission:new', mapSubmission(created));
    return res.status(201).json(mapSubmission(created));
  });
});

app.put('/api/admin/submissions/:id', ensureAdmin, async (req, res) => {
  const body = req.body || {};

  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
    const allowedSubmissionTypes = await getSubmissionTypes(db);
    const allowedCleanupStatuses = await getCleanupStatuses(db);
    const allowedCleanupTagTypes = await getCleanupTagTypes(db);

    const rawExisting = await Submission.findByPk(Number(req.params.id), { raw: true });
    if (!rawExisting) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    // Hydrate text fields from FK IDs (DB stores only _id columns, no redundant text columns)
    const existing = await resolveExistingLookupFields(rawExisting);

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
    const occurrenceCount = isBlank(body.occurrence_count)
      ? null
      : Number(body.occurrence_count);
    const occurrenceTimeframeCount = isBlank(body.occurrence_timeframe_count)
      ? null
      : Number(body.occurrence_timeframe_count);

    const isCleanup =
      typeof body.is_cleanup === 'boolean' ? body.is_cleanup : Boolean(existing.is_cleanup);

    const hasCleanupTagType = Object.prototype.hasOwnProperty.call(body, 'cleanup_tag_type');
    const incomingCleanupTagType = normalizeCleanupTagType(body.cleanup_tag_type, allowedCleanupTagTypes);
    const existingCleanupTagType = normalizeCleanupTagType(existing.cleanup_tag_type, allowedCleanupTagTypes);

    const requestedCleanupStatus = String(body.cleanup_status || '').trim();
    const nextCleanupStatus = isCleanup
        ? (allowedCleanupStatuses.includes(requestedCleanupStatus)
          ? requestedCleanupStatus
          : (existing.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[existing.status] || 'New'))
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
      status: String(body.status ?? normalizedExistingStatus).trim() || normalizedExistingStatus,
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
      easyvista_submitted_by:
        body.easyvista_submitted_by ?? existing.easyvista_submitted_by,
      occurrence_count:
        Object.prototype.hasOwnProperty.call(body, 'occurrence_count')
          ? (Number.isFinite(occurrenceCount) && occurrenceCount > 0 ? Math.trunc(occurrenceCount) : null)
          : existing.occurrence_count,
      occurrence_timeframe_count:
        Object.prototype.hasOwnProperty.call(body, 'occurrence_timeframe_count')
          ? (Number.isFinite(occurrenceTimeframeCount) && occurrenceTimeframeCount > 0 ? Math.trunc(occurrenceTimeframeCount) : null)
          : existing.occurrence_timeframe_count,
      occurrence_timeframe:
        body.occurrence_timeframe ?? existing.occurrence_timeframe ?? null,
    };

    const normalizedExistingStatusValue = String(existing.status || '').trim() || 'New';
    const normalizedNextStatus = String(next.status || '').trim() || normalizedExistingStatusValue;
    next.status = normalizedNextStatus;

    if (!allowedStatuses.includes(normalizedNextStatus) && normalizedNextStatus !== normalizedExistingStatusValue) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!allowedSubmissionTypes.includes(String(next.type || '').trim().toLowerCase())) {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const isEditingEnhancementRequestType = Object.prototype.hasOwnProperty.call(
      body,
      'enhancement_request_type',
    );
    if (
      next.type === 'enhancement' &&
      isEditingEnhancementRequestType &&
      next.enhancement_request_type
    ) {
      const allowedEnhancementRequestTypes = await getEnhancementRequestTypes(db);
      if (!allowedEnhancementRequestTypes.includes(next.enhancement_request_type)) {
        return res.status(400).json({ error: 'Invalid enhancement request type' });
      }
    }

    if (next.type === 'enhancement' && isBlank(next.priority_level)) {
      next.priority_level = '3 - Medium';
    }

    const lookupIds = await resolveSubmissionLookupIds(db, {
      created_via: existing.created_via,
      type: next.type,
      application_name: next.application_name,
      status: next.status,
      cleanup_status: next.cleanup_status,
      cleanup_tag_type: next.cleanup_tag_type,
      enhancement_request_type: next.enhancement_request_type,
      priority_level: next.priority_level,
    });
    const missingLookupFields = collectMissingLookupIds(lookupIds, [
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      { idKey: 'cleanup_status_id', label: 'Cleanup Status', required: next.is_cleanup && !isBlank(next.cleanup_status) },
      { idKey: 'cleanup_tag_type_id', label: 'Cleanup Tag Type', required: next.is_cleanup && !isBlank(next.cleanup_tag_type) },
      {
        idKey: 'enhancement_request_type_id',
        label: 'Enhancement Request Type',
        required: !isBlank(next.enhancement_request_type),
      },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: next.type === 'enhancement' && !isBlank(next.priority_level),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }

    const updatedAt = new Date().toISOString();
    const updatePayload = {
      updated_at: updatedAt,
      type_id: lookupIds.type_id,
      application_id: lookupIds.application_id,
      policy_num: next.policy_num,
      account_num: next.account_num,
      transaction_num: next.transaction_num,
      screen_title: next.screen_title,
      summary_of_issue: next.summary_of_issue,
      steps_to_reproduce: next.steps_to_reproduce,
      what_happened_exact_details: next.what_happened_exact_details,
      request: next.request,
      date_time_of_error: next.date_time_of_error,
      status_id: lookupIds.status_id,
      reviewer: next.reviewer,
      decision_notes: next.decision_notes,
      fingerprint: next.fingerprint,
      desired_completion_date: next.desired_completion_date,
      impact_details: next.impact_details,
      impact_notes: next.impact_notes,
      policy_premium_impact: next.policy_premium_impact,
      direct_dollar_impact: next.direct_dollar_impact,
      policies_affected_count: next.policies_affected_count,
      logged_defect: toBooleanSql(next.logged_defect),
      enhancement_request_type_id: lookupIds.enhancement_request_type_id,
      priority_level_id: lookupIds.priority_level_id,
      jira_number: next.jira_number,
      release_number: next.release_number,
      release_notes: next.release_notes,
      is_cleanup: toBooleanSql(next.is_cleanup),
      // When is_cleanup=false preserve the existing ID so it can be restored if re-checked later
      cleanup_status_id: isCleanup ? lookupIds.cleanup_status_id : (existing.cleanup_status_id ?? null),
      cleanup_tag_type_id: lookupIds.cleanup_tag_type_id,
      is_retired: toBooleanSql(next.is_retired),
      duplicate_reference: next.duplicate_reference,
      duplicate_of: next.duplicate_of,
      is_public: toBooleanSql(next.is_public),
      easyvista_submitted_by: next.easyvista_submitted_by,
      occurrence_count: next.occurrence_count,
      occurrence_timeframe_count: next.occurrence_timeframe_count,
      occurrence_timeframe_id: await getLookupIdByName(db, 'occurrence_timeframes', next.occurrence_timeframe),
      occurrence_rate: calculateOccurrenceRate(next.occurrence_count, next.occurrence_timeframe_count, next.occurrence_timeframe),
    };

    await Submission.update(updatePayload, {
      where: { id: Number(req.params.id) },
    });

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

    const saved = await getSubmissionByIdWithLookups(db, req.params.id);
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
      const dbModels = dbApi.getModels() || {};
      const Submission = dbModels.Submission;
      if (!Submission) {
        return res.status(500).json({ error: 'Submission model is not available' });
      }
      const existing = await Submission.findByPk(Number(req.params.id), { raw: true });
      if (!existing) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      const created = await persistUploadedFiles(db, existing.id, req.files || [], 'admin');

      await Submission.update(
        { updated_at: new Date().toISOString() },
        { where: { id: Number(existing.id) } },
      );

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
    const dbModels = dbApi.getModels() || {};
    const Attachment = dbModels.Attachment;
    const Submission = dbModels.Submission;
    if (!Attachment || !Submission) {
      return res.status(500).json({ error: 'Required models are not available' });
    }
    const attachment = await Attachment.findByPk(Number(req.params.id), { raw: true });
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const removedFromSupabase = await deleteSupabaseStoredFileByUrl(attachment.file_path);
    if (!removedFromSupabase) {
      const absolute = path.join(__dirname, '..', attachment.file_path);
      if (fs.existsSync(absolute)) {
        fs.rmSync(absolute, { force: true });
      }
    }

    await Attachment.destroy({ where: { id: Number(req.params.id) } });

    await Submission.update(
      { updated_at: new Date().toISOString() },
      { where: { id: Number(attachment.submission_id) } },
    );

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
  const dynamicImportOptions = await withDb(async (db) => ({
    allowedStatusesWithRetired: await getDefectEnhancementStatuses(db, { includeRetired: true }),
    allowedSubmissionTypes: await getSubmissionTypes(db),
    allowedCleanupStatuses: await getCleanupStatuses(db),
    allowedCleanupTagTypes: await getCleanupTagTypes(db),
  }));

  const {
    allowedStatusesWithRetired,
    allowedSubmissionTypes,
    allowedCleanupStatuses,
    allowedCleanupTagTypes,
  } = dynamicImportOptions;

  const normalizedStatusValueMappings = {};
  if (statusValueMappings && typeof statusValueMappings === 'object') {
    for (const [rawKey, rawValue] of Object.entries(statusValueMappings)) {
      const fromKey = normalizeStatusToken(rawKey);
      const toStatus = String(rawValue || '').trim();
      if (!fromKey) continue;
      if (!allowedStatusesWithRetired.includes(toStatus)) continue;
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
      } else if (allowedStatusesWithRetired.includes(statusInput)) {
        importedStatus = statusInput;
      } else {
        const mappedStatus = normalizedStatusValueMappings[normalizeStatusToken(statusInput)] || '';
        if (mappedStatus && allowedStatusesWithRetired.includes(mappedStatus)) {
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

      const rowCleanupTagType = normalizeCleanupTagType(getMappedImportValue(row, 'cleanup_tag_type', ['cleanup_tag_type', 'cleanup_type'], normalizedColumnMappings, null), allowedCleanupTagTypes);
      const inferredCleanup = parseImportBoolean(getMappedImportValue(row, 'is_cleanup', ['is_cleanup', 'cleanup'], normalizedColumnMappings, false), false) || Boolean(rowCleanupTagType);
      const isCleanup = importMode === 'cleanup' ? true : inferredCleanup;
      const requestedCleanupStatus = String(getMappedImportValue(row, 'cleanup_status', ['cleanup_status'], normalizedColumnMappings, '') || '').trim();
      const cleanupStatus = isCleanup
        ? (allowedCleanupStatuses.includes(requestedCleanupStatus) ? requestedCleanupStatus : 'Not Started')
        : null;
      const effectiveCleanupTagType = isCleanup
        ? (importMode === 'cleanup' ? 'cleanup_only' : (rowCleanupTagType || 'cleanup_only'))
        : null;

      let effectiveType = allowedSubmissionTypes.includes(requestedType) ? requestedType : 'defect';
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
        allowedStatuses: allowedStatusesWithRetired,
      });
    }

    return withDb(async (db) => {
      const dbModels = dbApi.getModels() || {};
      const Submission = dbModels.Submission;
      const ExcelImportRun = dbModels.ExcelImportRun;
      const changedBy = req.session?.user?.username || 'admin';
      let insertedRows = 0;
      const insertionErrors = [];

      if (!dryRun && preparedRows.length > 0) {
        for (const row of preparedRows) {
          try {
            const lookupIds = await resolveSubmissionLookupIds(db, {
              created_via: 'admin_excel_import',
              type: row.type,
              application_name: row.application_name,
              status: row.status,
              cleanup_status: row.cleanup_status,
              cleanup_tag_type: row.cleanup_tag_type,
              enhancement_request_type: row.enhancement_request_type,
              priority_level: row.priority_level,
            });
            const missingLookupFields = collectMissingLookupIds(lookupIds, [
              { idKey: 'created_via_id', label: 'Created Via', required: true },
              { idKey: 'type_id', label: 'Type', required: true },
              { idKey: 'application_id', label: 'Application', required: true },
              { idKey: 'status_id', label: 'Status', required: true },
              {
                idKey: 'cleanup_status_id',
                label: 'Cleanup Status',
                required: Boolean(row.is_cleanup) && !isBlank(row.cleanup_status),
              },
              {
                idKey: 'cleanup_tag_type_id',
                label: 'Cleanup Tag Type',
                required: Boolean(row.is_cleanup) && !isBlank(row.cleanup_tag_type),
              },
              {
                idKey: 'enhancement_request_type_id',
                label: 'Enhancement Request Type',
                required: !isBlank(row.enhancement_request_type),
              },
              {
                idKey: 'priority_level_id',
                label: 'Priority Level',
                required: row.type === 'enhancement' && !isBlank(row.priority_level),
              },
            ]);
            if (missingLookupFields.length > 0) {
              throw new Error(formatMissingLookupError(missingLookupFields));
            }
            const insertColumns = [
              'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
              'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
              'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
              'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_of', 'easyvista_ticket_id',
              'desired_completion_date', 'impact_details', 'enhancement_request_type_id', 'priority_level_id',
              'jira_number', 'release_number', 'release_notes', 'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id',
              'easyvista_submitted_by', 'is_public', 'is_retired', 'logged_defect',
            ];
            const insertValues = [
              row.created_at,
              row.updated_at,
              lookupIds.created_via_id,
              row.created_by,
              row.created_by_email,
              lookupIds.type_id,
              lookupIds.application_id,
              row.policy_num,
              row.account_num,
              row.transaction_num,
              row.screen_title,
              row.summary_of_issue,
              row.steps_to_reproduce,
              row.what_happened_exact_details,
              row.request,
              row.date_time_of_error,
              lookupIds.status_id,
              row.reviewer,
              row.decision_notes,
              null,
              null,
              row.easyvista_ticket_id,
              row.desired_completion_date,
              row.impact_details,
              lookupIds.enhancement_request_type_id,
              lookupIds.priority_level_id,
              row.jira_number,
              row.release_number,
              row.release_notes,
              toBooleanSql(row.is_cleanup),
              lookupIds.cleanup_status_id,
              lookupIds.cleanup_tag_type_id,
              row.easyvista_submitted_by,
              toBooleanSql(row.is_public),
              toBooleanSql(row.is_retired),
              toBooleanSql(row.logged_defect),
            ];
            if (!Submission) {
              throw new Error('Submission model is not initialized');
            }
            const submissionId = Number((await Submission.create(
              insertColumns.reduce((acc, column, columnIndex) => {
                acc[column] = insertValues[columnIndex];
                return acc;
              }, {}),
            )).id);
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

      const historyPayload = {
        created_at: new Date().toISOString(),
        created_by: changedBy,
        file_name: String(uploadedFile.originalname || 'upload.xlsx'),
        sheet_name: sheetName,
        import_mode: importMode,
        total_rows: responseBase.totalRows,
        valid_rows: responseBase.validRows,
        invalid_rows: invalidRows,
        inserted_rows: insertedRows,
        dry_run: toBooleanSql(dryRun),
        status,
        summary_message: summaryMessage,
        errors_json: JSON.stringify(combinedErrors),
      };

      if (!ExcelImportRun) {
        throw new Error('ExcelImportRun model is not initialized');
      }
      const historyEntry = (await ExcelImportRun.create(historyPayload)).toJSON();

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
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    const Attachment = dbModels.Attachment;
    if (!Submission || !Attachment) {
      return res.status(500).json({ error: 'Required models are not available' });
    }
    const submission = await Submission.findByPk(Number(req.params.id), { raw: true });
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
      const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
      const allowedSubmissionTypes = await getSubmissionTypes(db);
      const allowedCleanupStatuses = await getCleanupStatuses(db);
      const allowedCleanupTagTypes = await getCleanupTagTypes(db);
      const hasCleanupTagType = Object.prototype.hasOwnProperty.call(draftPayload, 'cleanup_tag_type');
      const incomingCleanupTagType = normalizeCleanupTagType(draftPayload.cleanup_tag_type, allowedCleanupTagTypes);
      const existingCleanupTagType = normalizeCleanupTagType(submission.cleanup_tag_type, allowedCleanupTagTypes);
      const isCleanup =
        typeof draftPayload.is_cleanup === 'boolean'
          ? draftPayload.is_cleanup
          : Boolean(submission.is_cleanup);
      const requestedCleanupStatus = String(draftPayload.cleanup_status || '').trim();
      const nextCleanupStatus = isCleanup
        ? (allowedCleanupStatuses.includes(requestedCleanupStatus)
            ? requestedCleanupStatus
            : (submission.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[submission.status] || 'Not Started'))
        : null;
      const nextCleanupTagType = isCleanup
        ? (hasCleanupTagType ? incomingCleanupTagType : existingCleanupTagType)
        : null;
      const requestedType = String(draftPayload.type || '').trim().toLowerCase();
      const nextType = isCleanup
        ? (nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect')
        : (allowedSubmissionTypes.includes(requestedType) ? requestedType : submission.type);
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
      const allowedEnhancementRequestTypes = await getEnhancementRequestTypes(db);
      if (
        isBlank(source.enhancement_request_type) ||
        !allowedEnhancementRequestTypes.includes(source.enhancement_request_type)
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
    const easyVistaReporter = req.session?.user?.username || 'Unknown';
    const easyVistaSubmittedBy = `Automatic (System API by ${easyVistaReporter})`;

    if (!isResubmissionRequest) {
      await Submission.update({
        easyvista_ticket_id: result.ticketId,
        status: 'Submitted',
        updated_at: updatedAt,
        easyvista_submitted_by: easyVistaSubmittedBy,
      }, {
        where: { id: Number(submission.id) },
      });

      if (submission.status !== 'Submitted') {
        await logStatusChange(db, submission.id, 'Submitted', easyVistaSubmittedBy, updatedAt);
      }

      const updated = await getSubmissionByIdWithLookups(db, submission.id);
      emitAdminNotification('submission:submitted-easyvista', mapSubmission(updated));

      return res.json({
        ticketId: result.ticketId,
        source: result.source,
        resubmission: false,
        submission: mapSubmission(updated),
      });
    }

    const resubmissionInsertColumns = [
      'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
      'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
      'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
      'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_reference', 'duplicate_of',
      'easyvista_ticket_id', 'desired_completion_date', 'impact_details', 'impact_notes',
      'policy_premium_impact', 'direct_dollar_impact', 'policies_affected_count', 'logged_defect',
      'enhancement_request_type_id', 'priority_level_id', 'jira_number', 'release_number', 'release_notes',
      'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id', 'easyvista_submitted_by',
      'is_resubmission', 'resubmission_of_submission_id', 'resubmission_of_easyvista_ticket_id',
      'has_resubmission', 'latest_resubmission_submission_id', 'latest_resubmission_easyvista_ticket_id',
      'is_public', 'is_retired',
    ];
    const resubmissionInsertValues = [
      updatedAt,
      updatedAt,
      null,
      source.created_by,
      source.created_by_email,
      null,
      null,
      source.policy_num,
      source.account_num,
      source.transaction_num,
      source.screen_title,
      source.summary_of_issue,
      source.steps_to_reproduce,
      source.what_happened_exact_details,
      source.request,
      source.date_time_of_error,
      null,
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
      null,
      null,
      source.jira_number,
      source.release_number,
      source.release_notes,
      toBooleanSql(source.is_cleanup),
      null,
      null,
      easyVistaSubmittedBy,
      1,
      submission.id,
      submission.easyvista_ticket_id,
      0,
      null,
      null,
      toBooleanSql(source.is_public),
      toBooleanSql(source.is_retired),
    ];
    const payload = resubmissionInsertColumns.reduce((acc, column, index) => {
      acc[column] = resubmissionInsertValues[index];
      return acc;
    }, {});
    const createdSubmission = await Submission.create(payload);
    const resubmissionId = Number(createdSubmission.id);
    const createdLookupIds = await resolveSubmissionLookupIds(db, {
      created_via: 'admin_easyvista_resubmission',
      type: effectiveType,
      application_name: source.application_name,
      status: 'Submitted',
      cleanup_status: source.cleanup_status,
      cleanup_tag_type: source.cleanup_tag_type,
      enhancement_request_type: source.enhancement_request_type,
      priority_level: source.priority_level,
    });
    const missingLookupFields = collectMissingLookupIds(createdLookupIds, [
      { idKey: 'created_via_id', label: 'Created Via', required: true },
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      {
        idKey: 'cleanup_status_id',
        label: 'Cleanup Status',
        required: Boolean(source.is_cleanup) && !isBlank(source.cleanup_status),
      },
      {
        idKey: 'cleanup_tag_type_id',
        label: 'Cleanup Tag Type',
        required: Boolean(source.is_cleanup) && !isBlank(source.cleanup_tag_type),
      },
      {
        idKey: 'enhancement_request_type_id',
        label: 'Enhancement Request Type',
        required: !isBlank(source.enhancement_request_type),
      },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: effectiveType === 'enhancement' && !isBlank(source.priority_level),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }
    await Submission.update({
      created_via_id: createdLookupIds.created_via_id,
      type_id: createdLookupIds.type_id,
      application_id: createdLookupIds.application_id,
      status_id: createdLookupIds.status_id,
      cleanup_status_id: createdLookupIds.cleanup_status_id,
      cleanup_tag_type_id: createdLookupIds.cleanup_tag_type_id,
      enhancement_request_type_id: createdLookupIds.enhancement_request_type_id,
      priority_level_id: createdLookupIds.priority_level_id,
    }, {
      where: { id: Number(resubmissionId) },
    });

    const existingAttachments = await Attachment.findAll({
      where: { submission_id: Number(submission.id) },
      attributes: ['filename', 'mime_type', 'file_path', 'uploaded_by_role'],
      raw: true,
    });
    for (const attachment of existingAttachments) {
      await Attachment.create({
        submission_id: resubmissionId,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        file_path: attachment.file_path,
        uploaded_at: updatedAt,
        uploaded_by_role: attachment.uploaded_by_role,
      });
    }

    await Submission.update({
      has_resubmission: 1,
      latest_resubmission_submission_id: resubmissionId,
      latest_resubmission_easyvista_ticket_id: result.ticketId,
      updated_at: updatedAt,
    }, {
      where: { id: Number(submission.id) },
    });

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

    const newSubmission = await getSubmissionByIdWithLookups(db, resubmissionId);
    const updatedOriginal = await getSubmissionByIdWithLookups(db, submission.id);

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
