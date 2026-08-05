/**
 * Shared pagination bar: a left-hand summary plus a per-page selector and
 * prev/next controls. Used by both the admin submissions table and the public
 * status board so the control markup stays in one place.
 *
 * The caller supplies its own `summary` text (wording differs per view) and owns
 * the page/pageSize state; this component renders the controls and resets to
 * page 1 when the page size changes.
 *
 * Its own spacing lives in CSS (.pagination-controls) rather than inline, so a
 * host that places it inside a row — the status board's summary band — can take
 * the bottom margin back off.
 */
export function PaginationControls({
  page,
  totalPages,
  pageSize,
  setPage,
  setPageSize,
  summary,
}) {
  return (
    <div className="pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span className="muted" style={{ fontSize: 13 }}>{summary}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
        <label style={{ fontSize: 13, color: 'var(--color-muted)' }}>Per page:</label>
        <select
          className="bs-inline-select"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
        >
          <option value={50}>50</option>
          <option value={75}>75</option>
          <option value={100}>100</option>
          <option value={0}>All</option>
        </select>
        {pageSize !== 0 && (
          <>
            <button
              type="button"
              className="bs-page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >&#8592;</button>
            <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
            <button
              type="button"
              className="bs-page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >&#8594;</button>
          </>
        )}
      </div>
    </div>
  );
}
