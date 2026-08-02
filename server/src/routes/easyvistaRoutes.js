const express = require('express');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { submitSubmissionToEasyVista } = require('../services/submissionService');

const router = express.Router();

router.post('/api/admin/submissions/:id/submit-easyvista', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const result = await submitSubmissionToEasyVista(db, {
      id: req.params.id,
      body: req.body,
      username: req.session?.user?.username,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(result.status).json(result.body);
  });
});

/**
 * What a send would transmit, without sending it.
 *
 * Runs the real submit path in dry-run mode and returns before the API call, so
 * the preview cannot disagree with the request. POST rather than GET because it
 * carries the admin's unsaved draft — it writes nothing.
 */
router.post('/api/admin/submissions/:id/easyvista-preview', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const result = await submitSubmissionToEasyVista(db, {
      id: req.params.id,
      body: req.body,
      username: req.session?.user?.username,
      dryRun: true,
    });
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json(result.preview);
  });
});

module.exports = router;
