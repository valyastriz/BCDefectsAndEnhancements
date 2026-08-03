// Dev-only identity switching, so per-application admin roles and super users can
// be exercised before SSO exists.
//
// This is a PASSWORD-FREE LOGIN. It must never be reachable in a deployed
// environment, so:
//
//   * the router is only built when DEV_IMPERSONATION_ENABLED is true, and that
//     flag requires AUTH_MODE=local AND NODE_ENV != production AND
//     DEV_IMPERSONATION=true (see config.js);
//   * src/index.js does not register the route at all when it is false, so the
//     path 404s rather than existing-but-refusing;
//   * every handler re-checks the flag anyway, so requiring this module directly
//     from a script or a test cannot bypass the gate.
const express = require('express');
const dbApi = require('../../db');
const { DEV_IMPERSONATION_ENABLED } = require('../config');

const router = express.Router();

function ensureImpersonationEnabled(_req, res, next) {
  if (!DEV_IMPERSONATION_ENABLED) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

router.use(ensureImpersonationEnabled);

// Become an existing user. Only a real users row can be assumed — this creates
// nobody, so it cannot invent rights that were never granted.
router.post('/api/dev/impersonate', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) {
      return res.status(400).json({ error: 'username is required' });
    }

    await dbApi.init();
    const { User } = dbApi.getModels() || {};
    if (!User) return res.status(500).json({ error: 'User model is not initialized' });

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(404).json({ error: `No user named ${username}` });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    // Marks the session so the viewer envelope can report it and the UI can say
    // plainly that this is not a real sign-in.
    req.session.impersonating = true;

    return res.json({
      ok: true,
      impersonating: true,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (error) {
    return next(error);
  }
});

// Drop the assumed identity. Separate from /api/auth/logout so ending an
// impersonation cannot be confused with signing out for real.
router.post('/api/dev/impersonate/stop', (req, res) => {
  req.session.user = null;
  req.session.impersonating = false;
  return res.json({ ok: true, impersonating: false });
});

// Who can be impersonated, with the rights each one currently has — so the
// switcher can show what it is switching to.
router.get('/api/dev/impersonate/users', async (_req, res, next) => {
  try {
    await dbApi.init();
    const { User, UserApplicationRole, Application } = dbApi.getModels() || {};
    if (!User) return res.status(500).json({ error: 'User model is not initialized' });

    const users = await User.findAll({ order: [['id', 'ASC']], raw: true });
    const roles = await UserApplicationRole.findAll({ raw: true });
    const applications = await Application.findAll({ raw: true });
    const applicationName = new Map(applications.map((a) => [Number(a.id), String(a.name)]));

    return res.json({
      users: users.map((user) => ({
        id: Number(user.id),
        username: String(user.username),
        displayName: String(user.display_name || user.username),
        role: String(user.role || ''),
        isSuperUser: Number(user.is_super_user || 0) === 1,
        applications: roles
          .filter((role) => Number(role.user_id) === Number(user.id))
          .map((role) => applicationName.get(Number(role.application_id)) || `#${role.application_id}`)
          .sort(),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
