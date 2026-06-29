import { Badge } from '../bite-size/BitsizeUI';
import { formatCurrency, formatNumber, formatDateOnly } from '../../utils/formatUtils';
import { inlineDisplayType } from '../../utils/mappers';

/**
 * Per-column header style + cell renderer for the admin submissions table.
 *
 * Keyed by the column keys in ADMIN_TABLE_COLUMNS (constants/adminConstants.js).
 * `renderCell(row, ctx)` returns the full <td>; `ctx` carries the quick-edit
 * handlers and runtime option lists the editable cells need. The markup mirrors
 * what previously lived inline in SubmissionsTable so behavior is unchanged.
 */
export const COLUMN_DEFS = {
  reportedDate: {
    headerStyle: { width: 110, minWidth: 110 },
    renderCell: (row) => (
      <td data-label="Reported Date" style={{ width: 110, minWidth: 110 }}>{formatDateOnly(row.created_at)}</td>
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
    headerStyle: { minWidth: 200 },
    renderCell: (row) => (
      <td data-label="Summary" style={{ minWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.summary_of_issue}</td>
    ),
  },
  status: {
    headerStyle: { width: 210, minWidth: 210 },
    renderCell: (row, ctx) => (
      <td data-label="Status" style={{ minWidth: 170 }}>
        <select
          className="bs-inline-select"
          aria-label={`Update defect or enhancement status for #${row.id}`}
          value={row.is_cleanup && row.cleanup_tag_type === 'cleanup_only' ? ctx.cleanupOnlyStatus : row.status}
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
    ),
  },
  cleanupStatus: {
    headerStyle: { width: 170, minWidth: 170 },
    renderCell: (row, ctx) => (
      <td data-label="Cleanup Status" style={{ minWidth: 170 }}>
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
    headerStyle: { width: 110, minWidth: 110 },
    renderCell: (row, ctx) => (
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
    headerStyle: { width: 110 },
    renderCell: (row) => (
      <td data-label="EasyVista" className="muted">{row.easyvista_ticket_id || '—'}</td>
    ),
  },
  jiraCard: {
    headerStyle: { width: 140, minWidth: 140 },
    renderCell: (row, ctx) => (
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
              ctx.updateJiraQuick(row.id, e.currentTarget.value.trim());
            }
          }}
          onBlur={(e) => {
            e.stopPropagation();
            ctx.updateJiraQuick(row.id, e.currentTarget.value.trim());
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
