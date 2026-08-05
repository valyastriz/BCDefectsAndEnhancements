// Who administers what — the write side of the model viewerService reads.
//
// Every grant here is a row in user_application_roles, and no row is no access
// (see the model comment). That makes this service the only place a person's
// triage rights widen, which is what keeps the fail-closed scoping honest: there
// is one door, it is behind ensureSuperUser, and it is audited by granted_by.
//
// Takes `models` and `sequelize` as parameters for the same reason viewerService
// does — so the rules can be tested without a database.
const { QueryTypes } = require('sequelize');
const { easyVistaCatalogStatus } = require('../helpers/easyVistaPayload');
// Tolerates a database that predates the catalog columns — see its own comment.
const { loadApplicationRows, loadApplicationRowById } = require('../helpers/lookups');
const {
  APPLICATION_ROLES,
  APPLICATION_ROLE_ADMIN,
  applicationRoleRank,
  applicationRoleAtLeast,
} = require('../constants');

const isApplicationId = (value) => Number.isInteger(value) && value > 0;
const normalizeRole = (value) => String(value || '').trim().toLowerCase();

/** Active application ids, as a Set, for validating a grant before it is written. */
async function loadActiveApplicationIds(models) {
  const active = await models.Application.findAll({
    where: { is_active: 1 },
    attributes: ['id'],
    raw: true,
  });
  return new Set(active.map((row) => Number(row.id)));
}

/**
 * Everything the Access page renders: the applications that can be granted, and
 * every account with what it currently holds.
 *
 * Read in one pass rather than per user, so the page cost does not grow with
 * headcount.
 */
async function listAccess(models, sequelize) {
  const applications = await loadApplicationRows(models.Application, {
    where: { is_active: 1 },
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
  });

  // How much each application actually holds, so revoking someone is a decision
  // made with the size of the queue in view rather than blind. One grouped read
  // — a count per application would be a query per column.
  const countRows = sequelize
    ? await sequelize.query(
      'SELECT application_id, COUNT(*) AS n FROM submissions GROUP BY application_id',
      { type: QueryTypes.SELECT },
    )
    : [];
  const ticketCounts = new Map();
  let unassignedTicketCount = 0;
  for (const row of countRows) {
    const count = Number(row.n) || 0;
    const applicationId = Number(row.application_id);
    // Tickets with no application are visible to super users only, so they are
    // reported separately rather than folded into any one application's total.
    if (isApplicationId(applicationId)) ticketCounts.set(applicationId, count);
    else unassignedTicketCount += count;
  }

  const users = await models.User.findAll({
    attributes: ['id', 'username', 'display_name', 'email', 'role', 'is_super_user'],
    order: [['username', 'ASC']],
    raw: true,
  });

  const grants = await models.UserApplicationRole.findAll({ raw: true });

  // Keyed by person, then application, so two rows for the same pair collapse to
  // the stronger role rather than rendering as a contradiction.
  const rolesByUser = new Map();
  for (const grant of grants) {
    const userId = Number(grant.user_id);
    const applicationId = Number(grant.application_id);
    const role = normalizeRole(grant.role);
    if (!isApplicationId(applicationId) || applicationRoleRank(role) < 0) continue;

    if (!rolesByUser.has(userId)) rolesByUser.set(userId, new Map());
    const held = rolesByUser.get(userId).get(applicationId);
    if (!held || applicationRoleAtLeast(role, held)) {
      rolesByUser.get(userId).set(applicationId, role);
    }
  }

  // Which applications each AD group feeds people into. This does NOT grant
  // triage — it is what the group controls today, shown here so a super user can
  // see the whole access picture in one place.
  const adGroups = models.ApplicationAdGroup
    ? await models.ApplicationAdGroup.findAll({ where: { is_active: 1 }, raw: true })
    : [];

  return {
    applications: applications.map((row) => {
      const status = easyVistaCatalogStatus(row);
      return {
        id: Number(row.id),
        name: String(row.name),
        ticketCount: ticketCounts.get(Number(row.id)) || 0,
        // Which EasyVista catalog this application's tickets are raised in.
        // Reported even while EasyVista is off, so a missing catalog is visible
        // during a walkthrough rather than on the day it is switched on.
        easyVista: {
          configured: status.configured,
          catalogGuid: String(row.easyvista_catalog_guid || ''),
          catalogCode: String(row.easyvista_catalog_code || ''),
          // True when the catalog comes from the environment rather than this
          // row — the one application allowed to inherit it.
          inherited: status.configured && !String(row.easyvista_catalog_guid || '').trim()
            && !String(row.easyvista_catalog_code || '').trim(),
        },
      };
    }),
    unassignedTicketCount,
    users: users.map((row) => ({
      id: Number(row.id),
      username: String(row.username),
      displayName: String(row.display_name || row.username),
      email: String(row.email || ''),
      isSuperUser: Number(row.is_super_user || 0) === 1,
      // Sorted so the page renders the same order every load and a diff of two
      // screenshots means something.
      grants: [...(rolesByUser.get(Number(row.id)) || new Map())]
        .map(([applicationId, role]) => ({ applicationId, role }))
        .sort((a, b) => a.applicationId - b.applicationId),
    })),
    adGroups: adGroups
      .map((row) => ({
        id: Number(row.id),
        applicationId: Number(row.application_id),
        groupName: String(row.group_name),
      }))
      .sort((a, b) => a.applicationId - b.applicationId || a.groupName.localeCompare(b.groupName)),
    roles: APPLICATION_ROLES,
  };
}

/**
 * Replace one person's application grants with exactly `applicationIds`.
 *
 * A replace rather than an add/remove pair because the page edits a set of
 * checkboxes: sending the whole set means two super users editing the same
 * person cannot interleave into a state neither of them chose.
 *
 * Every id is validated against the ACTIVE applications first, so a grant can
 * never point at an application that was retired or never existed.
 */
async function setUserGrants(models, sequelize, { userId, grants, grantedBy }) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid user id', status: 400 };
  }

  const user = await models.User.findByPk(id, { raw: true });
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  if (!Array.isArray(grants)) {
    return { error: 'grants must be an array', status: 400 };
  }

  // Collapse before validating, so a payload that names one application twice is
  // resolved here rather than becoming two rows the reader has to reconcile.
  const byApplication = new Map();
  for (const grant of grants) {
    const applicationId = Number(grant?.applicationId);
    const role = normalizeRole(grant?.role);
    if (!isApplicationId(applicationId)) {
      return { error: 'Each grant needs a positive integer applicationId', status: 400 };
    }
    if (applicationRoleRank(role) < 0) {
      return { error: `Unknown role: ${grant?.role}. Expected one of ${APPLICATION_ROLES.join(', ')}`, status: 400 };
    }
    const held = byApplication.get(applicationId);
    if (!held || applicationRoleAtLeast(role, held)) byApplication.set(applicationId, role);
  }

  const activeIds = await loadActiveApplicationIds(models);
  const unknown = [...byApplication.keys()].filter((applicationId) => !activeIds.has(applicationId));
  if (unknown.length > 0) {
    return { error: `Unknown or inactive application: ${unknown.join(', ')}`, status: 400 };
  }

  const resolved = [...byApplication]
    .map(([applicationId, role]) => ({ applicationId, role }))
    .sort((a, b) => a.applicationId - b.applicationId);
  const grantedAt = new Date().toISOString();

  // One transaction: a half-applied change would silently leave someone with
  // rights the page says they no longer have.
  await sequelize.transaction(async (transaction) => {
    await models.UserApplicationRole.destroy({ where: { user_id: id }, transaction });
    if (resolved.length > 0) {
      await models.UserApplicationRole.bulkCreate(
        resolved.map(({ applicationId, role }) => ({
          user_id: id,
          application_id: applicationId,
          role,
          granted_at: grantedAt,
          granted_by: String(grantedBy || ''),
        })),
        { transaction },
      );
    }
  });

  return { status: 200, body: { userId: id, grants: resolved } };
}

/**
 * Apply ONE change to many people and many applications at once.
 *
 * `grant` sets the named role on every (person × application) pair, replacing
 * whatever role each already held there. `revoke` removes those pairs outright.
 * Either way the other applications a person holds are left alone — this edits
 * the named intersection, not the person's whole access.
 *
 * All-or-nothing, and validated in full before anything is written: a batch that
 * names one bad application changes nobody, because a partially applied access
 * change is the hardest kind to notice.
 */
async function bulkSetAccess(models, sequelize, { userIds, applicationIds, role, action, grantedBy }) {
  if (action !== 'grant' && action !== 'revoke') {
    return { error: "action must be 'grant' or 'revoke'", status: 400 };
  }
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { error: 'Select at least one account', status: 400 };
  }
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return { error: 'Select at least one application', status: 400 };
  }

  const resolvedUserIds = [...new Set(userIds.map(Number))];
  if (!resolvedUserIds.every((id) => Number.isInteger(id) && id > 0)) {
    return { error: 'userIds must be positive integers', status: 400 };
  }

  const resolvedApplicationIds = [...new Set(applicationIds.map(Number))];
  if (!resolvedApplicationIds.every(isApplicationId)) {
    return { error: 'applicationIds must be positive integers', status: 400 };
  }

  // A role is required to grant, and meaningless when revoking — revoking takes
  // away whatever the person held, so accepting a role there would imply a
  // partial revoke that does not exist.
  const normalizedRole = normalizeRole(role);
  if (action === 'grant' && applicationRoleRank(normalizedRole) < 0) {
    return { error: `Unknown role: ${role}. Expected one of ${APPLICATION_ROLES.join(', ')}`, status: 400 };
  }

  const activeIds = await loadActiveApplicationIds(models);
  const unknownApplications = resolvedApplicationIds.filter((id) => !activeIds.has(id));
  if (unknownApplications.length > 0) {
    return { error: `Unknown or inactive application: ${unknownApplications.join(', ')}`, status: 400 };
  }

  const found = await models.User.findAll({
    where: { id: resolvedUserIds },
    attributes: ['id'],
    raw: true,
  });
  const foundIds = new Set(found.map((row) => Number(row.id)));
  const missing = resolvedUserIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return { error: `Unknown account: ${missing.join(', ')}`, status: 400 };
  }

  const grantedAt = new Date().toISOString();

  await sequelize.transaction(async (transaction) => {
    // Clearing first makes grant idempotent: re-granting a different role to the
    // same pair replaces it instead of stacking a second row beside it.
    await models.UserApplicationRole.destroy({
      where: { user_id: resolvedUserIds, application_id: resolvedApplicationIds },
      transaction,
    });

    if (action === 'grant') {
      const rows = [];
      for (const userId of resolvedUserIds) {
        for (const applicationId of resolvedApplicationIds) {
          rows.push({
            user_id: userId,
            application_id: applicationId,
            role: normalizedRole,
            granted_at: grantedAt,
            granted_by: String(grantedBy || ''),
          });
        }
      }
      await models.UserApplicationRole.bulkCreate(rows, { transaction });
    }
  });

  return {
    status: 200,
    body: {
      action,
      role: action === 'grant' ? normalizedRole : null,
      userIds: resolvedUserIds.slice().sort((a, b) => a - b),
      applicationIds: resolvedApplicationIds.slice().sort((a, b) => a - b),
      changed: resolvedUserIds.length * resolvedApplicationIds.length,
    },
  };
}

/**
 * Promote or demote a portal super user.
 *
 * Refuses to remove the last one. Losing every super user would mean nobody can
 * reach this page to grant anything, and the fail-closed scoping means the queue
 * would be empty for everyone — a state no one could undo from inside the app.
 */
async function setUserSuperUser(models, { userId, isSuperUser }) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid user id', status: 400 };
  }
  if (typeof isSuperUser !== 'boolean') {
    return { error: 'isSuperUser must be a boolean', status: 400 };
  }

  const user = await models.User.findByPk(id, { raw: true });
  if (!user) {
    return { error: 'User not found', status: 404 };
  }

  const wasSuperUser = Number(user.is_super_user || 0) === 1;
  if (wasSuperUser === isSuperUser) {
    return { status: 200, body: { userId: id, isSuperUser } };
  }

  if (wasSuperUser && !isSuperUser) {
    const remaining = await models.User.count({ where: { is_super_user: 1 } });
    if (remaining <= 1) {
      return {
        error: 'This is the last portal super user. Promote someone else first.',
        status: 409,
      };
    }
  }

  await models.User.update({ is_super_user: isSuperUser ? 1 : 0 }, { where: { id } });

  return { status: 200, body: { userId: id, isSuperUser } };
}

/**
 * Map a directory group to an application.
 *
 * This says "people in this group work in this product" and nothing more — it
 * sets their default application, and confers no triage rights whatsoever. Read
 * by resolveMemberApplicationIds and resolveHomeApplicationId; deliberately NOT
 * read by resolveApplicationRoles.
 *
 * The stored role is fixed rather than accepted from the caller, so a mapping
 * cannot be created that looks like it grants something.
 */
async function addAdGroupMapping(models, { applicationId, groupName }) {
  if (!models?.ApplicationAdGroup) {
    return { error: 'Directory group mappings are not available', status: 500 };
  }

  const id = Number(applicationId);
  if (!isApplicationId(id)) {
    return { error: 'Select an application', status: 400 };
  }

  const name = String(groupName || '').trim();
  if (!name) {
    return { error: 'Enter a directory group name', status: 400 };
  }
  if (name.length > 255) {
    return { error: 'That group name is too long', status: 400 };
  }

  const activeIds = await loadActiveApplicationIds(models);
  if (!activeIds.has(id)) {
    return { error: 'Unknown or inactive application', status: 400 };
  }

  // The composite unique index would reject this anyway; catching it here turns
  // a 500 into a sentence the super user can act on.
  const existing = await models.ApplicationAdGroup.findOne({
    where: { application_id: id, group_name: name },
    raw: true,
  });
  if (existing) {
    return { error: 'That group is already mapped to this application', status: 409 };
  }

  const created = await models.ApplicationAdGroup.create({
    application_id: id,
    group_name: name,
    role: APPLICATION_ROLE_ADMIN,
    is_active: 1,
  });

  return {
    status: 201,
    body: { id: Number(created.id), applicationId: id, groupName: name },
  };
}

/**
 * Remove a directory-group mapping.
 *
 * A hard delete rather than deactivation: an unmapped group is the absence of a
 * default, not a state worth keeping history of, and leaving inactive rows
 * behind would make the list read as though the mapping still meant something.
 */
async function removeAdGroupMapping(models, { id }) {
  if (!models?.ApplicationAdGroup) {
    return { error: 'Directory group mappings are not available', status: 500 };
  }

  const mappingId = Number(id);
  if (!Number.isInteger(mappingId) || mappingId <= 0) {
    return { error: 'Invalid mapping id', status: 400 };
  }

  const removed = await models.ApplicationAdGroup.destroy({ where: { id: mappingId } });
  if (removed === 0) {
    return { error: 'Mapping not found', status: 404 };
  }

  return { status: 200, body: { id: mappingId } };
}

/**
 * Set (or with blanks, clear) an application's EasyVista catalog.
 *
 * Stored per application because the outgoing payload's repurposed field names
 * belong to one specific catalog. Clearing it does not break anything today —
 * it simply means a REAL send is refused for that application rather than
 * misrouted, and the walkthrough continues to work either way.
 */
async function setApplicationEasyVista(models, { applicationId, catalogGuid, catalogCode }) {
  const id = Number(applicationId);
  if (!isApplicationId(id)) {
    return { error: 'Invalid application id', status: 400 };
  }

  const application = await loadApplicationRowById(models.Application, id);
  if (!application) {
    return { error: 'Application not found', status: 404 };
  }

  const guid = String(catalogGuid ?? '').trim();
  const code = String(catalogCode ?? '').trim();
  if (guid.length > 200 || code.length > 200) {
    return { error: 'Catalog identifiers must be under 200 characters', status: 400 };
  }

  await models.Application.update(
    { easyvista_catalog_guid: guid || null, easyvista_catalog_code: code || null },
    { where: { id } },
  );

  const status = easyVistaCatalogStatus({ ...application, easyvista_catalog_guid: guid, easyvista_catalog_code: code });
  return {
    status: 200,
    body: {
      id,
      name: String(application.name),
      easyVista: { configured: status.configured, catalogGuid: guid, catalogCode: code },
    },
  };
}

module.exports = {
  listAccess,
  setApplicationEasyVista,
  setUserGrants,
  bulkSetAccess,
  setUserSuperUser,
  addAdGroupMapping,
  removeAdGroupMapping,
};
