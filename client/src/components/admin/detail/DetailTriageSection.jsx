import { Input, Select, Textarea } from '../../bite-size/BitsizeUI';
import { STATUS_TO_CLEANUP } from '../../../constants/adminConstants';
import {
  formatMetaTypeLabel,
  formatCreatedViaLabel,
  isAutoEasyVistaReporter,
} from '../../../utils/formatUtils';

const cleanupOnlyStatus = '⛏ Cleanup Only';
const statusToCleanup = STATUS_TO_CLEANUP;

/**
 * Triage grid plus the Triage/Release Info <details> block.
 */
export function DetailTriageSection({
  detail,
  edit,
  setEdit,
  dynamicCleanupStatuses,
  dynamicCleanupTagTypes,
  runtimeStatusOptions,
}) {
  return (
    <>
      {/* ── Triage ── */}
      <p className="section-label">Triage</p>
      <div className="bs-grid two">
        <label className="toggle-row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={Boolean(edit.is_cleanup)}
            onChange={(e) =>
              setEdit((p) => ({
                ...p,
                is_cleanup: e.target.checked,
                cleanup_status: e.target.checked
                  ? (p.cleanup_status || statusToCleanup[p.status] || 'New')
                  : p.cleanup_status,
                cleanup_tag_type: e.target.checked
                  ? (
                      p.cleanup_tag_type
                      || (p.type === 'enhancement' ? 'enhancement' : 'defect')
                    )
                  : '',
              }))
            }
          />
          <span>Clean Up Task</span>
        </label>

        <Select
          label="Type"
          value={edit.is_cleanup ? (edit.cleanup_tag_type || 'cleanup_only') : edit.type}
          onChange={(e) =>
            setEdit((p) => {
              if (p.is_cleanup) {
                const nextCleanupTagType = e.target.value;
                return {
                  ...p,
                  cleanup_tag_type: nextCleanupTagType,
                  type: nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect',
                };
              }
              return { ...p, type: e.target.value };
            })
          }
        >
          {dynamicCleanupTagTypes.map((option) => {
            if (!edit.is_cleanup && option === 'cleanup_only') {
              return null;
            }
            return <option key={option} value={option}>{formatMetaTypeLabel(option)}</option>;
          })}
        </Select>

        <Select
          label="Defect/Enhancement Status"
          value={edit.is_cleanup && edit.cleanup_tag_type === 'cleanup_only' ? cleanupOnlyStatus : edit.status}
          disabled={edit.is_retired}
          onChange={(e) =>
            setEdit((p) => ({
              ...p,
              is_cleanup: e.target.value === cleanupOnlyStatus ? true : p.is_cleanup,
              cleanup_status:
                e.target.value === cleanupOnlyStatus
                  ? (p.cleanup_status || statusToCleanup[p.status] || 'Not Started')
                  : p.cleanup_status,
              status: e.target.value === cleanupOnlyStatus ? 'New' : e.target.value,
              cleanup_tag_type:
                e.target.value === cleanupOnlyStatus
                  ? 'cleanup_only'
                  : (
                      p.cleanup_tag_type === 'cleanup_only'
                        ? (p.type === 'enhancement' ? 'enhancement' : 'defect')
                        : p.cleanup_tag_type
                    ),
              type: e.target.value === cleanupOnlyStatus ? 'defect' : p.type,
            }))
          }
        >
          {runtimeStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select
          label="Cleanup Status"
          value={edit.cleanup_status || 'New'}
          onChange={(e) => setEdit((p) => ({ ...p, cleanup_status: e.target.value }))}
          disabled={!edit.is_cleanup}
        >
          {dynamicCleanupStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Input label="Reviewer" value={edit.reviewer} onChange={(e) => setEdit((p) => ({ ...p, reviewer: e.target.value }))} />
        <Input label="Duplicate Reference (EasyVista / JIRA / ID)" value={edit.duplicate_of} onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))} />
        <Input
          label="Submitted to EV By"
          value={edit.easyvista_submitted_by}
          readOnly={isAutoEasyVistaReporter(edit.easyvista_submitted_by)}
          onChange={(e) => setEdit((p) => ({ ...p, easyvista_submitted_by: e.target.value }))}
          placeholder="Unknown"
        />
        <Input
          label="Created Via"
          value={formatCreatedViaLabel(edit.created_via || detail.created_via || '')}
          readOnly
          placeholder="—"
        />
        <Input label="JIRA Number" value={edit.jira_number} onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))} placeholder="JIRA-123" />
        <Input label="EasyVista Ticket" value={detail.easyvista_ticket_id || ''} readOnly placeholder="—" />
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Triage/Release Info</summary>
        <div className="bs-form" style={{ marginTop: 12 }}>
          <Textarea label="Decision Notes" rows={2} value={edit.decision_notes} onChange={(e) => setEdit((p) => ({ ...p, decision_notes: e.target.value }))} />
          <Input label="Release #" placeholder="e.g. v1.2.0" value={edit.release_number} onChange={(e) => setEdit((p) => ({ ...p, release_number: e.target.value }))} />
          <Textarea label="Release Notes" rows={3} value={edit.release_notes} onChange={(e) => setEdit((p) => ({ ...p, release_notes: e.target.value }))} />
        </div>
      </details>
    </>
  );
}
