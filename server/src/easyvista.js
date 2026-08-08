const { buildEasyVistaPayload } = require('./helpers/easyVistaPayload');
// Errors thrown here surface in the admin UI, so they use the display name. The
// module, its env vars and its function names keep the vendor's — see
// src/constants.js.
const { TRACKER_LABEL } = require('./constants');
// Both predicates moved down to `helpers/easyVistaMode.js` and are re-exported
// below, unchanged. This module requires the payload helper at its top, and the
// payload helper now has to ask whether the integration is live — so the pair had
// to stop living above it. See that file's header for what the circular require
// actually produced.
const { easyVistaIsLive, easyVistaDemoMode } = require('./helpers/easyVistaMode');

async function submitToEasyVista(submission, { submitter = null, application = null } = {}) {
  const baseUrl = process.env.EASYVISTA_BASE_URL;
  const apiToken = process.env.EASYVISTA_API_KEY;

  if (!easyVistaIsLive()) {
    const suffix = String(Math.floor(10000 + Math.random() * 89999));
    return {
      ticketId: `EV-${suffix}`,
      // The fabricated id is identical either way; `source` is only how the
      // client decides whether to caveat the confirmation it shows.
      source: easyVistaDemoMode() ? 'demo' : 'stub',
    };
  }

  // Built by the shared helper so the admin modal's preview and this request
  // can never disagree about what gets sent. The application decides the
  // catalog — see easyVistaConfig.
  const payload = buildEasyVistaPayload(submission, { submitter, application });

  // TODO(easyvista): confirm the path. `EASYVISTA_REQUESTS_PATH` overrides it
  // without a code change once the real endpoint is known.
  const path = process.env.EASYVISTA_REQUESTS_PATH || '/requests';

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${TRACKER_LABEL} request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  // TODO(easyvista): confirm the response shape. The body posts a `requests`
  // array, so the reply may well be an array too — that case is handled here
  // rather than silently returning undefined.
  const first = Array.isArray(data?.requests) ? data.requests[0] : data;
  const ticketId = first?.ticketId
    || first?.incidentNumber
    || first?.requestNumber
    || first?.RFC_NUMBER
    || first?.REQUEST_ID;

  if (!ticketId) {
    throw new Error(`The ${TRACKER_LABEL} response did not include a ticket identifier`);
  }

  return {
    ticketId,
    source: 'api',
  };
}

/** EasyVista accepts at most this many files on a ticket. */
const EASYVISTA_MAX_ATTACHMENTS = 4;

/**
 * Sends the chosen attachments to a ticket that has just been created.
 *
 * ⚠️ THE ONLY PIECE STILL WAITING ON EASYVISTA. Everything that decides *which*
 * files go — the picker, the cap, validation that they belong to the submission,
 * the confirm dialog — is built and tested. Filling in the request below is all
 * that remains once the contract is known:
 *
 *   - endpoint (same call, or a follow-up against the new ticket id?)
 *   - multipart/form-data or base64 in JSON
 *   - the field name for the file, and whether several go per request
 *   - per-file size cap
 *
 * Deliberately never throws. The ticket already exists by the time this runs, so
 * failing here must not turn a successful submission into an error — it warns
 * and reports what it did.
 *
 * @param {string} ticketId  the EasyVista ticket just created
 * @param {Array<{id:number, filename:string, mime_type:string, file_path:string}>} attachments
 * @returns {Promise<{sent:number, skipped:number, source:string}>}
 */
/**
 * Whether a REAL send can carry files yet.
 *
 * The single source of truth for the unimplemented half below, so the warning
 * an admin sees before pressing Send and what actually happens afterwards
 * cannot drift apart. Flip this in the same change that fills in the request.
 */
const EASYVISTA_ATTACHMENT_UPLOAD_IMPLEMENTED = false;

function easyVistaAttachmentsSupported() {
  return EASYVISTA_ATTACHMENT_UPLOAD_IMPLEMENTED;
}

async function sendEasyVistaAttachments(ticketId, attachments = [], { submitter = null } = {}) {
  const files = attachments.slice(0, EASYVISTA_MAX_ATTACHMENTS);
  const skipped = Math.max(0, attachments.length - files.length);

  // `attempted` is what the admin picked (after the cap). Reported alongside
  // `sent` so the caller can say "3 files could not be attached" rather than
  // having to infer a count it was never given.
  if (files.length === 0) {
    return { attempted: 0, sent: 0, skipped, source: 'none' };
  }

  if (!easyVistaIsLive()) {
    return {
      attempted: files.length,
      sent: files.length,
      skipped,
      source: easyVistaDemoMode() ? 'demo' : 'stub',
    };
  }

  if (!easyVistaAttachmentsSupported()) {
    // eslint-disable-next-line no-unused-vars
    const _pendingContract = { ticketId, files, submitter };
    console.warn(
      `[easyvista] ${files.length} file(s) selected for ${ticketId} were not uploaded:`
      + ' the attachment API contract is not implemented yet (see sendEasyVistaAttachments).',
    );
    // The caller reports this to the admin — a server log is not a warning
    // anyone pressing Send will ever read.
    return { attempted: files.length, sent: 0, skipped, source: 'not-implemented' };
  }

  throw new Error(
    'sendEasyVistaAttachments: upload marked implemented but the request is not written.',
  );
}

module.exports = {
  submitToEasyVista,
  sendEasyVistaAttachments,
  easyVistaAttachmentsSupported,
  easyVistaIsLive,
  easyVistaDemoMode,
  EASYVISTA_MAX_ATTACHMENTS,
};
