// Turning a person named in a spreadsheet into the user id the column stores.
//
// This is the one place a NAME meets an ID in this codebase, and the STOP rule
// says never store the name — so the interesting cases are all the ways it must
// REFUSE. An import that guesses puts somebody else's work on a colleague, and
// the throughput page then reports that guess as fact.
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveImportedAssignee } = require('../src/services/deliveryService');

const key = (value) => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
const person = (id, name, username, email) => ({
  id,
  name,
  keys: [key(name), key(username), key(email)].filter(Boolean),
});

const PEOPLE = [
  person(2, 'Priya Raman', 'praman', 'priya.raman@example.test'),
  person(3, 'Tomas Whitlock', 'twhitlock', 'tomas@example.test'),
  // Two people, one spelling: the case that must never resolve to either.
  person(4, 'Alex Fry', 'afry1', 'alex.fry@example.test'),
  person(5, 'Alex Fry', 'afry2', 'a.fry@example.test'),
];
const ASSIGNABLE = new Set([2, 3, 4, 5]);

const resolve = (value, { assignable = ASSIGNABLE, people = PEOPLE } = {}) =>
  resolveImportedAssignee(value, { people, assignable });

test('a display name, a username or an email all find the same person', () => {
  for (const value of ['Priya Raman', 'praman', 'priya.raman@example.test']) {
    assert.equal(resolve(value).id, 2, value);
  }
});

test('case and stray whitespace do not stop a match', () => {
  assert.equal(resolve('  PRIYA   RAMAN ').id, 2);
  assert.equal(resolve('PRaman').id, 2);
});

test('an empty cell is not a failure — it is simply unassigned', () => {
  for (const value of ['', '   ', null, undefined]) {
    const result = resolve(value);
    assert.equal(result.id, null);
    assert.equal(result.reason, '', 'nothing to report about a blank cell');
  }
});

test('an unknown name refuses, and says the name it could not place', () => {
  const result = resolve('Somebody Else');
  assert.equal(result.id, null);
  assert.match(result.reason, /no portal user matches "Somebody Else"/);
});

test('an ambiguous name refuses rather than picking one', () => {
  const result = resolve('Alex Fry');
  assert.equal(result.id, null);
  assert.match(result.reason, /matches 2 portal users/);
  // The unambiguous keys for the same two people still work.
  assert.equal(resolve('afry1').id, 4);
  assert.equal(resolve('afry2').id, 5);
});

test('somebody real with no grant on this application refuses, by name', () => {
  const result = resolve('Tomas Whitlock', { assignable: new Set([2]) });
  assert.equal(result.id, null);
  assert.match(result.reason, /Tomas Whitlock has no grant on this application/);
});

test('nobody is assignable when the application grants nothing', () => {
  const result = resolve('Priya Raman', { assignable: new Set() });
  assert.equal(result.id, null);
  assert.match(result.reason, /no grant/);
});

test('a portal with no users answers with nothing rather than throwing', () => {
  const result = resolve('Priya Raman', { people: [] });
  assert.equal(result.id, null);
  assert.match(result.reason, /no portal user matches/);
});
