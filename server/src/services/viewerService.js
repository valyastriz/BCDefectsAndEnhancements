// The single answer to "who is this caller, and what may they see?".
//
// Every surface — the status board's My-reports scope and application prefilter,
// the submit form's locked reporter, the admin queue's scoping, the Access page —
// reads this one envelope via GET /api/viewer. Nothing else reads the session to
// decide what a caller may do. That is what makes switching to SSO a change in
// `resolveSessionIdentity` below and nowhere else.
const { QueryTypes } = require('sequelize');
const { AUTH_MODE, SUBMIT_REQUIRES_AUTH } = require('../config');
const {
  APPLICATION_ROLE_ADMIN,
  APPLICATION_ROLE_VIEWER,
  APPLICATION_ROLE_MANAGER,
  applicationRoleRank,
  applicationRoleAtLeast,
} = require('../constants');

// The stored marker for "this grant covers every request type". Empty string
// rather than NULL so it can sit inside the composite unique index — see the
// column's comment in db/models/index.js.
const ALL_TYPES = '';

/** A request type as the grant table stores it. Unknown shapes become ALL_TYPES. */
const normalizeGrantType = (value) => String(value ?? '').trim().toLowerCase();

// A real application id is a positive integer. Anything else — a stray null that
// Number() would quietly turn into 0, a name that became NaN — is not an id and
// must never be matched against one.
const isApplicationId = (value) => Number.isInteger(value) && value > 0;

/**
 * Who the session says this caller is.
 *
 * THIS is the SSO seam. Today it reads the session that the local username and
 * password login writes (routes/authRoutes.js). Under SSO it will read the
 * identity the provider asserted — including `groups`, which is already honoured
 * everywhere below, so group-driven home applications and admin rights start
 * working the moment the assertion carries them.
 */
function resolveSessionIdentity(req) {
  const sessionUser = req.session?.user || null;
  if (!sessionUser) return null;

  return {
    id: Number(sessionUser.id) || null,
    username: String(sessionUser.username || ''),
    role: String(sessionUser.role || ''),
    // Populated by SSO; absent under the local login. Never trusted from a
    // request body — only from the session the server itself wrote.
    groups: Array.isArray(sessionUser.groups) ? sessionUser.groups.filter(Boolean) : [],
  };
}

/**
 * Active applications, in the order the pickers should show them.
 */
async function listActiveApplications(models) {
  // Named, not implicit. Sequelize otherwise selects every column the MODEL
  // declares, so adding a column to `applications` broke this query against any
  // database that had not been migrated yet — and this one runs inside
  // `attachViewer`, which guards most of the admin API. Ask for what is used.
  //
  // `reports_only` is asked for SEPARATELY, with a fallback, for exactly that
  // reason: it is a new column, this query is load-bearing for most of the admin
  // API, and a database that has not run `npm run migrate:reports-only-applications`
  // yet must degrade to "no application is reports-only" rather than 500. That is
  // the correct degradation — it offers every application everywhere, which is what
  // the portal did before the column existed.
  const base = ['id', 'name', 'sort_order'];
  let rows;
  try {
    rows = await models.Application.findAll({
      where: { is_active: 1 },
      attributes: [...base, 'reports_only'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
  } catch {
    rows = await models.Application.findAll({
      where: { is_active: 1 },
      attributes: base,
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
  }
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    reportsOnly: Boolean(row.reports_only),
  }));
}

/**
 * The application this person most likely wants preselected, in priority order:
 *
 *   1. a mapped Active Directory group they belong to
 *   2. the application they have filed the most tickets against
 *   3. the portal's default (first active application)
 *
 * Always a PREFILL and never a lock — both the submit form and the board let the
 * user pick another. Returns null only when no active application exists at all.
 */
async function resolveHomeApplicationId(models, sequelize, { userId, groups }) {
  if (Array.isArray(groups) && groups.length > 0) {
    const mapped = await models.ApplicationAdGroup.findOne({
      where: { group_name: groups, is_active: 1 },
      order: [['id', 'ASC']],
      raw: true,
    });
    if (mapped) return Number(mapped.application_id);
  }

  if (userId) {
    // Raw so the aggregate ordering is identical on SQLite and Postgres. The
    // application_id tiebreak keeps the answer stable when two applications are
    // level, so the prefill does not flip between page loads.
    const rows = await sequelize.query(
      `SELECT application_id, COUNT(*) AS n
         FROM submissions
        WHERE reporter_user_id = :userId
          AND application_id IS NOT NULL
        GROUP BY application_id
        ORDER BY n DESC, application_id ASC
        LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    if (rows.length > 0 && rows[0].application_id != null) {
      return Number(rows[0].application_id);
    }
  }

  // The portal's default, and it must NOT be a reports-only application. This is a
  // prefill for the whole form, including the defect and enhancement branches, and
  // a reports-only queue has no defect admins in it — landing somebody there by
  // default would file their bug report where nobody who could work it can see it.
  const applications = (await listActiveApplications(models))
    .filter((application) => !application.reportsOnly);
  return applications.length > 0 ? applications[0].id : null;
}

/**
 * What this caller may do in each application's queue.
 *
 * Returns a plain object keyed by application id — `{ 7: 'admin', 9: 'viewer' }`
 * — and an application absent from it confers nothing at all. A grant is a row;
 * no row is no access.
 *
 * QUEUE RIGHTS COME FROM user_application_roles AND NOWHERE ELSE. Active
 * Directory does not appear here on purpose: an AD group says which applications
 * a person WORKS IN (see resolveMemberApplicationIds), not what they may triage.
 * Triage is granted deliberately, by a super user, one application at a time —
 * so nobody acquires the ability to change other teams' tickets by being added
 * to a distribution group.
 *
 * A role the catalog does not recognise is ignored rather than honoured, and
 * where two rows disagree the stronger one wins.
 */
async function resolveApplicationRoles(models, { userId, isSuperUser, applications }) {
  // `roles` is the STRONGEST role held in each application across every type —
  // the answer to "may this person work in this queue at all". `typeRoles` is the
  // per-type detail, keyed application → request type, and it is what a write on
  // a specific ticket has to consult.
  const roles = {};
  const typeRoles = {};

  if (isSuperUser) {
    for (const application of applications) {
      roles[application.id] = APPLICATION_ROLE_MANAGER;
      typeRoles[application.id] = { [ALL_TYPES]: APPLICATION_ROLE_MANAGER };
    }
    return { roles, typeRoles };
  }

  if (!userId) return { roles, typeRoles };

  const rows = await models.UserApplicationRole.findAll({
    where: { user_id: userId },
    raw: true,
  });

  for (const row of rows) {
    const applicationId = Number(row.application_id);
    if (!isApplicationId(applicationId)) continue;

    const role = String(row.role || '').trim().toLowerCase();
    if (applicationRoleRank(role) < 0) continue;

    // A grant row that names no type covers every type. Anything unrecognised
    // in the column is read as a type name, not as a wildcard — an unknown value
    // must narrow access, never widen it.
    const grantType = normalizeGrantType(row.request_type);

    const held = roles[applicationId];
    if (!held || applicationRoleAtLeast(role, held)) roles[applicationId] = role;

    const perType = typeRoles[applicationId] || (typeRoles[applicationId] = {});
    const heldForType = perType[grantType];
    if (!heldForType || applicationRoleAtLeast(role, heldForType)) perType[grantType] = role;
  }

  return { roles, typeRoles };
}

/**
 * Which applications this person WORKS IN, from their Active Directory groups.
 *
 * This is the one thing AD drives today: it answers "which product is this
 * person's day job", which prefills the submit form and scopes their own board.
 * It grants no queue rights whatsoever — resolveApplicationRoles is the only
 * source of those.
 *
 * Empty under the local login, because the session carries no groups until SSO
 * populates them.
 */
async function resolveMemberApplicationIds(models, { groups }) {
  if (!Array.isArray(groups) || groups.length === 0) return [];
  if (!models?.ApplicationAdGroup) return [];

  const mapped = await models.ApplicationAdGroup.findAll({
    where: { group_name: groups, is_active: 1 },
    raw: true,
  });

  const ids = new Set();
  for (const row of mapped) {
    const applicationId = Number(row.application_id);
    if (isApplicationId(applicationId)) ids.add(applicationId);
  }

  return [...ids].sort((left, right) => left - right);
}

/** The applications where `roles` confers at least `minimum`, ascending. */
function applicationIdsWithRole(roles, minimum) {
  return Object.entries(roles || {})
    .filter(([, role]) => applicationRoleAtLeast(role, minimum))
    .map(([applicationId]) => Number(applicationId))
    .sort((left, right) => left - right);
}

/**
 * Build the application constraint for an admin query.
 *
 * Fail-closed by construction: a caller with no grants yields
 * `{ application_id: [] }`, which Sequelize renders as `IN (NULL)` and matches
 * nothing. There is no code path where "no roles" silently becomes "no filter".
 * A super user yields `{}` — the only bypass, and it is one line to audit.
 */
function buildApplicationScopeWhere(viewer) {
  if (viewer?.isSuperUser) return {};
  // Scoped off what the caller may SEE, which viewer and admin both do. Writes
  // are gated separately by canMutateApplication.
  return { application_id: Array.isArray(viewer?.readableApplicationIds) ? viewer.readableApplicationIds : [] };
}

/**
 * The rows an admin query may return.
 *
 * Wider than write access on purpose. A ticket that has been redirected away no
 * longer carries the old application_id, but the team that handled it first
 * still needs to see where it went — so those tickets are collected by id from
 * the routing ledger and added to the scope.
 *
 * Fail-closed on the same terms as buildApplicationScopeWhere: no grants yields
 * a scope that admits nothing. `unrestricted` is set for a super user only, and
 * it is the single flag to audit.
 */
async function resolveAdminReadScope(models, viewer) {
  const empty = { unrestricted: false, applicationIds: [], submissionIds: new Set() };

  if (viewer?.isSuperUser) return { ...empty, unrestricted: true };
  if (!viewer?.isAuthenticated) return empty;

  // Viewer counts here: a read-only seat is a seat. Whether the caller may
  // CHANGE any of these rows is a separate question (canMutateApplication).
  const applicationIds = (Array.isArray(viewer.readableApplicationIds) ? viewer.readableApplicationIds : [])
    .map(Number)
    .filter(isApplicationId);
  if (applicationIds.length === 0) return empty;

  // A missing ledger means no hand-off history to widen by — never a wider scope.
  if (!models?.SubmissionRouting) return { ...empty, applicationIds };

  const handedOn = await models.SubmissionRouting.findAll({
    where: { from_application_id: applicationIds },
    attributes: ['submission_id'],
    raw: true,
  });

  return {
    unrestricted: false,
    applicationIds,
    submissionIds: new Set(handedOn.map((row) => Number(row.submission_id))),
  };
}

/**
 * True when `scope` admits this row.
 *
 * Everything unrecognised is refused: no scope at all (a caller that forgot to
 * resolve one), or a legacy ticket with no application — which therefore stays
 * visible to super users only, rather than to everyone.
 */
function canReadSubmissionRow(scope, row) {
  if (!scope) return false;
  if (scope.unrestricted) return true;
  const applicationId = Number(row?.application_id);
  if (isApplicationId(applicationId) && scope.applicationIds.includes(applicationId)) return true;
  // The soft association. A ticket in `Other` that an analyst chose to work shows
  // up in the queue they picked as well as in `Other` — that is the whole feature.
  //
  // READ ONLY, and deliberately not mirrored in `canMutateApplication`: this is a
  // second answer to "whose queue does this appear in", never a second answer to
  // "who may change it". Writing still follows `application_id` alone, so the
  // widening cannot hand anybody edit rights they were not granted, and the
  // analyst who set it holds `Other` already.
  const workingApplicationId = Number(row?.working_application_id);
  if (isApplicationId(workingApplicationId) && scope.applicationIds.includes(workingApplicationId)) {
    return true;
  }
  return scope.submissionIds.has(Number(row?.id));
}

/**
 * The role this caller holds in one application, or '' for none.
 *
 * The single lookup every capability question goes through, so an unknown
 * application, an unauthenticated caller and a malformed envelope all answer the
 * same way: nothing.
 *
 * **Pass `requestType` whenever the question is about a specific ticket.** A
 * grant can be narrowed to one request type — that is what an analyst is
 * (plan.md §4 open question 4) — and omitting the type asks the weaker question
 * "may they work in this queue at all", which is right for a queue-level check
 * and WRONG for a write. An analyst scoped to report requests must not be able
 * to edit a defect, and the only thing standing between them and one is this
 * argument being supplied at the call site.
 */
function roleInApplication(viewer, applicationId, requestType = undefined) {
  if (!viewer?.isAuthenticated) return '';
  if (viewer.isSuperUser) return APPLICATION_ROLE_MANAGER;
  const id = Number(applicationId);
  if (!isApplicationId(id)) return '';

  // No type asked for: the strongest role held anywhere in this application.
  if (requestType === undefined || requestType === null) {
    const role = viewer.applicationRoles?.[id];
    return applicationRoleRank(role) >= 0 ? role : '';
  }

  // A specific type: an all-types grant, or one naming this type. Nothing else.
  const perType = viewer.applicationTypeRoles?.[id];
  if (!perType) {
    // An envelope from before type scoping existed. Falling back to the
    // unscoped map would honour it; refusing would lock out every admin on a
    // stale session. The unscoped map is the pre-existing behaviour and the
    // narrower risk, because a portal with no type-scoped grants behaves
    // identically either way.
    const role = viewer.applicationRoles?.[id];
    return applicationRoleRank(role) >= 0 ? role : '';
  }

  const wanted = normalizeGrantType(requestType);
  const candidates = [perType[ALL_TYPES], perType[wanted]].filter(
    (role) => applicationRoleRank(role) >= 0,
  );
  if (candidates.length === 0) return '';
  return candidates.reduce((best, role) => (applicationRoleAtLeast(role, best) ? role : best));
}

/**
 * True when this caller may READ the given application's queue.
 *
 * Satisfied by viewer as well as admin — the read-only seat exists precisely so
 * someone can follow a queue without being able to touch it.
 */
function canReadApplication(viewer, applicationId, requestType = undefined) {
  return applicationRoleAtLeast(
    roleInApplication(viewer, applicationId, requestType),
    APPLICATION_ROLE_VIEWER,
  );
}

/**
 * True when this caller may change the given ticket.
 *
 * Two narrowings, both deliberate. Only an ADMIN of the application may write —
 * a viewer reads and nothing more. And read access extends to PAST owners (a
 * team that handed a ticket on can still see it — see submission_routings) while
 * write access does not, so this asks only about the ticket's CURRENT
 * application.
 */
function canMutateApplication(viewer, applicationId, requestType = undefined) {
  return applicationRoleAtLeast(
    roleInApplication(viewer, applicationId, requestType),
    APPLICATION_ROLE_ADMIN,
  );
}

/**
 * True when this caller may see OTHER PEOPLE's numbers for this application.
 *
 * The one thing the manager rank buys. Everyone who works report requests can
 * see their own throughput; only a manager (or a super user) sees the team's,
 * because the page names individuals and counts their output.
 *
 * Deliberately not type-scoped: managing a team is not managing a request type,
 * and a manager grant narrowed to one type would still be reading the same
 * people's names.
 */
function canManageApplication(viewer, applicationId) {
  return applicationRoleAtLeast(roleInApplication(viewer, applicationId), APPLICATION_ROLE_MANAGER);
}

/**
 * The full viewer envelope. Safe to call for an anonymous caller: it returns the
 * unauthenticated shape rather than throwing, because the status board must work
 * for someone with no session until SSO covers every page.
 */
async function resolveViewer(req, { models, sequelize }) {
  const applications = await listActiveApplications(models);
  const identity = resolveSessionIdentity(req);

  // One shape for every "this caller has no rights" answer, so a new field can
  // never be added to one branch and forgotten in the other.
  const anonymousEnvelope = () => ({
    isAuthenticated: false,
    source: AUTH_MODE === 'sso' ? 'sso' : 'local',
    // Advisory only — the server refuses an unsigned submission regardless. This
    // is what lets the submit page show a sign-in prompt instead of a form that
    // would 401 on the last click.
    submitRequiresAuth: SUBMIT_REQUIRES_AUTH,
    // A report request always needs one, whatever the line above says: it is only
    // ever visible to the person who filed it, so an anonymous one would belong
    // to nobody. Advisory, like the flag above — submissionRoutes enforces it.
    reportRequiresAuth: true,
    impersonating: false,
    user: null,
    isSuperUser: false,
    applicationRoles: {},
    applicationTypeRoles: {},
    adminApplicationIds: [],
    readableApplicationIds: [],
    managerApplicationIds: [],
    memberApplicationIds: [],
    canAdminAnyApplication: false,
    canManageAnyApplication: false,
    // An anonymous viewer still gets a sensible prefill so the board is not
    // unscoped on first load.
    homeApplicationId: applications.length > 0 ? applications[0].id : null,
    applications,
  });

  if (!identity || !identity.id) return anonymousEnvelope();

  // Re-read the user row rather than trusting the session copy: super-user and
  // role changes must take effect without forcing everyone to log out.
  const user = await models.User.findByPk(identity.id, { raw: true });
  if (!user) {
    // Session points at a user that no longer exists. Fail closed.
    return anonymousEnvelope();
  }

  const isSuperUser = Number(user.is_super_user || 0) === 1;
  const { roles: applicationRoles, typeRoles: applicationTypeRoles } = await resolveApplicationRoles(
    models,
    { userId: Number(user.id), isSuperUser, applications },
  );
  const adminApplicationIds = applicationIdsWithRole(applicationRoles, APPLICATION_ROLE_ADMIN);
  const readableApplicationIds = applicationIdsWithRole(applicationRoles, APPLICATION_ROLE_VIEWER);
  const managerApplicationIds = applicationIdsWithRole(applicationRoles, APPLICATION_ROLE_MANAGER);
  // Which products this person works in, per Active Directory. Not a grant.
  const memberApplicationIds = await resolveMemberApplicationIds(models, { groups: identity.groups });
  const homeApplicationId = await resolveHomeApplicationId(models, sequelize, {
    userId: Number(user.id),
    groups: identity.groups,
  });

  return {
    isAuthenticated: true,
    source: AUTH_MODE === 'sso' ? 'sso' : 'local',
    submitRequiresAuth: SUBMIT_REQUIRES_AUTH,
    // A report request always needs one, whatever the line above says: it is only
    // ever visible to the person who filed it, so an anonymous one would belong
    // to nobody. Advisory, like the flag above — submissionRoutes enforces it.
    reportRequiresAuth: true,
    impersonating: Boolean(req.session?.impersonating),
    user: {
      id: Number(user.id),
      username: String(user.username),
      // Falls back to the username so the UI always has something to show.
      displayName: String(user.display_name || user.username),
      email: String(user.email || ''),
      role: String(user.role || ''),
    },
    isSuperUser,
    applicationRoles,
    applicationTypeRoles,
    adminApplicationIds,
    readableApplicationIds,
    managerApplicationIds,
    memberApplicationIds,
    canAdminAnyApplication: isSuperUser || adminApplicationIds.length > 0,
    canManageAnyApplication: isSuperUser || managerApplicationIds.length > 0,
    homeApplicationId,
    applications,
  };
}

module.exports = {
  resolveViewer,
  resolveSessionIdentity,
  resolveHomeApplicationId,
  resolveApplicationRoles,
  resolveMemberApplicationIds,
  applicationIdsWithRole,
  buildApplicationScopeWhere,
  resolveAdminReadScope,
  canReadSubmissionRow,
  roleInApplication,
  canReadApplication,
  canMutateApplication,
  canManageApplication,
  listActiveApplications,
};
