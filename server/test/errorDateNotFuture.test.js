const { test } = require('node:test');
const assert = require('node:assert');

const { isFutureDay, defectDateTimeIso } = require('../src/helpers/utils');

// A DEFECT CANNOT HAVE HAPPENED TOMORROW.
//
// The submit form caps its own date picker at today, but a `max` attribute is a
// courtesy: a typed date, a tab left open overnight, or a direct post all walk
// past it. `isFutureDay` is what the endpoint asks (routes/submissionRoutes.js,
// the defect branch), so what it counts as "future" is worth a net.
//
// The load-bearing decision is CALENDAR DAYS rather than instants. Somebody
// reporting a defect at 2pm may well say it happened at 5pm — mistyped, or a
// clock that disagrees with the server's by a few hours — and refusing that is a
// worse answer than accepting it. Tomorrow is wrong at any hour.

const NOON_TODAY = new Date(2026, 7, 19, 12, 0, 0); // 19 Aug 2026, local

test('later today is not the future', () => {
  assert.equal(isFutureDay(new Date(2026, 7, 19, 17, 30).toISOString(), NOON_TODAY), false);
  assert.equal(isFutureDay('2026-08-19T23:59', NOON_TODAY), false);
  // The very end of today, to the millisecond, still counts as today.
  assert.equal(isFutureDay(new Date(2026, 7, 19, 23, 59, 59, 999).toISOString(), NOON_TODAY), false);
});

test('yesterday and long ago are fine — most defects are reported after the fact', () => {
  assert.equal(isFutureDay('2026-08-18T09:00', NOON_TODAY), false);
  assert.equal(isFutureDay('2019-01-02T00:00', NOON_TODAY), false);
});

test('tomorrow is refused at any hour of it', () => {
  assert.equal(isFutureDay(new Date(2026, 7, 20, 0, 0, 0, 1).toISOString(), NOON_TODAY), true);
  assert.equal(isFutureDay('2026-08-20T00:00', NOON_TODAY), true);
  assert.equal(isFutureDay('2026-12-25T00:00', NOON_TODAY), true);
});

test('blank and unparseable are NOT future — that is a different question', () => {
  // Whether the field is required is asked separately, and answered separately
  // ("Date of error is required"). Reporting a missing date as a future one
  // would send the requester looking for a date they have not typed.
  assert.equal(isFutureDay('', NOON_TODAY), false);
  assert.equal(isFutureDay(null, NOON_TODAY), false);
  assert.equal(isFutureDay(undefined, NOON_TODAY), false);
  assert.equal(isFutureDay('not a date', NOON_TODAY), false);
});

test('the guard sits on the value the endpoint actually stores', () => {
  // defectDateTimeIso is what produces `date_time_of_error` from the form's
  // separate date and time boxes; the check runs on its output, so the two can
  // never disagree about which day was meant.
  const tomorrow = defectDateTimeIso({ date_of_error: '2026-08-20', time_of_error: '09:15' });
  assert.equal(isFutureDay(tomorrow, NOON_TODAY), true);

  const earlier = defectDateTimeIso({ date_of_error: '2026-08-19', time_of_error: '09:15' });
  assert.equal(isFutureDay(earlier, NOON_TODAY), false);
});
