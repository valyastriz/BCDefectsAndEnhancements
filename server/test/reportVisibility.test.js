const { test } = require('node:test');
const assert = require('node:assert');

const {
  isReportRequest,
  maySeeReportRequest,
  boardVisibilityFor,
  boardAudienceFor,
} = require('../src/helpers/reportVisibility');

// A report request is visible only to the person who filed it. Defects and
// enhancements stay everybody's business — that difference is the whole rule,
// and it is enforced on four surfaces (board list, board by-id, public semantic
// search, live socket broadcast) which all call in here.

const defect = (over = {}) => ({ type: 'defect', reporter_user_id: 5, ...over });
const report = (over = {}) => ({ type: 'report', reporter_user_id: 5, ...over });
const session = (id) => ({ session: { user: { id } } });

// ── What counts as a report request ──────────────────────────────────────────
test('type is matched case- and whitespace-insensitively', () => {
  assert.strictEqual(isReportRequest({ type: ' Report ' }), true);
  assert.strictEqual(isReportRequest({ type: 'REPORT' }), true);
  assert.strictEqual(isReportRequest({ type: 'defect' }), false);
});

test('the by-id path spells the type differently, and is read too', () => {
  // getSubmissionByIdWithLookups hydrates into `model_type_name` and leaves
  // `type` undefined. Reading only `type` made every row from that path look
  // like a defect, and the board's detail route kept serving other people's
  // report requests after the list had stopped.
  assert.strictEqual(isReportRequest({ model_type_name: 'report' }), true);
  assert.strictEqual(isReportRequest({ model_type_name: 'defect' }), false);
  assert.strictEqual(
    maySeeReportRequest({ model_type_name: 'report', reporter_user_id: 5 }, null),
    false,
  );
  assert.strictEqual(
    maySeeReportRequest({ model_type_name: 'report', reporter_user_id: 5 }, 5),
    true,
  );
});

test('a row with no type is NOT a report request', () => {
  // Deliberate, and the direction is worth stating: report requests have carried
  // a type since the type existed, so an untyped row predates them and is an old
  // defect or enhancement. Hiding those would take long-public tickets off the
  // board to protect rows that cannot exist.
  assert.strictEqual(isReportRequest({}), false);
  assert.strictEqual(isReportRequest({ type: null }), false);
  assert.strictEqual(isReportRequest(null), false);
});

// ── Who may see one ──────────────────────────────────────────────────────────
test('everybody sees a defect, signed in or not', () => {
  assert.strictEqual(maySeeReportRequest(defect(), null), true);
  assert.strictEqual(maySeeReportRequest(defect(), 99), true);
});

test('the person who filed a report request sees it', () => {
  assert.strictEqual(maySeeReportRequest(report({ reporter_user_id: 5 }), 5), true);
});

test('somebody else does not', () => {
  assert.strictEqual(maySeeReportRequest(report({ reporter_user_id: 5 }), 6), false);
});

test('an anonymous visitor sees no report request at all', () => {
  // The bug this closes: signed out, the board listed everybody's.
  assert.strictEqual(maySeeReportRequest(report(), null), false);
  assert.strictEqual(maySeeReportRequest(report(), undefined), false);
  assert.strictEqual(maySeeReportRequest(report(), 0), false);
});

test('an ownerless report request is visible to nobody, not to everybody', () => {
  // Cannot be filed any more, but rows predating that rule exist. A null
  // reporter must not read as "matches the null viewer".
  assert.strictEqual(maySeeReportRequest(report({ reporter_user_id: null }), null), false);
  assert.strictEqual(maySeeReportRequest(report({ reporter_user_id: null }), 5), false);
});

test('the ids are compared as numbers, not as strings', () => {
  // The session carries a number; a raw row can carry either.
  assert.strictEqual(maySeeReportRequest(report({ reporter_user_id: '5' }), 5), true);
});

// ── Bound to a request, for filtering a list ─────────────────────────────────
test('boardVisibilityFor keeps defects and drops other people\'s report requests', () => {
  const rows = [
    defect({ id: 1 }),
    report({ id: 2, reporter_user_id: 5 }),
    report({ id: 3, reporter_user_id: 6 }),
  ];

  const mine = rows.filter(boardVisibilityFor(session(5)));
  assert.deepStrictEqual(mine.map((row) => row.id), [1, 2]);

  const anonymous = rows.filter(boardVisibilityFor({}));
  assert.deepStrictEqual(anonymous.map((row) => row.id), [1]);
});

// ── Who a live update goes to ────────────────────────────────────────────────
test('a defect is broadcast to the whole board', () => {
  assert.deepStrictEqual(boardAudienceFor(defect()), {});
});

test('a report request goes only to the socket of the person who filed it', () => {
  assert.deepStrictEqual(boardAudienceFor(report({ reporter_user_id: 5 })), { onlyReporterUserId: 5 });
});

test('an ownerless report request is broadcast to nobody', () => {
  // `{ nobody: true }` and `{}` must stay different: `{}` means the whole board,
  // so collapsing them would send a private row to every watcher.
  assert.deepStrictEqual(boardAudienceFor(report({ reporter_user_id: null })), { nobody: true });
  assert.notDeepStrictEqual(boardAudienceFor(report({ reporter_user_id: null })), {});
});
