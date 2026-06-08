const { test } = require('node:test');
const assert = require('node:assert');

const { createRateLimiter } = require('../src/middleware/rateLimit');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function hit(limiter, ip) {
  const res = makeRes();
  let nextCalled = false;
  limiter({ ip, socket: {} }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('allows up to max requests then returns 429', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  const outcomes = [];
  for (let i = 0; i < 5; i += 1) {
    const { res, nextCalled } = hit(limiter, '10.0.0.1');
    outcomes.push(nextCalled ? 'next' : res.statusCode);
  }
  assert.deepStrictEqual(outcomes, ['next', 'next', 'next', 429, 429]);
});

test('sets a Retry-After header when blocking', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  hit(limiter, '10.0.0.2');
  const { res, nextCalled } = hit(limiter, '10.0.0.2');
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) > 0, 'Retry-After should be a positive number of seconds');
});

test('tracks each IP in its own bucket', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  assert.ok(hit(limiter, '10.0.0.3').nextCalled, 'first IP first hit allowed');
  assert.ok(hit(limiter, '10.0.0.4').nextCalled, 'different IP is unaffected');
  assert.strictEqual(hit(limiter, '10.0.0.3').nextCalled, false, 'first IP second hit blocked');
});
