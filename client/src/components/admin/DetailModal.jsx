import { useEffect, useMemo, useState } from 'react';
import { Modal, Notice, Button } from '../bite-size/BitsizeUI';
import { formatTimeAgo } from '../../utils/formatUtils';
import { editableFromDetail } from '../../utils/mappers';
import { SaveWithTooltip } from './detail/SaveWithTooltip';
import { ConflictReviewPanel } from './detail/ConflictReviewPanel';
import { DetailTriageSection } from './detail/DetailTriageSection';
import { DetailSubmissionSection } from './detail/DetailSubmissionSection';
import { DetailTimelineSection } from './detail/DetailTimelineSection';
import { DetailImpactSection } from './detail/DetailImpactSection';
import { DetailAttachmentsSection } from './detail/DetailAttachmentsSection';
import { DetailActions } from './detail/DetailActions';

/**
 * Main detail / edit modal for an individual admin submission.
 */
export function DetailModal({
  // Detail modal hook state
  openId,
  setOpenId,
  detail,
  edit,
  setEdit,
  detailError,
  setDetailError,
  conflictInfo,
  setConflictInfo,
  baseEdit,
  recoverableDraft,
  restoreDraft,
  discardDraft,
  working,
  modalTitle,
  modalTopNotice,
  setModalTopNotice,
  modalBottomNotice,
  setModalBottomNotice,
  setPreviewAttachment,
  easyVistaConfirmation,
  showEasyVistaRequirements,
  setShowEasyVistaRequirements,
  showHeaderSaveTooltip,
  setShowHeaderSaveTooltip,
  showFooterSaveTooltip,
  setShowFooterSaveTooltip,
  effectiveType,
  easyVistaMissingRequirements,
  hasPendingChanges,
  visibleAttachments,
  saveDisabledReason,
  saveEdits,
  retireCurrentItem,
  unretireCurrentItem,
  uploadAttachment,
  deleteAttachment,
  submitEasyVista,
  clearPendingAttachmentDrafts,
  presence,
  // Meta options
  dynamicCleanupStatuses,
  dynamicCleanupTagTypes,
  dynamicApplications,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  dynamicOccurrenceTimeframes,
  runtimeStatusOptions,
  dynamicCoreStatusSet,
  dynamicCleanupStatusSet,
}) {
  const {
    isHeldByOther = false,
    isStale = false,
    holderIsSelf = false,
    holderName = null,
    holderOpenedAt = null,
    holderLastActivityAt = null,
    markActivity,
  } = presence || {};
  // "Edit anyway" override is keyed to the open ticket, so it auto-resets when a
  // different ticket opens — no reset effect needed.
  const [unlockedFor, setUnlockedFor] = useState(null);
  const locked = isHeldByOther && unlockedFor !== openId;

  // The current server version as editable fields, for the conflict diff.
  const currentServerEdit = useMemo(() => (detail ? editableFromDetail(detail) : null), [detail]);

  // Ping presence activity as the holder edits (throttled inside the hook).
  useEffect(() => {
    if (edit && markActivity) markActivity();
  }, [edit, markActivity]);

  return (
    <Modal
      open={Boolean(openId && detail && edit)}
      onClose={() => {
        clearPendingAttachmentDrafts();
        setOpenId(null);
        setModalTopNotice('');
        setModalBottomNotice('');
        setDetailError('');
        setConflictInfo(null);
        setShowEasyVistaRequirements(false);
      }}
      title={modalTitle}
      headerActions={(
        <SaveWithTooltip
          show={showHeaderSaveTooltip}
          setShow={setShowHeaderSaveTooltip}
          working={working}
          hasPendingChanges={hasPendingChanges}
          saveDisabledReason={saveDisabledReason}
          onSave={() => saveEdits('header')}
        />
      )}
    >
      {detail && edit && (
        <div className="stack">
          {modalTopNotice && <Notice text={modalTopNotice} kind="success" />}
          {recoverableDraft && (
            <div className="lock-banner">
              <div className="lock-banner-text">
                <strong>Unsaved changes recovered</strong>
                <div className="lock-banner-meta">
                  {`You left edits on this item${recoverableDraft.savedAt ? ` ${formatTimeAgo(recoverableDraft.savedAt)}` : ''}. Restore them or discard.`}
                </div>
              </div>
              <Button kind="ghost" type="button" onClick={restoreDraft}>Restore</Button>
              <Button kind="ghost" type="button" onClick={discardDraft}>Discard</Button>
            </div>
          )}
          {conflictInfo && (
            <Notice
              text={`⚠️ ${conflictInfo.updatedBy} just changed this item${conflictInfo.at ? ` at ${new Date(conflictInfo.at).toLocaleString()}` : ''} while you had it open. The latest version is now shown; resolve the overlapping fields below, then save.`}
            />
          )}
          {conflictInfo && (
            <ConflictReviewPanel
              key={`${openId}-${conflictInfo.at || ''}`}
              base={baseEdit}
              mine={edit}
              current={currentServerEdit}
              onUseCurrent={(field, value) => setEdit((prev) => ({ ...prev, [field]: value }))}
            />
          )}
          {detailError && <Notice text={detailError} />}
          {edit.is_retired && <Notice text="This item is retired." kind="info" />}
          {detail.has_resubmission && detail.latest_resubmission_easyvista_ticket_id && (
            <Notice
              text={`This item has been resubmitted. Latest EasyVista ticket: ${detail.latest_resubmission_easyvista_ticket_id}${detail.latest_resubmission_submission_id ? ` (Submission #${detail.latest_resubmission_submission_id})` : ''}.`}
              kind="info"
            />
          )}
          {detail.is_resubmission && detail.resubmission_of_easyvista_ticket_id && (
            <Notice
              text={`This card is a resubmission of EasyVista ticket ${detail.resubmission_of_easyvista_ticket_id}${detail.resubmission_of_submission_id ? ` (Original Submission #${detail.resubmission_of_submission_id})` : ''}.`}
              kind="info"
            />
          )}

          {isHeldByOther && (
            <div className={`lock-banner${isStale ? ' lock-banner--stale' : ''}`}>
              <div className="lock-banner-text">
                <strong>
                  {holderIsSelf
                    ? 'You have this item open in another window'
                    : `${holderName || 'Another admin'} is working on this item`}
                </strong>
                <div className="lock-banner-meta">
                  {holderOpenedAt ? `Opened ${formatTimeAgo(holderOpenedAt)}` : ''}
                  {holderLastActivityAt ? ` · last active ${formatTimeAgo(holderLastActivityAt)}` : ''}
                  {isStale ? ' · may have stepped away' : ''}
                </div>
                <div className="lock-banner-meta">
                  {locked
                    ? 'You can view everything below. Editing may overwrite their work.'
                    : 'Editing is unlocked — your changes may overwrite theirs.'}
                </div>
              </div>
              {locked && (
                <Button kind="ghost" type="button" onClick={() => setUnlockedFor(openId)}>
                  Edit anyway
                </Button>
              )}
            </div>
          )}

          <div className={`stack${locked ? ' modal-locked' : ''}`}>
          <DetailTriageSection
            detail={detail}
            edit={edit}
            setEdit={setEdit}
            dynamicCleanupStatuses={dynamicCleanupStatuses}
            dynamicCleanupTagTypes={dynamicCleanupTagTypes}
            runtimeStatusOptions={runtimeStatusOptions}
          />

          <DetailSubmissionSection
            detail={detail}
            edit={edit}
            setEdit={setEdit}
            effectiveType={effectiveType}
            dynamicApplications={dynamicApplications}
          />

          <DetailTimelineSection
            detail={detail}
            dynamicCoreStatusSet={dynamicCoreStatusSet}
            dynamicCleanupStatusSet={dynamicCleanupStatusSet}
          />

          <DetailImpactSection
            edit={edit}
            setEdit={setEdit}
            effectiveType={effectiveType}
            dynamicEnhancementRequestTypes={dynamicEnhancementRequestTypes}
            dynamicPriorityLevels={dynamicPriorityLevels}
            dynamicOccurrenceTimeframes={dynamicOccurrenceTimeframes}
          />

          <DetailAttachmentsSection
            edit={edit}
            setEdit={setEdit}
            effectiveType={effectiveType}
            visibleAttachments={visibleAttachments}
            setPreviewAttachment={setPreviewAttachment}
            uploadAttachment={uploadAttachment}
            deleteAttachment={deleteAttachment}
          />

          {showEasyVistaRequirements && easyVistaMissingRequirements.length > 0 && (
            <Notice text={`Complete before EasyVista submission: ${easyVistaMissingRequirements.join(', ')}`} />
          )}

          <DetailActions
            detail={detail}
            edit={edit}
            working={working}
            hasPendingChanges={hasPendingChanges}
            saveDisabledReason={saveDisabledReason}
            showFooterSaveTooltip={showFooterSaveTooltip}
            setShowFooterSaveTooltip={setShowFooterSaveTooltip}
            saveEdits={saveEdits}
            retireCurrentItem={retireCurrentItem}
            unretireCurrentItem={unretireCurrentItem}
            submitEasyVista={submitEasyVista}
            modalBottomNotice={modalBottomNotice}
            easyVistaConfirmation={easyVistaConfirmation}
          />
          </div>
        </div>
      )}
    </Modal>
  );
}
