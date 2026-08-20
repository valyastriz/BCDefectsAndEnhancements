const { test } = require('node:test');
const assert = require('node:assert');

const { mapSubmission, mapPublicSubmission } = require('../src/helpers/mappers');

// A person blocked by an issue SOMEBODY ELSE reported first has to be as visible
// as the original reporter. Before this, the only surfaces that said so were the
// ticket's own detail modal and an optional column — so an admin who was not
// watching at the moment the toast fired had no way to know.
//
// These pin the numbers the three loud surfaces read: the red banner at the top
// of the queue, the inline chip in the default columns, and the `workaround`
// filter's three states.

// The predicate the admin queue filter applies. Mirrors
// services/submissionService.js listFilteredAdminSubmissions — kept here as the
// executable statement of the rule, since the filter itself needs a database.
function workaroundState(row) {
  const originalOpen = Boolean(row.needs_workaround) && !row.workaround_provided;
  const recurrenceOpen = Number(row.open_workaround_requests || 0) > 0;
  const askedAtAll = Boolean(row.needs_workaround)
    || Number(row.workaround_requests_total || 0) > 0;
  const anybodyWaiting = originalOpen || recurrenceOpen;
  return {
    open: anybodyWaiting,
    handled: askedAtAll && !anybodyWaiting,
    any: askedAtAll,
  };
}

test('a ticket nobody flagged is in none of the three states', () => {
  const state = workaroundState({});
  assert.equal(state.open, false);
  assert.equal(state.handled, false);
  assert.equal(state.any, false, 'and "any" must not sweep it in either');
});

test('the ORIGINAL reporter waiting is open, as it always was', () => {
  const state = workaroundState({ needs_workaround: 1, workaround_provided: 0 });
  assert.equal(state.open, true);
  assert.equal(state.handled, false);
});

test('a RECURRENCE waiting is open too, even when the ticket itself never asked', () => {
  // The gap this closes. `needs_workaround` is false — nobody who FILED it was
  // blocked — but a person who hit it later is, and they were invisible.
  const state = workaroundState({
    needs_workaround: 0,
    workaround_provided: 0,
    open_workaround_requests: 1,
    workaround_requests_total: 1,
  });
  assert.equal(state.open, true, 'an admin must find this ticket');
  assert.equal(state.any, true);
});

test('the original being answered does NOT hide a recurrence still waiting', () => {
  // The trap the two-column design exists to catch: the parent reads "handled",
  // and somebody else is still stuck.
  const state = workaroundState({
    needs_workaround: 1,
    workaround_provided: 1,
    open_workaround_requests: 2,
    workaround_requests_total: 2,
  });
  assert.equal(state.open, true, 'two people are still waiting');
  assert.equal(state.handled, false, 'it is not handled while anybody waits');
});

test('handled means somebody asked and NOBODY is still waiting', () => {
  const bothServiced = workaroundState({
    needs_workaround: 1,
    workaround_provided: 1,
    open_workaround_requests: 0,
    workaround_requests_total: 3,
  });
  assert.equal(bothServiced.handled, true);
  assert.equal(bothServiced.open, false);
});

test('a recurrence that asked and was answered still counts as "any"', () => {
  // This is why workaround_requests_total exists: open_ alone cannot tell "we
  // helped the second person" from "nobody else ever asked".
  const state = workaroundState({
    needs_workaround: 0,
    open_workaround_requests: 0,
    workaround_requests_total: 1,
  });
  assert.equal(state.any, true);
  assert.equal(state.handled, true);
  assert.equal(state.open, false);
});

// ── The banner counts PEOPLE, not tickets ──────────────────────────────────

test('the banner counts every person waiting on a ticket, not the ticket', () => {
  // It says "N reporters are waiting", so it has to count reporters. Counting
  // tickets would report three blocked people as "1 reporter is waiting" — and
  // that number is what decides whether somebody drops what they are doing.
  const rows = [
    { needs_workaround: true, workaround_provided: false, open_workaround_requests: 2 },
    { needs_workaround: false, workaround_provided: false, open_workaround_requests: 1 },
    { needs_workaround: true, workaround_provided: true, open_workaround_requests: 0 },
  ];
  const people = rows.reduce((total, row) => (
    total
    + (row.needs_workaround && !row.workaround_provided ? 1 : 0)
    + Number(row.open_workaround_requests || 0)
  ), 0);
  assert.equal(people, 4, '1 original + 2 recurrences + 1 recurrence');
});

// ── Exposure ───────────────────────────────────────────────────────────────

test('the admin mapper exposes both counts as numbers', () => {
  const mapped = mapSubmission({
    id: 1, status: 'New', type: 'defect',
    open_workaround_requests: 2, workaround_requests_total: 5,
  });
  assert.strictEqual(mapped.open_workaround_requests, 2);
  assert.strictEqual(typeof mapped.open_workaround_requests, 'number');
});

test('a row that predates the columns reads as zero, not null', () => {
  // The queue sorts on these. Null would sort as its own thing rather than as
  // "nobody is blocked", which is what an un-backfilled row means.
  const mapped = mapSubmission({ id: 1, status: 'New', type: 'defect' });
  assert.strictEqual(mapped.open_workaround_requests, 0);
  assert.strictEqual(mapped.recurrence_count, 0);
});

test('neither count reaches the public board', () => {
  const mapped = mapPublicSubmission({
    id: 1, type: 'defect', status: 'New', summary_of_issue: 's',
    screen_title: 't', steps_to_reproduce: 'x', what_happened_exact_details: 'y',
    request: 'z', date_time_of_error: 'now', created_by: 'someone',
    open_workaround_requests: 2, workaround_requests_total: 5,
  });
  assert.ok(!('open_workaround_requests' in mapped));
  assert.ok(!('workaround_requests_total' in mapped));
});
