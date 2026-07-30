// ── Admin queue sort helpers ────────────────────────────────────────────────
import { SORT_COLS, SORT_DIRECTIONS_BY_TYPE, SORT_FIELDS } from '../constants/adminConstants';

const FIELD_BY_KEY = new Map(SORT_FIELDS.map((field) => [field.key, field]));

/** Look up a sort field definition by its registry key. */
export function sortFieldByKey(key) {
  return FIELD_BY_KEY.get(key) || null;
}

/**
 * Resolve a raw sort value (e.g. 'updated_desc') back to { field, dir }.
 * Unknown or legacy values fall back to the app's default sort.
 */
export function parseSortValue(sortValue) {
  for (const field of SORT_FIELDS) {
    const pair = SORT_COLS[field.key];
    if (!pair) continue;
    if (sortValue === pair.asc) return { field, dir: 'asc' };
    if (sortValue === pair.desc) return { field, dir: 'desc' };
  }
  return { field: FIELD_BY_KEY.get('statusUpdate'), dir: 'desc' };
}

/** Direction options for a field type, defaulting to text wording. */
export function directionsForType(type) {
  return SORT_DIRECTIONS_BY_TYPE[type] || SORT_DIRECTIONS_BY_TYPE.text;
}

/** The default direction for a field type — numbers open high→low. */
export function defaultDirectionFor(type) {
  return directionsForType(type)[0].dir;
}

/** The field type behind a SORT_COLS column key ('text' when unknown). */
export function sortTypeForColumn(colKey) {
  const pair = SORT_COLS[colKey];
  if (!pair) return 'text';
  return parseSortValue(pair.asc)?.field?.type || 'text';
}
