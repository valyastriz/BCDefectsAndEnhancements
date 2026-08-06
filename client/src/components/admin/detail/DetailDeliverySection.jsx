import { useRef, useState } from 'react';
import { Input, Select, Textarea } from '../../bite-size/BitsizeUI';
import { DetailGroup } from './DetailPane';
import { formatDateOnly } from '../../../utils/formatUtils';

/**
 * Delivery — the analyst's half of a report request.
 *
 * Takes the sixth tab slot, where the Service Desk hand-off sits for every other
 * type. A report request is finished by an analyst in the portal and never handed
 * downstream, so that pane has nothing to offer it.
 *
 * Built from the approved mockup v3:
 * https://claude.ai/code/artifact/9d716633-70b6-45f0-94c4-44ad493be76c
 *
 * Three of the values on this pane are DERIVED and have no column: the hours
 * total, "complete", and "approved". The source field list had `Complete`,
 * `Completed` and `Complete Date` — three fields for one fact, and three chances
 * for them to disagree. There is one timestamp and these read off it.
 */

/** 3 -> "3", 3.5 -> "3.5", 5.75 -> "5.75". The input steps in quarter hours. */
function hoursText(value) {
  return String(Math.round(Number(value || 0) * 100) / 100);
}

const KIND_FROM_NAME = (name) => (String(name).split('.').pop() || 'file').toUpperCase().slice(0, 4);

export function DetailDeliverySection({
  detail,
  edit,
  setEdit,
  locked,
  working,
  dynamicPriorityLevels,
  dynamicLevelsOfEffort,
  viewerUserId,
  onLogHours,
  onRemoveHours,
  onAttachApproval,
  onRemoveApproval,
}) {
  // Closed by default. A ledger grows without limit and most visits to this pane
  // are not about it, so the numbers ride on the label and the rows fold away.
  const [hoursOpen, setHoursOpen] = useState(false);
  const [draft, setDraft] = useState({ worked_on: '', hours: '', note: '' });
  const hoursInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const entries = detail.time_entries || [];
  const totalHours = detail.total_hours || 0;
  const byUser = detail.by_user || [];
  const assignments = detail.assignments || [];
  const assignable = detail.assignable_users || [];
  const approvalFiles = (detail.attachments || []).filter((file) => file.purpose === 'approval');

  const assignedName = assignable.find((user) => Number(user.id) === Number(edit.assigned_to))?.name;
  const isMine = Number(edit.assigned_to) === Number(viewerUserId);
  // Both a name and a date, or it is not an approval — a name on its own is
  // half-typed.
  const isApproved = Boolean(edit.approved_at && edit.approved_by_name);
  const canLog = Number(draft.hours) > 0 && Boolean(draft.worked_on);

  const openHours = (focus) => {
    setHoursOpen(true);
    if (focus) window.setTimeout(() => hoursInputRef.current?.focus(), 0);
  };

  const logHours = async () => {
    await onLogHours({ ...draft, hours: Number(draft.hours) });
    setDraft({ worked_on: '', hours: '', note: '' });
  };

  return (
    <>
      <div className="dm-groups">
        <DetailGroup label="Assignment">
          <Select
            label="Assigned to"
            value={edit.assigned_to ?? ''}
            onChange={(e) => setEdit((p) => ({ ...p, assigned_to: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">Nobody yet</option>
            {assignable.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </Select>
          {isMine ? (
            <p className="dm-note">This one is yours.</p>
          ) : (
            <div className="dm-stamp-acts">
              <button
                type="button"
                className="dm-act"
                disabled={locked || !viewerUserId}
                onClick={() => setEdit((p) => ({ ...p, assigned_to: viewerUserId }))}
              >
                {assignedName ? `Take it from ${assignedName.split(' ')[0]}` : 'Take it'}
              </button>
            </div>
          )}
          {assignments.length > 1 && (
            <p className="dm-note">
              {`Reassigned ${assignments.length - 1} ${assignments.length === 2 ? 'time' : 'times'} — see History.`}
            </p>
          )}
        </DetailGroup>

        <DetailGroup label="Sizing">
          <Select
            label="Level of effort"
            value={edit.level_of_effort || ''}
            onChange={(e) => setEdit((p) => ({ ...p, level_of_effort: e.target.value }))}
          >
            <option value="">Not sized</option>
            {dynamicLevelsOfEffort.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
          <Select
            label="Priority"
            value={edit.priority_level || ''}
            onChange={(e) => setEdit((p) => ({ ...p, priority_level: e.target.value }))}
          >
            <option value="">Not set</option>
            {dynamicPriorityLevels.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </DetailGroup>
      </div>

      {/* What actually came out of it, in the analyst's words.
          The other three types answer this with Release # and Release Notes on
          the History tab. A report request is finished in the portal and handed
          to the person who asked — nothing ships, so there is no release to
          number, and those two fields are hidden for this type rather than
          repurposed. This is where the answer goes instead. */}
      <div className="dm-group dm-group--wide">
        <span className="dm-group-label">Delivery notes</span>
        <Textarea
          label="What was delivered"
          rows={3}
          value={edit.delivery_notes || ''}
          placeholder="What the requester got, where it lives, and anything they need to know to use it."
          onChange={(e) => setEdit((p) => ({ ...p, delivery_notes: e.target.value }))}
        />
      </div>

      {/* Labelled "Go-ahead", not "Approval": the identity band already carries a
          status badge that can read "Approved", and two unrelated things called
          approval on one screen is a question nobody should have to answer
          twice. The approver is TYPED because they are usually not a portal user
          — a manager who replied to an email — and who RECORDED it is the
          server's answer, because a name with nobody behind it is a claim. */}
      <div className="dm-group dm-group--wide">
        <span className="dm-group-label">Go-ahead</span>
        <div className={`dm-stamp${isApproved ? ' dm-stamp--on' : ''}`}>
          <p className="dm-stamp-line">
            {isApproved ? (
              <>
                <b>{`Approved by ${edit.approved_by_name}`}</b>
                <span>
                  {`on ${formatDateOnly(edit.approved_at)}`}
                  {detail.approval_recorded_by_name ? ` · recorded by ${detail.approval_recorded_by_name}` : ''}
                </span>
              </>
            ) : (
              <>
                <b>Not approved yet</b>
                <span>Work can be logged either way — this records who said go, and what they said it in.</span>
              </>
            )}
            <em className="dm-rotag">derived</em>
          </p>
          {isApproved && (
            <div className="dm-stamp-acts">
              <button
                type="button"
                className="dm-act dm-act--quiet"
                disabled={locked}
                onClick={() => setEdit((p) => ({ ...p, approved_at: '', approved_by_name: '' }))}
              >
                Clear it
              </button>
            </div>
          )}
        </div>

        <div className="dm-groups">
          <Input
            label="Who approved it"
            placeholder="Their name"
            value={edit.approved_by_name || ''}
            onChange={(e) => setEdit((p) => ({ ...p, approved_by_name: e.target.value }))}
          />
          <Input
            label="On"
            type="date"
            value={(edit.approved_at || '').slice(0, 10)}
            onChange={(e) => setEdit((p) => ({ ...p, approved_at: e.target.value }))}
          />
        </div>

        {approvalFiles.length > 0 && (
          <ul className="dm-files">
            {approvalFiles.map((file) => (
              <li key={file.id} className="dm-file">
                <span className="dm-file-kind">{KIND_FROM_NAME(file.filename)}</span>
                <span className="dm-file-name">
                  {/* Through the app, never /uploads: that path is served with no
                      authentication at all, which is fine for a screenshot and
                      not for an approval email. */}
                  <a href={`/api/admin/attachments/${file.id}/file`} download>{file.filename}</a>
                </span>
                <button
                  type="button"
                  className="dm-file-x"
                  disabled={locked || working}
                  aria-label={`Remove ${file.filename}`}
                  onClick={() => onRemoveApproval(file.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dm-drop">
          <button
            type="button"
            className="dm-act"
            disabled={locked || working}
            onClick={() => fileInputRef.current?.click()}
          >
            Attach the approval…
          </button>
          <span>
            The email, the ticket, the signed page — PDF, Word, Excel, Outlook message
            or an image, up to 10&nbsp;MB.
          </span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.msg,.eml,.txt,.csv,image/*"
            onChange={(e) => {
              const chosen = [...(e.target.files || [])];
              e.target.value = '';
              if (chosen.length > 0) onAttachApproval(chosen);
            }}
          />
        </div>
      </div>

      {/* Hours. Closed by default, but the numbers stay on the label: a closed
          group that hides its own summary is just a hidden group. */}
      <div className="dm-group dm-group--wide">
        <button
          type="button"
          className="dm-fold-btn"
          aria-expanded={hoursOpen}
          aria-controls="dm-hrs-body"
          onClick={() => setHoursOpen((open) => !open)}
        >
          <span className="dm-group-label">Hours logged</span>
          <span className="dm-fold-sum">
            <b>{`${hoursText(totalHours)} h`}</b>
            <em className="dm-rotag">derived</em>
            <span>
              {entries.length === 0
                ? 'nothing logged'
                : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${byUser.length > 1 ? `, ${byUser.length} people` : ''}`}
            </span>
          </span>
          <span className="dm-caret" aria-hidden="true" />
        </button>

        <div className="dm-hrs" id="dm-hrs-body">
          {/* Who did which part — the number throughput reporting actually uses,
              and it stays readable while the ledger is folded. */}
          {byUser.length > 1 && (
            <p className="dm-hrs-by">
              {byUser.map((person, index) => (
                <span key={person.user_id}>
                  {index > 0 ? ' · ' : ''}
                  <b>{person.user_name}</b>
                  {` ${hoursText(person.hours)} h`}
                </span>
              ))}
            </p>
          )}

          {!hoursOpen && (
            <div className="dm-stamp-acts">
              <button type="button" className="dm-act" disabled={locked} onClick={() => openHours(true)}>
                Log hours
              </button>
            </div>
          )}

          {hoursOpen && (
            <>
              {entries.length === 0 ? (
                <p className="dm-none">No hours logged yet.</p>
              ) : (
                <ul className="dm-hrs-list">
                  {entries.map((entry) => (
                    <li key={entry.id} className="dm-hrs-row">
                      <span className="dm-hrs-who">{entry.user_name}</span>
                      <span className="dm-hrs-when">{formatDateOnly(entry.worked_on)}</span>
                      <span className="dm-hrs-amt">{`${hoursText(entry.hours)} h`}</span>
                      {/* Somebody else's logged time is their record, and it is
                          the basis of a number about them. */}
                      {Number(entry.user_id) === Number(viewerUserId) ? (
                        <button
                          type="button"
                          className="dm-hrs-x"
                          disabled={locked || working}
                          aria-label={`Remove your ${hoursText(entry.hours)} hours on ${formatDateOnly(entry.worked_on)}`}
                          onClick={() => onRemoveHours(entry.id)}
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="dm-hrs-x" aria-hidden="true" />
                      )}
                      {entry.note && <p className="dm-hrs-note">{entry.note}</p>}
                    </li>
                  ))}
                </ul>
              )}

              <div className="dm-hrs-add">
                <Input
                  label="Day worked"
                  type="date"
                  value={draft.worked_on}
                  onChange={(e) => setDraft((p) => ({ ...p, worked_on: e.target.value }))}
                />
                <label className="bs-field">
                  <span>Hours</span>
                  <input
                    ref={hoursInputRef}
                    type="number"
                    step="0.25"
                    min="0"
                    placeholder="e.g. 1.5"
                    value={draft.hours}
                    onChange={(e) => setDraft((p) => ({ ...p, hours: e.target.value }))}
                  />
                </label>
                <Input
                  label="What you did"
                  placeholder="Optional"
                  value={draft.note}
                  onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
                />
                <button type="button" className="dm-act" disabled={locked || working || !canLog} onClick={logHours}>
                  Log it
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="dm-group dm-group--wide">
        <span className="dm-group-label">Completion</span>
        <div className={`dm-stamp${edit.completed_at ? ' dm-stamp--on' : ''}`}>
          <p className="dm-stamp-line">
            {edit.completed_at ? (
              <>
                <b>Complete</b>
                <span>{`delivered ${formatDateOnly(edit.completed_at)} · ${hoursText(totalHours)} h of work`}</span>
              </>
            ) : (
              <>
                <b>Not complete</b>
                <span>There is no completion date on it yet.</span>
              </>
            )}
            <em className="dm-rotag">derived</em>
          </p>
          <div className="dm-stamp-acts">
            {edit.completed_at ? (
              <button
                type="button"
                className="dm-act dm-act--quiet"
                disabled={locked}
                onClick={() => setEdit((p) => ({ ...p, completed_at: '' }))}
              >
                Reopen it
              </button>
            ) : (
              <button
                type="button"
                className="dm-act"
                disabled={locked}
                onClick={() => setEdit((p) => ({ ...p, completed_at: new Date().toISOString().slice(0, 10) }))}
              >
                Mark it delivered
              </button>
            )}
          </div>
        </div>
        <Input
          label="Completed on"
          type="date"
          value={(edit.completed_at || '').slice(0, 10)}
          onChange={(e) => setEdit((p) => ({ ...p, completed_at: e.target.value }))}
        />
        <p className="bs-field-hint">
          Set when you mark it delivered. Correct it here if the work actually finished on a
          different day.
        </p>
      </div>
    </>
  );
}

/** The handover trail, on the History tab beside the status one. */
export function DetailHandoverSection({ assignments }) {
  if (!assignments || assignments.length === 0) {
    return <p className="dm-none">Nobody has been assigned to this yet.</p>;
  }
  const current = assignments[0];
  return (
    <>
      <p className="dm-hand-current">
        <b>{current.assigned_to_name || 'Nobody'}</b>
        <span>has it now</span>
      </p>
      <div className="dm-timeline-scroll">
        <ol className="dm-timeline">
          {assignments.map((entry, index) => (
            <li key={entry.id} className={`dm-event${index === 0 ? ' dm-event--latest' : ''}`}>
              <span className="dm-event-dot" aria-hidden="true" />
              <p className="dm-event-title">{entry.assigned_to_name || 'Unassigned'}</p>
              <p className="dm-event-meta">
                {formatDateOnly(entry.assigned_at)}
                {entry.assigned_by_name ? ` · assigned by ${entry.assigned_by_name}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
