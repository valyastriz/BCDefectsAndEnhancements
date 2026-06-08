const express = require('express');
const bcrypt = require('bcrypt');
const dbApi = require('../../db');
const { createRateLimiter } = require('../middleware/rateLimit');

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

  const user = await User.findOne({ where: { username } });
  if (!user || user.role !== 'admin') {
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

module.exports = router;
