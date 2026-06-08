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

module.exports = router;
