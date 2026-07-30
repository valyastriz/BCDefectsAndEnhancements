import { Button } from '../bite-size/BitsizeUI';

// Per-column skeleton widths, keyed by column key. Anything unlisted gets the
// fallback, so a newly added column still renders a sane placeholder.
const SKELETON_WIDTHS = {
  id: 44,
  reportedDate: 66,
  statusUpdate: 66,
  type: 70,
  summary: '80%',
  status: 96,
  cleanupStatus: 74,
  isPublic: 34,
  easyvista: 78,
  jiraCard: 80,
  policyPremium: 78,
  directImpact: 78,
  policiesImpacted: 56,
  frequency: 70,
};

/**
 * Loading placeholder shaped like the real rows.
 *
 * The previous behaviour was a "Loading…" line above the *stale* rows, which left
 * out-of-date tickets on screen presenting themselves as current — the worst of
 * the loading failure modes. Matching the row layout also stops the page jumping
 * when the data lands.
 */
export function TableSkeleton({ columns, rowCount = 6 }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={rowIndex}>
          <td style={{ width: 40, minWidth: 40 }}>
            <span className="sk-bar" style={{ width: 15, height: 15 }} />
          </td>
          {columns.map((column) => (
            <td key={column.key}>
              <span className="sk-bar" style={{ width: SKELETON_WIDTHS[column.key] || 64 }} />
              {column.key === 'summary' && (
                <span className="sk-bar" style={{ width: '36%', height: 9, marginTop: 6 }} />
              )}
              {column.key === 'reportedDate' && (
                <span className="sk-bar" style={{ width: 50, height: 9, marginTop: 5 }} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/**
 * No rows matched. Names how many filters are narrowing the view and offers the
 * one action that fixes it, so an empty table never reads as an empty queue.
 */
export function QueueEmptyState({ activeFilterCount, baselineTotal, onClearFilters, onOpenFilters }) {
  const filtered = activeFilterCount > 0;
  return (
    <div className="queue-state">
      <span className="queue-state-icon" aria-hidden="true">⌕</span>
      <h4>{filtered ? 'No tickets match these filters' : 'No tickets to show'}</h4>
      <p>
        {filtered
          ? <>
            {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} {activeFilterCount === 1 ? 'is' : 'are'} narrowing this view
            {baselineTotal > 0 && <>. Clearing {activeFilterCount === 1 ? 'it' : 'them'} brings back all {baselineTotal} active tickets</>}.
          </>
          : 'Nothing has been submitted into this scope yet.'}
      </p>
      {filtered && (
        <div className="bs-actions">
          <Button type="button" onClick={onClearFilters}>Clear all filters</Button>
          <Button type="button" kind="ghost" onClick={onOpenFilters}>Open filters</Button>
        </div>
      )}
    </div>
  );
}

/**
 * The load failed. States that the filters survived, so retrying is obviously
 * safe, and keeps the raw message available without dumping it into the layout.
 */
export function QueueErrorState({ message, onRetry }) {
  return (
    <div className="queue-state queue-state--error">
      <span className="queue-state-icon" aria-hidden="true">!</span>
      <h4>Couldn&apos;t load the queue</h4>
      <p>{message || 'The request to load tickets failed.'} Your filters are still set — retrying will use them.</p>
      <div className="bs-actions">
        <Button type="button" onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}
