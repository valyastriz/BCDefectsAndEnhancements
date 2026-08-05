// ── Public status board sort helpers ────────────────────────────────────────
// Same mechanics as the admin queue (utils/sortShared.js), bound to the public
// registry — and, unlike the admin queue, the comparison happens here: the
// public list endpoint returns the whole board unsorted-by-request, so the
// board sorts in memory.
import { PUBLIC_SORT_COLS, PUBLIC_SORT_FIELDS } from '../constants/publicConstants';
import { createSortRegistry } from './sortShared';

const registry = createSortRegistry(PUBLIC_SORT_FIELDS, PUBLIC_SORT_COLS, 'statusUpdate');

export { directionsForType, defaultDirectionFor } from './sortShared';

/** Look up a public sort field definition by its registry key. */
export const publicSortFieldByKey = registry.fieldByKey;

/** Resolve a stored sort value back to { field, dir }. */
export const parsePublicSortValue = registry.parseSortValue;

/** The field type behind a public column key ('text' when unknown). */
export const publicSortTypeForColumn = registry.typeForColumn;

/** The stored value for a field key and direction. */
export const publicSortValueFor = registry.sortValueFor;

// How each sortable field reads a row. Every one of these is in the public
// allow-list (server/src/helpers/mappers.js) — nothing here can read a field the
// board was never sent.
const READERS = {
  statusUpdate: (item) => item.latest_status_changed_at || item.updated_at,
  reportedDate: (item) => item.created_at,
  id: (item) => Number(item.id),
  summary: (item) => item.summary_of_issue,
  status: (item) => item.status,
  type: (item) => item.type,
  createdBy: (item) => item.created_by,
  easyvista: (item) => item.easyvista_ticket_id,
  application: (item) => item.application_name,
};

function toMillis(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * A value with nothing to compare — no incident number, no application.
 *
 * Blanks sort last in BOTH directions: a ticket with no incident number has not
 * got the lowest one, it has none, and flipping the direction should not dredge
 * every blank to the top of the board.
 */
function isBlank(field, value) {
  if (value === null || value === undefined) return true;
  if (field.type === 'number') return !Number.isFinite(Number(value));
  if (field.type === 'date') return !value;
  return String(value).trim() === '';
}

/** Compare two values that are both present. */
function compareValues(field, a, b) {
  if (field.type === 'date') return toMillis(a) - toMillis(b);
  if (field.type === 'number') return Number(a) - Number(b);
  return String(a).trim().localeCompare(String(b).trim(), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * A copy of `items` in the order the stored sort value asks for.
 *
 * Ties break on id descending so the order is stable across re-renders — two
 * tickets updated in the same second must not swap places when the socket
 * fires.
 */
export function sortPublicItems(items, sortValue) {
  const { field, dir } = parsePublicSortValue(sortValue);
  const read = field ? READERS[field.key] : null;
  if (!read) return [...items];
  const direction = dir === 'asc' ? 1 : -1;

  return [...items].sort((left, right) => {
    const a = read(left);
    const b = read(right);
    // Checked BEFORE the direction is applied, so blanks stay last both ways.
    const blankA = isBlank(field, a);
    const blankB = isBlank(field, b);
    if (blankA !== blankB) return blankA ? 1 : -1;

    if (!blankA) {
      const compared = compareValues(field, a, b);
      if (compared !== 0) return compared * direction;
    }
    return Number(right.id) - Number(left.id);
  });
}
