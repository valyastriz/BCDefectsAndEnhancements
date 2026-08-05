const test = require('node:test');
const assert = require('node:assert');

const {
  ADMIN_EXPORT_FIELDS,
  EXPORT_FIELD_GROUPS,
  UNGROUPED_FIELD_GROUP,
  exportFieldGroup,
} = require('../src/helpers/export');
const { TRACKER_LABEL } = require('../src/constants');
const { normalizeImportHeader, suggestImportMappings } = require('../src/helpers/importUtils');
const { IMPORT_COLUMN_TARGETS } = require('../src/constants');

// ── The grouping invariant ────────────────────────────────────────────────
// The export dialog draws checkboxes by group. A field with no group would still
// render (under "Other fields") but it would be misfiled, and nobody looking at
// the dialog would know. These tests are what makes adding a field to
// buildAdminExportFields without grouping it a failing build rather than a
// quiet demotion.

test('every export field belongs to a declared group', () => {
  const ungrouped = ADMIN_EXPORT_FIELDS
    .filter((field) => field.group === UNGROUPED_FIELD_GROUP)
    .map((field) => field.key);
  assert.deepEqual(
    ungrouped,
    [],
    `these export fields have no group in EXPORT_FIELD_GROUPS: ${ungrouped.join(', ')}`,
  );
});

test('no group claims a field that does not exist', () => {
  const realKeys = new Set(ADMIN_EXPORT_FIELDS.map((field) => field.key));
  const phantom = EXPORT_FIELD_GROUPS
    .flatMap((group) => group.fieldKeys)
    .filter((fieldKey) => !realKeys.has(fieldKey));
  assert.deepEqual(phantom, [], `these grouped keys are not export fields: ${phantom.join(', ')}`);
});

test('no field is claimed by two groups', () => {
  const seen = new Map();
  for (const group of EXPORT_FIELD_GROUPS) {
    for (const fieldKey of group.fieldKeys) {
      assert.ok(
        !seen.has(fieldKey),
        `${fieldKey} is in both ${seen.get(fieldKey)} and ${group.key}`,
      );
      seen.set(fieldKey, group.key);
    }
  }
});

test('the group counts add up to the whole field list', () => {
  const grouped = EXPORT_FIELD_GROUPS.reduce((total, group) => total + group.fieldKeys.length, 0);
  assert.equal(grouped, ADMIN_EXPORT_FIELDS.length);
});

test('an unknown key falls back to the visible-but-misfiled group', () => {
  assert.equal(exportFieldGroup('a_field_nobody_declared'), UNGROUPED_FIELD_GROUP);
});

// ── Round-trip: an exported sheet must re-import ──────────────────────────
// Export column HEADERS are display labels; import matches on aliases, never on
// the label. That is what lets a label be reworded safely — but only as long as
// the reworded header is still one of the aliases. This is the test that proves
// it, for every field the import side can accept. It caught two headers that had
// never round-tripped ("Reported Date", "Request Details") and one the
// TRACKER_LABEL rename would have broken.

test('every export header that has an import target re-imports under it', () => {
  const targetsByKey = new Map(IMPORT_COLUMN_TARGETS.map((target) => [target.key, target]));
  const broken = [];

  for (const field of ADMIN_EXPORT_FIELDS) {
    const target = targetsByKey.get(field.key);
    if (!target) continue;
    const normalizedHeader = normalizeImportHeader(field.label);
    if (!target.aliases.includes(normalizedHeader)) {
      broken.push(`"${field.label}" -> ${normalizedHeader} (${field.key} accepts ${target.aliases.join(', ')})`);
    }
  }

  assert.deepEqual(broken, [], `these exported headers would not re-import:\n  ${broken.join('\n  ')}`);
});

// The strongest form of the same check: build a header row out of the real export
// labels, hand it to the real suggester, and see how many columns it claims. This
// goes through suggestImportMappings rather than reading the alias arrays, so it
// would catch a break in the matching itself and not just a missing alias.
test('a sheet exported with every field re-imports every column it can', () => {
  const importable = new Set(IMPORT_COLUMN_TARGETS.map((target) => target.key));
  const exportedHeaders = ADMIN_EXPORT_FIELDS
    .filter((field) => importable.has(field.key))
    .map((field) => ({ key: field.key, header: field.label }));

  const suggested = suggestImportMappings(exportedHeaders.map((column) => column.header));

  const unclaimed = exportedHeaders.filter((column) => suggested[column.key] !== column.header);
  assert.deepEqual(
    unclaimed.map((column) => `${column.header} (${column.key})`),
    [],
    'these exported columns came back unmapped',
  );
  assert.ok(exportedHeaders.length >= 30, `only ${exportedHeaders.length} export fields are importable`);
});

test('the hand-off columns are named for the tracker label, not the vendor', () => {
  for (const key of ['easyvista_ticket_id', 'easyvista_submitted_by']) {
    const field = ADMIN_EXPORT_FIELDS.find((candidate) => candidate.key === key);
    assert.ok(field, `${key} is not an export field`);
    assert.ok(field.label.includes(TRACKER_LABEL), `${key} does not use the tracker label`);
    assert.ok(!/easyvista|\bEV\b/i.test(field.label), `${key} still names the vendor: ${field.label}`);
  }
});
