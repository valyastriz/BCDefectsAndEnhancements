function ensureAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'admin') {
    return res.status(401).json({ error: 'Admin authentication required' });
  }

  next();
}

module.exports = {
  ensureAdmin,
};
