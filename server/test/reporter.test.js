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

// ── A session that WAS there and is gone ─────────────────────────────────────
// Sessions live in express-session's default MemoryStore, so every restart of the
// server — every deploy — drops all of them, while an open tab goes on showing
// "Filing as …" from the viewer answer it fetched beforehand. That submit arrives
// with a session cookie the server cannot resolve and no typed name, because the
// form stops asking for one once it believes it knows who you are.
//
// It used to be answered "Requester Name is required": a field the form is not
// showing, about a person who thought they were signed in. Now it says what
// happened, so the form can keep what was typed and reshape itself.
const withStaleCookie = (extra = {}) => ({
  headers: { cookie: 'bc_csrf=abc; bc_sid=s%3Along-gone-session.signature' },
  ...extra,
});

test('a submit carrying a dead session cookie is told the session expired', async () => {
  const result = await resolveReporter(makeModels(), withStaleCookie(), {});

  assert.strictEqual(result.status, 401, 'not a 400 about a missing field');
  assert.strictEqual(result.sessionExpired, true);
  assert.match(result.error, /session has expired/i);
  assert.doesNotMatch(result.error, /required/i, 'it names what happened, not a field');
});

test('the session cookie has to be the SESSION one, not just any cookie', async () => {
  // A CSRF cookie alone means a browser that has talked to the portal, not one
  // that was signed in — that person is anonymous and the form is asking for
  // their name.
  const result = await resolveReporter(
    makeModels(),
    { headers: { cookie: 'bc_csrf=abc' } },
    {},
  );
  assert.strictEqual(result.status, 400);
  assert.match(result.error, /required/i);
  assert.strictEqual(result.sessionExpired, undefined);
});

test('a dead session cookie WITH a typed name still files anonymously', async () => {
  // Somebody who was signed in, lost it, and typed their name rather than signing
  // in again. There is nothing to refuse: the name stands, unbound.
  const result = await resolveReporter(makeModels(), withStaleCookie(), {
    created_by: 'Dana Field',
  });

  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.createdBy, 'Dana Field');
  assert.strictEqual(result.reporterUserId, null);
  assert.strictEqual(result.isBound, false);
});

test('a live session is unaffected by the cookie check', async () => {
  const result = await resolveReporter(makeModels([JANE]), withStaleCookie(session(5)), {});
  assert.strictEqual(result.reporterUserId, 5);
  assert.strictEqual(result.createdBy, 'Jane Rep');
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

// ── requireAuthenticated: the anonymous path closes entirely ─────────────────
// Config gates this on SSO being live, because the local login is admin-only —
// turning it on sooner would leave the submit form reachable by nobody.
const REQUIRE = { requireAuthenticated: true };

test('an anonymous filer is refused with 401, not asked for a name', async () => {
  const result = await resolveReporter(makeModels(), {}, { created_by: 'Dana Field' }, REQUIRE);

  assert.strictEqual(result.status, 401);
  assert.match(result.error, /sign in/i);
  assert.strictEqual(result.reporterUserId, undefined, 'no identity is invented');
});

test('a typed name cannot substitute for signing in', async () => {
  // The whole point: a claim is not an identity.
  const result = await resolveReporter(makeModels(), {}, {
    created_by: 'Jane Rep', created_by_email: 'jane@example.com',
  }, REQUIRE);

  assert.strictEqual(result.status, 401);
});

test('a signed-in reporter is unaffected by the requirement', async () => {
  const result = await resolveReporter(makeModels([JANE]), session(5), {}, REQUIRE);

  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.reporterUserId, 5);
  assert.strictEqual(result.isBound, true);
});

test('a session pointing at a deleted user is refused rather than let through', async () => {
  // The fallback to the typed name is exactly what must NOT happen here.
  const result = await resolveReporter(makeModels([JANE]), session(999), {
    created_by: 'Dana Field',
  }, REQUIRE);

  assert.strictEqual(result.status, 401);
});

test('the anonymous name requirement still answers 400, not 401', async () => {
  // Two different failures; conflating them would tell an anonymous filer to
  // sign in when the real problem is a blank field.
  const result = await resolveReporter(makeModels(), {}, {});
  assert.strictEqual(result.status, 400);
});
