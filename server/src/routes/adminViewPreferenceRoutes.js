const express = require('express');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const {
  getViewPreference,
  saveViewPreference,
  resetViewPreference,
} = require('../services/adminViewPreferenceService');

const router = express.Router();

// Per-admin table/filter view preferences. Identity always comes from the
// session (never the request body); CSRF is enforced on /api/admin/* mutations.

router.get('/api/admin/view-preferences', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const prefs = await getViewPreference(db, req.session.user.id);
    return res.json(prefs);
  });
});

router.put('/api/admin/view-preferences', ensureAdmin, async (req, res) => {
  const body = req.body || {};
  return withDb(async (db) => {
    const saved = await saveViewPreference(db, req.session.user.id, {
      columns: body.columns,
      filters: body.filters,
    });
    return res.json(saved);
  });
});

router.delete('/api/admin/view-preferences', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const prefs = await resetViewPreference(db, req.session.user.id);
    return res.json(prefs);
  });
});

module.exports = router;
