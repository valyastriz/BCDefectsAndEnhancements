const { test } = require('node:test');
const assert = require('node:assert');

const { resolveReporter } = require('../src/services/reporterService');

// The one rule worth testing hardest: a signed-in reporter cannot file as anyone
// but themselves, no matter what the request body says.

function makeModels(users = []) {
  return {
    User: {
      findByPk: async (id) => users.find((user) => Number(user.id) === Number(id)) || null,
    },
  };
}

const session = (id) => ({ session: { user: { id } } });

const JANE = {
  id: 5, username: 'jrep', display_name: 'Jane Rep', email: 'jane@example.com',
};

// ── Signed in: the session decides ───────────────────────────────────────────
test('a signed-in reporter is bound to their own user row', async () => {
  const result = await resolveReporter(makeModels([JANE]), session(5), {});

  assert.strictEqual(result.reporterUserId, 5);
  assert.strictEqual(result.createdBy, 'Jane Rep');
  assert.strictEqual(result.createdByEmail, 'jane@example.com');
  assert.strictEqual(result.isBound, true);
});

test('a submitted name and email are DISCARDED for a signed-in reporter', async () => {
  // The attack this closes: filing a ticket under a colleague's name.
  const result = await resolveReporter(makeModels([JANE]), session(5), {
    created_by: 'Someone Else',
    created_by_email: 'someone.else@example.com',
  });

  assert.strictEqual(result.createdBy, 'Jane Rep');
  assert.strictEqual(result.createdByEmail, 'jane@example.com');
  assert.strictEqual(result.reporterUserId, 5);
});

test('a bound reporter with no display name falls back to the username', async () => {
  const result = await resolveReporter(
    makeModels([{ id: 6, username: 'kpatel', display_name: null, email: null }]),
    session(6),
    {},
  );

  assert.strictEqual(result.createdBy, 'kpatel');
  assert.strictEqual(result.createdByEmail, '-', 'the column is not nullable');
  assert.strictEqual(result.reporterUserId, 6);
});

test('a bound reporter needs no typed name at all', async () => {
  // The form stops asking once someone is signed in, so an empty body is normal.
  const result = await resolveReporter(makeModels([JANE]), session(5), { created_by: '' });
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.createdBy, 'Jane Rep');
});

// ── Anonymous: today's behaviour, unchanged ──────────────────────────────────
test('an anonymous filer keeps the typed name and email', async () => {
  const result = await resolveReporter(makeModels(), {}, {
    created_by: '  Dana Field  ',
    created_by_email: ' dana@example.com ',
  });

  assert.strictEqual(result.reporterUserId, null);
  assert.strictEqual(result.createdBy, 'Dana Field', 'trimmed');
  assert.strictEqual(result.createdByEmail, 'dana@example.com');
  assert.strictEqual(result.isBound, false);
});

test('an anonymous filer with no email gets the placeholder', async () => {
  const result = await resolveReporter(makeModels(), {}, { created_by: 'Dana Field' });
  assert.strictEqual(result.createdByEmail, '-');
});

test('an anonymous filer must supply a name', async () => {
  const blank = await resolveReporter(makeModels(), {}, { created_by: '   ' });
  assert.match(blank.error, /required/i);

  const missing = await resolveReporter(makeModels(), {}, {});
  assert.match(missing.error, /required/i);
});

// ── Fail-safe edges ──────────────────────────────────────────────────────────
test('a session pointing at a deleted user falls back to the anonymous path', async () => {
  // Binding an id that resolves to nobody would put an orphan reference on the
  // ticket; the typed name is the honest answer instead.
  const result = await resolveReporter(makeModels([JANE]), session(999), {
    created_by: 'Dana Field',
  });

  assert.strictEqual(result.reporterUserId, null);
  assert.strictEqual(result.createdBy, 'Dana Field');
  assert.strictEqual(result.isBound, false);
});

test('a deleted-user session with no typed name is refused rather than bound', async () => {
  const result = await resolveReporter(makeModels([JANE]), session(999), {});
  assert.match(result.error, /required/i);
});

test('a missing User model does not bind a reporter', async () => {
  const result = await resolveReporter({}, session(5), { created_by: 'Dana Field' });
  assert.strictEqual(result.reporterUserId, null);
  assert.strictEqual(result.isBound, false);
});
