/**
 * Bulk-action toolbar, shown when ≥1 ticket is selected. Lets the admin flip
 * public visibility or retire/unretire the whole selection. Rendered by
 * AdminDashboardPage, which owns the selection state. `disabled` is set while a
 * bulk request is in flight so a second one can't be launched.
 *
 * Sticks to the bottom of the viewport so it stays reachable while scrolling a
 * long selection, and states in words that the selection spans every page of the
 * filtered set — that scope is what makes these actions dangerous and it was
 * previously invisible.
 */
export function BulkActionBar({ count, onMakePublic, onMakePrivate, onRetire, onUnretire, onClear, disabled = false }) {
  return (
    <div className="bulk-action-bar" role="region" aria-label="Bulk actions for selected tickets">
      <span className="bulk-count">
        <b>{count}</b> ticket{count === 1 ? '' : 's'} selected <span>— across every page of this filtered view</span>
      </span>
      <div className="bulk-actions">
        <button type="button" className="bulk-btn" disabled={disabled} onClick={onMakePublic}>Make public</button>
        <button type="button" className="bulk-btn" disabled={disabled} onClick={onMakePrivate}>Make private</button>
        <button type="button" className="bulk-btn bulk-btn--danger" disabled={disabled} onClick={onRetire}>Retire</button>
        <button type="button" className="bulk-btn" disabled={disabled} onClick={onUnretire}>Unretire</button>
        <button type="button" className="bulk-btn" disabled={disabled} onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}
