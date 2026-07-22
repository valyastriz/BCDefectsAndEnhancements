const express = require('express');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { isAiConfigured } = require('../aiSummary');
const {
  runAiSearch,
  isFeatureEnabled,
  SCOPE_ADMIN,
  SCOPE_PUBLIC,
} = require('../services/aiSearchService');
const {
  AI_SEARCH_PUBLIC_RATE_LIMIT,
  AI_SEARCH_PUBLIC_RATE_WINDOW_MS,
} = require('../config');

const router = express.Router();

// ── Simple in-memory per-IP rate limiter for the unauthenticated public route ──
// (bounds anonymous cost/abuse — no Redis in this app). Fixed window.
const publicHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  if (publicHits.size > 5000) {
    for (const [key, entry] of publicHits) {
      if (now > entry.resetAt) publicHits.delete(key);
    }
  }
  const entry = publicHits.get(ip);
  if (!entry || now > entry.resetAt) {
    publicHits.set(ip, { count: 1, resetAt: now + AI_SEARCH_PUBLIC_RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > AI_SEARCH_PUBLIC_RATE_LIMIT;
}

function readSearchParams(body = {}) {
  return {
    query: body.query,
    applicationId: body.applicationId ?? null,
    applicationName: body.applicationName ?? '',
    reportedWithinDays: body.reportedWithinDays ?? null,
    resolvedWithinDays: body.resolvedWithinDays ?? null,
  };
}

// ── Admin: full-data semantic search ──────────────────────────────────────────
router.get('/api/admin/ai-search/status', ensureAdmin, (_req, res) => {
  res.json({ enabled: isFeatureEnabled(SCOPE_ADMIN), summaryEnabled: isAiConfigured() });
});

router.post('/api/admin/submissions/ai-search', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const result = await runAiSearch(db, { ...readSearchParams(req.body), scope: SCOPE_ADMIN });
    if (!result.enabled) return res.status(503).json(result);
    return res.json(result);
  });
});

// ── Public: restricted (public tickets + public fields only) ──────────────────
router.get('/api/ai-search/status', (_req, res) => {
  res.json({ enabled: isFeatureEnabled(SCOPE_PUBLIC), summaryEnabled: isAiConfigured() });
});

router.post('/api/ai-search', async (req, res) => {
  if (!isFeatureEnabled(SCOPE_PUBLIC)) {
    return res.status(503).json({ enabled: false, reason: 'AI search is not available.' });
  }
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many searches. Please wait a moment and try again.' });
  }
  return withDb(async (db) => {
    const result = await runAiSearch(db, { ...readSearchParams(req.body), scope: SCOPE_PUBLIC });
    if (!result.enabled) return res.status(503).json(result);
    return res.json(result);
  });
});

module.exports = router;
