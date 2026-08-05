import { PUBLIC_SORT_COLS, PUBLIC_SORT_FIELDS } from '../../constants/publicConstants';
import {
  defaultDirectionFor,
  directionsForType,
  parsePublicSortValue,
  publicSortFieldByKey,
} from '../../utils/publicSortUtils';

/**
 * Sort field + direction for the status board.
 *
 * The same two-control shape as the admin queue's SortControl, and for the same
 * reason: clicking a column header also sorts, but a header can be off-screen
 * at a narrow width, so every sortable field stays reachable here regardless.
 * Both write the same `filters.sort` value.
 *
 * The direction wording follows the field's type — "Newest first" means nothing
 * for Summary.
 */
export function PublicSortControl({ sortValue, onChange }) {
  const { field, dir } = parsePublicSortValue(sortValue);
  const directions = directionsForType(field?.type);

  function selectField(nextKey) {
    const nextField = publicSortFieldByKey(nextKey);
    if (!nextField) return;
    // Keep the current direction when the new field's type uses the same
    // wording, otherwise fall back to that type's default.
    const nextDir = nextField.type === field?.type ? dir : defaultDirectionFor(nextField.type);
    onChange(PUBLIC_SORT_COLS[nextField.key][nextDir]);
  }

  function selectDirection(nextDir) {
    if (!field) return;
    onChange(PUBLIC_SORT_COLS[field.key][nextDir]);
  }

  return (
    <span className="sb-sort">
      <label htmlFor="public-sort-field">Sort</label>
      <select
        id="public-sort-field"
        className="bs-inline-select"
        value={field?.key || 'statusUpdate'}
        onChange={(event) => selectField(event.target.value)}
      >
        {PUBLIC_SORT_FIELDS.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>
      <select
        className="bs-inline-select"
        aria-label="Sort direction"
        value={dir}
        onChange={(event) => selectDirection(event.target.value)}
      >
        {directions.map((option) => (
          <option key={option.dir} value={option.dir}>{option.label}</option>
        ))}
      </select>
    </span>
  );
}
