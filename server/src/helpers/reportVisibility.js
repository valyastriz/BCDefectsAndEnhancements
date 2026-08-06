// Who may see a report request.
//
// Defects and enhancements are everybody's business — that is what a public
// status board is for, and it is how a second person finds out their problem is
// already reported. A REPORT REQUEST IS NOT. It names an internal dataset, a
// department, and often the thing somebody is trying to measure, so the rule is:
// only the person who filed it.
//
// The rule lives here because it is enforced in four places that are easy to
// change independently — the board list, the board's by-id route, the public
// semantic search, and the live socket broadcast. Three of them agreeing and one
// not is exactly the shape of a leak, so they all call this.
//
// `is_public` is a separate, earlier question. This narrows that answer; it never
// widens it.

const { SUBMISSION_TYPE_REPORT } = require('../constants');

/**
 * The type name, under either spelling this codebase hydrates it as.
 *
 * `hydrateRowFromMaps` (the list path) writes `type`. `getSubmissionByIdWithLookups`
 * (the by-id path) writes `model_type_name` and leaves `type` undefined. Reading
 * only `type` is not a near miss — it silently answers "not a report request" for
 * every row that came through the by-id path, which is how the board's detail
 * route went on serving other people's report requests after the list stopped.
 * Found by a browser check, not by reading this file.
 */
function typeNameOf(row) {
  return String(row?.type ?? row?.model_type_name ?? '').trim().toLowerCase();
}

/**
 * A row is a report request only if it SAYS it is.
 *
 * An untyped row is therefore public, which looks like the unsafe direction and
 * is not: report requests have carried a type since the day the type existed, so
 * a row without one predates them and is an old defect or enhancement. Treating
 * those as report requests would hide tickets that have been on the board for
 * months, to protect rows that cannot exist.
 */
function isReportRequest(row) {
  return typeNameOf(row) === SUBMISSION_TYPE_REPORT;
}

/**
 * May `viewerUserId` (null for anonymous) see this row on a public surface?
 *
 * Anonymous callers match nobody, so an ownerless report request is visible to
 * no one. New ones cannot be filed anonymously (submissionRoutes refuses them);
 * rows filed before that rule can be, and those stay hidden rather than public.
 */
function maySeeReportRequest(row, viewerUserId) {
  if (!isReportRequest(row)) return true;
  const viewer = Number(viewerUserId) || null;
  return Boolean(viewer) && Number(row?.reporter_user_id) === viewer;
}

/** A predicate bound to one request, for filtering a list. */
function boardVisibilityFor(req) {
  const viewerUserId = Number(req?.session?.user?.id) || null;
  return (row) => maySeeReportRequest(row, viewerUserId);
}

/**
 * Who a live update about this row may be sent to.
 *
 * `{}` is the whole board. `{ onlyReporterUserId }` is one person. `{ nobody }`
 * is nobody — which is NOT the same as `{}`, and conflating the two is how a
 * private row would go out to every watcher.
 */
function boardAudienceFor(row) {
  if (!isReportRequest(row)) return {};
  const reporterUserId = Number(row?.reporter_user_id) || null;
  return reporterUserId ? { onlyReporterUserId: reporterUserId } : { nobody: true };
}

module.exports = {
  isReportRequest,
  maySeeReportRequest,
  boardVisibilityFor,
  boardAudienceFor,
};
