const { test } = require('node:test');
const assert = require('node:assert');

const metaRoutes = require('../src/routes/metaRoutes');

// WHO MAY EDIT THE PORTAL'S VOCABULARY.
//
// Managing metadata is super-user only: renaming a status renames it on every
// ticket that holds it, on the public board and in every export, and switching a
// value off stops it being offered anywhere. None of that is scoped by the
// per-application grants the rest of the admin side uses, so an admin for one
// application editing this list is editing every application's.
//
// READING the same lists is not: the queue's filters and the detail modal's
// dropdowns are built from GET /api/admin/meta/options (useAdminMeta delegates to
// useMetaManagement, which reads exactly that). Narrowing the GET too would take
// every non-super-user admin's dropdowns away to protect values they can already
// read off any ticket.
//
// That asymmetry is the thing worth pinning. It looks like an inconsistency, so
// it is exactly what a later tidy-up would "fix".

/** The guard middleware names Express holds for one method+path, in order. */
function guardsFor(method, path) {
  const layer = metaRoutes.stack.find((entry) => (
    entry.route
    && entry.route.path === path
    && entry.route.methods[method]
  ));
  assert.ok(layer, `no ${method.toUpperCase()} route registered at ${path}`);
  return layer.route.stack
    .map((handler) => handler.name)
    // The final handler is the route body; guards are everything before it.
    .slice(0, -1);
}

test('writing metadata is super-user only, on every write', () => {
  const writes = [
    ['post', '/api/admin/meta/:category'],
    ['put', '/api/admin/meta/:category/:id'],
    ['post', '/api/admin/meta/:category/reorder'],
  ];

  for (const [method, path] of writes) {
    assert.deepStrictEqual(
      guardsFor(method, path),
      ['ensureSuperUser'],
      `${method.toUpperCase()} ${path} is not behind ensureSuperUser`,
    );
  }
});

test('reading the admin lists stays open to every admin', () => {
  // Deliberate, and load-bearing — see the header. Every admin's dropdowns come
  // from here.
  assert.deepStrictEqual(guardsFor('get', '/api/admin/meta/options'), ['ensureAdmin']);
});

test('the public option list is still public', () => {
  // The submit form reads it with no session at all.
  assert.deepStrictEqual(guardsFor('get', '/api/meta/options'), []);
});

test('no metadata write is left behind a weaker guard', () => {
  // Catches a route ADDED later without the guard, which the fixed list above
  // would not: anything that mutates under /api/admin/meta must be super-user.
  const weak = [];
  for (const entry of metaRoutes.stack) {
    if (!entry.route) continue;
    const path = entry.route.path;
    if (!String(path).startsWith('/api/admin/meta')) continue;
    const mutates = ['post', 'put', 'patch', 'delete'].some((method) => entry.route.methods[method]);
    if (!mutates) continue;
    const guards = entry.route.stack.map((handler) => handler.name).slice(0, -1);
    if (!guards.includes('ensureSuperUser')) weak.push(`${Object.keys(entry.route.methods).join('/')} ${path}`);
  }

  assert.deepStrictEqual(weak, [], `these metadata writes are not super-user only:\n  ${weak.join('\n  ')}`);
});
