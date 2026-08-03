const { test } = require('node:test');
const assert = require('node:assert');

const {
  sendEasyVistaAttachments,
  easyVistaAttachmentsSupported,
  EASYVISTA_MAX_ATTACHMENTS,
} = require('../src/easyvista');

// The upload half is still waiting on EasyVista's contract. What matters until
// then is that the outcome is REPORTED rather than swallowed: a real send
// creates a real ticket, and if the files did not go, the admin has to be told.
// A console.warn on the server is not telling anyone.

const withEnv = (vars, run) => {
  const previous = {};
  for (const [key, val] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, val] of Object.entries(previous)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    });
};

const LIVE = {
  EASYVISTA_ENABLED: 'true',
  EASYVISTA_BASE_URL: 'https://easyvista.example',
  EASYVISTA_API_KEY: 'test-key',
};
const OFF = { EASYVISTA_ENABLED: undefined, EASYVISTA_BASE_URL: undefined, EASYVISTA_API_KEY: undefined };

const files = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, filename: `shot-${i + 1}.png` }));

test('no files reports nothing attempted', async () => {
  const result = await sendEasyVistaAttachments('EV-1', []);
  assert.deepStrictEqual(result, { attempted: 0, sent: 0, skipped: 0, source: 'none' });
});

// ── While EasyVista is off, a send transmits nothing at all ─────────────────
test('a simulated send reports the files as sent', async () => {
  await withEnv(OFF, async () => {
    const result = await sendEasyVistaAttachments('EV-1', files(3));
    assert.strictEqual(result.sent, 3);
    assert.strictEqual(result.attempted, 3);
    assert.ok(['demo', 'stub'].includes(result.source));
  });
});

// ── Live, with the upload unwritten: the case that must not stay silent ─────
test('a live send reports that the files did NOT go', async () => {
  await withEnv(LIVE, async () => {
    const result = await sendEasyVistaAttachments('EV-1', files(3));
    assert.strictEqual(result.source, 'not-implemented');
    assert.strictEqual(result.sent, 0, 'nothing was uploaded');
    assert.strictEqual(result.attempted, 3, 'and the caller is told how many did not');
  });
});

test('attempted is the count the admin picked, after the per-ticket cap', async () => {
  await withEnv(LIVE, async () => {
    const over = EASYVISTA_MAX_ATTACHMENTS + 2;
    const result = await sendEasyVistaAttachments('EV-1', files(over));
    assert.strictEqual(result.attempted, EASYVISTA_MAX_ATTACHMENTS);
    assert.strictEqual(result.skipped, 2, 'the ones over the cap are counted separately');
  });
});

test('it never throws — the ticket already exists by the time this runs', async () => {
  await withEnv(LIVE, async () => {
    // Turning a created ticket into an error response would be a worse lie than
    // the one this whole change exists to fix.
    await assert.doesNotReject(() => sendEasyVistaAttachments('EV-1', files(2)));
  });
});

test('the supported flag is the single source of truth, and is currently off', async () => {
  // When someone writes the upload they flip this in the same change, and the
  // pre-send warning and the confirmation both follow it automatically.
  assert.strictEqual(easyVistaAttachmentsSupported(), false);
});
