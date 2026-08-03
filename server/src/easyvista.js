const { buildEasyVistaPayload } = require('./helpers/easyVistaPayload');

/**
 * Whether a send actually leaves this app.
 *
 * `EASYVISTA_ENABLED` is a deliberate master switch, and it is OFF unless set.
 * Credentials alone are not enough: the payload shape, the endpoint path and the
 * response parsing are all still unconfirmed, so an environment that happens to
 * have a base URL and a key configured must not start transmitting on its own.
 * Turning this on is the conscious act of saying the integration is ready.
 */
function easyVistaIsLive() {
  const flag = String(process.env.EASYVISTA_ENABLED || '').trim().toLowerCase();
  const enabled = flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on';
  return enabled && Boolean(process.env.EASYVISTA_BASE_URL) && Boolean(process.env.EASYVISTA_API_KEY);
}

/**
 * Whether an un-wired send is presented as though it were real.
 *
 * The integration is built and waiting on EasyVista, so stakeholders are shown
 * the flow end to end — press send, get an incident number back, watch the
 * ticket move to Submitted. Demo mode is what lets that walkthrough read like
 * the real thing instead of a caveat, and it is the behaviour this app has had
 * for its whole life, so it is ON by default.
 *
 * It is only ever consulted when the integration is NOT live, so it can never
 * quiet a warning about a real transmission. Set `EASYVISTA_DEMO_MODE=false` to
 * get the "nothing was transmitted" wording back on every surface.
 */
function easyVistaDemoMode() {
  if (easyVistaIsLive()) return false;
  const flag = String(process.env.EASYVISTA_DEMO_MODE ?? '').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no' || flag === 'off');
}

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
    throw new Error(`EasyVista API request failed: ${response.status} ${message}`);
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
    throw new Error('EasyVista API response did not include a ticket identifier');
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
async function sendEasyVistaAttachments(ticketId, attachments = [], { submitter = null } = {}) {
  const files = attachments.slice(0, EASYVISTA_MAX_ATTACHMENTS);
  const skipped = Math.max(0, attachments.length - files.length);

  if (files.length === 0) {
    return { sent: 0, skipped, source: 'none' };
  }

  if (!easyVistaIsLive()) {
    return { sent: files.length, skipped, source: easyVistaDemoMode() ? 'demo' : 'stub' };
  }

  // eslint-disable-next-line no-unused-vars
  const _pendingContract = { ticketId, files, submitter };
  console.warn(
    `[easyvista] ${files.length} file(s) selected for ${ticketId} were not uploaded:`
    + ' the attachment API contract is not implemented yet (see sendEasyVistaAttachments).',
  );
  return { sent: 0, skipped, source: 'not-implemented' };
}

module.exports = {
  submitToEasyVista,
  sendEasyVistaAttachments,
  easyVistaIsLive,
  easyVistaDemoMode,
  EASYVISTA_MAX_ATTACHMENTS,
};
