/**
 * The applied filters, each removable on its own.
 *
 * This answers "why am I seeing 142 of 247?" without opening anything, and lets
 * an admin undo one filter instead of resetting every one of them. The list comes
 * from getActiveFilters (utils/activeFilterUtils) so the chips, the Filters button
 * badge and the filtered-view band all describe the same thing.
 */
export function ActiveFilterChips({ activeFilters, onRemove, onClearAll }) {
  if (activeFilters.length === 0) return null;

  return (
    <div className="admin-chips">
      <span className="admin-chips-label">Filtered by</span>
      {activeFilters.map(({ key, label, valueLabel }) => (
        <button
          key={key}
          type="button"
          className="admin-chip"
          onClick={() => onRemove(key)}
          aria-label={`Remove filter ${label}: ${valueLabel}`}
        >
          {label}: {valueLabel}
          <span className="admin-chip-x" aria-hidden="true">✕</span>
        </button>
      ))}
      <button type="button" className="bs-link-btn" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
