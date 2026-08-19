const crypto = require('crypto');
const {
  SESSION_COOKIE_SAME_SITE,
  SESSION_COOKIE_SECURE,
  SESSION_COOKIE_DOMAIN,
} = require('../config');

// Double-submit-cookie CSRF protection (no external dependency).
// A non-httpOnly token cookie is issued to every client; state-changing requests
// to the authenticated admin API must echo it back in the X-CSRF-Token header.
const CSRF_COOKIE = 'bc_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Session-bound write paths OUTSIDE /api/admin/ that still need the check.
//
// `/api/admin/` was a fine rule while every authenticated write lived there.
// Recording a recurrence does not: it is filed by a rep, so it sits under
// /api/submissions, but it is still a state-changing action performed with the
// caller's session — which is exactly the shape CSRF attacks. It matters in
// production specifically, where the session cookie is SameSite=none (config.js)
// and therefore IS sent on a cross-site POST.
//
// Costs the client nothing: the shared `request()` helper in client/src/lib/api.js
// already attaches X-CSRF-Token to every non-safe method, admin or not.
//
// Matched with a regex per entry so an id in the path cannot be used to slip
// past a prefix check.
const CSRF_PROTECTED_PATHS = [
  /^\/api\/submissions\/\d+\/recurrences\/?$/,
];

function parseCookies(cookieHeader) {
  const out = {};
  String(cookieHeader || '')
    .split(';')
    .forEach((part) => {
      const index = part.indexOf('=');
      if (index === -1) return;
      const key = part.slice(0, index).trim();
      if (!key) return;
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    });
  return out;
}

function csrfProtection() {
  const cookieOptions = {
    httpOnly: false, // must be readable by client JS for the double-submit pattern
    sameSite: SESSION_COOKIE_SAME_SITE,
    secure: SESSION_COOKIE_SECURE,
    path: '/',
    ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {}),
  };

  return function csrf(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies[CSRF_COOKIE];

    // Issue a token to clients that don't have one yet (e.g. on the initial GET).
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      res.cookie(CSRF_COOKIE, token, cookieOptions);
    }

    // Enforce on state-changing requests to the session-authenticated admin API,
    // plus the explicitly listed session-bound write paths outside it.
    const requiresCheck = !SAFE_METHODS.has(req.method) && (
      req.path.startsWith('/api/admin/')
      || CSRF_PROTECTED_PATHS.some((pattern) => pattern.test(req.path))
    );
    if (!requiresCheck) return next();

    const provided = req.get(CSRF_HEADER);
    if (!provided || !token || provided !== token) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token. Reload the page and try again.' });
    }
    return next();
  };
}

module.exports = { csrfProtection, CSRF_COOKIE, CSRF_HEADER };
