// Everything an analyst records against a report request, and the numbers read
// back out of it.
//
// Three facts live here, and the shape of each one is the design:
//
//   1. HOURS are a child table, never a column. They accumulate across sittings
//      and across people, so a single `duration` number would be overwritten by
//      whoever saved last and "who actually did the work" would be unanswerable.
//      `Duration` on a request is SUM(hours), computed on read.
//   2. ASSIGNMENT keeps a history. `submissions.assigned_to` is the current
//      holder — cheap to index for "my queue" — and `request_assignments` is the
//      audit trail. It cannot be reconstructed after the fact, which is why it
//      ships with the feature.
//   3. THROUGHPUT counts two different things and refuses to conflate them.
//      "Worked on" is the delivered requests somebody logged hours against;
//      "closed" is the ones they happened to hold at the finish. With
//      reassignment those are rarely the same list, and only the first survives
//      a hand-over.
const { QueryTypes } = require('sequelize');
const dbApi = require('../../db');

// A day, as the columns store it. `worked_on` and `completed_at` are ISO text
// (this database keeps timestamps as TEXT — see plan.md on why that is not being
// changed), so a window is a string comparison and the bounds have to be exact.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The YYYY-MM-DD of an ISO string, or '' when it is not a date at all. */
function dayOf(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const head = text.slice(0, 10);
  return DAY.test(head) ? head : '';
}

/** Hours as a number the JSON contract can carry. Postgres returns DECIMAL as text. */
function toHours(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

/**
 * An hours figure the database will accept.
 *
 * Refuses anything that is not a positive number of at most 24 hours in a day —
 * a typo of 80 for 8 would quietly become somebody's throughput. Quarter-hour
 * granularity matches the form's step; anything finer is rounded rather than
 * rejected, because refusing 1.333 would be pedantry.
 */
function normalizeHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { error: 'Enter the hours as a number' };
  const rounded = Math.round(parsed * 100) / 100;
  if (rounded <= 0) return { error: 'Hours must be more than zero' };
  if (rounded > 24) return { error: 'That is more than a day — log it against the days it was worked' };
  return { hours: rounded };
}

// ── Hours ────────────────────────────────────────────────────────────────────

async function listTimeEntries(submissionId) {
  const models = dbApi.getModels() || {};
  if (!models.RequestTimeEntry) return [];

  const rows = await models.RequestTimeEntry.findAll({
    where: { submission_id: Number(submissionId) },
    raw: true,
  });
  if (rows.length === 0) return [];

  // One query for the names rather than one per row.
  const userIds = [...new Set(rows.map((row) => Number(row.user_id)).filter(Boolean))];
  const users = userIds.length > 0
    ? await models.User.findAll({
      where: { id: userIds },
      attributes: ['id', 'display_name', 'username'],
      raw: true,
    })
    : [];
  const nameById = new Map(users.map((user) => [
    Number(user.id),
    String(user.display_name || user.username || ''),
  ]));

  return rows
    .map((row) => ({
      id: Number(row.id),
      submission_id: Number(row.submission_id),
      user_id: Number(row.user_id),
      // A deleted user leaves their hours behind — the work happened. The row
      // says so rather than dropping out of the total.
      user_name: nameById.get(Number(row.user_id)) || 'Someone who has left',
      hours: toHours(row.hours),
      worked_on: dayOf(row.worked_on),
      note: row.note || '',
      created_at: row.created_at,
    }))
    // Newest day first, the way the status trail reads. Ties break on the id so
    // two entries for the same day keep a stable order.
    .sort((left, right) => (
      left.worked_on === right.worked_on
        ? right.id - left.id
        : (left.worked_on < right.worked_on ? 1 : -1)
    ));
}

/** SUM(hours) and the per-person split — the two derived numbers, in one place. */
function summarizeTimeEntries(entries) {
  const byUser = new Map();
  let total = 0;
  for (const entry of entries) {
    total += entry.hours;
    const held = byUser.get(entry.user_id) || { user_id: entry.user_id, user_name: entry.user_name, hours: 0 };
    held.hours = Math.round((held.hours + entry.hours) * 100) / 100;
    byUser.set(entry.user_id, held);
  }
  return {
    total_hours: Math.round(total * 100) / 100,
    by_user: [...byUser.values()].sort((left, right) => right.hours - left.hours),
  };
}

async function addTimeEntry(submissionId, { userId, hours, workedOn, note }) {
  const models = dbApi.getModels() || {};
  if (!models.RequestTimeEntry) return { error: 'Time entries are not available', status: 500 };

  const amount = normalizeHours(hours);
  if (amount.error) return { error: amount.error, status: 400 };

  const day = dayOf(workedOn);
  if (!day) return { error: 'Pick the day the work was done', status: 400 };
  // A day in the future is a typo, not a plan. Compared as strings, which is
  // exact for YYYY-MM-DD and needs no timezone reasoning.
  if (day > dayOf(new Date().toISOString())) {
    return { error: 'That day has not happened yet', status: 400 };
  }

  const created = await models.RequestTimeEntry.create({
    submission_id: Number(submissionId),
    // Whose hours these are is the SESSION's answer, never the payload's.
    // Accepting a user id from the body would let anyone log time against
    // anybody, and this is the number a throughput page reports on.
    user_id: Number(userId),
    hours: amount.hours,
    worked_on: day,
    note: String(note || '').trim().slice(0, 500) || null,
    created_at: new Date().toISOString(),
  });

  return { entry: Number(created.id) };
}

async function deleteTimeEntry(entryId, { userId, isSuperUser }) {
  const models = dbApi.getModels() || {};
  if (!models.RequestTimeEntry) return { error: 'Time entries are not available', status: 500 };

  const row = await models.RequestTimeEntry.findByPk(Number(entryId), { raw: true });
  if (!row) return { error: 'That entry is already gone', status: 404 };

  // Somebody else's logged time is their record, and it is the basis of a number
  // about them. Correcting it is a conversation, not a button — a super user can
  // still fix a genuine mistake.
  if (Number(row.user_id) !== Number(userId) && !isSuperUser) {
    return { error: 'You can only remove hours you logged yourself', status: 403 };
  }

  await models.RequestTimeEntry.destroy({ where: { id: Number(entryId) } });
  return { submissionId: Number(row.submission_id) };
}

// ── Assignment ───────────────────────────────────────────────────────────────

/**
 * Record a change of holder.
 *
 * Called from inside the submission update's transaction: the column and its
 * history row have to land together, or the first failure leaves the two
 * disagreeing about who has the ticket.
 */
async function recordAssignment(submissionId, { assignedTo, assignedBy }, { transaction } = {}) {
  const models = dbApi.getModels() || {};
  if (!models.RequestAssignment) return null;
  return models.RequestAssignment.create({
    submission_id: Number(submissionId),
    // Null is a real event — somebody taking a request off a person without
    // giving it to another — not the absence of one.
    assigned_to: assignedTo == null ? null : Number(assignedTo),
    assigned_by: assignedBy == null ? null : Number(assignedBy),
    assigned_at: new Date().toISOString(),
  }, { transaction });
}

async function listAssignments(submissionId) {
  const models = dbApi.getModels() || {};
  if (!models.RequestAssignment) return [];

  const rows = await models.RequestAssignment.findAll({
    where: { submission_id: Number(submissionId) },
    raw: true,
  });
  if (rows.length === 0) return [];

  const userIds = [...new Set(
    rows.flatMap((row) => [Number(row.assigned_to), Number(row.assigned_by)]).filter(Boolean),
  )];
  const users = userIds.length > 0
    ? await models.User.findAll({
      where: { id: userIds },
      attributes: ['id', 'display_name', 'username'],
      raw: true,
    })
    : [];
  const nameById = new Map(users.map((user) => [
    Number(user.id),
    String(user.display_name || user.username || ''),
  ]));

  return rows
    .map((row) => ({
      id: Number(row.id),
      assigned_to: row.assigned_to == null ? null : Number(row.assigned_to),
      assigned_to_name: row.assigned_to == null
        ? null
        : (nameById.get(Number(row.assigned_to)) || 'Someone who has left'),
      assigned_by_name: row.assigned_by == null
        ? null
        : (nameById.get(Number(row.assigned_by)) || 'Someone who has left'),
      assigned_at: row.assigned_at,
    }))
    .sort((left, right) => right.id - left.id);
}

/** Everyone who could hold a request in this application: the grant list, not a new one. */
async function listAssignableUsers(applicationId) {
  const models = dbApi.getModels() || {};
  if (!models.UserApplicationRole || !models.User) return [];

  const grants = await models.UserApplicationRole.findAll({
    where: { application_id: Number(applicationId) },
    attributes: ['user_id', 'role'],
    raw: true,
  });
  // A viewer seat cannot be handed work — it cannot change the ticket it would
  // be given. Super users are included because they can act anywhere.
  const workerIds = new Set(
    grants
      .filter((grant) => String(grant.role || '').toLowerCase() !== 'viewer')
      .map((grant) => Number(grant.user_id)),
  );

  const supers = await models.User.findAll({
    where: { is_super_user: 1 },
    attributes: ['id'],
    raw: true,
  });
  for (const row of supers) workerIds.add(Number(row.id));
  if (workerIds.size === 0) return [];

  const users = await models.User.findAll({
    where: { id: [...workerIds] },
    attributes: ['id', 'display_name', 'username'],
    raw: true,
  });
  return users
    .map((user) => ({
      id: Number(user.id),
      name: String(user.display_name || user.username || ''),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

// ── Throughput ───────────────────────────────────────────────────────────────

/**
 * The numbers behind the throughput page, grouped in the database.
 *
 * Everything is computed — there is no stored total anywhere — so the page can
 * never disagree with the tickets it describes. `Created Month` in the source
 * field list was exactly this mistake: a stored month that can drift from its own
 * date.
 *
 * `onlyUserId` is how a non-manager sees their own work and nobody else's. It
 * narrows the QUERY, not the response afterwards: filtering in the browser would
 * ship the whole team to it and call that privacy.
 */
async function getThroughput({ applicationIds, from, to, onlyUserId = null, reportTypeId }) {
  const models = dbApi.getModels() || {};
  const sequelize = models.Submission?.sequelize;
  if (!sequelize) return null;

  const scope = (Array.isArray(applicationIds) ? applicationIds : []).map(Number).filter(Boolean);
  // Fail closed. No readable application means no rows, never all of them.
  if (scope.length === 0 || !reportTypeId) {
    return {
      delivered: 0, total_hours: 0, analysts: [], by_month: [], hours_by_month: [], median_days: null,
    };
  }

  const fromDay = dayOf(from);
  const toDay = dayOf(to);
  if (!fromDay || !toDay) return null;
  // `completed_at` and `worked_on` are ISO text, so the upper bound has to cover
  // the whole of the last day rather than stopping at its midnight.
  const toBound = `${toDay}T23:59:59.999Z`;

  const replacements = { scope, fromDay, toBound, reportTypeId, onlyUserId };
  const mineOnly = onlyUserId ? 'AND te.user_id = :onlyUserId' : '';

  // Delivered requests in the window, with who held each one at the finish.
  const delivered = await sequelize.query(
    `SELECT s.id, s.assigned_to, s.completed_at, s.created_at
       FROM submissions s
      WHERE s.type_id = :reportTypeId
        AND s.application_id IN (:scope)
        AND s.completed_at IS NOT NULL
        AND s.completed_at >= :fromDay
        AND s.completed_at <= :toBound`,
    { replacements, type: QueryTypes.SELECT },
  );

  // Hours in the window, by the day WORKED — an analyst catching up on Friday for
  // Tuesday's work belongs in Tuesday.
  const hours = await sequelize.query(
    `SELECT te.user_id, te.submission_id, te.hours, te.worked_on
       FROM request_time_entries te
       JOIN submissions s ON s.id = te.submission_id
      WHERE s.type_id = :reportTypeId
        AND s.application_id IN (:scope)
        AND te.worked_on >= :fromDay
        AND te.worked_on <= :toBound
        ${mineOnly}`,
    { replacements, type: QueryTypes.SELECT },
  );

  // Who logged hours against each delivered request, WHENEVER they logged them.
  // Deliberately not windowed: a request delivered in August was often worked in
  // July, and crediting only the hours inside the window would erase that.
  const deliveredIds = delivered.map((row) => Number(row.id));
  const workers = deliveredIds.length > 0
    ? await sequelize.query(
      `SELECT DISTINCT te.user_id, te.submission_id
         FROM request_time_entries te
        WHERE te.submission_id IN (:deliveredIds)`,
      { replacements: { deliveredIds }, type: QueryTypes.SELECT },
    )
    : [];

  const userIds = [...new Set([
    ...hours.map((row) => Number(row.user_id)),
    ...workers.map((row) => Number(row.user_id)),
    ...delivered.map((row) => Number(row.assigned_to)).filter(Boolean),
  ].filter(Boolean))];
  const users = userIds.length > 0
    ? await models.User.findAll({
      where: { id: userIds },
      attributes: ['id', 'display_name', 'username'],
      raw: true,
    })
    : [];
  const nameById = new Map(users.map((user) => [
    Number(user.id),
    String(user.display_name || user.username || ''),
  ]));

  const analysts = new Map();
  const seat = (userId) => {
    const id = Number(userId);
    if (!analysts.has(id)) {
      analysts.set(id, {
        user_id: id,
        name: nameById.get(id) || 'Someone who has left',
        hours: 0,
        worked: 0,
        closed: 0,
      });
    }
    return analysts.get(id);
  };

  for (const row of hours) {
    const person = seat(row.user_id);
    person.hours = Math.round((person.hours + toHours(row.hours)) * 100) / 100;
  }
  const deliveredSet = new Set(deliveredIds);
  for (const row of workers) {
    if (!deliveredSet.has(Number(row.submission_id))) continue;
    if (onlyUserId && Number(row.user_id) !== Number(onlyUserId)) continue;
    seat(row.user_id).worked += 1;
  }
  for (const row of delivered) {
    if (!row.assigned_to) continue;
    if (onlyUserId && Number(row.assigned_to) !== Number(onlyUserId)) continue;
    seat(row.assigned_to).closed += 1;
  }

  // Months, by completion. Sliced from the stored text rather than computed with
  // a dialect-specific date function, so SQLite and Postgres agree.
  const byMonth = new Map();
  for (const row of delivered) {
    if (onlyUserId && Number(row.assigned_to) !== Number(onlyUserId)) continue;
    const month = String(row.completed_at).slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + 1);
  }

  // Hours by the month WORKED — the personal view's own chart, where one
  // person's hours over time is a shape and their single total is not. The
  // `hours` rows are already narrowed to the caller by the query when they are
  // not a manager, so this needs no filter of its own. Accumulated in whole
  // pence to keep 0.25 + 0.5 + 0.25 exactly 1.
  const hoursByMonth = new Map();
  for (const row of hours) {
    const month = dayOf(row.worked_on).slice(0, 7);
    if (!month) continue;
    hoursByMonth.set(month, (hoursByMonth.get(month) || 0) + Math.round(toHours(row.hours) * 100));
  }

  // Median rather than mean: one request that sat for a year moves a mean and
  // tells you nothing about the rest.
  const spans = delivered
    .filter((row) => !onlyUserId || Number(row.assigned_to) === Number(onlyUserId))
    .map((row) => {
      const start = Date.parse(row.created_at);
      const end = Date.parse(row.completed_at);
      return Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? Math.round((end - start) / 86400000)
        : null;
    })
    .filter((days) => days !== null)
    .sort((left, right) => left - right);
  const medianDays = spans.length === 0
    ? null
    : (spans.length % 2 === 1
      ? spans[(spans.length - 1) / 2]
      : Math.round((spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2));

  const deliveredCount = onlyUserId
    ? delivered.filter((row) => Number(row.assigned_to) === Number(onlyUserId)).length
    : delivered.length;

  return {
    delivered: deliveredCount,
    total_hours: Math.round(
      [...analysts.values()].reduce((sum, person) => sum + person.hours, 0) * 100,
    ) / 100,
    analysts: [...analysts.values()].sort((left, right) => right.hours - left.hours),
    by_month: [...byMonth.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((left, right) => (left.month < right.month ? -1 : 1)),
    hours_by_month: [...hoursByMonth.entries()]
      .map(([month, pence]) => ({ month, hours: pence / 100 }))
      .sort((left, right) => (left.month < right.month ? -1 : 1)),
    median_days: medianDays,
  };
}

module.exports = {
  listTimeEntries,
  summarizeTimeEntries,
  addTimeEntry,
  deleteTimeEntry,
  recordAssignment,
  listAssignments,
  listAssignableUsers,
  getThroughput,
  dayOf,
  normalizeHours,
};
