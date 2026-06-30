const crypto = require('crypto');
const { SESSION_SECRET } = require('../config');

// Short-lived, HMAC-signed token that lets the browser authenticate a *direct*
// Socket.IO connection to this server (bypassing the Vercel proxy, which can't
// carry WebSocket upgrades). The session cookie is scoped to the frontend
// origin and isn't sent cross-origin, so the client fetches one of these from a
// same-origin (session-authenticated) endpoint and passes it in the socket
// handshake. Only needed at connect time, so the TTL is intentionally tiny.
const TTL_MS = 2 * 60 * 1000; // 2 minutes

function sign(body) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
}

/**
 * Build a signed realtime token for an authenticated admin.
 * @param {{ username: string, role: string }} user
 */
function signRealtimeToken(user) {
  const payload = {
    username: user?.username || null,
    role: user?.role || null,
    exp: Date.now() + TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Verify a realtime token. Returns { username, role } when valid + unexpired +
 * role 'admin', else null. Never throws.
 */
function verifyRealtimeToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = sign(body);
  // Constant-time compare; timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  if (payload.role !== 'admin') return null;
  return { username: payload.username, role: payload.role };
}

module.exports = { signRealtimeToken, verifyRealtimeToken };
