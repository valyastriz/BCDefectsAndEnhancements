import { Button, Notice } from '../../bite-size/BitsizeUI';
import { SaveWithTooltip } from './SaveWithTooltip';

/**
 * Footer actions row (Save / Retire-Unretire / Submit-to-EasyVista) plus the
 * trailing notices.
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
  submitEasyVista,
  modalBottomNotice,
  easyVistaConfirmation,
}) {
  return (
    <>
      {/* ── Actions ── */}
      <div className="bs-actions">
        <SaveWithTooltip
          show={showFooterSaveTooltip}
          setShow={setShowFooterSaveTooltip}
          working={working}
          hasPendingChanges={hasPendingChanges}
          saveDisabledReason={saveDisabledReason}
          onSave={() => saveEdits('footer')}
        />
        {edit.is_retired ? (
          <Button
            kind="secondary"
            onClick={unretireCurrentItem}
            disabled={working}
          >
            Unretire Item
          </Button>
        ) : (
          <Button
            kind="danger"
            onClick={retireCurrentItem}
            disabled={working}
          >
            Retire Item
          </Button>
        )}
        <Button
          kind="secondary"
          onClick={submitEasyVista}
          disabled={working}
        >
          {detail.easyvista_ticket_id ? 'Re-submit to EasyVista' : 'Submit to EasyVista'}
        </Button>
      </div>
      {!working && !hasPendingChanges && (
        <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
          No unsaved changes.
        </p>
      )}
      {modalBottomNotice && <Notice text={modalBottomNotice} kind="success" />}
      {easyVistaConfirmation && <Notice text={easyVistaConfirmation} kind="success" />}
      {detail.easyvista_ticket_id && (
        <p className="muted" style={{ fontSize: 13 }}>EasyVista ticket: <strong>{detail.easyvista_ticket_id}</strong></p>
      )}
    </>
  );
}
