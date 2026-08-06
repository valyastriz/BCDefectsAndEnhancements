// Who filed a ticket.
//
// Two answers, and which one applies is decided by the server alone:
//
//   signed in  — the reporter IS the session's user. Their name, email and
//                reporter_user_id come from the users row, and whatever the
//                request body claimed is discarded. That is the whole point: a
//                signed-in person must not be able to file as someone else, and
//                reporter_user_id is what later makes "my reports" answerable
//                without trusting the browser.
//
//   anonymous  — the typed name and email stand, exactly as before, and
//                reporter_user_id is null. The submit form has to keep working
//                for people with no session until SSO covers everyone.
//
// Mirrors the SSO seam in viewerService.resolveSessionIdentity: when the session
// starts being written by an identity provider instead of the local login, this
// binds real identities with no change here.

const BLANK_EMAIL = '-';
const SESSION_COOKIE = 'bc_sid';

/**
 * Did this request ARRIVE with a session cookie?
 *
 * `express-session` mints a fresh empty session when the id it is presented with
 * is not in the store, so `req.session` alone cannot tell "never signed in" from
 * "signed in, and the session is gone". The cookie the browser sent can.
 *
 * That distinction is the whole point. It was written for a deploy dropping every
 * session at once — sessions used to live in the default MemoryStore — and
 * sessions now persist (middleware/session.js), so that particular cause is gone.
 * The branch is not: a session still lapses at 8 hours, gets pruned, or is lost
 * outright on a local sql.js box where MemoryStore is still the store. An open tab
 * goes on showing "Filing as …" from the viewer answer it fetched before, and
 * reporting that as "Requester Name is required" names a field the form is not
 * even showing, which the person cannot act on.
 */
function arrivedWithASession(req) {
  return String(req?.headers?.cookie || '')
    .split(';')
    .some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

/**
 * Resolve the reporter for an incoming submission.
 *
 * Returns `{ reporterUserId, createdBy, createdByEmail, isBound }`, or
 * `{ error, status }` when the caller cannot be identified. `isBound` says the
 * identity came from the session rather than the request body.
 *
 * `requireAuthenticated` (config.SUBMIT_REQUIRES_AUTH) closes the anonymous path
 * entirely: with it on, an unsigned caller is a 401 and no typed name will do.
 * The check sits here rather than in the route so the rule and the identity it
 * guards cannot drift apart.
 */
async function resolveReporter(models, req, body = {}, {
  requireAuthenticated = false,
  authRequiredMessage = 'Sign in to submit a report',
} = {}) {
  const sessionUserId = Number(req?.session?.user?.id) || null;

  if (sessionUserId && models?.User) {
    const user = await models.User.findByPk(sessionUserId, { raw: true });
    // A session pointing at a deleted user falls through to the anonymous path
    // rather than binding a reporter id that no longer resolves to anyone.
    if (user) {
      return {
        reporterUserId: Number(user.id),
        // Falls back to the username so a ticket always shows a person.
        createdBy: String(user.display_name || user.username || '').trim(),
        createdByEmail: String(user.email || '').trim() || BLANK_EMAIL,
        isBound: true,
      };
    }
  }

  // Nothing below this line can produce an identity, only a typed claim — so if
  // one is required, refuse here rather than accepting the claim.
  if (requireAuthenticated) {
    return { error: authRequiredMessage, status: 401, authRequired: true };
  }

  const typedName = String(body.created_by || '').trim();
  if (!typedName) {
    // A stale tab, not a missing field. Answered as 401 with `sessionExpired` so
    // the form can say what happened and keep what was typed, rather than
    // demanding a name it deliberately stopped asking for.
    if (arrivedWithASession(req)) {
      return {
        error: 'Your session has expired. Sign in again and send this once more.',
        status: 401,
        sessionExpired: true,
      };
    }
    return { error: 'Requester Name is required', status: 400 };
  }

  return {
    reporterUserId: null,
    createdBy: typedName,
    createdByEmail: String(body.created_by_email || '').trim() || BLANK_EMAIL,
    isBound: false,
  };
}

module.exports = { resolveReporter };
