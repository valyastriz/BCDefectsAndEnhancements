// Which request types an application will accept.
//
// One question, one place, because FOUR write paths ask it — the public submit
// route, the admin create, the admin update, and the Excel import's per-row insert
// — and a rule three of them enforce is not enforced. The same shape as
// `helpers/reportVisibility.js`, and for the same reason.
//
// THE RULE. A reporting analyst can create an application by typing a name in
// (`POST /api/admin/applications`), and what they create is **reports-only**:
// `applications.reports_only = 1`. Such an application takes report requests and
// nothing else.
//
// WHY IT IS REFUSED AT THE ENDPOINT AND NOT ONLY HIDDEN IN THE PICKER. An
// application is a queue with grants, and a reports-only one is granted to the
// people who work report requests. A DEFECT filed against it would sit in a queue
// with no defect admins — visible to nobody who could work it, which is exactly the
// failure `Other` was invented to avoid (see plan.md, the sixth pass). The submit
// form not offering it is a courtesy; this is the control.
//
// Every application that existed before the column is `reports_only = 0` and takes
// every type, including `Other`.
const dbApi = require('../../db');
const { SUBMISSION_TYPE_REPORT } = require('../constants');

/**
 * Is this application reports-only?
 *
 * Reads the column defensively for the same reason
 * `viewerService.listActiveApplications` does: it is a new column, and a database
 * that has not run `npm run migrate:reports-only-applications` must degrade to
 * "no application is reports-only" rather than refusing every write. That
 * degradation is what the portal did before the column existed.
 */
async function isReportsOnlyApplication(applicationId) {
  const id = Number(applicationId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const { Application } = dbApi.getModels() || {};
  if (!Application) return false;

  try {
    const row = await Application.findByPk(id, { attributes: ['id', 'reports_only'], raw: true });
    return Boolean(row?.reports_only);
  } catch {
    return false;
  }
}

/**
 * Refuse a type an application does not take.
 *
 * Returns `null` when the combination is allowed, or `{ error, status }` shaped like
 * every other refusal in the route layer, so a caller can hand it straight back.
 *
 * Only one combination is refused: a non-report type against a reports-only
 * application. A report request is welcome anywhere — `Other` and the two real
 * applications included — because "whose data is this" can legitimately be answered
 * with any of them.
 */
async function refuseTypeForApplication(applicationId, requestType, applicationName = '') {
  const type = String(requestType || '').trim().toLowerCase();
  if (type === SUBMISSION_TYPE_REPORT) return null;
  if (!(await isReportsOnlyApplication(applicationId))) return null;

  const named = String(applicationName || '').trim();
  return {
    status: 400,
    error: named
      ? `${named} takes report requests only. Choose the application the ${type || 'request'} actually happened in.`
      : `That application takes report requests only. Choose the application the ${type || 'request'} actually happened in.`,
  };
}

module.exports = { isReportsOnlyApplication, refuseTypeForApplication };
