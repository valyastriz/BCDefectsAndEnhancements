const { test } = require('node:test');
const assert = require('node:assert');

const {
  easyVistaConfig,
  easyVistaCatalogStatus,
  buildEasyVistaPayload,
} = require('../src/helpers/easyVistaPayload');

// The catalog belongs to the APPLICATION, not the environment.
//
// With one global catalog, adding an application through Manage Metadata gave it
// a queue, access and a board lane while its tickets would have posted into the
// first application's catalog, under field names repurposed from that catalog —
// silently, with a clean "Submitted" confirmation.

const withEnv = (vars, run) => {
  const previous = {};
  for (const [key, val] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  try {
    return run();
  } finally {
    for (const [key, val] of Object.entries(previous)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
};

const BILLING = { name: 'Billing Center', easyvista_catalog_guid: '', easyvista_catalog_code: '' };
const POLICY = { name: 'Policy Center', easyvista_catalog_guid: '', easyvista_catalog_code: '' };
const CONFIGURED_POLICY = {
  name: 'Policy Center',
  easyvista_catalog_guid: 'PC-GUID-9',
  easyvista_catalog_code: 'PC-CODE-9',
};

// ── The application's own catalog wins ───────────────────────────────────────
test('an application with its own catalog uses it', () => {
  withEnv({ EASYVISTA_CATALOG_GUID: 'BC-GUID', EASYVISTA_CATALOG_CODE: 'BC-CODE' }, () => {
    const config = easyVistaConfig(CONFIGURED_POLICY);
    assert.strictEqual(config.catalogGuid, 'PC-GUID-9');
    assert.strictEqual(config.catalogCode, 'PC-CODE-9');
  });
});

// ── The environment is a fallback for exactly ONE named application ──────────
test('the environment catalog applies only to the application it belongs to', () => {
  withEnv({
    EASYVISTA_CATALOG_GUID: 'BC-GUID',
    EASYVISTA_CATALOG_CODE: 'BC-CODE',
    EASYVISTA_DEFAULT_APPLICATION: 'Billing Center',
  }, () => {
    assert.strictEqual(easyVistaConfig(BILLING).catalogGuid, 'BC-GUID', 'the named one inherits it');
    // This is the bug the whole change exists to prevent.
    assert.strictEqual(easyVistaConfig(POLICY).catalogGuid, '', 'no other application inherits it');
  });
});

test('the environment name match ignores case', () => {
  withEnv({
    EASYVISTA_CATALOG_GUID: 'BC-GUID',
    EASYVISTA_DEFAULT_APPLICATION: 'billing center',
  }, () => {
    assert.strictEqual(easyVistaConfig(BILLING).catalogGuid, 'BC-GUID');
  });
});

test('with no default application named, nothing inherits the environment catalog', () => {
  withEnv({
    EASYVISTA_CATALOG_GUID: 'BC-GUID',
    EASYVISTA_DEFAULT_APPLICATION: undefined,
  }, () => {
    assert.strictEqual(easyVistaConfig(BILLING).catalogGuid, '');
    assert.strictEqual(easyVistaConfig(POLICY).catalogGuid, '');
  });
});

// ── Status, which is what the send guard and the preview both read ───────────
test('an unconfigured application reports why it cannot be sent to', () => {
  withEnv({ EASYVISTA_CATALOG_GUID: '', EASYVISTA_CATALOG_CODE: '' }, () => {
    const status = easyVistaCatalogStatus(POLICY);
    assert.strictEqual(status.configured, false);
    assert.match(status.reason, /Policy Center/);
    // The display label, not the vendor's — the message reaches an admin.
    assert.match(status.reason, /no Service Desk catalog/i);
  });
});

test('a configured application reports no reason to refuse', () => {
  const status = easyVistaCatalogStatus(CONFIGURED_POLICY);
  assert.strictEqual(status.configured, true);
  assert.strictEqual(status.reason, '');
});

test('either half of the catalog counts as configured', () => {
  // Some catalogs are addressed by code alone; requiring both would refuse a
  // send that would have worked.
  assert.strictEqual(
    easyVistaCatalogStatus({ name: 'X', easyvista_catalog_code: 'ONLY-CODE' }).configured,
    true,
  );
});

// ── The payload actually carries the resolved catalog ────────────────────────
test('the outgoing payload carries the application\'s catalog, not the environment\'s', () => {
  withEnv({
    EASYVISTA_CATALOG_GUID: 'BC-GUID',
    EASYVISTA_CATALOG_CODE: 'BC-CODE',
    EASYVISTA_DEFAULT_APPLICATION: 'Billing Center',
  }, () => {
    const payload = buildEasyVistaPayload(
      { type: 'defect', summary_of_issue: 'x', application_name: 'Policy Center' },
      { application: CONFIGURED_POLICY },
    );
    const [request] = payload.requests;
    assert.strictEqual(request.Catalog_GUID, 'PC-GUID-9');
    assert.strictEqual(request.Catalog_Code, 'PC-CODE-9');
  });
});

// ── The two holes found reviewing PR #10 before merging it ────────────────────
//
// The branch resolved the ticket's application by NAME and then handed whatever
// came back — including null — to the live-send guard. Both tests below pin the
// behaviour the fix depends on.

test('a null application still reads the environment, which is why the guard checks for null itself', () => {
  // Deliberate: a dry-run preview can be built before an application is known,
  // and it has to render. So `easyVistaCatalogStatus(null)` reports the
  // environment's catalog as configured — and a live send must NOT decide from
  // this alone, or an unassigned ticket inherits somebody else's catalog. The
  // refusal for a missing application row lives in submitSubmissionToEasyVista,
  // above this call, precisely because of what this asserts.
  withEnv(
    {
      EASYVISTA_CATALOG_GUID: 'ENV-GUID',
      EASYVISTA_CATALOG_CODE: 'ENV-CODE',
      EASYVISTA_DEFAULT_APPLICATION: 'Billing Center',
    },
    () => {
      const status = easyVistaCatalogStatus(null);
      assert.equal(status.configured, true, 'a preview with no application still renders');
      assert.equal(status.catalogGuid, 'ENV-GUID');
    },
  );
});

test('the refusal names the tracker, not the vendor', () => {
  withEnv(
    {
      EASYVISTA_CATALOG_GUID: 'ENV-GUID',
      EASYVISTA_CATALOG_CODE: 'ENV-CODE',
      EASYVISTA_DEFAULT_APPLICATION: 'Billing Center',
    },
    () => {
      const { reason } = easyVistaCatalogStatus(POLICY);
      assert.match(reason, /Policy Center/, 'it names the application that cannot be sent to');
      assert.match(reason, /Service Desk/, 'it uses the display label');
      assert.doesNotMatch(reason, /EasyVista/, 'it does not leak the vendor name to an admin');
    },
  );
});
