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
// A `DEMO-` catalog counts as configured only while nothing is transmitted, so
// this file has to know. Imported from `helpers/easyVistaMode` and NOT from
// `src/easyvista.js`, which requires this module at its top — see that header.
const { easyVistaIsLive } = require('./easyVistaMode');

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
 * Parse a per-application map written as `Name:value,Other Name:value`.
 *
 * Same shape as `EASYVISTA_ADMIN_MAILS`, deliberately — one spelling for
 * "a value per named thing" across this file. Split on the FIRST colon only, so
 * an application name may contain anything but a colon and the value keeps its
 * own. Keyed lowercase; unparseable entries are skipped rather than throwing,
 * because a typo in one application's catalog must not take the others down.
 */
function parseNamedMap(raw) {
  const map = new Map();
  for (const entry of String(raw || '').split(',')) {
    const separator = entry.indexOf(':');
    if (separator < 1) continue;
    const name = entry.slice(0, separator).trim().toLowerCase();
    const mapped = entry.slice(separator + 1).trim();
    if (name && mapped) map.set(name, mapped);
  }
  return map;
}

/**
 * Values that are catalog configuration rather than ticket data.
 *
 * WHO SETS THESE. Not an admin and not a super user — the catalog GUID is an
 * identifier in EasyVista, which the team that runs EasyVista owns. It used to
 * be editable on the Access page, which put a field nobody in this portal has
 * the answer to in front of the people who manage who-sees-what. It is
 * environment configuration now, beside the API key and base URL, where the team
 * that has the value already works.
 *
 * Resolution order, first hit wins:
 *   1. The application's own columns. Nothing in the app writes them any more —
 *      kept because they exist on the database and a direct fix should still be
 *      honoured rather than silently ignored.
 *   2. `EASYVISTA_CATALOG_GUIDS` / `_CODES` — a catalog per named application.
 *      This is the one to use.
 *   3. `EASYVISTA_CATALOG_GUID` / `_CODE`, for the single application named by
 *      `EASYVISTA_DEFAULT_APPLICATION` only.
 *
 * No OTHER application inherits, at any step. That inheritance was the original
 * bug: a Policy Center ticket posting into Billing Center's catalog with Billing
 * Center's repurposed field names, with nothing to show for it.
 */
function easyVistaConfig(application = null) {
  const ownGuid = value(application?.easyvista_catalog_guid).trim();
  const ownCode = value(application?.easyvista_catalog_code).trim();

  const applicationName = value(application?.name).trim().toLowerCase();
  const mappedGuid = applicationName
    ? (parseNamedMap(process.env.EASYVISTA_CATALOG_GUIDS).get(applicationName) || '')
    : '';
  const mappedCode = applicationName
    ? (parseNamedMap(process.env.EASYVISTA_CATALOG_CODES).get(applicationName) || '')
    : '';

  const defaultApplication = String(process.env.EASYVISTA_DEFAULT_APPLICATION || '').trim();
  const inheritsEnv = Boolean(defaultApplication)
    && applicationName === defaultApplication.toLowerCase();
  // No application at all (a preview built before one is known) keeps the old
  // behaviour of reading the environment, so the dry-run preview still renders.
  const mayUseEnv = inheritsEnv || !application;

  return {
    catalogGuid: ownGuid || mappedGuid || (mayUseEnv ? process.env.EASYVISTA_CATALOG_GUID || '' : ''),
    catalogCode: ownCode || mappedCode || (mayUseEnv ? process.env.EASYVISTA_CATALOG_CODE || '' : ''),
    // Medium. Matches the "3 - Medium" the service already defaults an
    // enhancement's priority to, so an unprioritised defect lands the same way.
    urgencyId: process.env.EASYVISTA_URGENCY_ID || '3',
    severityId: process.env.EASYVISTA_SEVERITY_ID || '40',
    origin: process.env.EASYVISTA_ORIGIN || '3',
    fallbackMail: process.env.EASYVISTA_FALLBACK_MAIL || '',
  };
}

// A catalog value that exists only so the walkthrough has a wired-up application
// to press Send on. Good enough to DEMONSTRATE a send, never good enough to
// transmit one.
//
// WHY THE PREFIX EXISTS. The owner needs the demo site to show both halves of the
// story: Billing Center and Policy Center pretend-send end to end, and `Other`
// refuses because nothing is configured for it. That needs the two to count as
// configured — and writing a plausible-looking GUID into their rows would mean a
// real send, on the day EasyVista is switched on, posting into a catalog that does
// not exist. So the placeholder says what it is, and `easyVistaCatalogStatus`
// stops honouring it the moment the integration goes live. Fail closed, out loud.
const DEMO_CATALOG_PREFIX = 'DEMO-';

const isDemoCatalogValue = (v) => value(v).trim().toUpperCase().startsWith(DEMO_CATALOG_PREFIX);

/**
 * Whether this application can be sent to, and why not if it cannot.
 *
 * TWO GRADES OF CONFIGURED, because there are two kinds of send.
 *
 *   - A real value → configured for both. This is what a wired application has.
 *   - A `DEMO-` placeholder → configured for the demo path only. Nothing is
 *     transmitted there, so there is no catalog to land in and no misroute to
 *     prevent; on the live path it reverts to unconfigured and the send is
 *     refused, exactly as if the column were empty.
 *   - Nothing at all → configured for neither, on every path.
 *
 * THIS USED TO BE A LIVE-ONLY QUESTION, and the third case is why it is not any
 * more. With EasyVista off, an application with no catalog demonstrated a send
 * exactly like a configured one — so the portal had no way to show the case it
 * actually has to handle today, which is an application the Service Desk is not
 * wired up to at all. The admin has to raise that one by hand and come back with
 * the number, and a Send button that cheerfully invents an incident number is the
 * opposite of telling them so.
 */
function easyVistaCatalogStatus(application = null) {
  const config = easyVistaConfig(application);
  const guid = value(config.catalogGuid).trim();
  const code = value(config.catalogCode).trim();
  const present = Boolean(guid || code);
  // Demo placeholders only count while nothing is being transmitted. A mix of a
  // real value and a placeholder counts as real — the real one is what would be
  // used.
  const demoOnly = present && [guid, code].filter(Boolean).every(isDemoCatalogValue);
  const configured = present && (!demoOnly || !easyVistaIsLive());
  const named = value(application?.name).trim() || 'This application';
  return {
    configured,
    // So a caller can tell "nothing configured" from "configured for the
    // walkthrough only" without re-deriving the rule.
    demoOnly,
    catalogGuid: config.catalogGuid,
    catalogCode: config.catalogCode,
    // Surfaces to an admin as a 400, in the preview, and now as the note under a
    // disabled Send button — so it uses the display name; the module and its env
    // vars keep the vendor's (src/constants.js). The environment variable is NOT
    // named here: that would put the vendor's name in front of an admin, which is
    // the one thing TRACKER_LABEL exists to prevent, and whoever needs the variable
    // name is reading .env.example rather than this message.
    //
    // TWO DIFFERENT REASONS, because two different people fix them.
    //
    // Nothing configured is the ADMIN's to work around, and the message is the
    // whole procedure rather than a diagnosis: raise it by hand, come back, put the
    // number in, set the status. Every one of those steps already exists — the
    // number is editable behind the unlock on this same tab, and Submitted is in the
    // status dropdown — so naming them turns a dead end into an instruction.
    //
    // A demonstration catalog on a LIVE server is whoever configured the server's
    // to fix, and it must not read as the admin's problem: there is no manual step
    // that helps, and inventing one would send them to raise a duplicate.
    reason: configured
      ? ''
      : (demoOnly
        ? `${named} is set up with a demonstration catalog rather than a real one, so it `
          + `cannot be sent for real. Whoever configured this server needs ${named}'s real `
          + `${TRACKER_LABEL} catalog ID before anything here can be handed off.`
        : `${named} is not wired up to ${TRACKER_LABEL}, so this cannot be sent from the portal. `
          + `Raise it in ${TRACKER_LABEL} by hand, then come back, unlock the ${TRACKER_LABEL} `
          + 'ticket number on this tab and enter the number it gave you, and set the status to '
          + 'Submitted.'),
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
