const dbApi = require('../db');
const { resolveViewer } = require('./services/viewerService');
const { ACCOUNT_ROLE_ADMIN } = require('./constants');

/**
 * The admin side, gated on the ACCOUNT role — not on any per-application grant,
 * which is a separate question answered by attachViewer.
 *
 * The two refusals are told apart deliberately. Signed in as a rep is a 403: the
 * caller is who they say they are and simply may not be here, and answering 401
 * would send the client down its "your session expired" path and invite them to
 * sign in again as the same account that was just refused.
 */
function ensureAdmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  if (req.session.user.role !== ACCOUNT_ROLE_ADMIN) {
    return res.status(403).json({ error: 'This area is for the triage team' });
  }

  next();
}

/**
 * Portal super users only — currently the Access page, which grants and revokes
 * other people's triage rights.
 *
 * Reads `is_super_user` from the users row rather than the session, so revoking
 * someone's super-user takes effect on their next request instead of waiting for
 * them to log out. Fails closed: any missing model, missing row or unset flag is
 * a 403.
 */
async function ensureSuperUser(req, res, next) {
  try {
    if (!req.session?.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await dbApi.init();
    const { User } = dbApi.getModels() || {};
    if (!User) {
      return res.status(500).json({ error: 'User model is not initialized' });
    }

    const user = await User.findByPk(req.session.user.id, { raw: true });
    if (!user || Number(user.is_super_user || 0) !== 1) {
      return res.status(403).json({ error: 'Portal super-user access required' });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Resolves the caller's rights once per request and hangs the envelope on
 * `req.viewer`, so every handler in a chain scopes off the same answer instead
 * of each re-reading the session.
 *
 * Pairs with ensureAdmin rather than replacing it: ensureAdmin decides WHETHER
 * a caller is an admin at all, this decides WHAT they administer. Resolution
 * failure is an error, never an empty-but-successful viewer, so a route can
 * never scope off a half-built envelope.
 */
async function attachViewer(req, res, next) {
  try {
    await dbApi.init();
    const models = dbApi.getModels() || {};
    if (!models.Application || !models.User) {
      return res.status(500).json({ error: 'Models are not initialized' });
    }

    req.viewer = await resolveViewer(req, { models, sequelize: models.User.sequelize });
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  ensureAdmin,
  ensureSuperUser,
  attachViewer,
};
