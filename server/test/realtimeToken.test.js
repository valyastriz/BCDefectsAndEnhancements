const { test } = require('node:test');
const assert = require('node:assert');

const { signRealtimeToken, verifyRealtimeToken } = require('../src/helpers/realtimeToken');

test('round-trips a valid admin token', () => {
  const token = signRealtimeToken({ username: 'alice', role: 'admin' });
  assert.deepStrictEqual(verifyRealtimeToken(token), { username: 'alice', role: 'admin' });
});

test('rejects a tampered payload', () => {
  const token = signRealtimeToken({ username: 'alice', role: 'admin' });
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ username: 'mallory', role: 'admin', exp: Date.now() + 60000 })).toString('base64url');
  assert.strictEqual(verifyRealtimeToken(`${forged}.${sig}`), null);
  assert.strictEqual(verifyRealtimeToken(`${body}.deadbeef`), null);
});

test('rejects an expired token', () => {
  // Hand-roll an expired token using the same secret to confirm exp is enforced.
  const crypto = require('crypto');
  const { SESSION_SECRET } = require('../src/config');
  const body = Buffer.from(JSON.stringify({ username: 'alice', role: 'admin', exp: Date.now() - 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  assert.strictEqual(verifyRealtimeToken(`${body}.${sig}`), null);
});

test('rejects a non-admin role', () => {
  const token = signRealtimeToken({ username: 'bob', role: 'user' });
  assert.strictEqual(verifyRealtimeToken(token), null);
});

test('rejects malformed / missing input', () => {
  assert.strictEqual(verifyRealtimeToken(undefined), null);
  assert.strictEqual(verifyRealtimeToken(''), null);
  assert.strictEqual(verifyRealtimeToken('nodot'), null);
  assert.strictEqual(verifyRealtimeToken('.sig'), null);
});
