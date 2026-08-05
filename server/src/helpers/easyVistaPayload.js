/**
 * The single definition of what EasyVista receives.
 *
 * `submitToEasyVista` sends exactly this, and the admin modal's preview renders
 * exactly this. Keeping one copy is the point: a preview built from a second,
 * hand-maintained copy of the format drifts silently and the admin trusts it
 * anyway.
 *
 * ── Why this looks strange ──────────────────────────────────────────────
 * EasyVista's Billing Center catalog does not have fields named after the
 * things we send. Existing fields are REPURPOSED, so `E_KCL_CHECK_VOID_REASON`
 * carries the summary of the issue and `E_KCL_MKT_AUDIENCE` carries what
 * happened. The mapping below is the only place that translation lives, and the
 * admin modal shows both names side by side so the repurposing is visible
 * rather than folklore.
 *
 * Everything is ALSO rendered into `Description` as an HTML table, because the
 * repurposed fields are not surfaced anywhere readable in the EasyVista UI.
 *
 * ⚠️ KNOWN ISSUE (EasyVista side, not ours): EV overwrites `Description` with
 * its own form-question results, which come through empty. Sending the table
 * is what we can do about it from here; making it stick is an EV-side fix.
 */

// Only the admin-facing refusal message below uses this. The field codes, the
// env vars and this module's own name keep the vendor's on purpose.
const { TRACKER_LABEL } = require('../constants');

const value = (v) => (v === null || v === undefined ? '' : String(v));
const orDash = (v) => (value(v).trim() === '' ? '-' : value(v));

/** EasyVista's `*_UT` date fields: `M/D/YYYY HH:mm`, 24-hour. */
function formatEasyVistaDate(input) {
  const date = input ? new Date(input) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The human-readable form used inside the HTML table: `MM/DD/YYYY h:mm:ss am`. */
function formatDisplayDate(input) {
  const date = input ? new Date(input) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()}`
    + ` ${pad(hours12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + ` ${hours24 < 12 ? 'am' : 'pm'}`;
}

/**
 * Our field → the EasyVista field carrying it, and the label it gets in the
 * HTML table. `evField: null` means the value only appears in the table.
 *
 * `only` marks the fields that belong to one type. A defect has no Request Type
 * or Desired Completion Date; an enhancement has no Steps To Reproduce. The
 * modal only ever collects the relevant half, so sending — and worse, offering
 * to edit — the other half is noise.
 *
 * ORDER IS THE WIRE FORMAT for the table. Reordering changes every future ticket.
 */
const EASYVISTA_FIELD_MAP = [
  { key: 'policy_num', label: 'Policy#/Submission#', evField: 'E_LEGAL_POLICY_NUMBER' },
  { key: 'summary_of_issue', label: 'Summary of Issue', evField: 'E_KCL_CHECK_VOID_REASON' },
  { key: 'screen_title', label: 'Screen Title', evField: 'E_KCL_CHECK_REISSUED' },
  { key: 'steps_to_reproduce', label: 'Steps To Reproduce', evField: 'E_KCL_CHECK_TYPE', only: 'defect' },
  { key: 'what_happened_exact_details', label: 'What happened (Exact Details)', evField: 'E_KCL_MKT_AUDIENCE', only: 'defect' },
  { key: 'account_num', label: 'Account#', evField: 'E_KCL_CHECK_PAYEE' },
  { key: 'transaction_num', label: 'Transaction#', evField: 'E_PRB_CENTURYLINK_DCI1' },
  { key: 'created_by', label: 'Requestor', evField: null },
  { key: 'date_time_of_error', label: 'Time/Date of Error', evField: 'E_PRB_LAST_UPDATE_UT', date: true, only: 'defect' },
  // Carried in the table only — no repurposed field has been assigned to these.
  { key: 'type', label: 'Type', evField: null },
  { key: 'application_name', label: 'Application', evField: null },
  { key: 'request', label: 'Request', evField: null, only: 'enhancement' },
  { key: 'impact_details', label: 'Impact Details', evField: null, only: 'enhancement' },
  { key: 'enhancement_request_type', label: 'Enhancement Request Type', evField: null, only: 'enhancement' },
  { key: 'priority_level', label: 'Priority Level', evField: null, only: 'enhancement' },
  { key: 'desired_completion_date', label: 'Desired Completion Date', evField: null, date: true, only: 'enhancement' },
  { key: 'jira_number', label: 'JIRA Number', evField: null },
];

/** The fields that apply to a ticket of this type. */
function fieldsForType(type) {
  const effective = type === 'enhancement' ? 'enhancement' : 'defect';
  return EASYVISTA_FIELD_MAP.filter((field) => !field.only || field.only === effective);
}

/**
 * The rows the admin modal renders: our label, and the value that will be sent.
 * The HTML table is built from these same rows, so the preview cannot show one
 * thing and send another.
 */
function buildDescriptionRows(submission) {
  return fieldsForType(submission.type).map((field) => ({
    key: field.key,
    label: field.label,
    evField: field.evField,
    value: field.date ? formatDisplayDate(submission[field.key]) : orDash(submission[field.key]),
  }));
}

const CELL_LABEL = 'color: #0000ff;font-family:arial;font-size:12px;';
const CELL_VALUE = 'font-family:arial;color:blue;font-size:12px;padding-left:5px;';

/** Minimal escaping — these values land inside an HTML table cell. */
function escapeHtml(input) {
  return value(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The HTML table that goes in `Description`, so the repurposed fields stay
 * readable to whoever opens the ticket.
 */
function buildDescriptionHtml(submission) {
  const rows = buildDescriptionRows(submission)
    .map((row) => (
      '<tr>'
      + `<td style="padding: 8px;"><span style="${CELL_LABEL}">${escapeHtml(row.label)}</td>`
      + `<td style="${CELL_VALUE}">${escapeHtml(row.value)}</span></td>`
      + '</tr>'
    ))
    .join('\n');

  return '<table border="0" cellpadding="5px">\n<tbody>'
    + '<tr><td colspan="2"><h4>Details</h4><hr></td></tr>\n'
    + `${rows}\n`
    + '</tbody></table>';
}

/**
 * Values that are catalog configuration rather than ticket data.
 *
 * `application` is the row for the ticket's application and, when it carries a
 * catalog, it WINS. The environment is a fallback for exactly one application —
 * the one named by `EASYVISTA_DEFAULT_APPLICATION` — so the catalog that was
 * configured before applications had their own keeps working, and no OTHER
 * application silently inherits it. That inheritance was the bug: a Policy
 * Center ticket posting into Billing Center's catalog with Billing Center's
 * repurposed field names, with nothing to show for it.
 */
function easyVistaConfig(application = null) {
  const ownGuid = value(application?.easyvista_catalog_guid).trim();
  const ownCode = value(application?.easyvista_catalog_code).trim();

  const defaultApplication = String(process.env.EASYVISTA_DEFAULT_APPLICATION || '').trim();
  const inheritsEnv = Boolean(defaultApplication)
    && value(application?.name).trim().toLowerCase() === defaultApplication.toLowerCase();
  // No application at all (a preview built before one is known) keeps the old
  // behaviour of reading the environment, so the dry-run preview still renders.
  const mayUseEnv = inheritsEnv || !application;

  return {
    catalogGuid: ownGuid || (mayUseEnv ? process.env.EASYVISTA_CATALOG_GUID || '' : ''),
    catalogCode: ownCode || (mayUseEnv ? process.env.EASYVISTA_CATALOG_CODE || '' : ''),
    // Medium. Matches the "3 - Medium" the service already defaults an
    // enhancement's priority to, so an unprioritised defect lands the same way.
    urgencyId: process.env.EASYVISTA_URGENCY_ID || '3',
    severityId: process.env.EASYVISTA_SEVERITY_ID || '40',
    origin: process.env.EASYVISTA_ORIGIN || '3',
    fallbackMail: process.env.EASYVISTA_FALLBACK_MAIL || '',
  };
}

/**
 * Whether this application can be sent to for real, and why not if it cannot.
 *
 * Only meaningful for a LIVE send. While EasyVista is off — the stub and demo
 * paths — nothing is transmitted, so there is no catalog to land in and no
 * misroute to prevent; an unconfigured application demos end to end exactly like
 * a configured one.
 */
function easyVistaCatalogStatus(application = null) {
  const config = easyVistaConfig(application);
  const configured = Boolean(value(config.catalogGuid).trim() || value(config.catalogCode).trim());
  return {
    configured,
    catalogGuid: config.catalogGuid,
    catalogCode: config.catalogCode,
    // Surfaces to an admin as a 400 and in the preview, so it uses the display
    // name — the module and its env vars keep the vendor's (src/constants.js).
    reason: configured
      ? ''
      : `${value(application?.name).trim() || 'This application'} has no ${TRACKER_LABEL} catalog `
        + 'configured, so a real send would post into another application\'s catalog. '
        + 'Set its catalog on the Access page first.',
  };
}

/**
 * `Urgency_ID` from our Priority Level.
 *
 * Our levels are literally numbered — "1 - Urgent" … "4 - Low" — so the leading
 * digit is the urgency. Falls back to the configured default when the ticket has
 * no priority, which is the normal case for defects.
 */
function resolveUrgencyId(priorityLevel, fallback) {
  const match = /^\s*(\d+)/.exec(value(priorityLevel));
  return match ? match[1] : fallback;
}

/**
 * The mailbox EasyVista sees as requestor and recipient: the admin who pressed
 * send, not the person who reported the ticket.
 *
 * The `users` table has no email column, so until it does this maps usernames
 * through `EASYVISTA_ADMIN_MAILS` ("username:mail,username:mail"). A `user.email`
 * is preferred the moment one exists, so adding the column later needs no change
 * here.
 */
function resolveSubmitterMail(user) {
  const config = easyVistaConfig();
  if (user && value(user.email).trim()) return value(user.email).trim();

  const username = value(typeof user === 'string' ? user : user?.username).trim().toLowerCase();
  if (username) {
    const entries = String(process.env.EASYVISTA_ADMIN_MAILS || '')
      .split(',')
      .map((pair) => pair.split(':'))
      .filter((parts) => parts.length === 2);
    for (const [name, mail] of entries) {
      if (name.trim().toLowerCase() === username) return mail.trim();
    }
  }
  return config.fallbackMail;
}

/** The exact request body posted to EasyVista. */
function buildEasyVistaPayload(submission, { now = null, submitter = null, application = null } = {}) {
  const config = easyVistaConfig(application);
  const stamp = formatEasyVistaDate(now || new Date().toISOString());
  const mail = resolveSubmitterMail(submitter);

  const request = {
    Catalog_GUID: config.catalogGuid,
    Catalog_Code: config.catalogCode,
    Urgency_ID: resolveUrgencyId(submission.priority_level, config.urgencyId),
    Severity_ID: config.severityId,
    Requestor_Identification: '',
    Requestor_Mail: mail,
    Recipient_Mail: mail,
    Origin: config.origin,
    Description: buildDescriptionHtml(submission),
    // The requester's narrative. Defects put it in "what happened"; enhancements
    // have no such field in the modal and put it in "request", so fall through
    // rather than sending a bare dash for every enhancement.
    Comment: orDash(
      value(submission.what_happened_exact_details).trim() || submission.request,
    ),
    SUBMIT_DATE_UT: stamp,
    CREATION_DATE_UT: stamp,
  };

  // Deliberately the FULL map, not the type-filtered one: the repurposed field
  // keys stay present on every request so the wire shape never varies. Only the
  // human-facing table and the editable rows filter by type.
  for (const field of EASYVISTA_FIELD_MAP) {
    if (!field.evField) continue;
    request[field.evField] = field.date
      ? formatEasyVistaDate(submission[field.key])
      : orDash(submission[field.key]);
  }

  return { requests: [request] };
}

/** The `edit`-shaped keys that reach EasyVista, in any form. */
const EASYVISTA_SOURCE_FIELDS = EASYVISTA_FIELD_MAP.map((field) => field.key);

/**
 * Editable fields that never leave this app, by their label in the modal.
 * Derived from the map above so the two can never disagree.
 */
const EASYVISTA_EXCLUDED_LABELS = [
  'Reviewer', 'Decision Notes', 'Clean Up Task', 'Cleanup Status',
  'Policy Premium Impact', 'Direct Dollar Impact', 'Policies Affected',
  '# of Occurrences', 'Per How Many', 'Time Frame', 'Impact Notes',
  'In JIRA', 'Release #', 'Release Notes', 'Duplicate Reference',
  'Visible on Public Status Board', 'Created Via', 'Submitted to EV By',
];

/** EasyVista accepts these two and nothing else. */
const EASYVISTA_TYPES = ['defect', 'enhancement'];

function normalizeSendAsType(input) {
  const candidate = String(input || '').trim().toLowerCase();
  return EASYVISTA_TYPES.includes(candidate) ? candidate : null;
}

/**
 * What the "Send as" control is pre-filled with.
 *
 * `null` means there is no sensible default and the admin has to choose: a
 * Cleanup Only task is neither a defect nor an enhancement, and EasyVista has no
 * third option.
 */
function defaultSendAsType(source) {
  if (source.is_cleanup) {
    if (!source.cleanup_tag_type || source.cleanup_tag_type === 'cleanup_only') return null;
    return source.cleanup_tag_type === 'enhancement' ? 'enhancement' : 'defect';
  }
  return source.type === 'enhancement' ? 'enhancement' : 'defect';
}

/**
 * The `type` EasyVista is told this ticket is: the admin's explicit choice, or
 * the ticket's own type when they have not overridden it. `null` means the send
 * cannot proceed until a choice is made.
 */
function resolveEasyVistaEffectiveType(source, sendAsType) {
  return normalizeSendAsType(sendAsType) || defaultSendAsType(source);
}

module.exports = {
  fieldsForType,
  buildDescriptionRows,
  buildDescriptionHtml,
  buildEasyVistaPayload,
  easyVistaConfig,
  easyVistaCatalogStatus,
  resolveUrgencyId,
  resolveSubmitterMail,
  formatEasyVistaDate,
  formatDisplayDate,
  resolveEasyVistaEffectiveType,
  defaultSendAsType,
  normalizeSendAsType,
  EASYVISTA_FIELD_MAP,
  EASYVISTA_TYPES,
  EASYVISTA_SOURCE_FIELDS,
  EASYVISTA_EXCLUDED_LABELS,
};
