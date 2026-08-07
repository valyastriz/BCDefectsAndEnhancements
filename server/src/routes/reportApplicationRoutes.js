// One route: a reporting analyst adding an application by typing its name in.
//
// It is deliberately NOT under `/api/admin/meta`. Every write on that router is
// behind `ensureSuperUser` (the fifteenth pass), and `test/metaRouteGuards.test.js`
// sweeps its stack so a route added there later without the guard fails too. That
// guard exists because editing a lookup renames or withdraws a value on every ticket
// that holds it, across every application, unscoped by the per-application grants
// the rest of the admin side runs on.
//
// **Creating is not editing.** A new application touches no existing ticket. So this
// is its own door with its own narrower rule — CREATE only, and what it creates is
// always reports-only — rather than a hole in a guard a test polices on purpose.
// Renaming or retiring an application is still a super user's job, on the Metadata
// page.
//
// `/api/admin/*`, so the double-submit CSRF check already covers it
// (middleware/csrf.js).
const express = require('express');
const dbApi = require('../../db');
const { ensureAdmin, attachViewer } = require('../auth');
const { createReportApplication } = require('../services/reportApplicationService');

const router = express.Router();

router.post('/api/admin/applications', ensureAdmin, attachViewer, async (req, res, next) => {
  try {
    await dbApi.init();
    const result = await createReportApplication({
      name: req.body?.name,
      viewer: req.viewer,
      username: req.session?.user?.username,
    });
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
