// ── Admin queue sort helpers ────────────────────────────────────────────────
// The mechanics live in sortShared.js, bound here to the admin registry; the
// public status board binds the same helpers to its own (publicSortUtils.js).
import { SORT_COLS, SORT_FIELDS } from '../constants/adminConstants';
import { createSortRegistry } from './sortShared';

const registry = createSortRegistry(SORT_FIELDS, SORT_COLS, 'statusUpdate');

export { directionsForType, defaultDirectionFor } from './sortShared';

/** Look up a sort field definition by its registry key. */
export const sortFieldByKey = registry.fieldByKey;

/**
 * Resolve a raw sort value (e.g. 'updated_desc') back to { field, dir }.
 * Unknown or legacy values fall back to the app's default sort.
 */
export const parseSortValue = registry.parseSortValue;

/** The field type behind a SORT_COLS column key ('text' when unknown). */
export const sortTypeForColumn = registry.typeForColumn;
