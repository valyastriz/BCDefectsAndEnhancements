import { Badge } from '../bite-size/BitsizeUI';
import { formatCurrency, formatNumber, formatDateOnly } from '../../utils/formatUtils';
import { inlineDisplayType } from '../../utils/mappers';

/**
 * Map a defect/enhancement status onto its visual variant. The three parked
 * statuses share `holding` because they read as one state to a triager; anything
 * unrecognised (a status added through Manage Metadata) falls back to `holding`
 * rather than rendering unstyled.
 */
export function statusVariant(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'new') return 'new';
  if (value === 'approved') return 'approved';
  if (value === 'submitted') return 'submitted';
  if (value === 'deployed') return 'deployed';
  if (value === 'rejected') return 'rejected';
  if (value === 'duplicate') return 'duplicate';
  if (value === 'redirected') return 'redirected';
  if (value === 'retired') return 'retired';
  if (value === 'cleanup only') return 'cleanup-only';
  return 'holding';
}

/**
 * Per-column header style + cell renderer for the admin submissions table.
 *
 * Keyed by the column keys in ADMIN_TABLE_COLUMNS (constants/adminConstants.js).
 * `renderCell(row, ctx)` returns the full <td>; `ctx` carries the quick-edit
 * handlers and runtime option lists the editable cells need.
 */
export const COLUMN_DEFS = {
  id: {
    headerStyle: { width: 78, minWidth: 78 },
    renderCell: (row) => (
      <td data-label="ID" className="muted" style={{ width: 78, minWidth: 78, fontVariantNumeric: 'tabular-nums' }}>
        #{row.id}
      </td>
    ),
  },
  reportedDate: {
    headerStyle: { width: 112, minWidth: 112 },
    // Reported and last-updated are read together, so they share one cell rather
    // than costing two columns. Sorting by either stays available through the
    // header sort control, which does not depend on a column being visible.
    renderCell: (row) => (
      <td data-label="Reported / Updated" className="cell-dates" style={{ width: 112, minWidth: 112 }}>
        {formatDateOnly(row.created_at)}
        <span className="cell-dates-updated">
          <i>upd</i> {formatDateOnly(row.status_update_at || row.updated_at)}
        </span>
      </td>
    ),
  },
  statusUpdate: {
    headerStyle: { width: 110, minWidth: 110 },
    renderCell: (row) => (
      <td data-label="Status Update" style={{ width: 110, minWidth: 110 }}>{formatDateOnly(row.status_update_at || row.updated_at)}</td>
    ),
  },
  type: {
    headerStyle: { width: 110 },
    renderCell: (row) => (
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
    ),
  },
  summary: {
    headerStyle: { minWidth: 240 },
    // The type badges ride along under the summary so the default view keeps that
    // signal without spending a column on it — the standalone Type column is
    // still available through Customize View for anyone who sorts by it visually.
    renderCell: (row) => (
      <td data-label="Summary" style={{ minWidth: 240, whiteSpace: 'normal', wordBreak: 'break-word' }}>
        <div style={{ fontWeight: 600, lineHeight: 1.4 }}>{row.summary_of_issue}</div>
        <div className="cell-summary-meta">
          <Badge value={inlineDisplayType(row)} />
          {row.is_cleanup && row.cleanup_tag_type !== 'cleanup_only' && <Badge value="Clean Up" />}
          {row.is_retired && <Badge value="Retired" />}
          {row.application_name && <span>{row.application_name}</span>}
          {row.has_resubmission && row.latest_resubmission_easyvista_ticket_id && (
            <Badge value={`Resubmitted: ${row.latest_resubmission_easyvista_ticket_id}`} />
          )}
          {row.is_resubmission && row.resubmission_of_easyvista_ticket_id && (
            <Badge value={`Resubmit of: ${row.resubmission_of_easyvista_ticket_id}`} />
          )}
        </div>
      </td>
    ),
  },
  status: {
    headerStyle: { width: 210, minWidth: 210 },
    renderCell: (row, ctx) => {
      const value = row.is_cleanup && row.cleanup_tag_type === 'cleanup_only'
        ? ctx.cleanupOnlyStatus
        : row.status;
      return (
        <td data-label="Status" style={{ minWidth: 190 }}>
          <select
            className={`bs-inline-select bs-inline-select--status sel-status--${statusVariant(row.is_retired ? 'Retired' : value)}`}
            aria-label={`Update defect or enhancement status for #${row.id}`}
            value={value}
            disabled={row.is_retired}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              ctx.updateStatusQuick(row.id, e.target.value, row);
            }}
          >
            {ctx.runtimeStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
      );
    },
  },
  cleanupStatus: {
    headerStyle: { width: 170, minWidth: 170 },
    renderCell: (row, ctx) => (
      <td data-label="Cleanup Status" style={{ minWidth: 160 }}>
        <select
          className="bs-inline-select"
          aria-label={`Update cleanup status for #${row.id}`}
          value={row.is_cleanup ? (row.cleanup_status || ctx.statusToCleanup[row.status] || 'New') : 'No Cleanup'}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            ctx.updateCleanupStatusQuick(row.id, e.target.value, row);
          }}
        >
          {ctx.runtimeCleanupInlineStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
    ),
  },
  isPublic: {
    headerStyle: { width: 96, minWidth: 96 },
    renderCell: (row, ctx) => (
      <td data-label="Public" style={{ minWidth: 96 }}>
        <select
          className="bs-inline-select"
          aria-label={`Update public visibility for #${row.id}`}
          value={row.is_public ? 'yes' : 'no'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            ctx.updatePublicQuick(row.id, e.target.value === 'yes');
          }}
        >
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </td>
    ),
  },
  easyvista: {
    headerStyle: { width: 118 },
    renderCell: (row) => (
      <td data-label="EasyVista" className="muted" style={{ whiteSpace: 'nowrap' }}>{row.easyvista_ticket_id || '—'}</td>
    ),
  },
  jiraCard: {
    headerStyle: { width: 140, minWidth: 140 },
    renderCell: (row, ctx) => (
      <td data-label="JIRA Card #" style={{ minWidth: 140 }}>
        <input
          // Remount when the row value changes so live updates from other
          // admins show up (defaultValue only applies on mount).
          key={row.jira_number || ''}
          className="bs-inline-input"
          aria-label={`Update JIRA number for #${row.id}`}
          defaultValue={row.jira_number || ''}
          placeholder="JIRA-123"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Delegate to onBlur so Enter followed by blur can't double-submit.
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={(e) => {
            e.stopPropagation();
            const next = e.currentTarget.value.trim();
            if (next !== (row.jira_number || '')) ctx.updateJiraQuick(row.id, next);
          }}
        />
      </td>
    ),
  },
  policyPremium: {
    headerStyle: { width: 160 },
    renderCell: (row) => (
      <td data-label="Policy Premium ($)">{formatCurrency(row.policy_premium_impact)}</td>
    ),
  },
  directImpact: {
    headerStyle: { width: 160 },
    renderCell: (row) => (
      <td data-label="Direct Impact ($)">{formatCurrency(row.direct_dollar_impact)}</td>
    ),
  },
  policiesImpacted: {
    headerStyle: { width: 140 },
    renderCell: (row) => (
      <td data-label="Policies Impacted">{formatNumber(row.policies_affected_count)}</td>
    ),
  },
  frequency: {
    headerStyle: { width: 160 },
    renderCell: (row) => (
      <td data-label="Frequency">
        {row.occurrence_count && row.occurrence_timeframe
          ? `${row.occurrence_count} per ${row.occurrence_timeframe_count > 1 ? `${row.occurrence_timeframe_count} ` : ''}${row.occurrence_timeframe}${row.occurrence_timeframe_count > 1 ? 's' : ''}`
          : '—'}
      </td>
    ),
  },
};
