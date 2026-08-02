const test = require('node:test');
const assert = require('node:assert');

const {
  fieldsForType,
  buildDescriptionRows,
  buildDescriptionHtml,
  buildEasyVistaPayload,
  formatEasyVistaDate,
  formatDisplayDate,
  resolveUrgencyId,
  resolveSubmitterMail,
  resolveEasyVistaEffectiveType,
  defaultSendAsType,
  normalizeSendAsType,
  EASYVISTA_FIELD_MAP,
  EASYVISTA_EXCLUDED_LABELS,
} = require('../src/helpers/easyVistaPayload');

// ── Send-as type ──────────────────────────────────────────────────────────

const DEFECT = { type: 'defect', is_cleanup: false, cleanup_tag_type: null };
const ENHANCEMENT = { type: 'enhancement', is_cleanup: false, cleanup_tag_type: null };
const CLEANUP_DEFECT = { type: 'defect', is_cleanup: true, cleanup_tag_type: 'defect' };
const CLEANUP_ENHANCEMENT = { type: 'enhancement', is_cleanup: true, cleanup_tag_type: 'enhancement' };
const CLEANUP_ONLY = { type: 'defect', is_cleanup: true, cleanup_tag_type: 'cleanup_only' };

test('the send-as default is the ticket\'s own type', () => {
  assert.equal(defaultSendAsType(DEFECT), 'defect');
  assert.equal(defaultSendAsType(ENHANCEMENT), 'enhancement');
  assert.equal(defaultSendAsType(CLEANUP_DEFECT), 'defect');
  assert.equal(defaultSendAsType(CLEANUP_ENHANCEMENT), 'enhancement');
});

test('an ordinary enhancement defaults to enhancement, not defect', () => {
  // Regression guard: an earlier inference consulted only cleanup_tag_type, so
  // every non-cleanup enhancement went out labelled a defect.
  assert.equal(resolveEasyVistaEffectiveType(ENHANCEMENT, null), 'enhancement');
});

test('a Cleanup Only task has no default — the admin must choose', () => {
  assert.equal(defaultSendAsType(CLEANUP_ONLY), null);
  assert.equal(resolveEasyVistaEffectiveType(CLEANUP_ONLY, null), null);
  assert.equal(resolveEasyVistaEffectiveType(CLEANUP_ONLY, 'enhancement'), 'enhancement');
});

test('an explicit choice overrides the ticket type in both directions', () => {
  assert.equal(resolveEasyVistaEffectiveType(DEFECT, 'enhancement'), 'enhancement');
  assert.equal(resolveEasyVistaEffectiveType(ENHANCEMENT, 'defect'), 'defect');
});

test('an unrecognised send-as value never reaches EasyVista', () => {
  for (const bad of ['cleanup_only', '', null, undefined, 'DEFECTS', 42, {}]) {
    assert.equal(normalizeSendAsType(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(normalizeSendAsType('Enhancement'), 'enhancement');
  assert.equal(normalizeSendAsType('  DEFECT '), 'defect');
  assert.equal(resolveEasyVistaEffectiveType(CLEANUP_ONLY, 'nonsense'), null);
});

// ── Dates ─────────────────────────────────────────────────────────────────

test('EasyVista date fields use M/D/YYYY HH:mm, 24-hour', () => {
  assert.equal(formatEasyVistaDate('2026-02-26T21:01:00'), '2/26/2026 21:01');
  assert.equal(formatEasyVistaDate('2026-03-10T09:05:00'), '3/10/2026 09:05');
  assert.equal(formatEasyVistaDate(''), '');
  assert.equal(formatEasyVistaDate('not a date'), '');
});

test('the table shows MM/DD/YYYY h:mm:ss am/pm', () => {
  assert.equal(formatDisplayDate('2026-03-10T12:00:00'), '03/10/2026 12:00:00 pm');
  assert.equal(formatDisplayDate('2026-03-10T00:30:00'), '03/10/2026 12:30:00 am');
  assert.equal(formatDisplayDate('2026-03-10T13:07:09'), '03/10/2026 01:07:09 pm');
  assert.equal(formatDisplayDate(null), '-');
});

// ── Payload ───────────────────────────────────────────────────────────────

const SAMPLE = {
  id: 1487,
  type: 'defect',
  status: 'Approved',
  application_name: 'Billing Center',
  created_by: 'Riebel, Lachelle',
  created_by_email: 'lachelle@example.com',
  policy_num: '2897004',
  account_num: 'AC-9001',
  transaction_num: null,
  screen_title: 'Delinquencies',
  summary_of_issue: 'EP Without NOC',
  steps_to_reproduce: null,
  what_happened_exact_details: 'The earned premium process kicked off without a NOC.',
  request: null,
  date_time_of_error: '2026-03-10T12:00:00',
  impact_details: null,
  enhancement_request_type: null,
  priority_level: null,
  desired_completion_date: null,
  jira_number: 'JIRA-101',
};

test('our values land in the repurposed EasyVista fields', () => {
  const { requests } = buildEasyVistaPayload(SAMPLE, { now: '2026-02-26T21:01:00' });
  assert.equal(requests.length, 1);
  const r = requests[0];

  assert.equal(r.E_LEGAL_POLICY_NUMBER, '2897004');           // Policy#/Submission#
  assert.equal(r.E_KCL_CHECK_PAYEE, 'AC-9001');               // Account#
  assert.equal(r.E_KCL_CHECK_VOID_REASON, 'EP Without NOC');  // Summary of Issue
  assert.equal(r.E_KCL_CHECK_REISSUED, 'Delinquencies');      // Screen Title
  assert.equal(r.E_KCL_MKT_AUDIENCE, SAMPLE.what_happened_exact_details);
  assert.equal(r.E_PRB_LAST_UPDATE_UT, '3/10/2026 12:00');    // Date/Time of Error
});

test('blank values send a dash, never "null" or "undefined"', () => {
  const { requests } = buildEasyVistaPayload(SAMPLE, { now: '2026-02-26T21:01:00' });
  const r = requests[0];
  assert.equal(r.E_KCL_CHECK_TYPE, '-');           // steps_to_reproduce is null
  assert.equal(r.E_PRB_CENTURYLINK_DCI1, '-');     // transaction_num is null
  const serialised = JSON.stringify(requests[0]);
  assert.ok(!serialised.includes('"null"'));
  assert.ok(!serialised.includes('undefined'));
});

test('timestamps are set', () => {
  const { requests } = buildEasyVistaPayload(SAMPLE, { now: '2026-02-26T21:01:00' });
  assert.equal(requests[0].SUBMIT_DATE_UT, '2/26/2026 21:01');
  assert.equal(requests[0].CREATION_DATE_UT, '2/26/2026 21:01');
  assert.equal(requests[0].Origin, '3');
});

test('Urgency_ID comes from the priority level', () => {
  assert.equal(resolveUrgencyId('1 - Urgent', '2'), '1');
  assert.equal(resolveUrgencyId('2 - High', '2'), '2');
  assert.equal(resolveUrgencyId('3 - Medium', '2'), '3');
  assert.equal(resolveUrgencyId('4 - Low', '2'), '4');
  // An unparseable value falls through to whatever default is passed in.
  assert.equal(resolveUrgencyId('Medium', '9'), '9');

  const urgent = buildEasyVistaPayload(
    { ...SAMPLE, priority_level: '1 - Urgent' },
    { now: '2026-02-26T21:01:00' },
  );
  assert.equal(urgent.requests[0].Urgency_ID, '1');
});

test('no priority falls back to Medium', () => {
  // Defects usually carry no priority at all.
  for (const priority of [null, undefined, '']) {
    const { requests } = buildEasyVistaPayload(
      { ...SAMPLE, priority_level: priority },
      { now: '2026-02-26T21:01:00' },
    );
    assert.equal(requests[0].Urgency_ID, '3', `expected Medium for ${JSON.stringify(priority)}`);
  }
});

test('requestor and recipient are the submitting admin, not the requester', () => {
  const previous = process.env.EASYVISTA_ADMIN_MAILS;
  process.env.EASYVISTA_ADMIN_MAILS = 'lead_admin:lead@grange.example,ops:ops@grange.example';
  try {
    const { requests } = buildEasyVistaPayload(SAMPLE, {
      now: '2026-02-26T21:01:00',
      submitter: 'lead_admin',
    });
    assert.equal(requests[0].Requestor_Mail, 'lead@grange.example');
    assert.equal(requests[0].Recipient_Mail, 'lead@grange.example');
    // The reporter's own address must not leak into these fields.
    assert.notEqual(requests[0].Requestor_Mail, SAMPLE.created_by_email);

    assert.equal(resolveSubmitterMail('OPS'), 'ops@grange.example', 'match is case-insensitive');
    // A `users.email` column, if one is ever added, wins over the env map.
    assert.equal(
      resolveSubmitterMail({ username: 'lead_admin', email: 'from-db@grange.example' }),
      'from-db@grange.example',
    );
  } finally {
    if (previous === undefined) delete process.env.EASYVISTA_ADMIN_MAILS;
    else process.env.EASYVISTA_ADMIN_MAILS = previous;
  }
});

test('Comment carries the requester narrative for either type', () => {
  const defect = buildEasyVistaPayload(SAMPLE, { now: '2026-02-26T21:01:00' });
  assert.equal(defect.requests[0].Comment, SAMPLE.what_happened_exact_details);

  // Enhancements have no "what happened" — the narrative is the request.
  const enhancement = buildEasyVistaPayload(
    { ...SAMPLE, what_happened_exact_details: '-', request: 'Add a CSV export.' },
    { now: '2026-02-26T21:01:00' },
  );
  assert.equal(enhancement.requests[0].Comment, '-');

  const blank = buildEasyVistaPayload(
    { ...SAMPLE, what_happened_exact_details: '', request: 'Add a CSV export.' },
    { now: '2026-02-26T21:01:00' },
  );
  assert.equal(blank.requests[0].Comment, 'Add a CSV export.');
});

test('the request is wrapped in a `requests` array', () => {
  const payload = buildEasyVistaPayload(SAMPLE, { now: '2026-02-26T21:01:00' });
  assert.deepEqual(Object.keys(payload), ['requests']);
  assert.ok(Array.isArray(payload.requests));
});

// ── HTML description ──────────────────────────────────────────────────────

test('the description is an HTML table carrying every mapped field', () => {
  const html = buildDescriptionHtml(SAMPLE);
  assert.ok(html.startsWith('<table border="0" cellpadding="5px">'));
  assert.ok(html.includes('<h4>Details</h4>'));
  assert.ok(html.trimEnd().endsWith('</table>'));

  // Every field that applies to this type is represented, so one cannot be
  // silently dropped.
  for (const field of fieldsForType(SAMPLE.type)) {
    assert.ok(html.includes(field.label), `missing "${field.label}" from the table`);
  }
  assert.ok(html.includes('EP Without NOC'));
  assert.ok(html.includes('03/10/2026 12:00:00 pm'));
});

test('values are escaped so they cannot break out of the table', () => {
  const html = buildDescriptionHtml({
    ...SAMPLE,
    summary_of_issue: '</td></tr></table><script>alert(1)</script>',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a defect is never shown or sent enhancement-only fields', () => {
  const labels = buildDescriptionRows({ ...SAMPLE, type: 'defect' }).map((row) => row.label);
  for (const absent of [
    'Request', 'Impact Details', 'Enhancement Request Type',
    'Priority Level', 'Desired Completion Date',
  ]) {
    assert.ok(!labels.includes(absent), `a defect should not carry "${absent}"`);
  }
  for (const present of ['Steps To Reproduce', 'What happened (Exact Details)', 'Time/Date of Error']) {
    assert.ok(labels.includes(present), `a defect should carry "${present}"`);
  }
});

test('an enhancement is never shown or sent defect-only fields', () => {
  const labels = buildDescriptionRows({ ...SAMPLE, type: 'enhancement' }).map((row) => row.label);
  for (const absent of ['Steps To Reproduce', 'What happened (Exact Details)', 'Time/Date of Error']) {
    assert.ok(!labels.includes(absent), `an enhancement should not carry "${absent}"`);
  }
  for (const present of ['Request', 'Impact Details', 'Priority Level']) {
    assert.ok(labels.includes(present), `an enhancement should carry "${present}"`);
  }
});

test('both types keep the shared fields', () => {
  for (const type of ['defect', 'enhancement']) {
    const labels = buildDescriptionRows({ ...SAMPLE, type }).map((row) => row.label);
    for (const shared of ['Policy#/Submission#', 'Summary of Issue', 'Screen Title', 'Account#', 'Requestor']) {
      assert.ok(labels.includes(shared), `${type} should carry "${shared}"`);
    }
  }
});

test('the repurposed field keys are present on every request regardless of type', () => {
  // The visible table filters by type; the wire shape must not, or EasyVista
  // would see a different set of keys depending on the ticket.
  const enhancement = buildEasyVistaPayload(
    { ...SAMPLE, type: 'enhancement' },
    { now: '2026-02-26T21:01:00' },
  );
  const r = enhancement.requests[0];
  assert.equal(r.E_KCL_CHECK_TYPE, '-', 'steps key still sent, blank');
  assert.ok('E_KCL_MKT_AUDIENCE' in r);
  assert.ok('E_PRB_LAST_UPDATE_UT' in r);
});

test('the table and the preview rows come from one source', () => {
  const rows = buildDescriptionRows(SAMPLE);
  const html = buildDescriptionHtml(SAMPLE);
  assert.equal(rows.length, fieldsForType(SAMPLE.type).length);
  assert.ok(rows.length < EASYVISTA_FIELD_MAP.length, 'a defect drops the enhancement fields');
  for (const row of rows) {
    assert.ok(html.includes(row.label), `"${row.label}" is previewed but not sent`);
  }
});

// ── Attachments ───────────────────────────────────────────────────────────

const {
  submitToEasyVista,
  sendEasyVistaAttachments,
  easyVistaIsLive,
  easyVistaDemoMode,
  EASYVISTA_MAX_ATTACHMENTS,
} = require('../src/easyvista');

/** Runs `fn` with the given EasyVista env, restoring whatever was there. */
function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    // An async `fn` is still mid-flight when it hands back its promise, so the
    // env has to survive until that settles — restoring in `finally` would pull
    // it out from under everything after the first await.
    if (result && typeof result.then === 'function') {
      return result.then(
        (value) => { restore(); return value; },
        (error) => { restore(); throw error; },
      );
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('credentials alone do not make EasyVista live', () => {
  // The payload shape, endpoint path and response parsing are unconfirmed, so an
  // environment that merely has credentials must not start transmitting.
  withEnv(
    { EASYVISTA_ENABLED: undefined, EASYVISTA_BASE_URL: 'https://ev.example', EASYVISTA_API_KEY: 'k' },
    () => assert.equal(easyVistaIsLive(), false, 'must stay stubbed without the switch'),
  );
  withEnv(
    { EASYVISTA_ENABLED: 'false', EASYVISTA_BASE_URL: 'https://ev.example', EASYVISTA_API_KEY: 'k' },
    () => assert.equal(easyVistaIsLive(), false),
  );
});

test('the switch alone does not make EasyVista live either', () => {
  withEnv(
    { EASYVISTA_ENABLED: 'true', EASYVISTA_BASE_URL: undefined, EASYVISTA_API_KEY: undefined },
    () => assert.equal(easyVistaIsLive(), false, 'no endpoint to send to'),
  );
});

test('live requires the switch and both credentials', () => {
  for (const flag of ['true', '1', 'yes', 'on', 'TRUE']) {
    withEnv(
      { EASYVISTA_ENABLED: flag, EASYVISTA_BASE_URL: 'https://ev.example', EASYVISTA_API_KEY: 'k' },
      () => assert.equal(easyVistaIsLive(), true, `"${flag}" should enable it`),
    );
  }
});

// ── Demo mode ─────────────────────────────────────────────────────────────

test('demo mode is on by default while EasyVista is not wired up', async () => {
  await withEnv(
    { EASYVISTA_ENABLED: undefined, EASYVISTA_DEMO_MODE: undefined },
    async () => {
      assert.equal(easyVistaDemoMode(), true);
      const result = await submitToEasyVista({ type: 'defect' });
      assert.match(result.ticketId, /^EV-\d{5}$/, 'the walkthrough needs a realistic incident number');
      assert.equal(result.source, 'demo', 'the client caveats "stub", not "demo"');
    },
  );
});

test('demo mode can be switched off for the honest wording', async () => {
  await withEnv(
    { EASYVISTA_ENABLED: undefined, EASYVISTA_DEMO_MODE: 'false' },
    async () => {
      assert.equal(easyVistaDemoMode(), false);
      const result = await submitToEasyVista({ type: 'defect' });
      assert.equal(result.source, 'stub', 'so the confirmation says nothing was transmitted');
    },
  );
});

test('demo mode can never dress up a real send', () => {
  // Guard: once the integration is live the flag must stop meaning anything,
  // so it can never suppress a caveat about an actual transmission.
  withEnv(
    {
      EASYVISTA_ENABLED: 'true',
      EASYVISTA_BASE_URL: 'https://ev.example',
      EASYVISTA_API_KEY: 'k',
      EASYVISTA_DEMO_MODE: 'true',
    },
    () => assert.equal(easyVistaDemoMode(), false),
  );
});

const file = (id) => ({ id, filename: `f${id}.png`, mime_type: 'image/png', file_path: `u/f${id}.png` });

test('EasyVista takes at most four files', async () => {
  assert.equal(EASYVISTA_MAX_ATTACHMENTS, 4);
  const result = await sendEasyVistaAttachments('EV-1', [1, 2, 3, 4, 5, 6].map(file));
  assert.equal(result.sent + result.skipped >= 4, true);
  assert.equal(result.skipped, 2, 'the two beyond the cap are reported, not silently dropped');
});

test('no files selected is not an error', async () => {
  const result = await sendEasyVistaAttachments('EV-1', []);
  assert.equal(result.sent, 0);
  assert.equal(result.source, 'none');
});

test('attachment delivery never throws — the ticket already exists by then', async () => {
  const result = await withEnv(
    {
      EASYVISTA_ENABLED: 'true',
      EASYVISTA_BASE_URL: 'https://easyvista.example',
      EASYVISTA_API_KEY: 'test-key',
    },
    () => sendEasyVistaAttachments('EV-1', [file(1)]),
  );
  // Contract not implemented yet: it must report that, not reject.
  assert.equal(result.source, 'not-implemented');
  assert.equal(result.sent, 0);
});

test('the excluded list never names a field that is actually sent', () => {
  const sentLabels = buildDescriptionRows(SAMPLE).map((row) => row.label);
  for (const excluded of EASYVISTA_EXCLUDED_LABELS) {
    assert.ok(
      !sentLabels.includes(excluded),
      `"${excluded}" is listed as never sent, but it is in the payload`,
    );
  }
});
