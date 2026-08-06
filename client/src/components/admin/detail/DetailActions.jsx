import { useState } from 'react';
import { Button, Modal, Notice } from '../../bite-size/BitsizeUI';
import { AdminMenu, AdminMenuItem } from '../AdminHeader';
import { SaveWithTooltip } from './SaveWithTooltip';
import { buildRespondToUserMailto } from '../../../utils/formatUtils';
import { TRACKER_LABEL, TRACKER_LABEL_THE } from '../../../constants/tracker';

/**
 * The pinned action bar.
 *
 * These four actions used to sit inside the scroll region in one flat row —
 * primary Save eight pixels from a red Retire, with the irreversible EasyVista
 * hand-off styled more quietly than either. Expanding any section pushed all of
 * them out of view, which is why Save had to be duplicated into the header.
 *
 * Now: one primary, the outbound action beside it, and the two rarely-used
 * actions behind an overflow menu. Retiring asks first — it is a state change
 * with no undo in the modal, and the queue's bulk retire already confirms.
 *
 * The menu is a DOM descendant of the modal, never a portal: a portal's clicks
 * would land on the backdrop, whose close handler discards staged attachments.
 */
export function DetailActions({
  detail,
  edit,
  working,
  hasPendingChanges,
  saveDisabledReason,
  showFooterSaveTooltip,
  setShowFooterSaveTooltip,
  saveEdits,
  retireCurrentItem,
  unretireCurrentItem,
  redirectCurrentItem,
  redirectTargets = [],
  modalBottomNotice,
  easyVistaConfirmation,
  locked,
  readOnly,
  sendsDirectly,
  // Withheld for a report request, which is finished here and never handed on.
  hidesHandoff = false,
  onEasyVista,
}) {
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectTo, setRedirectTo] = useState('');
  const [redirectNote, setRedirectNote] = useState('');
  const respondMailto = buildRespondToUserMailto(detail);
  const resultNotice = modalBottomNotice || easyVistaConfirmation;
  // Nowhere to send it (a single-application portal, or the only other
  // application is inactive) means the action would open a dialog with an empty
  // picker. Hidden rather than shown-and-broken.
  const canRedirect = !readOnly && redirectTargets.length > 0;

  function closeRedirect() {
    setRedirectOpen(false);
    setRedirectTo('');
    setRedirectNote('');
  }

  function confirmRedirect() {
    const target = redirectTargets.find((app) => String(app.id) === String(redirectTo));
    if (!target) return;
    closeRedirect();
    redirectCurrentItem({ toApplicationId: target.id, note: redirectNote.trim() });
  }

  return (
    <div className="dm-foot">
      <p className={`dm-foot-state${hasPendingChanges ? ' dm-foot-state--dirty' : ''}`}>
        {working
          ? 'Saving…'
          : resultNotice
            || (hasPendingChanges ? 'Unsaved changes' : 'No unsaved changes.')}
      </p>

      <div className="dm-foot-actions">
        <SaveWithTooltip
          show={showFooterSaveTooltip}
          setShow={setShowFooterSaveTooltip}
          working={working}
          hasPendingChanges={hasPendingChanges}
          saveDisabledReason={saveDisabledReason}
          onSave={() => saveEdits('footer')}
        />
        {/* Sends outright when there is nothing left to decide, and routes to
            the hand-off tab when there is — a resubmit to confirm the fork, a
            blocked send to fill the fields in, a Cleanup Only task to pick a
            type. The ellipsis tracks that: it is there only when the click
            opens something rather than sending. */}
        {/* Withheld entirely for a report request: an analyst finishes it here
            and it never goes downstream, so the button would either always fail
            or — worse — succeed. A permanently disabled control is furniture. */}
        {!hidesHandoff && (
          <Button
            kind="secondary"
            onClick={onEasyVista}
            disabled={working || locked}
          >
            {detail.easyvista_ticket_id
              ? `Re-submit to ${TRACKER_LABEL_THE}…`
              : `Submit to ${TRACKER_LABEL_THE}${sendsDirectly ? '' : '…'}`}
          </Button>
        )}
        <AdminMenu
          label="More actions"
          triggerClassName="bs-btn bs-btn-ghost"
          trigger={<><span aria-hidden="true">⋯</span> More</>}
        >
          {({ close }) => (
            <>
              <AdminMenuItem onClick={() => { close(); window.location.href = respondMailto; }}>
                Respond to User
              </AdminMenuItem>
              {canRedirect && (
                <AdminMenuItem
                  disabled={working || locked}
                  onClick={() => { close(); setRedirectOpen(true); }}
                >
                  Redirect to another queue…
                </AdminMenuItem>
              )}
              {edit.is_retired ? (
                <AdminMenuItem
                  disabled={working || locked}
                  onClick={() => { close(); unretireCurrentItem(); }}
                >
                  Unretire Item
                </AdminMenuItem>
              ) : (
                <AdminMenuItem
                  disabled={working || locked}
                  onClick={() => { close(); setConfirmRetire(true); }}
                >
                  Retire Item…
                </AdminMenuItem>
              )}
            </>
          )}
        </AdminMenu>
      </div>

      {/* A hand-off, not a copy: the ticket leaves this queue for good. The
          dialog says so plainly, because it is not undoable from here — only the
          receiving team (or a super user) can send it back. */}
      <Modal
        open={redirectOpen}
        onClose={closeRedirect}
        title="Redirect to another queue"
      >
        <div className="stack">
          <p>
            Submission #{detail.id} moves to the queue you pick and comes back as
            <strong> New</strong> for them — its history travels with it, so they can
            see it was {detail.status || 'New'} when you sent it.
          </p>
          <p className="muted">
            It leaves your queue straight away. You keep seeing it, but changing it
            becomes theirs.
          </p>

          <label className="bs-field">
            <span>Send to</span>
            <select
              value={redirectTo}
              onChange={(event) => setRedirectTo(event.target.value)}
            >
              <option value="">Choose an application</option>
              {redirectTargets.map((app) => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
            </select>
          </label>

          <label className="bs-field">
            <span>Note for the receiving admin (optional)</span>
            <textarea
              rows={4}
              value={redirectNote}
              placeholder="Why it's theirs, and what you already checked so they don't redo it."
              onChange={(event) => setRedirectNote(event.target.value)}
            />
          </label>
          <p className="muted" style={{ marginTop: -4 }}>
            Admins only — the person who reported this never sees the note.
          </p>

          {hasPendingChanges && (
            <Notice
              text="You have unsaved changes. Redirecting moves the ticket only — your other edits stay unsaved."
              kind="info"
            />
          )}

          <div className="bs-actions">
            <Button kind="primary" disabled={!redirectTo || working} onClick={confirmRedirect}>
              Redirect
            </Button>
            <Button kind="ghost" onClick={closeRedirect}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmRetire}
        onClose={() => setConfirmRetire(false)}
        title="Retire this item?"
      >
        <div className="stack">
          <p>
            Submission #{detail.id} will be hidden from the active queue and its status
            locked. You can bring it back with Unretire Item.
          </p>
          {hasPendingChanges && (
            <Notice
              text="You have unsaved changes. Retiring saves the retired flag only — your other edits stay unsaved."
              kind="info"
            />
          )}
          <div className="bs-actions">
            <Button kind="danger" onClick={() => { setConfirmRetire(false); retireCurrentItem(); }}>
              Retire Item
            </Button>
            <Button kind="ghost" onClick={() => setConfirmRetire(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
