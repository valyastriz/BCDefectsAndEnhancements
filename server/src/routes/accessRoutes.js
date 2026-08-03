const express = require('express');
const dbApi = require('../../db');
const { ensureSuperUser } = require('../auth');
const {
  listAccess,
  setApplicationEasyVista,
  setUserGrants,
  bulkSetAccess,
  setUserSuperUser,
  addAdGroupMapping,
  removeAdGroupMapping,
} = require('../services/accessService');

const router = express.Router();

// Every route here is super-user only. ensureSuperUser re-reads is_super_user
// from the users row rather than the session, so a demotion takes effect on the
// demoted person's very next request — including one already in flight against
// this page.
//
// These are /api/admin/* paths, so the double-submit CSRF check already covers
// the mutations (see middleware/csrf.js).

async function withModels(res, handler) {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  if (!models.User || !models.Application || !models.UserApplicationRole) {
    return res.status(500).json({ error: 'Models are not initialized' });
  }
  return handler(models);
}

router.get('/api/admin/access', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => (
      res.json(await listAccess(models, models.User.sequelize))
    ));
  } catch (error) {
    return next(error);
  }
});

// One person's whole access, as a replaced set — what editing a single row sends.
router.put('/api/admin/access/users/:id/grants', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => {
      const result = await setUserGrants(models, models.User.sequelize, {
        userId: req.params.id,
        grants: req.body?.grants,
        grantedBy: req.session?.user?.username,
      });
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(result.status).json(result.body);
    });
  } catch (error) {
    return next(error);
  }
});

// Many people × many applications in one action. Same response shape as the
// existing bulk-visibility / bulk-retire endpoints.
router.post('/api/admin/access/bulk', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => {
      const result = await bulkSetAccess(models, models.User.sequelize, {
        userIds: req.body?.userIds,
        applicationIds: req.body?.applicationIds,
        role: req.body?.role,
        action: req.body?.action,
        grantedBy: req.session?.user?.username,
      });
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(result.status).json(result.body);
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/api/admin/access/users/:id/super-user', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => {
      const result = await setUserSuperUser(models, {
        userId: req.params.id,
        isSuperUser: req.body?.isSuperUser,
      });
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(result.status).json(result.body);
    });
  } catch (error) {
    return next(error);
  }
});

// Which EasyVista catalog an application's tickets are raised in. Without one,
// a real send is refused rather than posted into another application's catalog.
router.put('/api/admin/access/applications/:id/easyvista', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => {
      const result = await setApplicationEasyVista(models, {
        applicationId: req.params.id,
        catalogGuid: req.body?.catalogGuid,
        catalogCode: req.body?.catalogCode,
      });
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(result.status).json(result.body);
    });
  } catch (error) {
    return next(error);
  }
});

// Directory-group mappings: which application a group's members work in. These
// set a default, not an entitlement — see addAdGroupMapping.
router.post('/api/admin/access/ad-groups', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => {
      const result = await addAdGroupMapping(models, {
        applicationId: req.body?.applicationId,
        groupName: req.body?.groupName,
      });
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(result.status).json(result.body);
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/api/admin/access/ad-groups/:id', ensureSuperUser, async (req, res, next) => {
  try {
    return await withModels(res, async (models) => {
      const result = await removeAdGroupMapping(models, { id: req.params.id });
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.status(result.status).json(result.body);
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
