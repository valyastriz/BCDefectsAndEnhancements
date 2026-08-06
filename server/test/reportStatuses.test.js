// The report-request status vocabulary.
//
// One status table serves every request type, and `statusesForRequestType` is the
// whole of what keeps the two vocabularies apart. So these cases are the contract:
// a report request may hold exactly its nine words, every other type may hold
// everything except the three that are its alone, and a value an admin adds on the
// Metadata page keeps reaching defects — because the alternative reading of "its
// own status list" was a second table, and a registry only works if it is exact.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_DEFECT_ENHANCEMENT_STATUSES,
  DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED,
  REPORT_REQUEST_STATUSES,
  REPORT_ONLY_STATUSES,
  REPORT_DELIVERED_STATUS,
  RETIRED_STATUS,
  SUBMISSION_TYPE_REPORT,
  statusesForRequestType,
} = require('../src/constants');

const ALL = DEFAULT_DEFECT_ENHANCEMENT_STATUSES_WITH_RETIRED;

test('the nine confirmed words are the report-request list, in the order they read in', () => {
  assert.deepEqual(REPORT_REQUEST_STATUSES, [
    'New',
    'Approved',
    'In progress',
    'Delivered',
    'On hold',
    'Rejected',
    'Duplicate',
    'Redirected',
    'Retired',
  ]);
});

test('a report request is offered its nine and nothing else', () => {
  const offered = statusesForRequestType(SUBMISSION_TYPE_REPORT, ALL);
  assert.deepEqual(offered, REPORT_REQUEST_STATUSES);
  // The two Service Desk words a report request never reaches.
  assert.ok(!offered.includes('Submitted'));
  assert.ok(!offered.includes('Deployed'));
  // And the three parked words 'On hold' replaces.
  for (const parked of ['Backlog - Monitoring Impact', 'Future Consideration', 'Deferred – Not in Current Scope']) {
    assert.ok(!offered.includes(parked), parked);
  }
});

test('every other type is offered everything except the three report-only words', () => {
  for (const type of ['defect', 'enhancement', '', undefined, 'cleanup']) {
    const offered = statusesForRequestType(type, ALL);
    for (const reportOnly of REPORT_ONLY_STATUSES) {
      assert.ok(!offered.includes(reportOnly), `${type || '(none)'} must not offer ${reportOnly}`);
    }
    assert.ok(offered.includes('Submitted'), `${type || '(none)'} keeps Submitted`);
    assert.ok(offered.includes('Deployed'), `${type || '(none)'} keeps Deployed`);
    assert.equal(offered.length, ALL.length - REPORT_ONLY_STATUSES.length);
  }
});

test('a status an admin adds on the Metadata page still reaches defects, and not report requests', () => {
  const withAdded = [...ALL, 'Waiting on the vendor'];
  assert.ok(statusesForRequestType('defect', withAdded).includes('Waiting on the vendor'));
  assert.ok(!statusesForRequestType(SUBMISSION_TYPE_REPORT, withAdded).includes('Waiting on the vendor'));
});

test('a switched-off value is offered to neither type', () => {
  // The caller passes the live list, so switching 'Duplicate' off on the Metadata
  // page removes it from both vocabularies rather than only from one.
  const withoutDuplicate = ALL.filter((name) => name !== 'Duplicate');
  assert.ok(!statusesForRequestType(SUBMISSION_TYPE_REPORT, withoutDuplicate).includes('Duplicate'));
  assert.ok(!statusesForRequestType('defect', withoutDuplicate).includes('Duplicate'));
});

test('the three new words are seeded, and appended so no existing sort order moves', () => {
  for (const name of REPORT_ONLY_STATUSES) {
    assert.ok(DEFAULT_DEFECT_ENHANCEMENT_STATUSES.includes(name), `${name} is seeded`);
  }
  // 'Deployed' was the last of the original ten. Anything after it is new.
  const deployed = DEFAULT_DEFECT_ENHANCEMENT_STATUSES.indexOf('Deployed');
  assert.deepEqual(DEFAULT_DEFECT_ENHANCEMENT_STATUSES.slice(deployed + 1), REPORT_ONLY_STATUSES);
});

test('the report-only words are a subset of the report list, and shared with nothing', () => {
  for (const name of REPORT_ONLY_STATUSES) {
    assert.ok(REPORT_REQUEST_STATUSES.includes(name), `${name} is one of the nine`);
  }
  assert.ok(REPORT_REQUEST_STATUSES.includes(REPORT_DELIVERED_STATUS));
  assert.ok(REPORT_REQUEST_STATUSES.includes(RETIRED_STATUS), 'Retired exists everywhere');
});

test('an unresolvable list answers with nothing rather than with everything', () => {
  assert.deepEqual(statusesForRequestType(SUBMISSION_TYPE_REPORT, null), []);
  assert.deepEqual(statusesForRequestType('defect', undefined), []);
  assert.deepEqual(statusesForRequestType(SUBMISSION_TYPE_REPORT, ['', '  ']), []);
});
