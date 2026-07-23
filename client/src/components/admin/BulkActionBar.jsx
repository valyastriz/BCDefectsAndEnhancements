import { Button } from '../bite-size/BitsizeUI';

/**
 * Bulk-action toolbar shown above the submissions table when ≥1 ticket is
 * selected. Lets the admin flip public visibility for the whole selection.
 * Rendered by AdminDashboardPage, which owns the selection state. `disabled`
 * is set while a bulk request is in flight so a second one can't be launched.
 */
export function BulkActionBar({ count, onMakePublic, onMakePrivate, onClear, disabled = false }) {
  return (
    <div
      className="bulk-action-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 12px',
        marginBottom: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        background: 'var(--blue-50)',
      }}
    >
      <strong>{count} selected</strong>
      <div className="bs-actions" style={{ marginLeft: 'auto' }}>
        <Button type="button" kind="secondary" disabled={disabled} onClick={onMakePublic}>Make Public</Button>
        <Button type="button" kind="secondary" disabled={disabled} onClick={onMakePrivate}>Make Private</Button>
        <Button type="button" kind="ghost" disabled={disabled} onClick={onClear}>Clear selection</Button>
      </div>
    </div>
  );
}
