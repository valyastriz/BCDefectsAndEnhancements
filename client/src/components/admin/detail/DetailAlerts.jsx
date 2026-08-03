import { Button } from '../../bite-size/BitsizeUI';
import { formatTimeAgo } from '../../../utils/formatUtils';

/** One alert row. `body` may be text or nodes. */
function Alert({ tone = 'neutral', glyph = '!', title, children }) {
  return (
    <div className={`dm-alert dm-alert--${tone}`}>
      <span className="dm-alert-glyph" aria-hidden="true">{glyph}</span>
      <p className="dm-alert-title">{title}</p>
      <div className="dm-alert-body">{children}</div>
    </div>
  );
}

/**
 * Every warning the modal can raise, in one region ordered by severity.
 *
 * Previously these were twelve independent slots stacked ahead of the first
 * field, so a retired + resubmitted + remotely-changed ticket opened on nothing
 * but banners. Past two alerts the region caps and scrolls, which keeps the
 * first section on screen no matter how many fire at once.
 */
export function DetailAlerts({
  modalTopNotice,
  conflictInfo,
  conflictPanel,
  recoverableDraft,
  restoreDraft,
  discardDraft,
  presence,
  locked,
  onUnlock,
  detailError,
  edit,
  setEdit,
  detail,
  showEasyVistaRequirements,
  easyVistaMissingRequirements,
}) {
  const {
    isHeldByOther = false,
    isStale = false,
    holderIsSelf = false,
    holderName = null,
    holderOpenedAt = null,
    holderLastActivityAt = null,
  } = presence || {};

  const showRequirements = showEasyVistaRequirements && easyVistaMissingRequirements.length > 0;
  const showResubmitted = Boolean(detail.has_resubmission && detail.latest_resubmission_easyvista_ticket_id);
  const showResubmissionOf = Boolean(detail.is_resubmission && detail.resubmission_of_easyvista_ticket_id);
  // Keyed off the saved record, not the draft, so ticking Handled does not make
  // the alert vanish before the change is saved — it changes tone instead.
  const showWorkaround = Boolean(detail.needs_workaround && !detail.workaround_provided);
  const workaroundStaged = Boolean(edit.workaround_provided);

  const count = [
    modalTopNotice,
    conflictInfo,
    recoverableDraft,
    isHeldByOther,
    detailError,
    showRequirements,
    showWorkaround,
    showResubmitted,
    showResubmissionOf,
    edit.is_retired,
  ].filter(Boolean).length;

  if (count === 0) return null;

  const holdMeta = [
    holderOpenedAt ? `Opened ${formatTimeAgo(holderOpenedAt)}` : '',
    holderLastActivityAt ? `last active ${formatTimeAgo(holderLastActivityAt)}` : '',
    isStale ? 'may have stepped away' : '',
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={`dm-alerts${count > 2 ? ' dm-alerts--capped' : ''}`}
      role="region"
      aria-label="Alerts"
    >
      {modalTopNotice && (
        <Alert tone="success" glyph="✓" title={modalTopNotice} />
      )}

      {conflictInfo && (
        <Alert
          tone="danger"
          title={`${conflictInfo.updatedBy} changed this ticket while you were editing`}
        >
          <p>
            {`Your unsaved edits are still here${conflictInfo.at ? ` — they changed it at ${new Date(conflictInfo.at).toLocaleString()}` : ''}. Pick a side for each field below, then save.`}
          </p>
          {conflictPanel}
        </Alert>
      )}

      {recoverableDraft && (
        <Alert tone="warn" title="Unsaved draft recovered">
          <p>
            {`Edits you left on this ticket${recoverableDraft.savedAt ? ` ${formatTimeAgo(recoverableDraft.savedAt)}` : ''} were never saved. Restore them into the form, or discard them and work from what the server has.`}
          </p>
          <div className="bs-actions">
            <Button kind="ghost" type="button" onClick={restoreDraft}>Restore</Button>
            <Button kind="ghost" type="button" onClick={discardDraft}>Discard</Button>
          </div>
        </Alert>
      )}

      {isHeldByOther && (
        <Alert
          tone="warn"
          title={holderIsSelf
            ? 'You have this ticket open in another window'
            : `${holderName || 'Another admin'} is editing this ticket right now`}
        >
          {holdMeta && <p>{holdMeta}</p>}
          <p>
            {locked
              ? 'Everything below is readable and you can open the attachments — the fields are just held so two admins cannot overwrite each other.'
              : 'You chose Edit anyway, so the form is live for you. If they save first you will get a conflict to resolve.'}
          </p>
          {locked && (
            <div className="bs-actions">
              <Button kind="ghost" type="button" onClick={onUnlock}>Edit anyway</Button>
            </div>
          )}
        </Alert>
      )}

      {detailError && <Alert tone="danger" title={detailError} />}

      {/* Someone cannot do their job until this is answered, which is why it
          outranks everything below it here. */}
      {showWorkaround && (
        <Alert
          tone={workaroundStaged ? 'success' : 'danger'}
          glyph={workaroundStaged ? '✓' : '!'}
          title={workaroundStaged
            ? 'Marked handled — save to record it'
            : `${detail.created_by || 'The reporter'} is blocked and needs a workaround`}
        >
          <p>
            {workaroundStaged
              ? 'Save Changes writes it to the history with your name against it. The badge on the queue goes quiet once saved.'
              : 'They asked for a way to keep working while this waits on the developer queue. Mark it handled once you have given them one.'}
          </p>
          {!workaroundStaged && (
            <div className="bs-actions">
              <Button
                kind="ghost"
                type="button"
                onClick={() => setEdit((prev) => ({ ...prev, workaround_provided: true }))}
              >
                Mark handled
              </Button>
            </div>
          )}
        </Alert>
      )}

      {showRequirements && (
        <Alert tone="warn" title="Complete before EasyVista submission">
          <p>
            {easyVistaMissingRequirements.length === 1
              ? 'One required field is empty. The section holding it has been opened below and the field is flagged.'
              : `${easyVistaMissingRequirements.length} required fields are empty. The sections holding them have been opened below and the fields are flagged.`}
          </p>
          <ul className="dm-req-list">
            {easyVistaMissingRequirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </Alert>
      )}

      {showResubmitted && (
        <Alert tone="info" title="Resubmitted to EasyVista as a new ticket">
          <p>
            {`Continue on EasyVista ticket ${detail.latest_resubmission_easyvista_ticket_id}${detail.latest_resubmission_submission_id ? ` (Submission #${detail.latest_resubmission_submission_id})` : ''}. Changes here do not reach that ticket.`}
          </p>
        </Alert>
      )}

      {showResubmissionOf && (
        <Alert tone="info" title="This ticket is a resubmission">
          <p>
            {`It continues EasyVista ticket ${detail.resubmission_of_easyvista_ticket_id}${detail.resubmission_of_submission_id ? ` (Original Submission #${detail.resubmission_of_submission_id})` : ''}.`}
          </p>
        </Alert>
      )}

      {edit.is_retired && (
        <Alert tone="neutral" title="This item is retired">
          <p>It is hidden from the active queue and its status is locked. Use Unretire Item under More to bring it back.</p>
        </Alert>
      )}
    </div>
  );
}
