// Lightweight in-memory rate limiter (no external dependency).
// Suitable for a single-instance deployment; swap for a shared store if scaled horizontally.

function createRateLimiter({ windowMs, max, message } = {}) {
  const windowSize = Number(windowMs) || 15 * 60 * 1000;
  const maxHits = Number(max) || 10;
  const hits = new Map();

  function sweep(now) {
    for (const [key, entry] of hits) {
      if (now > entry.resetAt) hits.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (hits.size > 5000) sweep(now);

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowSize });
      return next();
    }

    entry.count += 1;
    if (entry.count > maxHits) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
      });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
