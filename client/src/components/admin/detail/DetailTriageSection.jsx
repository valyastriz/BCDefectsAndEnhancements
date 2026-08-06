import { Input, Select, Textarea } from '../../bite-size/BitsizeUI';
import { DetailGroup } from './DetailPane';
import { CLEANUP_ONLY_STATUS, STATUS_TO_CLEANUP } from '../../../constants/adminConstants';
import { SUBMISSION_TYPE_REPORT, statusesForRequestType } from '../../../constants/statusConstants';
import { formatMetaTypeLabel } from '../../../utils/formatUtils';

const cleanupOnlyStatus = CLEANUP_ONLY_STATUS;
const statusToCleanup = STATUS_TO_CLEANUP;

/**
 * Triage — the decisions an admin makes on nearly every ticket, and the tab you
 * land on.
 *
 * Provenance and external identifiers live in History & reference; Decision
 * Notes came up out of a collapsed block, and the public-visibility toggle came
 * in from where it used to float above Attachments with no heading of its own.
 */
export function DetailTriageSection({
  edit,
  setEdit,
  dynamicCleanupStatuses,
  dynamicCleanupTagTypes,
  runtimeStatusOptions,
}) {
  const isReport = String(edit.type || '').trim().toLowerCase() === SUBMISSION_TYPE_REPORT;

  return (
    <div className="dm-groups">
      <DetailGroup label="Classification">
        {/* A report request is neither a cleanup task nor one of the three
            cleanup tag types, so it gets its type stated rather than offered:
            the select below is fed by `dynamicCleanupTagTypes`, and a value
            outside its own option list would silently rewrite the ticket's type
            the first time the control was touched. */}
        {isReport ? (
          <p className="bs-field-hint">Report request. The type cannot be changed here.</p>
        ) : (
          <>
        <label className="dm-check">
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
          </>
        )}

        <Select
          label={isReport ? 'Status' : 'Defect/Enhancement Status'}
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
          {/* Scoped to the ticket's own type. A report request is offered its
              nine words — 'In progress', 'Delivered', 'On hold' among them — and
              never 'Submitted' or 'Deployed', which are the Service Desk
              hand-off it does not make. */}
          {statusesForRequestType(edit.type, runtimeStatusOptions)
            .map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        {edit.is_retired && (
          <p className="bs-field-hint">Unretire the item to change its status.</p>
        )}

        {/* Only rendered for cleanup tickets — it used to sit permanently
            disabled in the grid for every other ticket. */}
        {edit.is_cleanup && (
          <Select
            label="Cleanup Status"
            value={edit.cleanup_status || 'New'}
            onChange={(e) => setEdit((p) => ({ ...p, cleanup_status: e.target.value }))}
          >
            {dynamicCleanupStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
      </DetailGroup>

      <DetailGroup label="Ownership & tracking">
        {/* Left blank, the server fills this with whoever saves — see
            reviewerForSave. The placeholder says so rather than the field being
            pre-filled here, which would mark every ticket edited on open. */}
        <Input
          label="Reviewer"
          value={edit.reviewer}
          placeholder="Your name, when you save"
          onChange={(e) => setEdit((p) => ({ ...p, reviewer: e.target.value }))}
        />
        <Input
          label="JIRA Number"
          value={edit.jira_number}
          onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))}
          placeholder="JIRA-123"
        />
        <label className="dm-check">
          <input
            type="checkbox"
            checked={Boolean(edit.logged_defect)}
            onChange={(e) => setEdit((p) => ({ ...p, logged_defect: e.target.checked }))}
          />
          <span>In JIRA</span>
        </label>
      </DetailGroup>

      {/* The alert at the top of the modal is the prompt; this is where the two
          flags actually live, so a request can also be raised on a reporter's
          behalf or reopened after the fact.

          NOT ON A REPORT REQUEST. A workaround is what you give someone whose
          work is blocked by something broken. Nothing is broken here — the
          report does not exist yet — so "does the reporter need a workaround"
          has no answer, and a permanently-unticked pair of boxes reads as an
          outstanding question rather than an inapplicable one. The columns stay
          on the row and keep whatever they hold; only the control goes. */}
      {!isReport && (
        <DetailGroup label="Workaround">
          <label className="dm-check">
            <input
              type="checkbox"
              checked={Boolean(edit.needs_workaround)}
              onChange={(e) => setEdit((p) => ({ ...p, needs_workaround: e.target.checked }))}
            />
            <span>Reporter needs a workaround for their case</span>
          </label>
          <label className="dm-check">
            <input
              type="checkbox"
              disabled={!edit.needs_workaround}
              checked={Boolean(edit.workaround_provided)}
              onChange={(e) => setEdit((p) => ({ ...p, workaround_provided: e.target.checked }))}
            />
            <span>Workaround provided</span>
          </label>
        </DetailGroup>
      )}

      <DetailGroup label="Decision">
        <Textarea
          label="Decision Notes"
          rows={3}
          value={edit.decision_notes}
          onChange={(e) => setEdit((p) => ({ ...p, decision_notes: e.target.value }))}
        />
        <label className="dm-check dm-check--consequence">
          <input
            type="checkbox"
            checked={Boolean(edit.is_public)}
            onChange={(e) => setEdit((p) => ({ ...p, is_public: e.target.checked }))}
          />
          <span>Visible on Public Status Board</span>
        </label>
      </DetailGroup>
    </div>
  );
}
