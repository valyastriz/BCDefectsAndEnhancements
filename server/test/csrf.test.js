const { test } = require('node:test');
const assert = require('node:assert');

const { csrfProtection } = require('../src/middleware/csrf');

function makeReq({ method = 'GET', path = '/', cookie = '', csrfHeader } = {}) {
  const headerMap = {};
  if (csrfHeader !== undefined) headerMap['x-csrf-token'] = csrfHeader;
  return {
    method,
    path,
    headers: { cookie },
    get(name) { return headerMap[String(name).toLowerCase()]; },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    cookie(name, value) { this.cookies[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function run(mw, req) {
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

const csrf = csrfProtection();

test('issues a token cookie on a GET with no existing token', () => {
  const { res, nextCalled } = run(csrf, makeReq({ method: 'GET', path: '/api/auth/me' }));
  assert.ok(nextCalled, 'safe request should pass through');
  assert.match(res.cookies.bc_csrf || '', /^[a-f0-9]{64}$/, 'a 64-hex token should be issued');
});

test('does not reissue when a token cookie already exists', () => {
  const { res, nextCalled } = run(csrf, makeReq({ method: 'GET', cookie: 'bc_csrf=existingtoken' }));
  assert.ok(nextCalled);
  assert.strictEqual(res.cookies.bc_csrf, undefined, 'should not overwrite an existing token');
});

test('blocks an admin mutation with no CSRF header', () => {
  const { res, nextCalled } = run(csrf, makeReq({
    method: 'PUT', path: '/api/admin/submissions/1', cookie: 'bc_csrf=tok',
  }));
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test('blocks an admin mutation when header does not match cookie', () => {
  const { res, nextCalled } = run(csrf, makeReq({
    method: 'PUT', path: '/api/admin/submissions/1', cookie: 'bc_csrf=tok', csrfHeader: 'WRONG',
  }));
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test('allows an admin mutation when header matches cookie', () => {
  const { nextCalled } = run(csrf, makeReq({
    method: 'PUT', path: '/api/admin/submissions/1', cookie: 'bc_csrf=tok', csrfHeader: 'tok',
  }));
  assert.ok(nextCalled, 'valid double-submit token should pass');
});

test('does not enforce CSRF on non-admin (public) mutations', () => {
  const { nextCalled } = run(csrf, makeReq({
    method: 'POST', path: '/api/submissions', cookie: 'bc_csrf=tok',
  }));
  assert.ok(nextCalled, 'unauthenticated public endpoints are exempt');
});

test('does not enforce CSRF on safe methods to admin routes', () => {
  const { nextCalled } = run(csrf, makeReq({ method: 'GET', path: '/api/admin/submissions', cookie: 'bc_csrf=tok' }));
  assert.ok(nextCalled);
});
