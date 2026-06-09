import { formatCurrency } from '../../utils/formatUtils';

/**
 * Status count tiles + impact summary tiles.
 *
 * Row 1 (Total + status breakdown) reflects all non-retired submissions
 * regardless of the active filters, sourced from `baselineCounts`.
 * Row 2 (Filtered Items + impact totals) reflects the currently filtered rows.
 * Hidden only when there is nothing to show in either row.
 *
 * `showActiveHint` surfaces a caption clarifying that row 1 excludes retired
 * items — only shown when the current view includes retired ones, so the
 * default (non-retired) view stays uncluttered.
 *
 * Row 1 tiles are clickable quick filters: `onSelectTotal` shows all non-retired
 * items and `onSelectStatus(status)` filters the table to a single status.
 */
export function StatTiles({
  rows,
  baselineCounts,
  impactTotals,
  showActiveHint,
  onSelectTotal,
  onSelectStatus,
}) {
  if (rows.length === 0 && baselineCounts.total === 0) return null;

  return (
    <>
      {showActiveHint && (
        <p className="muted" style={{ margin: '0 0 -4px', fontSize: 13 }}>
          Active totals — excludes retired items
        </p>
      )}
      <div className="stat-row">
        <button
          type="button"
          className="stat-tile stat-tile--clickable"
          onClick={onSelectTotal}
        >
          <div className="stat-num">{baselineCounts.total}</div>
          <div className="stat-lbl">Total</div>
        </button>
        {['New', 'Approved', 'Submitted', 'Deployed'].map((s) => (
          <button
            type="button"
            key={s}
            className="stat-tile stat-tile--clickable"
            onClick={() => onSelectStatus(s)}
          >
            <div className="stat-num">{baselineCounts.statuses[s] || 0}</div>
            <div className="stat-lbl">{s}</div>
          </button>
        ))}
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-num">{rows.length}</div>
          <div className="stat-lbl">Filtered Items</div>
        </div>
        <div className="stat-tile">
          <div className="stat-num">{formatCurrency(impactTotals.policyPremiumImpact)}</div>
          <div className="stat-lbl">Policy Premium Impact</div>
        </div>
        <div className="stat-tile">
          <div className="stat-num">{formatCurrency(impactTotals.directDollarImpact)}</div>
          <div className="stat-lbl">Direct Dollar Impact</div>
        </div>
        <div className="stat-tile">
          <div className="stat-num">{Math.trunc(impactTotals.policiesAffectedCount)}</div>
          <div className="stat-lbl">Policies Impacted</div>
        </div>
      </div>
    </>
  );
}
