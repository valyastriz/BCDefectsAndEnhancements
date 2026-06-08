import { Badge } from '../bite-size/BitsizeUI';
import { PaginationControls } from '../common/PaginationControls';
import { SORT_COLS } from '../../constants/adminConstants';
import { formatCurrency, formatNumber, formatDateOnly } from '../../utils/formatUtils';
import { inlineDisplayType } from '../../utils/mappers';

/**
 * Pagination controls + the main admin submissions table.
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
  loadRows,
  openDetail,
  updateStatusQuick,
  updateCleanupStatusQuick,
  updatePublicQuick,
  updateJiraQuick,
  runtimeStatusOptions,
  runtimeCleanupInlineStatuses,
  cleanupOnlyStatus,
  statusToCleanup,
}) {
  // ── Sorting helpers ──────────────────────────────────────────────────────
  function handleColSort(colKey) {
    const { asc, desc } = SORT_COLS[colKey];
    const numericFirst = ['policyPremium', 'directImpact', 'policiesImpacted'];
    let nextSort;
    if (filters.sort === asc) nextSort = desc;
    else if (filters.sort === desc) nextSort = asc;
    else nextSort = numericFirst.includes(colKey) ? desc : asc;
    const nextFilters = { ...filters, sort: nextSort };
    setFilters(nextFilters);
    loadRows(nextFilters);
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
              {sortTh('reportedDate',     'Reported Date',      { width: 110, minWidth: 110 })}
              {sortTh('statusUpdate',     'Status Update',      { width: 110, minWidth: 110 })}
              {sortTh('type',             'Type',               { width: 110 })}
              {sortTh('summary',          'Summary',            { minWidth: 200 })}
              {sortTh('status',           'Defect/Enhancement Status', { width: 210, minWidth: 210 })}
              <th style={{ width: 170, minWidth: 170 }}>Cleanup Status</th>
              {sortTh('isPublic',         'Public',             { width: 110, minWidth: 110 })}
              {sortTh('easyvista',        'EasyVista',          { width: 110 })}
              {sortTh('jiraCard',         'JIRA Card #',        { width: 140, minWidth: 140 })}
              {sortTh('policyPremium',    'Policy Premium ($)', { width: 160 })}
              {sortTh('directImpact',     'Direct Impact ($)',  { width: 160 })}
              {sortTh('policiesImpacted', 'Policies Impacted',  { width: 140 })}
              {sortTh('frequency',        'Frequency',          { width: 160 })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 12px' }}>No submissions match the current filters.</td></tr>
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
                <td data-label="Reported Date" style={{ width: 110, minWidth: 110 }}>{formatDateOnly(row.created_at)}</td>
                <td data-label="Status Update" style={{ width: 110, minWidth: 110 }}>{formatDateOnly(row.status_update_at || row.updated_at)}</td>
                <td data-label="Type">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <Badge value={inlineDisplayType(row)} />
                    {row.is_cleanup && row.cleanup_tag_type !== 'cleanup_only' && <Badge value="Clean Up" />}
                    {row.has_resubmission && row.latest_resubmission_easyvista_ticket_id && (
                      <Badge value={`Resubmitted: ${row.latest_resubmission_easyvista_ticket_id}`} />
                    )}
                    {row.is_resubmission && row.resubmission_of_easyvista_ticket_id && (
                      <Badge value={`Resubmit of: ${row.resubmission_of_easyvista_ticket_id}`} />
                    )}
                  </div>
                </td>
                <td data-label="Summary" style={{ minWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.summary_of_issue}</td>
                <td data-label="Status" style={{ minWidth: 170 }}>
                  <select
                    className="bs-inline-select"
                    aria-label={`Update defect or enhancement status for #${row.id}`}
                    value={row.is_cleanup && row.cleanup_tag_type === 'cleanup_only' ? cleanupOnlyStatus : row.status}
                    disabled={row.is_retired}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateStatusQuick(row.id, e.target.value, row);
                    }}
                  >
                    {runtimeStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td data-label="Cleanup Status" style={{ minWidth: 170 }}>
                  <select
                    className="bs-inline-select"
                    aria-label={`Update cleanup status for #${row.id}`}
                    value={row.is_cleanup ? (row.cleanup_status || statusToCleanup[row.status] || 'New') : 'No Cleanup'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateCleanupStatusQuick(row.id, e.target.value, row);
                    }}
                  >
                    {runtimeCleanupInlineStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td data-label="Public" style={{ minWidth: 110 }}>
                  <select
                    className="bs-inline-select"
                    aria-label={`Update public visibility for #${row.id}`}
                    value={row.is_public ? 'yes' : 'no'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      updatePublicQuick(row.id, e.target.value === 'yes');
                    }}
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </td>
                <td data-label="EasyVista" className="muted">{row.easyvista_ticket_id || '—'}</td>
                <td data-label="JIRA Card #" style={{ minWidth: 140 }}>
                  <input
                    className="bs-inline-input"
                    aria-label={`Update JIRA number for #${row.id}`}
                    defaultValue={row.jira_number || ''}
                    placeholder="JIRA-123"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        updateJiraQuick(row.id, e.currentTarget.value.trim());
                      }
                    }}
                    onBlur={(e) => {
                      e.stopPropagation();
                      updateJiraQuick(row.id, e.currentTarget.value.trim());
                    }}
                  />
                </td>
                <td data-label="Policy Premium ($)">{formatCurrency(row.policy_premium_impact)}</td>
                <td data-label="Direct Impact ($)">{formatCurrency(row.direct_dollar_impact)}</td>
                <td data-label="Policies Impacted">{formatNumber(row.policies_affected_count)}</td>
                <td data-label="Frequency">
                  {row.occurrence_count && row.occurrence_timeframe
                    ? `${row.occurrence_count} per ${row.occurrence_timeframe_count > 1 ? `${row.occurrence_timeframe_count} ` : ''}${row.occurrence_timeframe}${row.occurrence_timeframe_count > 1 ? 's' : ''}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
