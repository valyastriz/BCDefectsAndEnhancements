import { useState } from 'react';
import { CLEANUP_ONLY_STATUS, SCOPE_STRIP_STATUSES } from '../../constants/adminConstants';

// Status → card accent class. Statuses outside the headline four fall into the
// "other statuses" card, so only these need their own accent.
const CARD_CLASS_BY_STATUS = {
  New: 'qscope-card--new',
  Approved: 'qscope-card--approved',
  Submitted: 'qscope-card--submitted',
  Deployed: 'qscope-card--deployed',
};

/**
 * The WHOLE-QUEUE scope: counts of every non-retired ticket, independent of the
 * filters below. This is one of the page's two deliberately different count
 * scopes — it is badged "Whole queue" and states in words that filters do not
 * affect it, so it can't be misread as describing the table (the filtered band
 * above the table owns that job).
 *
 * The headline statuses are fixed (SCOPE_STRIP_STATUSES) so the cards never
 * reorder under the admin between loads. Everything else is summed into an
 * expandable "other statuses" card — previously those tickets were counted in
 * Total but shown nowhere, so Total didn't equal the sum of the tiles.
 *
 * Every card is a quick filter: clicking one narrows the table to that scope.
 */
export function QueueScopeStrip({
  baselineCounts,
  activeStatuses,
  isTotalSelected,
  onSelectTotal,
  onSelectStatus,
}) {
  const [otherOpen, setOtherOpen] = useState(false);

  const total = baselineCounts?.total || 0;
  const statusCounts = baselineCounts?.statuses || {};

  // Every status present in the data that isn't one of the headline cards,
  // including the cleanup-only pseudo-status. Sorted by count, biggest first, so
  // the expanded list leads with whatever actually has volume.
  const otherEntries = Object.entries(statusCounts)
    .filter(([status]) => !SCOPE_STRIP_STATUSES.includes(status))
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const otherTotal = otherEntries.reduce((sum, [, count]) => sum + count, 0);
  const cleanupOnlyCount = baselineCounts?.cleanupOnly || 0;

  if (total === 0) return null;

  const share = (count) => (total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0);

  return (
    <div className="qscope">
      <div className="qscope-head">
        <span className="scope-badge scope-badge--all">Whole queue</span>
        <span className="qscope-title">All {total} active ticket{total === 1 ? '' : 's'}</span>
        <span className="qscope-hint">
          Always the full picture — your filters never change these numbers. Click one to filter the table to it.
        </span>
      </div>

      <div className="qscope-cards">
        <button
          type="button"
          className="qscope-card qscope-card--total"
          aria-pressed={isTotalSelected}
          onClick={onSelectTotal}
        >
          <span className="qscope-num">{total}</span>
          <span className="qscope-meter"><i style={{ width: '100%' }} /></span>
          <span className="qscope-lbl">All active</span>
        </button>

        {SCOPE_STRIP_STATUSES.map((status) => {
          const count = statusCounts[status] || 0;
          const selected = !isTotalSelected
            && activeStatuses?.length === 1
            && activeStatuses[0] === status;
          return (
            <button
              key={status}
              type="button"
              className={`qscope-card ${CARD_CLASS_BY_STATUS[status] || ''}`.trim()}
              aria-pressed={selected}
              onClick={() => onSelectStatus(status)}
            >
              <span className="qscope-num">{count}</span>
              <span className="qscope-meter"><i style={{ width: `${share(count)}%` }} /></span>
              <span className="qscope-lbl">{status}</span>
            </button>
          );
        })}

        <button
          type="button"
          className="qscope-card qscope-card--other"
          aria-pressed={otherOpen}
          aria-expanded={otherOpen}
          onClick={() => setOtherOpen((prev) => !prev)}
        >
          <span className="qscope-num">{otherTotal + cleanupOnlyCount}</span>
          <span className="qscope-meter"><i style={{ width: `${share(otherTotal + cleanupOnlyCount)}%` }} /></span>
          <span className="qscope-lbl">
            {otherEntries.length + (cleanupOnlyCount > 0 ? 1 : 0)} other status
            {otherEntries.length + (cleanupOnlyCount > 0 ? 1 : 0) === 1 ? '' : 'es'} {otherOpen ? '▴' : '▾'}
          </span>
        </button>
      </div>

      {otherOpen && (
        <div className="qscope-other-list">
          {cleanupOnlyCount > 0 && (
            // Not a quick filter: no existing filter expresses "cleanup-only"
            // exactly (Cleanup Required also matches cleanup-tagged defects), so
            // this reports the count rather than pretending to filter by it.
            <span
              className="qscope-other-item"
              style={{ cursor: 'default' }}
              title="Cleanup-only tasks. Use the Cleanup filters to narrow the table."
            >
              {CLEANUP_ONLY_STATUS} <b>{cleanupOnlyCount}</b>
            </span>
          )}
          {otherEntries.map(([status, count]) => (
            <button
              key={status}
              type="button"
              className="qscope-other-item"
              onClick={() => onSelectStatus(status)}
            >
              {status} <b>{count}</b>
            </button>
          ))}
          {otherEntries.length === 0 && cleanupOnlyCount === 0 && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              No tickets in any other status right now.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
