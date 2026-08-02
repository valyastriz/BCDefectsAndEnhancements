import { useEffect, useState } from 'react';
import { Button, Notice } from '../../bite-size/BitsizeUI';
import { api } from '../../../lib/api';
import { buildAdminUpdatePayload, hasPendingModalChanges } from '../../../utils/mappers';
import { resolveAttachmentUrl } from '../../../utils/formatUtils';
import { EASYVISTA_REQUIREMENT_FIELD } from '../../../constants/detailModalConstants';

/**
 * Which payload rows an admin can edit, and how. Anything absent from here is
 * shown as text: `type` is set by the Send as control, and `created_by` is the
 * requester, composed from two fields nobody edits from this screen.
 */
const EDITORS = {
  summary_of_issue: { control: 'text' },
  screen_title: { control: 'text', placeholder: 'Screen or page name' },
  policy_num: { control: 'text' },
  account_num: { control: 'text' },
  transaction_num: { control: 'text' },
  jira_number: { control: 'text', placeholder: 'JIRA-123' },
  date_time_of_error: { control: 'datetime-local' },
  desired_completion_date: { control: 'date' },
  application_name: { control: 'select', options: 'applications' },
  enhancement_request_type: { control: 'select', options: 'requestTypes', blank: 'Select one' },
  priority_level: { control: 'select', options: 'priorityLevels' },
  steps_to_reproduce: { control: 'textarea' },
  what_happened_exact_details: { control: 'textarea' },
  request: { control: 'textarea' },
  impact_details: { control: 'textarea' },
};

/**
 * Fetches what a send would transmit.
 *
 * The server runs the real submit path in dry-run mode and returns before the
 * API call, so this cannot disagree with the request. Debounced, because it
 * re-runs as the admin edits — and only while this tab is mounted.
 */
function useEasyVistaPreview(openId, detail, edit, sendAsType, attachmentIds) {
  const [state, setState] = useState({ loading: true, error: '', preview: null });

  const draftKey = JSON.stringify(buildAdminUpdatePayload(edit));

  useEffect(() => {
    if (!openId) return undefined;
    let cancelled = false;
    const draft = hasPendingModalChanges(detail, edit) ? buildAdminUpdatePayload(edit) : null;

    const timer = setTimeout(() => {
      api.previewEasyVista(openId, draft, sendAsType, attachmentIds)
        .then((preview) => {
          if (!cancelled) setState({ loading: false, error: '', preview });
        })
        .catch((err) => {
          if (!cancelled) setState({ loading: false, error: err.message, preview: null });
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // draftKey stands in for `edit` so the preview refetches on a real value
    // change rather than on every keystroke that produces the same payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, detail, draftKey, sendAsType, JSON.stringify(attachmentIds)]);

  return state;
}

/**
 * One outgoing field: its label, the value that will be sent, and whether an
 * unsaved edit changed it. Editable fields are edited here rather than being
 * listed a second time elsewhere on the tab.
 */
function PayloadRow({ row, edit, setEdit, options, required, readOnly }) {
  const editor = readOnly ? null : EDITORS[row.key];
  const onChange = (e) => setEdit((p) => ({ ...p, [row.key]: e.target.value }));
  const value = edit[row.key] ?? '';

  let control = null;
  if (!editor) {
    control = <span className="dm-prow-v">{row.value === '' ? <em>empty</em> : row.value}</span>;
  } else if (editor.control === 'select') {
    control = (
      <select className="dm-prow-input" value={value} onChange={onChange}>
        {editor.blank && <option value="">{editor.blank}</option>}
        {(options[editor.options] || []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  } else if (editor.control === 'textarea') {
    control = (
      <textarea className="dm-prow-input" rows={3} value={value} onChange={onChange} />
    );
  } else {
    control = (
      <input
        className="dm-prow-input"
        type={editor.control}
        value={value}
        placeholder={editor.placeholder}
        onChange={onChange}
      />
    );
  }

  const modifier = required ? ' dm-prow--missing' : (row.changed ? ' dm-prow--changed' : '');
  return (
    <div className={`dm-prow${modifier}`}>
      <span className="dm-prow-k">
        {row.label}
        {required && <em className="dm-rotag dm-rotag--req">required</em>}
      </span>
      {control}
      {row.changed && <span className="dm-prow-tag">changed</span>}
      {row.changed && (
        <span className="dm-prow-was">
          was <s>{row.previous === '' ? 'empty' : row.previous}</s>
        </span>
      )}
    </div>
  );
}

/**
 * The EasyVista Submission tab: what will be sent, editable in place, what
 * sending will do, and what is stopping it.
 *
 * Two things were invisible before this existed. Re-submitting does not update
 * the existing ticket — it creates a new submission and a new EasyVista ticket
 * and copies the attachments across, leaving the original untouched. And most of
 * the modal's fields never reach EasyVista at all.
 */
export function DetailEasyVistaSection({
  openId,
  detail,
  edit,
  setEdit,
  locked,
  working,
  missingRequirements,
  visibleAttachments,
  submitEasyVista,
  resolvedSendAsType,
  defaultSendAsType,
  setSendAsType,
  easyVistaAttachmentIds,
  setEasyVistaAttachmentIds,
  uploadAttachment,
  setPreviewAttachment,
  dynamicApplications,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
}) {
  const { loading, error, preview } = useEasyVistaPreview(
    openId, detail, edit, resolvedSendAsType, easyVistaAttachmentIds,
  );
  const [confirming, setConfirming] = useState(false);

  const isResubmit = Boolean(detail.easyvista_ticket_id);
  const mustChoose = !resolvedSendAsType;
  const blocked = mustChoose || missingRequirements.length > 0;
  const changedRows = (preview?.rows || []).filter((row) => row.changed);
  const sentAsLabel = resolvedSendAsType === 'enhancement' ? 'Enhancement' : 'Defect';
  const isCleanupOnly = detail.is_cleanup
    && (detail.cleanup_tag_type === 'cleanup_only' || !detail.cleanup_tag_type);

  const missingFields = new Set(
    missingRequirements.map((label) => EASYVISTA_REQUIREMENT_FIELD[label]),
  );
  const options = {
    applications: dynamicApplications,
    requestTypes: dynamicEnhancementRequestTypes,
    priorityLevels: dynamicPriorityLevels,
  };

  return (
    <>
      <div className="dm-ev-head">
        <h4>What EasyVista will receive</h4>
        <p>
          Every field below is what actually goes out, editable in place. The list is built
          by the server from the same code that sends it, so it cannot drift from the
          request.
        </p>
      </div>

      {/* A stubbed send still writes a realistic-looking EV-##### onto the
          record, so the admin has to be told it was not real. */}
      {preview && !preview.live && (
        <Notice
          kind="info"
          text={'The EasyVista connection is not switched on yet. Sending records a placeholder '
            + 'ticket number and files stay here — nothing is transmitted.'}
        />
      )}

      {/* EasyVista takes a defect or an enhancement and nothing else. A Cleanup
          Only task is neither, so it has no default and must be chosen — which
          is how a cleanup task reaches EasyVista without being reclassified. */}
      <fieldset className={`dm-sendas${mustChoose ? ' dm-sendas--required' : ''}`}>
        <legend>Send as</legend>
        <div className="dm-sendas-options">
          {['defect', 'enhancement'].map((option) => (
            <label key={option} className="dm-sendas-opt">
              <input
                type="radio"
                name={`dm-sendas-${openId}`}
                value={option}
                checked={resolvedSendAsType === option}
                disabled={locked}
                onChange={() => setSendAsType(option)}
              />
              <span>{option === 'enhancement' ? 'Enhancement' : 'Defect'}</span>
            </label>
          ))}
        </div>
        <p className="dm-sendas-note">
          {mustChoose
            ? `This is a Cleanup Only task and EasyVista has no such type, so pick the one it should be raised under.${
              isResubmit
                ? ' It already has a ticket, so sending creates a new submission with that type; this one stays Cleanup Only.'
                : ' This is its first send, so the task itself becomes cleanup work tagged with the type you pick.'}`
            : resolvedSendAsType === defaultSendAsType
              ? `Matches the ticket's own type.${isResubmit ? ' The new submission this creates will have this type.' : ''}`
              : `Overriding the ticket's own type — EasyVista will be told this is a ${sentAsLabel}. ${
                isResubmit
                  ? 'The new submission gets that type; this record keeps its own.'
                  : 'This record keeps its own type.'}`}
        </p>
      </fieldset>

      {/* Collapsed by default: useful to be able to check, but not what an admin
          is here to read. The confirm dialog states all of it again at the
          moment it matters. */}
      {isResubmit ? (
        <details className="dm-consequence dm-consequence--fold">
          <summary>
            <span className="dm-caret" aria-hidden="true" />
            <span>Sending forks this ticket</span>
            <span className="dm-nested-hint">creates a new submission and a new ticket</span>
          </summary>
          <ul>
            <li>
              Creates a <strong>new submission</strong>
              {resolvedSendAsType && <> as a <strong>{sentAsLabel}</strong></>} and a{' '}
              <strong>new EasyVista ticket</strong>.
            </li>
            <li>
              <strong>{detail.easyvista_ticket_id} is not updated</strong> — it stays as it is,
              and the two records stay linked.
            </li>
            {visibleAttachments.length > 0 && (
              <li>
                {visibleAttachments.length === 1
                  ? 'The 1 attachment is copied'
                  : `All ${visibleAttachments.length} attachments are copied`} onto the new record.
              </li>
            )}
            <li>Three entries are written to the status history.</li>
          </ul>
        </details>
      ) : (
        <details className="dm-consequence dm-consequence--fold">
          <summary>
            <span className="dm-caret" aria-hidden="true" />
            <span>This is the first send</span>
            <span className="dm-nested-hint">updates this record in place</span>
          </summary>
          <ul>
            <li><strong>No new submission is created</strong> — this record is updated in place.</li>
            <li>Stores the new EasyVista id and sets the status to <strong>Submitted</strong>.</li>
            {isCleanupOnly && resolvedSendAsType && (
              <li>Tags this task as <strong>Cleanup + {sentAsLabel}</strong>.</li>
            )}
          </ul>
        </details>
      )}

      {/* Reads as "here is what to fill in", not "you may not do this" —
          switching type is always allowed, it just asks for different fields. */}
      {blocked && (
        <Notice
          kind="info"
          text={mustChoose
            ? 'Choose Defect or Enhancement to continue.'
            : `A ${sentAsLabel} needs ${missingRequirements.length === 1 ? 'one more field' : `${missingRequirements.length} more fields`}: ${missingRequirements.join(', ')}. Fill ${missingRequirements.length === 1 ? 'it' : 'them'} in below — ${missingRequirements.length === 1 ? 'it is' : 'they are'} flagged in the list.`}
        />
      )}

      {error && <Notice text={`Could not build the preview: ${error}`} />}

      {loading && !preview && (
        <div className="dm-payload">
          <div className="dm-payload-head"><h5>Outgoing fields</h5><span>loading…</span></div>
          <div className="dm-sk-rows">
            {[1, 2, 3, 4, 5].map((n) => <span key={n} className="sk-bar" />)}
          </div>
        </div>
      )}

      {preview && preview.rows.length > 0 && (
        <>
          <div className="dm-payload">
            <div className="dm-payload-head">
              <h5>Outgoing fields</h5>
              <span>
                {`${preview.rows.length} fields`}
                {changedRows.length > 0 && ` · ${changedRows.length} changed by your unsaved edits`}
              </span>
            </div>
            <div className="dm-payload-rows">
              {preview.rows.map((row) => (
                <PayloadRow
                  key={row.key}
                  row={row}
                  edit={edit}
                  setEdit={setEdit}
                  options={options}
                  required={missingFields.has(row.key)}
                  readOnly={locked}
                />
              ))}
            </div>
          </div>

          {/* Directly under the outgoing fields: the files are part of what is
              being sent, not a separate concern. */}
          <EasyVistaFiles
            preview={preview}
            selectedIds={easyVistaAttachmentIds}
            setSelectedIds={setEasyVistaAttachmentIds}
            uploadAttachment={uploadAttachment}
            setPreviewAttachment={setPreviewAttachment}
            locked={locked}
            effectiveType={detail.type}
          />

        </>
      )}

      <div className="bs-actions">
        <Button
          type="button"
          disabled={blocked || locked || working || !preview}
          onClick={() => setConfirming(true)}
        >
          {isResubmit ? 'Re-submit to EasyVista…' : 'Submit to EasyVista…'}
        </Button>
      </div>

      <EasyVistaConfirm
        open={confirming}
        onClose={() => setConfirming(false)}
        onSend={() => { setConfirming(false); submitEasyVista(); }}
        detail={detail}
        preview={preview}
        changedRows={changedRows}
        isResubmit={isResubmit}
        attachmentCount={visibleAttachments.length}
        sentAsLabel={sentAsLabel}
        isCleanupOnly={isCleanupOnly}
      />
    </>
  );
}

/**
 * Which of the ticket's files travel with the submission.
 *
 * EasyVista takes at most four, so this is a genuine choice rather than a list.
 * New files added here go through the normal attachment upload, so they land on
 * the ticket too — there is no second, EasyVista-only pile of files.
 */
function EasyVistaFiles({
  preview, selectedIds, setSelectedIds, uploadAttachment, setPreviewAttachment,
  locked, effectiveType,
}) {
  const all = preview.attachments || [];
  const max = preview.maxAttachments || 4;
  // `null` means untouched, which the server reads as "all of them, up to the cap".
  const selected = selectedIds ?? all.filter((att) => att.selected).map((att) => att.id);
  const atCap = selected.length >= max;

  const toggle = (id) => {
    setSelectedIds(selected.includes(id)
      ? selected.filter((each) => each !== id)
      : [...selected, id]);
  };

  return (
    <div className="dm-evfiles">
      <div className="dm-payload-head">
        <h5>Files</h5>
        <span>
          {all.length === 0
            ? 'none on this ticket'
            : `${selected.length} of ${all.length} selected · EasyVista accepts ${max}`}
        </span>
      </div>

      {all.length > 0 && (
        <div className="thumb-grid dm-evgrid">
          {all.map((att) => {
            const isSelected = selected.includes(att.id);
            const isImage = att.mime_type?.startsWith('image/');
            return (
              <figure
                key={att.id}
                className={`dm-thumb dm-evthumb${isSelected ? ' dm-evthumb--on' : ''}`}
              >
                <label className="dm-evthumb-pick">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={locked || (!isSelected && atCap)}
                    onChange={() => toggle(att.id)}
                  />
                  <span>{isSelected ? 'Sending' : 'Not sent'}</span>
                </label>

                {/* Same preview behaviour as the Files tab — clicking opens the
                    image rather than making the admin go and find it there. */}
                {isImage ? (
                  <button
                    type="button"
                    className="dm-thumb-btn"
                    onClick={() => setPreviewAttachment(att)}
                    aria-label={`Open ${att.filename}`}
                  >
                    <img src={resolveAttachmentUrl(att.file_path)} alt={att.filename} />
                  </button>
                ) : (
                  <a
                    href={resolveAttachmentUrl(att.file_path)}
                    target="_blank"
                    rel="noreferrer"
                    className="file-link"
                  >
                    {att.filename}
                  </a>
                )}

                <figcaption>
                  <span className="dm-thumb-name" title={att.filename}>{att.filename}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      <label className="bs-field">
        <span>Add a file</span>
        <input
          type="file"
          multiple
          disabled={locked}
          accept={effectiveType === 'enhancement'
            ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt'
            : 'image/*'}
          onChange={uploadAttachment}
        />
      </label>
      <p className="bs-field-hint">
        {atCap
          ? `At the ${max}-file limit. Deselect one to choose another.`
          : 'Added files attach to the ticket as well, and stage until you save.'}
      </p>
    </div>
  );
}

/**
 * The last stop before an outbound call that cannot be undone. Consequences
 * first, then only what changed — the full payload stays on the tab behind it.
 */
function EasyVistaConfirm({
  open, onClose, onSend, detail, preview, changedRows, isResubmit,
  attachmentCount, sentAsLabel, isCleanupOnly,
}) {
  if (!open || !preview) return null;
  return (
    <div className="dm-confirm-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dm-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={isResubmit ? 'Re-submit to EasyVista?' : 'Submit to EasyVista?'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dm-confirm-head">
          <h3>{isResubmit ? 'Re-submit to EasyVista?' : 'Submit to EasyVista?'}</h3>
        </header>

        <div className="dm-confirm-body">
          <div className="dm-consequence">
            <h5>{isResubmit ? 'This forks the ticket' : 'This creates an EasyVista ticket'}</h5>
            <ul>
              {isResubmit ? (
                <>
                  <li>
                    Creates a <strong>new submission as a {sentAsLabel}</strong> with a{' '}
                    <strong>new EasyVista ticket</strong>.
                  </li>
                  <li>
                    <strong>{detail.easyvista_ticket_id} will not be updated.</strong> This
                    record keeps its own type and gains a history entry recording the
                    resubmission and that it went out as a {sentAsLabel}.
                  </li>
                  {attachmentCount > 0 && (
                    <li>
                      {attachmentCount === 1 ? '1 attachment is' : `${attachmentCount} attachments are`} copied
                      onto the new record.
                    </li>
                  )}
                </>
              ) : (
                <>
                  <li>Raises it in EasyVista as a <strong>{sentAsLabel}</strong> and stores the id here.</li>
                  <li>Sets the status to <strong>Submitted</strong>. <strong>No new submission is created.</strong></li>
                  {isCleanupOnly && (
                    <li>Tags this task as <strong>Cleanup + {sentAsLabel}</strong>.</li>
                  )}
                </>
              )}
              <li>Your unsaved changes are saved first, then sent.</li>
            </ul>
          </div>

          {changedRows.length > 0 && (
            <div className="dm-payload">
              <div className="dm-payload-head">
                <h5>Changed by your unsaved edits</h5>
                <span>{`${changedRows.length} of ${preview.rows.length} fields`}</span>
              </div>
              <div className="dm-payload-rows">
                {changedRows.map((row) => (
                  <div className="dm-prow dm-prow--changed" key={row.key}>
                    <span className="dm-prow-k">{row.label}</span>
                    <span className="dm-prow-v">{row.value === '' ? <em>empty</em> : row.value}</span>
                    <span className="dm-prow-tag">changed</span>
                    <span className="dm-prow-was">
                      was <s>{row.previous === '' ? 'empty' : row.previous}</s>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <details className="dm-nested">
            <summary>
              <span className="dm-caret" aria-hidden="true" />
              <span>See the full outgoing text</span>
              <span className="dm-nested-hint">{`${preview.rows.length} fields`}</span>
            </summary>
            <div className="dm-pre-scroll">
              <pre>{preview.raw}</pre>
            </div>
          </details>
        </div>

        <div className="dm-foot">
          <p className="dm-foot-state">
            {preview.live
              ? 'Nothing is sent until you confirm.'
              : 'Not connected yet — this records a placeholder ticket number only.'}
          </p>
          <div className="dm-foot-actions">
            <Button kind="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={onSend}>Send to EasyVista</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
