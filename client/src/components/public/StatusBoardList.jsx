import { PUBLIC_BOARD_COLUMNS, PUBLIC_SORT_COLS } from '../../constants/publicConstants';
import { defaultDirectionFor, publicSortTypeForColumn } from '../../utils/publicSortUtils';
import { PaginationControls } from '../common/PaginationControls';
import { PublicSortControl } from './PublicSortControl';
import { StatusBoardRow } from './StatusBoardRow';

/**
 * The board itself: the summary band, the sortable column header, and the rows.
 *
 * Sorting is reachable two ways that write the same `filters.sort` value — the
 * sort control in the band and a click on a column header — mirroring the admin
 * queue (components/admin/SubmissionsTable.jsx).
 */
export function StatusBoardList({
  items,
  pagedItems,
  totalInScope,
  scopeLabel,
  activeFilterCount,
  mineOnly,
  sortValue,
  onSortChange,
  page,
  setPage,
  pageSize,
  setPageSize,
  totalPages,
  isMine,
  // "I did not file this, but I said it happened to me." Its own test so the row
  // can say which relationship it is instead of claiming a report you never made.
  iReportedTooo = () => false,
}) {
  // Clicking the column you are already sorted by flips it; a new column opens
  // in its type's default direction (dates and numbers high→low, text A→Z) —
  // the same rule the sort control applies.
  function toggleSort(colKey) {
    const { asc, desc } = PUBLIC_SORT_COLS[colKey];
    if (sortValue === asc) return onSortChange(desc);
    if (sortValue === desc) return onSortChange(asc);
    return onSortChange(defaultDirectionFor(publicSortTypeForColumn(colKey)) === 'asc' ? asc : desc);
  }

  return (
    <div className="sb-panel">
      <div className="sb-band">
        <span className="sb-band-title">
          <b>{items.length}</b> of {totalInScope} tickets
        </span>
        {/* The explicit {' '} matter: JSX strips the whitespace between elements
            on separate lines, and .sb-sep carries no margin — without them the
            hint reads "filter·Billing Center·no filters". */}
        <span className="sb-band-hint">
          {scopeLabel}
          {mineOnly && (
            <>
              {' '}
              <span className="sb-sep">·</span>
              {' '}
              Yours only
            </>
          )}
          {' '}
          <span className="sb-sep">·</span>
          {' '}
          {activeFilterCount === 0
            ? 'no filters applied'
            : `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied`}
        </span>
        <span className="sb-band-right">
          <PublicSortControl sortValue={sortValue} onChange={onSortChange} />
          <PaginationControls
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            setPage={setPage}
            setPageSize={setPageSize}
            summary={pageSize === 0
              ? `Showing all ${items.length}`
              : `Showing ${Math.min((page - 1) * pageSize + 1, items.length)}–${Math.min(page * pageSize, items.length)} of ${items.length}`}
          />
        </span>
      </div>

      <div className="sb-head">
        {PUBLIC_BOARD_COLUMNS.map((column) => {
          const pair = PUBLIC_SORT_COLS[column.sortKey];
          const isAscending = sortValue === pair.asc;
          const isActive = isAscending || sortValue === pair.desc;
          return (
            <button
              key={column.key}
              type="button"
              className={`sb-th c-${column.key}`}
              aria-sort={isActive ? (isAscending ? 'ascending' : 'descending') : 'none'}
              onClick={() => toggleSort(column.sortKey)}
            >
              {column.label}
              <span className="sb-caret" aria-hidden="true" />
            </button>
          );
        })}
        <span className="sb-th sb-th--plain c-exp" />
      </div>

      <div className="sb-rows">
        {pagedItems.map((item) => (
          <StatusBoardRow key={item.id} item={item} isMine={isMine(item)} iReportedTooo={iReportedTooo(item)} />
        ))}
      </div>
    </div>
  );
}
