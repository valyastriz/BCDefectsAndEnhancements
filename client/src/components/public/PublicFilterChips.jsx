/**
 * The applied filters, each removable on its own.
 *
 * The public twin of the admin queue's ActiveFilterChips, and there for the
 * same reason: it answers "why am I seeing 142 of 247?" without opening
 * anything, and lets a reporter undo one filter instead of resetting every one
 * of them. The list comes from getActivePublicFilters (utils/publicFilterUtils)
 * so the chips, the Filters button badge and the list band all describe the
 * same thing.
 */
export function PublicFilterChips({ activeFilters, onRemove, onClearAll }) {
  if (activeFilters.length === 0) return null;

  return (
    <div className="pb-chips">
      <span className="pb-chips-label">Filtered by</span>
      {activeFilters.map(({ key, label, valueLabel }) => (
        <button
          key={key}
          type="button"
          className="pb-chip"
          onClick={() => onRemove(key)}
          aria-label={`Remove filter ${label}: ${valueLabel}`}
        >
          {label}: {valueLabel}
          <span className="pb-chip-x" aria-hidden="true">✕</span>
        </button>
      ))}
      <button type="button" className="pb-linkbtn" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
