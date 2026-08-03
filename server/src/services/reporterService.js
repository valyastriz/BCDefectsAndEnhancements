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

/**
 * Resolve the reporter for an incoming submission.
 *
 * Returns `{ reporterUserId, createdBy, createdByEmail, isBound }` or
 * `{ error }` when an anonymous caller supplied no name. `isBound` says the
 * identity came from the session rather than the request body.
 */
async function resolveReporter(models, req, body = {}) {
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

  const typedName = String(body.created_by || '').trim();
  if (!typedName) {
    return { error: 'Requester Name is required' };
  }

  return {
    reporterUserId: null,
    createdBy: typedName,
    createdByEmail: String(body.created_by_email || '').trim() || BLANK_EMAIL,
    isBound: false,
  };
}

module.exports = { resolveReporter };
