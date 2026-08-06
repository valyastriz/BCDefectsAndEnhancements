// The numbers behind the throughput page.
//
// Two things are checked here and they are different in kind. The first is
// arithmetic: "worked on" and "closed" count different things and must not be
// conflated, hours are counted by the day WORKED, and nothing on the page is a
// stored total. The second is the one that matters if it breaks — a non-manager's
// answer must contain their own numbers and NOBODY else's, because the page names
// individuals. That narrowing happens in the query, and the case below asserts
// both halves: the SQL carries the filter, and no colleague survives into the
// response.
const test = require('node:test');
const assert = require('node:assert/strict');

const dbApi = require('../db');
const { getThroughput } = require('../src/services/deliveryService');

const REPORT_TYPE = 4;
const SCOPE = [7];

// Three analysts, one window. #101 and #102 were each worked by two people and
// closed by one, which is exactly the gap the two series exist to show.
const DELIVERED = [
  { id: 101, assigned_to: 1, completed_at: '2026-07-10T12:00:00.000Z', created_at: '2026-07-01T09:00:00.000Z' },
  { id: 102, assigned_to: 2, completed_at: '2026-08-04T12:00:00.000Z', created_at: '2026-07-20T09:00:00.000Z' },
  { id: 103, assigned_to: 1, completed_at: '2026-08-05T12:00:00.000Z', created_at: '2026-08-01T09:00:00.000Z' },
];
const TIME_ENTRIES = [
  { user_id: 1, submission_id: 101, hours: '4.00', worked_on: '2026-07-08' },
  { user_id: 2, submission_id: 101, hours: '2.50', worked_on: '2026-07-09' },
  { user_id: 1, submission_id: 102, hours: '1.25', worked_on: '2026-08-01' },
  { user_id: 2, submission_id: 102, hours: '0.25', worked_on: '2026-08-02' },
  { user_id: 3, submission_id: 103, hours: '3.00', worked_on: '2026-08-03' },
  // Outside the window: it must not reach the hours total, but it still counts
  // its owner as somebody who worked on #103.
  { user_id: 3, submission_id: 103, hours: '9.00', worked_on: '2026-05-01' },
];
const USERS = [
  { id: 1, display_name: 'Aisha Bell', username: 'abell' },
  { id: 2, display_name: 'Priya Raman', username: 'praman' },
  { id: 3, display_name: 'Tomas Whitlock', username: 'twhitlock' },
];

/**
 * A Sequelize stand-in that answers each of the three queries by what it selects
 * from, and records the SQL so a test can assert the narrowing is in the QUERY
 * rather than applied to the response afterwards.
 */
function fakeModels({ statements = [] } = {}) {
  const query = async (sql, { replacements = {} } = {}) => {
    statements.push({ sql, replacements });
    const only = replacements.onlyUserId;
    const window = (row) => row.worked_on >= replacements.fromDay && row.worked_on <= replacements.toBound;

    if (sql.includes('FROM submissions s\n')) {
      return DELIVERED.filter((row) => (
        row.completed_at >= replacements.fromDay && row.completed_at <= replacements.toBound
      ));
    }
    if (sql.includes('FROM request_time_entries te\n       JOIN submissions')) {
      // `mineOnly` is spliced into the SQL, so honour it the way the database would.
      const mine = sql.includes('te.user_id = :onlyUserId');
      return TIME_ENTRIES.filter(window).filter((row) => !mine || Number(row.user_id) === Number(only));
    }
    if (sql.includes('SELECT DISTINCT te.user_id')) {
      const ids = (replacements.deliveredIds || []).map(Number);
      const seen = new Set();
      return TIME_ENTRIES
        .filter((row) => ids.includes(Number(row.submission_id)))
        .filter((row) => {
          const key = `${row.user_id}:${row.submission_id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((row) => ({ user_id: row.user_id, submission_id: row.submission_id }));
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };

  return {
    Submission: { sequelize: { query } },
    User: { findAll: async ({ where }) => USERS.filter((user) => where.id.includes(user.id)) },
  };
}

/** Swaps the model registry for the duration of one call. */
async function withFakeDb(models, run) {
  const original = dbApi.getModels;
  dbApi.getModels = () => models;
  try {
    return await run();
  } finally {
    dbApi.getModels = original;
  }
}

const WINDOW = { from: '2026-06-01', to: '2026-08-31' };

async function throughputFor(options = {}) {
  const statements = [];
  const data = await withFakeDb(fakeModels({ statements }), () => getThroughput({
    applicationIds: SCOPE, ...WINDOW, reportTypeId: REPORT_TYPE, ...options,
  }));
  return { data, statements };
}

// ── The arithmetic ───────────────────────────────────────────────────────────

test('worked on and closed are different numbers, and only closed sums to delivered', async () => {
  const { data } = await throughputFor();

  const byName = new Map(data.analysts.map((row) => [row.name, row]));
  assert.equal(data.delivered, 3);
  // Aisha closed 101 and 103, and logged hours on 101 and 102.
  assert.deepEqual(
    { worked: byName.get('Aisha Bell').worked, closed: byName.get('Aisha Bell').closed },
    { worked: 2, closed: 2 },
  );
  // Priya closed 102 and logged hours on 101 and 102 — worked more than she closed.
  assert.deepEqual(
    { worked: byName.get('Priya Raman').worked, closed: byName.get('Priya Raman').closed },
    { worked: 2, closed: 1 },
  );
  // Tomas closed nothing at all and still did a request's worth of work.
  assert.deepEqual(
    { worked: byName.get('Tomas Whitlock').worked, closed: byName.get('Tomas Whitlock').closed },
    { worked: 1, closed: 0 },
  );

  const closed = data.analysts.reduce((sum, row) => sum + row.closed, 0);
  const worked = data.analysts.reduce((sum, row) => sum + row.worked, 0);
  assert.equal(closed, data.delivered, 'every delivered request had exactly one holder');
  assert.equal(worked, 5, 'and more people than that worked on them');
});

test('hours are counted by the day worked, and add up without drifting', async () => {
  const { data } = await throughputFor();

  // 4 + 2.5 + 1.25 + 0.25 + 3 — the 9 hours worked in May are outside the window.
  assert.equal(data.total_hours, 11);
  assert.equal(data.analysts.reduce((sum, row) => sum + row.hours, 0), 11);
  assert.deepEqual(data.hours_by_month, [
    { month: '2026-07', hours: 6.5 },
    { month: '2026-08', hours: 4.5 },
  ]);
});

test('months are grouped from the stored date, never a stored month', async () => {
  const { data } = await throughputFor();
  assert.deepEqual(data.by_month, [
    { month: '2026-07', count: 1 },
    { month: '2026-08', count: 2 },
  ]);
});

test('the median is the middle span, not the mean', async () => {
  const { data } = await throughputFor();
  // Spans: 9, 15, 4 days -> sorted 4, 9, 15 -> 9. The mean would be 9.33.
  assert.equal(data.median_days, 9);
});

// ── The narrowing ────────────────────────────────────────────────────────────

test('a non-manager gets their own numbers and no colleague appears at all', async () => {
  const { data, statements } = await throughputFor({ onlyUserId: 2 });

  assert.deepEqual(data.analysts.map((row) => row.name), ['Priya Raman']);
  assert.equal(data.analysts[0].hours, 2.75);
  assert.equal(data.analysts[0].worked, 2);
  assert.equal(data.analysts[0].closed, 1);
  // Delivered, months and the median are theirs too, not the team's.
  assert.equal(data.delivered, 1);
  assert.deepEqual(data.by_month, [{ month: '2026-08', count: 1 }]);
  assert.equal(data.total_hours, 2.75);
  assert.equal(data.median_days, 15);

  // The whole point: the filter is in the SQL, so a colleague's row never
  // reaches this process, let alone the browser.
  const hoursQuery = statements.find((entry) => entry.sql.includes('JOIN submissions'));
  assert.ok(hoursQuery.sql.includes('te.user_id = :onlyUserId'), 'the hours query is narrowed');
  assert.equal(hoursQuery.replacements.onlyUserId, 2);

  const names = JSON.stringify(data);
  for (const other of ['Aisha', 'Tomas']) {
    assert.ok(!names.includes(other), `${other} must not appear anywhere in the response`);
  }
});

test('a manager asks the unnarrowed question', async () => {
  const { statements } = await throughputFor();
  const hoursQuery = statements.find((entry) => entry.sql.includes('JOIN submissions'));
  assert.ok(!hoursQuery.sql.includes('te.user_id = :onlyUserId'));
});

// ── Failing closed ───────────────────────────────────────────────────────────

test('no readable application means no rows, never all of them', async () => {
  const data = await withFakeDb(fakeModels(), () => getThroughput({
    applicationIds: [], ...WINDOW, reportTypeId: REPORT_TYPE,
  }));
  assert.deepEqual(data, {
    delivered: 0, total_hours: 0, analysts: [], by_month: [], hours_by_month: [], median_days: null,
  });
});

test('an unresolvable report type means no rows either', async () => {
  const data = await withFakeDb(fakeModels(), () => getThroughput({
    applicationIds: SCOPE, ...WINDOW, reportTypeId: null,
  }));
  assert.equal(data.delivered, 0);
  assert.deepEqual(data.analysts, []);
});
