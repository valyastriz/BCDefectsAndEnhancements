import { cloneElement } from 'react';
import { PaginationControls } from '../common/PaginationControls';
import { SORT_COLS } from '../../constants/adminConstants';
import { COLUMN_DEFS } from './submissionColumns';

/**
 * Pagination controls + the main admin submissions table.
 *
 * Columns are driven by `orderedVisibleColumns` (the admin's saved view): an
 * ordered array of `{ key, label, sortKey }` from ADMIN_TABLE_COLUMNS, already
 * filtered to the visible set. Header/cell rendering and sort behavior are
 * unchanged from the previous hardcoded layout.
 */
export function SubmissionsTable({
  rows,
  pagedRows,
  loading,
  page,
  totalPages,
  pageSize,
  setPage,
  setPageSize,
  filters,
  setFilters,
  openDetail,
  orderedVisibleColumns,
  updateStatusQuick,
  updateCleanupStatusQuick,
  updatePublicQuick,
  updateJiraQuick,
  runtimeStatusOptions,
  runtimeCleanupInlineStatuses,
  cleanupOnlyStatus,
  statusToCleanup,
  selectedIds,
  onToggleRow,
  onToggleAll,
}) {
  // Selection state for the leading checkbox column. The master checkbox acts on
  // the full filtered `rows` (every page), not just the visible `pagedRows`.
  const allRowsSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));
  const someRowsSelected = selectedIds.size > 0 && !allRowsSelected;

  // Shared context handed to each column's cell renderer (see submissionColumns).
  const cellCtx = {
    updateStatusQuick,
    updateCleanupStatusQuick,
    updatePublicQuick,
    updateJiraQuick,
    runtimeStatusOptions,
    runtimeCleanupInlineStatuses,
    cleanupOnlyStatus,
    statusToCleanup,
  };

  // ── Sorting helpers ──────────────────────────────────────────────────────
  function handleColSort(colKey) {
    const { asc, desc } = SORT_COLS[colKey];
    const numericFirst = ['policyPremium', 'directImpact', 'policiesImpacted'];
    let nextSort;
    if (filters.sort === asc) nextSort = desc;
    else if (filters.sort === desc) nextSort = asc;
    else nextSort = numericFirst.includes(colKey) ? desc : asc;
    // The page's filters effect reloads the table; calling loadRows here too
    // would double-fetch on every sort click.
    setFilters({ ...filters, sort: nextSort });
  }

  function sortTh(colKey, label, style) {
    const { asc, desc } = SORT_COLS[colKey];
    const isAsc = filters.sort === asc;
    const isActive = isAsc || filters.sort === desc;
    return (
      <th
        style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'normal', verticalAlign: 'bottom' }}
        onClick={() => handleColSort(colKey)}
      >
        {(() => {
          const spaceIdx = label.indexOf(' ');
          const firstWord = spaceIdx === -1 ? label : label.slice(0, spaceIdx);
          const rest = spaceIdx === -1 ? '' : label.slice(spaceIdx);
          return (
            <>
              <span style={{ whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 10, opacity: isActive ? 1 : 0.3, marginRight: 2 }}>
                  {isAsc ? '▲' : '▼'}
                </span>{firstWord}
              </span>{rest}
            </>
          );
        })()}
      </th>
    );
  }

  return (
    <>
      {loading && <p className="muted">Loading…</p>}

      {/* ── Pagination controls ── */}
      <PaginationControls
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        setPage={setPage}
        setPageSize={setPageSize}
        summary={rows.length === 0
          ? 'No results'
          : pageSize === 0
            ? `Showing all ${rows.length} item(s)`
            : `Showing ${Math.min((page - 1) * pageSize + 1, rows.length)}–${Math.min(page * pageSize, rows.length)} of ${rows.length}`}
      />

      <div className="table-wrap">
        <table className="admin-submissions-table">
          <thead>
            <tr>
              {/* Leading selection column — outside the registry-driven columns. */}
              <th style={{ width: 40, minWidth: 40 }}>
                <input
                  type="checkbox"
                  aria-label="Select all filtered tickets"
                  checked={allRowsSelected}
                  ref={(el) => { if (el) el.indeterminate = someRowsSelected; }}
                  onChange={onToggleAll}
                />
              </th>
              {orderedVisibleColumns.map((col) => {
                const headerStyle = COLUMN_DEFS[col.key]?.headerStyle;
                return col.sortKey
                  ? cloneElement(sortTh(col.sortKey, col.label, headerStyle), { key: col.key })
                  : <th key={col.key} style={headerStyle}>{col.label}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={orderedVisibleColumns.length + 1} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 12px' }}>No submissions match the current filters.</td></tr>
            )}
            {pagedRows.map((row) => (
              <tr
                key={row.id}
                onClick={(e) => {
                  if (e.target.closest('select, input, button, a, textarea, label')) {
                    return;
                  }
                  openDetail(row.id);
                }}
                className="clickable"
              >
                {/* Leading selection cell — the onClick guard above ignores clicks on this input. */}
                <td data-label="Select" style={{ width: 40, minWidth: 40 }}>
                  <input
                    type="checkbox"
                    aria-label={`Select ticket #${row.id}`}
                    checked={selectedIds.has(row.id)}
                    onChange={() => onToggleRow(row.id)}
                  />
                </td>
                {orderedVisibleColumns.map((col) => {
                  const cell = COLUMN_DEFS[col.key]?.renderCell(row, cellCtx);
                  return cell ? cloneElement(cell, { key: col.key }) : null;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
