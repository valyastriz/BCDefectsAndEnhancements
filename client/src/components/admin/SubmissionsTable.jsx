import { cloneElement } from 'react';
import { PaginationControls } from '../common/PaginationControls';
import { SORT_COLS } from '../../constants/adminConstants';
import { COLUMN_DEFS, statusVariant } from './submissionColumns';
import { SortControl } from './SortControl';
import { defaultDirectionFor, sortTypeForColumn } from '../../utils/sortUtils';
import { QueueEmptyState, QueueErrorState, TableSkeleton } from './QueueStates';

/**
 * The admin submissions table: sort control + pagination + rows, plus the
 * skeleton / empty / error surfaces for the same region.
 *
 * Columns are driven by `orderedVisibleColumns` (the admin's saved view): an
 * ordered array of `{ key, label, sortKey }` from ADMIN_TABLE_COLUMNS, already
 * filtered to the visible set.
 *
 * Sorting is reachable two ways that write the same `filters.sort` value: the
 * header sort control (every sortable field, whether or not its column shows) and
 * clicking a sortable header.
 */
export function SubmissionsTable({
  rows,
  pagedRows,
  loading,
  error,
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
  activeFilterCount = 0,
  baselineTotal = 0,
  onClearFilters,
  onOpenFilters,
  onRetry,
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

  const showSkeleton = loading && rows.length === 0;
  const showEmpty = !loading && !error && rows.length === 0;

  // ── Sorting helpers ──────────────────────────────────────────────────────
  // A header click toggles that column's direction, or opens it at its type's
  // default (numbers high→low) — the same rule the sort control applies.
  function handleColSort(colKey) {
    const { asc, desc } = SORT_COLS[colKey];
    let nextSort;
    if (filters.sort === asc) nextSort = desc;
    else if (filters.sort === desc) nextSort = asc;
    else nextSort = defaultDirectionFor(sortTypeForColumn(colKey)) === 'asc' ? asc : desc;
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
        aria-sort={isActive ? (isAsc ? 'ascending' : 'descending') : 'none'}
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

  // The load failed and there is nothing usable on screen — show the error
  // surface instead of an empty table. When rows are still present from a
  // previous successful load, the page-level Notice reports the error and the
  // known-good rows stay usable.
  if (error && rows.length === 0) {
    return <QueueErrorState message={error} onRetry={onRetry} />;
  }

  return (
    <>
      <div className="queue-table-head">
        <SortControl
          sortValue={filters.sort}
          onChange={(nextSort) => setFilters({ ...filters, sort: nextSort })}
        />
        <PaginationControls
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          setPage={setPage}
          setPageSize={setPageSize}
          summary={rows.length === 0
            ? (loading ? 'Loading…' : 'No results')
            : pageSize === 0
              ? `Showing all ${rows.length} item(s)`
              : `Showing ${Math.min((page - 1) * pageSize + 1, rows.length)}–${Math.min(page * pageSize, rows.length)} of ${rows.length}`}
        />
      </div>

      {showEmpty ? (
        <QueueEmptyState
          activeFilterCount={activeFilterCount}
          baselineTotal={baselineTotal}
          onClearFilters={onClearFilters}
          onOpenFilters={onOpenFilters}
        />
      ) : (
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
            {showSkeleton ? (
              <TableSkeleton columns={orderedVisibleColumns} />
            ) : (
              <tbody>
                {pagedRows.map((row) => {
                  const displayStatus = row.is_retired
                    ? 'Retired'
                    : (row.is_cleanup && row.cleanup_tag_type === 'cleanup_only' ? cleanupOnlyStatus : row.status);
                  return (
                    <tr
                      key={row.id}
                      className={[
                        'clickable',
                        `row-status--${statusVariant(displayStatus)}`,
                        row.is_retired ? 'row-retired' : '',
                      ].filter(Boolean).join(' ')}
                      data-selected={selectedIds.has(row.id) ? 'true' : 'false'}
                      onClick={(e) => {
                        if (e.target.closest('select, input, button, a, textarea, label')) {
                          return;
                        }
                        openDetail(row.id);
                      }}
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
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
      )}
    </>
  );
}
