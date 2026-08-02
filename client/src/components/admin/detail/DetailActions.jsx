import { useState } from 'react';
import { Button, Modal, Notice } from '../../bite-size/BitsizeUI';
import { AdminMenu, AdminMenuItem } from '../AdminHeader';
import { SaveWithTooltip } from './SaveWithTooltip';
import { buildRespondToUserMailto } from '../../../utils/formatUtils';

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
  modalBottomNotice,
  easyVistaConfirmation,
  locked,
  sendsDirectly,
  onEasyVista,
}) {
  const [confirmRetire, setConfirmRetire] = useState(false);
  const respondMailto = buildRespondToUserMailto(detail);
  const resultNotice = modalBottomNotice || easyVistaConfirmation;

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
            the EasyVista tab when there is — a resubmit to confirm the fork, a
            blocked send to fill the fields in, a Cleanup Only task to pick a
            type. The ellipsis tracks that: it is there only when the click
            opens something rather than sending. */}
        <Button
          kind="secondary"
          onClick={onEasyVista}
          disabled={working || locked}
        >
          {detail.easyvista_ticket_id
            ? 'Re-submit to EasyVista…'
            : `Submit to EasyVista${sendsDirectly ? '' : '…'}`}
        </Button>
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
