import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../bite-size/BitsizeUI';
import { editableFromDetail } from '../../utils/mappers';
import { TRACKER_LABEL } from '../../constants/tracker';
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
import { DetailRecurrences } from './detail/DetailRecurrences';
import { DetailTimelineSection } from './detail/DetailTimelineSection';
import { DetailReferenceSection } from './detail/DetailReferenceSection';
import { DetailEasyVistaSection } from './detail/DetailEasyVistaSection';
import { DetailActions } from './detail/DetailActions';
import { DetailDeliverySection, DetailHandoverSection } from './detail/DetailDeliverySection';

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
  canSubmitEasyVistaDirectly,
  markWorkaroundHandled,
  hasPendingChanges,
  visibleAttachments,
  saveDisabledReason,
  saveEdits,
  retireCurrentItem,
  unretireCurrentItem,
  redirectCurrentItem,
  uploadAttachment,
  deleteAttachment,
  submitEasyVista,
  // Delivery pane. Hours and approval files are their own endpoints, not part
  // of the submission save — an entry has its own author and must not bump the
  // ticket's optimistic-concurrency token.
  viewerUserId,
  logHours,
  removeHours,
  attachApprovalFiles,
  clearPendingAttachmentDrafts,
  presence,
  // Every active application as { id, name, reportsOnly } — the redirect picker's
  // source. `reportsOnly` is what keeps a defect off a report-only queue.
  redirectApplications,
  // The viewer envelope, for the redirect dialog's "the application isn't listed"
  // control — which offers itself only to somebody who works report requests.
  viewer,
  onApplicationCreated,
  // Meta options
  dynamicCleanupStatuses,
  dynamicCleanupTagTypes,
  dynamicApplications,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  dynamicOccurrenceTimeframes,
  dynamicLevelsOfEffort,
  runtimeStatusOptions,
  dynamicCoreStatusSet,
  dynamicCleanupStatusSet,
}) {
  const { isHeldByOther = false, markActivity } = presence || {};
  // "Edit anyway" and the active tab are both keyed to the open ticket, so they
  // auto-reset when a different ticket opens — no reset effect needed.
  const [unlockedFor, setUnlockedFor] = useState(null);
  const heldByOtherAdmin = isHeldByOther && unlockedFor !== openId;

  // Two different locks, deliberately not merged. The presence lock above is
  // temporary and overridable ("edit anyway"). This one is not: the ticket lives
  // in an application this caller does not administer — normally one their team
  // handed on — and the server refuses the write, so offering an override would
  // only produce a 403.
  //
  // `can_edit` is absent on an older cached payload, so only an explicit false
  // locks the form; undefined leaves today's behaviour untouched.
  const readOnly = detail?.can_edit === false;
  const locked = heldByOtherAdmin || readOnly;

  // Declared HERE, above its first use, and not beside the tab list that also
  // reads it: a `const` used before its declaration is a temporal dead zone, and
  // the page throws "Cannot access before initialization" and renders nothing at
  // all. It still compiles, so only the browser finds it.
  const isReportRequest = effectiveType === 'report';

  // Where this ticket could go: every active application except the one it is
  // already in. Deliberately from the viewer envelope ({id, name, reportsOnly})
  // rather than `dynamicApplications` (names only) — the endpoint moves by id, and
  // a name would have to be resolved back to one somewhere.
  //
  // Not narrowed to what the caller administers: handing a ticket to a team you
  // are not part of is the entire point of a redirect.
  //
  // A reports-only application is dropped for anything that is not a report
  // request. It is granted to the people who work report requests and nobody
  // else, so a DEFECT redirected into it would land in a queue with no defect
  // admins — invisible rather than merely unassigned, which is the exact failure
  // `Other` exists to avoid. The server refuses it too; this keeps it off the menu.
  const redirectTargets = (redirectApplications || []).filter(
    (app) => String(app.name) !== String(detail?.application_name)
      && (isReportRequest || !app.reportsOnly),
  );

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
  // A report request is worked by an analyst here and never handed downstream,
  // so the sixth slot carries Delivery instead of the hand-off. Same position in
  // the ticket's life — the step where it leaves your hands — and six tabs is
  // already a lot without adding a seventh that is empty of meaning.
  const tabs = [
    { key: DETAIL_TABS.report, label: 'Report', warn: blockedTabs.has(DETAIL_TABS.report) },
    { key: DETAIL_TABS.files, label: 'Files', count: visibleAttachments.length },
    { key: DETAIL_TABS.history, label: 'History' },
    { key: DETAIL_TABS.triage, label: 'Triage' },
    { key: DETAIL_TABS.impact, label: 'Impact', warn: blockedTabs.has(DETAIL_TABS.impact) },
    // Only when somebody has actually reported it again. An always-present tab
    // reading "0" on the overwhelming majority of tickets would be six words of
    // furniture on every open; a tab that appears IS the signal.
    ...(Number(detail?.recurrence_count || 0) > 0 ? [{
      key: DETAIL_TABS.recurrences,
      label: 'Reported again',
      count: Number(detail.recurrence_count),
      warn: Number(detail.open_workaround_requests || 0) > 0,
    }] : []),
    isReportRequest
      ? { key: DETAIL_TABS.delivery, label: 'Delivery' }
      : {
        key: DETAIL_TABS.easyvista,
        label: `${TRACKER_LABEL} Submission`,
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
          redirectCurrentItem={redirectCurrentItem}
          redirectTargets={redirectTargets}
          viewer={viewer}
          onApplicationCreated={onApplicationCreated}
          // Only a report request can be sent to an application created here, so
          // only a report request is offered the control.
          canAddApplication={isReportRequest}
          readOnly={readOnly}
          modalBottomNotice={modalBottomNotice}
          easyVistaConfirmation={easyVistaConfirmation}
          locked={locked}
          sendsDirectly={canSubmitEasyVistaDirectly}
          hidesHandoff={isReportRequest}
          // Read straight off the detail response rather than re-derived: only the
          // server knows which applications have a catalog, and it is the same call
          // that refuses the send.
          handoffBlockedReason={detail?.easyvista_catalog?.configured === false
            ? (detail.easyvista_catalog.reason || '')
            : ''}
          onEasyVista={() => {
            if (canSubmitEasyVistaDirectly) submitEasyVista();
            else selectTab(DETAIL_TABS.easyvista);
          }}
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
              readOnly={readOnly}
              handedOnTo={readOnly ? detail?.application_name : null}
              // Only the presence lock is overridable; a ticket that belongs to
              // another team has no "edit anyway" to offer.
              onUnlock={() => setUnlockedFor(openId)}
              detailError={detailError}
              edit={edit}
              detail={detail}
              markWorkaroundHandled={markWorkaroundHandled}
              working={working}
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
                viewer={viewer}
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

          {activeTab === DETAIL_TABS.recurrences && (
            <DetailPane id={DETAIL_TABS.recurrences}>
              <DetailGroup label="Who has reported this happening to them">
                {/* No onChanged: both admin actions emit submission:recurrence,
                    and useAdminNotifications already reloads the queue and the
                    open detail on any admin event. The pane reloads itself for
                    the immediate feedback, and refreshToken re-syncs it when the
                    detail comes back with a new count. */}
                <DetailRecurrences
                  submissionId={openId}
                  detail={detail}
                  canEdit={!readOnly}
                  refreshToken={detail?.recurrence_count || 0}
                />
              </DetailGroup>
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
              {/* Reassignment is required, so the current assignee cannot be the
                  only record of who has held it. Same shape as the status trail
                  above, on the tab that already means "what happened to this". */}
              {isReportRequest && (
                <DetailGroup label="Who has held this">
                  <DetailHandoverSection assignments={detail.assignments} />
                </DetailGroup>
              )}
              <DetailReferenceSection detail={detail} edit={edit} setEdit={setEdit} />
            </DetailPane>
          )}

          {activeTab === DETAIL_TABS.delivery && (
            <DetailPane id={DETAIL_TABS.delivery} lockBody={locked}>
              <DetailDeliverySection
                detail={detail}
                edit={edit}
                setEdit={setEdit}
                locked={locked}
                working={working}
                dynamicPriorityLevels={dynamicPriorityLevels}
                dynamicLevelsOfEffort={dynamicLevelsOfEffort}
                viewerUserId={viewerUserId}
                onLogHours={logHours}
                onRemoveHours={removeHours}
                onAttachApproval={attachApprovalFiles}
                onRemoveApproval={deleteAttachment}
              />
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
