const express = require('express');
const bcrypt = require('bcrypt');
const dbApi = require('../../db');
const { ensureAdmin } = require('../auth');
const { signRealtimeToken } = require('../helpers/realtimeToken');
const { createRateLimiter } = require('../middleware/rateLimit');
const { accountMaySignIn } = require('../constants');

const router = express.Router();

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

router.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  await dbApi.init();
  const dbModels = dbApi.getModels() || {};
  const User = dbModels.User;
  if (!User) {
    return res.status(500).json({ error: 'User model is not initialized' });
  }

  // Two account roles may sign in: 'admin' and 'rep'. A rep gets a session and
  // nothing else — ensureAdmin refuses them exactly as it refuses a stranger.
  // Same 'Invalid credentials' for an unknown username, a wrong password and a
  // role that may not sign in, so the response never confirms an account exists.
  const user = await User.findOne({ where: { username } });
  if (!user || !accountMaySignIn(user.role)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
  };

  return res.json({
    user: req.session.user,
  });
});

router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bc_sid');
    res.json({ ok: true });
  });
});

router.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ user: null });
  }

  return res.json({ user: req.session.user });
});

// Issues a short-lived signed token so the client can authenticate a *direct*
// Socket.IO connection to this server (the realtime path bypasses the frontend
// proxy, which can't carry WebSocket upgrades). Same-origin + session-gated.
router.get('/api/realtime/token', ensureAdmin, (req, res) => {
  const { username, role } = req.session.user;
  return res.json({ token: signRealtimeToken({ username, role }) });
});

module.exports = router;
