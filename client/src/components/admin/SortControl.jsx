import { SORT_COLS, SORT_FIELDS } from '../../constants/adminConstants';
import {
  defaultDirectionFor,
  directionsForType,
  parseSortValue,
  sortFieldByKey,
} from '../../utils/sortUtils';

/**
 * Sort field + direction, independent of which columns are visible.
 *
 * Before this, the only way to sort was clicking a column header, so hiding a
 * column also hid its sort — including sorting by last status update once that
 * moved into the reported-date cell. Clicking a header still works and simply
 * writes the same `filters.sort` value this control reads.
 *
 * The direction wording follows the field's type, because "Newest first" means
 * nothing for Summary. The four groups mirror the comparators the server uses for
 * each field (compareText / compareNum / compareBool in submissionService).
 */
export function SortControl({ sortValue, onChange }) {
  const { field, dir } = parseSortValue(sortValue);
  const directions = directionsForType(field?.type);

  function selectField(nextKey) {
    const nextField = sortFieldByKey(nextKey);
    if (!nextField) return;
    // Keep the current direction when the new field's type uses the same wording,
    // otherwise fall back to that type's default.
    const nextDir = nextField.type === field?.type ? dir : defaultDirectionFor(nextField.type);
    onChange(SORT_COLS[nextField.key][nextDir]);
  }

  function selectDirection(nextDir) {
    if (!field) return;
    onChange(SORT_COLS[field.key][nextDir]);
  }

  return (
    <div className="sort-control">
      <label htmlFor="admin-sort-field">Sort by</label>
      <select
        id="admin-sort-field"
        value={field?.key || 'statusUpdate'}
        onChange={(e) => selectField(e.target.value)}
      >
        {SORT_FIELDS.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>
      <select
        aria-label="Sort direction"
        value={dir}
        onChange={(e) => selectDirection(e.target.value)}
      >
        {directions.map((option) => (
          <option key={option.dir} value={option.dir}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
