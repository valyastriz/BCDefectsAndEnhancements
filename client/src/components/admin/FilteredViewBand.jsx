import { formatCurrency } from '../../utils/formatUtils';

/**
 * The FILTERED scope: what the table below currently shows. This is the page's
 * second, deliberately different count scope.
 *
 * Three things keep the two scopes apart, because they are different numbers by
 * design and the previous two-identical-rows layout said nothing about that:
 *   1. a badge naming it ("Filtered view" vs. the strip's "Whole queue"),
 *   2. a line stating that these numbers change with every filter,
 *   3. its own tinted treatment, joined to the top of the table it describes —
 *      proximity carries the meaning "these numbers describe these rows".
 *
 * The count also carries its denominator ("142 of 247"), so an admin never has
 * to look back up at the strip to know whether they are seeing everything.
 */
export function FilteredViewBand({
  rowCount,
  baselineTotal,
  impactTotals,
  activeFilterSummary = '',
  loading = false,
}) {
  return (
    <div className="viewband">
      <div className="viewband-head">
        <span className="scope-badge scope-badge--filtered">Filtered view</span>
        <span className="viewband-title">
          {loading ? (
            <span className="sk-bar" style={{ width: 180 }} />
          ) : (
            <>
              <b>{rowCount}</b>
              {baselineTotal > 0 && <> of {baselineTotal}</>} ticket{rowCount === 1 ? '' : 's'}
              {' '}— the rows in this table
            </>
          )}
        </span>
        <span className="viewband-hint">
          {activeFilterSummary
            ? <>Changes with every filter · {activeFilterSummary}</>
            : 'Changes with every filter · no filters applied'}
        </span>
      </div>

      <div className="viewband-tiles">
        <Tile label="Tickets in view" value={rowCount} loading={loading} />
        <Tile label="Policy Premium Impact" value={formatCurrency(impactTotals.policyPremiumImpact)} loading={loading} />
        <Tile label="Direct Dollar Impact" value={formatCurrency(impactTotals.directDollarImpact)} loading={loading} />
        <Tile label="Policies Impacted" value={Math.trunc(impactTotals.policiesAffectedCount)} loading={loading} />
      </div>
    </div>
  );
}

function Tile({ label, value, loading }) {
  return (
    <div className="viewband-tile">
      <div className="viewband-num">
        {loading ? <span className="sk-bar" style={{ width: 72, height: 18 }} /> : value}
      </div>
      <div className="viewband-lbl">{label}</div>
    </div>
  );
}
