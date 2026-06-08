import { Modal, Notice } from '../bite-size/BitsizeUI';
import { SaveWithTooltip } from './detail/SaveWithTooltip';
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
  return (
    <Modal
      open={Boolean(openId && detail && edit)}
      onClose={() => {
        clearPendingAttachmentDrafts();
        setOpenId(null);
        setModalTopNotice('');
        setModalBottomNotice('');
        setDetailError('');
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
      )}
    </Modal>
  );
}
