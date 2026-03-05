import { formatCurrency } from '../../utils/formatUtils';

/**
 * Status count tiles + impact summary tiles.
 * Hidden when rows array is empty.
 */
export function StatTiles({ rows, statusCounts, impactTotals }) {
  if (rows.length === 0) return null;

  return (
    <>
      <div className="stat-row">
        <div className="stat-tile"><div className="stat-num">{rows.length}</div><div className="stat-lbl">Total</div></div>
        {['New', 'Approved', 'Submitted', 'Deployed'].map((s) => (
          <div className="stat-tile" key={s}>
            <div className="stat-num">{statusCounts[s] || 0}</div>
            <div className="stat-lbl">{s}</div>
          </div>
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
