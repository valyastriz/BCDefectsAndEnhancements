// A reporting analyst creating an application by typing a name in.
//
// WHY THIS EXISTS. Analysts do reporting work for systems the portal does not
// otherwise track. Before this, every one of those collapsed into `Other`, so the
// analyst's own record lost **which system the data came from** — the one thing the
// application field on a report request is for. `Other` went back to meaning what it
// was built to mean: "I do not know yet", rather than "not in the list".
//
// WHY IT IS A DEDICATED ROUTE AND NOT A RELAXED METADATA GUARD. The fifteenth pass
// moved every `/api/admin/meta` write behind `ensureSuperUser`, because editing a
// lookup renames or withdraws a value on **every ticket that holds it**, across every
// application, and it is not scoped by the per-application grants the rest of the
// admin side runs on. `test/metaRouteGuards.test.js` sweeps that router's stack so a
// route added later without the guard fails too.
//
// Creating is a different act from renaming: **it touches no existing ticket.** So
// this is its own door with its own rule — CREATE only, reports-only only — rather
// than a hole in a guard that a test deliberately polices. Renaming or retiring an
// application is still a super user's job.
//
// WHAT IT MUST DO BESIDES INSERT A ROW. An application is a **queue with grants**,
// not a label. A new one with no grants is visible to nobody but a super user, which
// is the failure `Other` was invented to avoid — so creating one also grants it, to
// everybody who works report requests anywhere, derived from the grants that exist.
// Same derivation as `scripts/seedOtherApplication.js`.
const dbApi = require('../../db');
const { SUBMISSION_TYPE_REPORT, APPLICATION_ROLE_VIEWER } = require('../constants');

const NAME_MAX_LENGTH = 60;
const GRANTED_BY = 'analyst:new-report-application';

/**
 * May this caller create one? Holding a report grant anywhere is the bar.
 *
 * Read from `applicationTypeRoles` — the viewer envelope's per-type detail, keyed
 * application → request type — and NOT from `applicationRoles`, which collapses to
 * the strongest role held across every type and so cannot tell an analyst apart from
 * a defect admin. `''` is an all-types grant, which covers report requests; a viewer
 * seat reads a queue and creates nothing.
 */
function canCreateReportApplication(viewer) {
  if (!viewer) return false;
  if (viewer.isSuperUser) return true;
  const byApplication = viewer.applicationTypeRoles || {};
  return Object.values(byApplication).some((perType) => (
    Object.entries(perType || {}).some(([type, role]) => {
      const normalizedType = String(type || '').trim().toLowerCase();
      if (String(role || '').trim().toLowerCase() === APPLICATION_ROLE_VIEWER) return false;
      return normalizedType === '' || normalizedType === SUBMISSION_TYPE_REPORT;
    })
  ));
}

/**
 * Everybody who works report requests anywhere, with the strongest role they hold.
 *
 * Derived rather than listed, so it stays right as people come and go. A viewer seat
 * is skipped: it reads a queue and cannot work it.
 */
async function resolveReportWorkers(models) {
  const grants = await models.UserApplicationRole.findAll({
    attributes: ['user_id', 'role', 'request_type'],
    raw: true,
  });
  const workers = new Map();
  for (const grant of grants) {
    const type = String(grant.request_type || '').trim().toLowerCase();
    if (type !== '' && type !== SUBMISSION_TYPE_REPORT) continue;
    const role = String(grant.role || 'admin').trim().toLowerCase();
    if (role === APPLICATION_ROLE_VIEWER) continue;
    const userId = Number(grant.user_id);
    const held = workers.get(userId);
    workers.set(userId, held === 'manager' ? held : role);
  }
  return workers;
}

/**
 * Create a reports-only application, and grant it.
 *
 * Returns `{ status, body }` or `{ error, status }`, the same shape every other
 * service in this layer returns, so a route can hand it straight back.
 *
 * The row and its grants go in ONE transaction. A half-applied create would leave an
 * application nobody can see — indistinguishable, from the outside, from a queue
 * whose tickets have gone missing.
 */
async function createReportApplication({ name, viewer, username }) {
  const models = dbApi.getModels() || {};
  const { Application, UserApplicationRole } = models;
  if (!Application || !UserApplicationRole) {
    return { error: 'Required models are not available', status: 500 };
  }

  if (!canCreateReportApplication(viewer)) {
    return { error: 'Only somebody who works report requests can add an application', status: 403 };
  }

  const trimmed = String(name || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return { error: 'Give the application a name', status: 400 };
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    return { error: `Keep the name under ${NAME_MAX_LENGTH} characters`, status: 400 };
  }

  // Case-insensitively unique, and against EVERY application including the inactive
  // ones — a lookup value is deactivated rather than deleted, so a name can be taken
  // by a row nobody can currently see. Colliding would either fail on the unique
  // index or create a second queue with the same name on screen.
  const existing = (await Application.findAll({ attributes: ['id', 'name', 'is_active'], raw: true }))
    .find((row) => String(row.name || '').trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    return {
      error: Number(existing.is_active) === 1
        ? `${existing.name} is already in the list`
        : `${existing.name} exists but is switched off. A super user can switch it back on.`,
      status: 409,
    };
  }

  const highest = await Application.max('sort_order');
  const sortOrder = Number.isFinite(Number(highest)) ? Number(highest) + 1 : 1;
  const workers = await resolveReportWorkers(models);
  const grantedAt = new Date().toISOString();

  let created;
  await Application.sequelize.transaction(async (transaction) => {
    created = await Application.create({
      name: trimmed,
      sort_order: sortOrder,
      is_active: 1,
      reports_only: 1,
    }, { transaction });

    for (const [userId, role] of workers) {
      await UserApplicationRole.create({
        user_id: userId,
        application_id: Number(created.id),
        role,
        // Narrowed to `report`, because that is the only thing this application
        // takes. A wider grant here would be a claim the queue cannot honour.
        request_type: SUBMISSION_TYPE_REPORT,
        granted_at: grantedAt,
        granted_by: `${GRANTED_BY}:${String(username || 'unknown')}`,
      }, { transaction });
    }
  });

  return {
    status: 201,
    body: {
      id: Number(created.id),
      name: trimmed,
      reportsOnly: true,
      grantedTo: workers.size,
    },
  };
}

module.exports = {
  createReportApplication,
  canCreateReportApplication,
  resolveReportWorkers,
  NAME_MAX_LENGTH,
};
