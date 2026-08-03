const express = require('express');
const { attachViewer } = require('../auth');

const router = express.Router();

// Deliberately NOT behind ensureAdmin: the status board must work for a caller
// with no session, and this is how the client learns there isn't one. The
// anonymous envelope carries no user and no application rights, so being
// unauthenticated is a shape rather than an error.
router.get('/api/viewer', attachViewer, (req, res) => res.json({ viewer: req.viewer }));

module.exports = router;
