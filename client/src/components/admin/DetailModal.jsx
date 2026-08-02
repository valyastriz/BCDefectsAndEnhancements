import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../bite-size/BitsizeUI';
import { editableFromDetail } from '../../utils/mappers';
import {
  DETAIL_TABS,
  EASYVISTA_REQUIREMENT_SECTION,
} from '../../constants/detailModalConstants';
import { ConflictReviewPanel } from './detail/ConflictReviewPanel';
import { DetailIdentityBand } from './detail/DetailIdentityBand';
import { DetailAlerts } from './detail/DetailAlerts';
import { DetailTabs } from './detail/DetailTabs';
import { DetailPane, DetailGroup } from './detail/DetailPane';
import { DetailTriageSection } from './detail/DetailTriageSection';
import { DetailImpactSection } from './detail/DetailImpactSection';
import { DetailSubmissionSection } from './detail/DetailSubmissionSection';
import { DetailAttachmentsSection } from './detail/DetailAttachmentsSection';
import { DetailTimelineSection } from './detail/DetailTimelineSection';
import { DetailReferenceSection } from './detail/DetailReferenceSection';
import { DetailEasyVistaSection } from './detail/DetailEasyVistaSection';
import { DetailActions } from './detail/DetailActions';

/**
 * Main detail / edit modal for an individual admin submission.
 *
 * One pane at a time. Identity, alerts and the action bar live outside the tab
 * strip, so nothing that needs attention can hide behind an inactive tab — and
 * a tab that IS hiding something required says so on its label.
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
  showFooterSaveTooltip,
  setShowFooterSaveTooltip,
  effectiveType,
  resolvedSendAsType,
  defaultSendAsType,
  setSendAsType,
  easyVistaAttachmentIds,
  setEasyVistaAttachmentIds,
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
  const { isHeldByOther = false, markActivity } = presence || {};
  // "Edit anyway" and the active tab are both keyed to the open ticket, so they
  // auto-reset when a different ticket opens — no reset effect needed.
  const [unlockedFor, setUnlockedFor] = useState(null);
  const locked = isHeldByOther && unlockedFor !== openId;

  // Deliberately NOT keyed to the open ticket: an admin who wants the compact
  // header wants it on every ticket, not to re-collapse it each time.
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  const [tabState, setTabState] = useState({ forId: null, key: DETAIL_TABS.report });
  const requestedTab = tabState.forId === openId ? tabState.key : DETAIL_TABS.report;
  const selectTab = (key) => setTabState({ forId: openId, key });

  // Which tabs hold a field that blocks the EasyVista submission. Derived from
  // the requirement list, never pushed into state by an effect.
  const blockedTabs = useMemo(() => {
    if (!easyVistaMissingRequirements.length) return new Set();
    return new Set(
      easyVistaMissingRequirements
        .map((requirement) => EASYVISTA_REQUIREMENT_SECTION[requirement])
        .filter(Boolean),
    );
  }, [easyVistaMissingRequirements]);

  // A blocked send pulls the admin to EasyVista, where the offending fields are
  // editable, rather than leaving them to hunt for the right tab.
  const activeTab = showEasyVistaRequirements && easyVistaMissingRequirements.length
    ? DETAIL_TABS.easyvista
    : requestedTab;

  // Order follows the ticket's life: what came in, its evidence, what has
  // happened to it, the internal call, then the outbound hand-off last.
  const tabs = [
    { key: DETAIL_TABS.report, label: 'Report', warn: blockedTabs.has(DETAIL_TABS.report) },
    { key: DETAIL_TABS.files, label: 'Files', count: visibleAttachments.length },
    { key: DETAIL_TABS.history, label: 'History' },
    { key: DETAIL_TABS.triage, label: 'Triage' },
    { key: DETAIL_TABS.impact, label: 'Impact', warn: blockedTabs.has(DETAIL_TABS.impact) },
    {
      key: DETAIL_TABS.easyvista,
      label: 'EasyVista Submission',
      warn: easyVistaMissingRequirements.length > 0,
    },
  ];

  // A conflict or a load/save error forces the header open — those need acting
  // on, so they must not be collapsible out of view.
  const forceHeaderOpen = Boolean(conflictInfo || detailError);
  const alertCount = [
    modalTopNotice,
    conflictInfo,
    recoverableDraft,
    presence?.isHeldByOther,
    detailError,
    showEasyVistaRequirements && easyVistaMissingRequirements.length > 0,
    detail?.has_resubmission && detail?.latest_resubmission_easyvista_ticket_id,
    detail?.is_resubmission && detail?.resubmission_of_easyvista_ticket_id,
    edit?.is_retired,
  ].filter(Boolean).length;

  // The current server version as editable fields, for the conflict diff.
  const currentServerEdit = useMemo(() => (detail ? editableFromDetail(detail) : null), [detail]);

  // Ping presence activity as the holder edits (throttled inside the hook).
  useEffect(() => {
    if (edit && markActivity) markActivity();
  }, [edit, markActivity]);

  const open = Boolean(openId && detail && edit);

  return (
    <Modal
      open={open}
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
      className="dm-modal"
      footer={open && (
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
          modalBottomNotice={modalBottomNotice}
          easyVistaConfirmation={easyVistaConfirmation}
          locked={locked}
          onReview={() => selectTab(DETAIL_TABS.easyvista)}
        />
      )}
    >
      {open && (
        <>
          {/* A conflict or an error can never be collapsed out of sight; the
              rest of the header can, because it is orientation rather than
              something to act on. */}
          <div className={`dm-fixed${headerCollapsed && !forceHeaderOpen ? ' dm-fixed--collapsed' : ''}`}>
            <DetailIdentityBand
              detail={detail}
              edit={edit}
              effectiveType={effectiveType}
              collapsed={headerCollapsed && !forceHeaderOpen}
              canCollapse={!forceHeaderOpen}
              onToggle={() => setHeaderCollapsed((prev) => !prev)}
              alertCount={alertCount}
            />

            {(!headerCollapsed || forceHeaderOpen) && <DetailAlerts
              modalTopNotice={modalTopNotice}
              conflictInfo={conflictInfo}
              conflictPanel={conflictInfo && (
                <ConflictReviewPanel
                  key={`${openId}-${conflictInfo.at || ''}`}
                  base={baseEdit}
                  mine={edit}
                  current={currentServerEdit}
                  onUseCurrent={(field, value) => setEdit((prev) => ({ ...prev, [field]: value }))}
                />
              )}
              recoverableDraft={recoverableDraft}
              restoreDraft={restoreDraft}
              discardDraft={discardDraft}
              presence={presence}
              locked={locked}
              onUnlock={() => setUnlockedFor(openId)}
              detailError={detailError}
              edit={edit}
              detail={detail}
              showEasyVistaRequirements={showEasyVistaRequirements}
              easyVistaMissingRequirements={easyVistaMissingRequirements}
            />}
          </div>

          <DetailTabs tabs={tabs} active={activeTab} onSelect={selectTab} />

          {/* Only the active pane is rendered. Every input is controlled by
              `edit`, so unmounting an inactive pane loses nothing. */}
          {activeTab === DETAIL_TABS.triage && (
            <DetailPane id={DETAIL_TABS.triage} lockBody={locked}>
              <DetailTriageSection
                edit={edit}
                setEdit={setEdit}
                dynamicCleanupStatuses={dynamicCleanupStatuses}
                dynamicCleanupTagTypes={dynamicCleanupTagTypes}
                runtimeStatusOptions={runtimeStatusOptions}
              />
            </DetailPane>
          )}

          {activeTab === DETAIL_TABS.impact && (
            <DetailPane id={DETAIL_TABS.impact} lockBody={locked}>
              <DetailImpactSection
                edit={edit}
                setEdit={setEdit}
                effectiveType={effectiveType}
                missingRequirements={easyVistaMissingRequirements}
                dynamicEnhancementRequestTypes={dynamicEnhancementRequestTypes}
                dynamicPriorityLevels={dynamicPriorityLevels}
                dynamicOccurrenceTimeframes={dynamicOccurrenceTimeframes}
              />
            </DetailPane>
          )}

          {activeTab === DETAIL_TABS.report && (
            <DetailPane id={DETAIL_TABS.report} lockBody={locked}>
              <DetailSubmissionSection detail={detail} effectiveType={effectiveType} />
            </DetailPane>
          )}

          {activeTab === DETAIL_TABS.files && (
            <DetailPane id={DETAIL_TABS.files}>
              <DetailAttachmentsSection
                effectiveType={effectiveType}
                visibleAttachments={visibleAttachments}
                locked={locked}
                setPreviewAttachment={setPreviewAttachment}
                uploadAttachment={uploadAttachment}
                deleteAttachment={deleteAttachment}
              />
            </DetailPane>
          )}

          {activeTab === DETAIL_TABS.history && (
            <DetailPane id={DETAIL_TABS.history} lockBody={locked}>
              <DetailGroup label="Status history">
                <DetailTimelineSection
                  detail={detail}
                  dynamicCoreStatusSet={dynamicCoreStatusSet}
                  dynamicCleanupStatusSet={dynamicCleanupStatusSet}
                />
              </DetailGroup>
              <DetailReferenceSection detail={detail} edit={edit} setEdit={setEdit} />
            </DetailPane>
          )}

          {activeTab === DETAIL_TABS.easyvista && (
            <DetailPane id={DETAIL_TABS.easyvista}>
              <DetailEasyVistaSection
                openId={openId}
                detail={detail}
                edit={edit}
                setEdit={setEdit}
                locked={locked}
                working={working}
                missingRequirements={easyVistaMissingRequirements}
                visibleAttachments={visibleAttachments}
                submitEasyVista={submitEasyVista}
                resolvedSendAsType={resolvedSendAsType}
                defaultSendAsType={defaultSendAsType}
                setSendAsType={setSendAsType}
                easyVistaAttachmentIds={easyVistaAttachmentIds}
                setEasyVistaAttachmentIds={setEasyVistaAttachmentIds}
                uploadAttachment={uploadAttachment}
                setPreviewAttachment={setPreviewAttachment}
                dynamicApplications={dynamicApplications}
                dynamicEnhancementRequestTypes={dynamicEnhancementRequestTypes}
                dynamicPriorityLevels={dynamicPriorityLevels}
              />
            </DetailPane>
          )}
        </>
      )}
    </Modal>
  );
}
