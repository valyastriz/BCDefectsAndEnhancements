import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { editableFromDetail, normalizeAdminRow, buildAdminUpdatePayload, hasPendingModalChanges } from '../utils/mappers';

/**
 * Custom hook for the admin submission detail/edit modal.
 *
 * @param {Object} deps
 * @param {Function} deps.loadRows - reload the main submissions table
 * @param {Function} deps.setRows - setter for the rows state
 * @param {Function} deps.setNotice - page-level notice setter
 * @param {Function} deps.setError - page-level error setter
 * @returns Detail modal state and handlers
 */
export function useDetailModal({ loadRows, setRows, setError, currentUsername }) {
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState(null);
  // Optimistic-concurrency guard: the row version this modal is editing against,
  // plus a banner describing a change another admin made while it was open.
  const baseUpdatedAtRef = useRef(null);
  // Snapshot of the editable fields as first loaded — the "base" for a 3-way
  // diff (base vs your draft vs the now-current server version) on a conflict.
  const baseEditRef = useRef(null);
  const openIdRef = useRef(null);
  const hasPendingRef = useRef(false);
  const [conflictInfo, setConflictInfo] = useState(null);
  const [recoverableDraft, setRecoverableDraft] = useState(null);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState([]);
  const [pendingRemovedAttachmentIds, setPendingRemovedAttachmentIds] = useState([]);
  const [modalTopNotice, setModalTopNotice] = useState('');
  const [modalBottomNotice, setModalBottomNotice] = useState('');
  const [detailError, setDetailError] = useState('');
  const [working, setWorking] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [easyVistaConfirmation, setEasyVistaConfirmation] = useState('');
  const [showHeaderSaveTooltip, setShowHeaderSaveTooltip] = useState(false);
  const [showFooterSaveTooltip, setShowFooterSaveTooltip] = useState(false);
  const [showEasyVistaRequirements, setShowEasyVistaRequirements] = useState(false);
  const [sendAsType, setSendAsType] = useState(null);
  // null = "not chosen", which the server reads as "all of them, up to the cap".
  const [easyVistaAttachmentIds, setEasyVistaAttachmentIds] = useState(null);

  const previousDetailEditRef = useRef(null);
  const previousDetailPendingFilesCountRef = useRef(0);
  const previousDetailPendingRemovedCountRef = useRef(0);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isDetailModalOpen = Boolean(openId && detail && edit);
  // Keep a ref in sync so the socket-driven remote-update handler reads the live id.
  openIdRef.current = openId;

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const clearPendingAttachmentDrafts = useCallback(() => {
    setPendingAttachmentFiles((prev) => {
      prev.forEach((item) => {
        if (item?.preview_url) {
          URL.revokeObjectURL(item.preview_url);
        }
      });
      return [];
    });
    setPendingRemovedAttachmentIds([]);
  }, []);

  // ── Local draft persistence (survives reload / accidental close) ───────────
  const draftKey = useCallback(
    (id) => `bcModalDraft:${currentUsername || 'admin'}:${id}`,
    [currentUsername],
  );
  const removeDraft = useCallback((id) => {
    if (typeof window === 'undefined' || id == null) return;
    try { window.localStorage.removeItem(draftKey(id)); } catch { /* ignore */ }
  }, [draftKey]);

  const openDetail = useCallback(async (id, preserveEdit = false) => {
    try {
      setError('');
      if (!preserveEdit) {
        setEasyVistaConfirmation('');
        setShowEasyVistaRequirements(false);
        // A send-as choice and a file selection belong to the ticket they were
        // made on.
        setSendAsType(null);
        setEasyVistaAttachmentIds(null);
      }
      const data = await api.getAdminSubmissionDetail(id);
      setDetail(data);
      if (!preserveEdit) {
        const editable = editableFromDetail(data);
        setEdit(editable);
        baseEditRef.current = editable;
        clearPendingAttachmentDrafts();
        // Fresh open (not a live refresh): adopt this version as the edit base and
        // clear any stale "someone else changed it" banner.
        baseUpdatedAtRef.current = data?.updated_at ?? null;
        setConflictInfo(null);

        // Offer a previously-saved local draft for this item if it differs.
        let recoverable = null;
        if (typeof window !== 'undefined') {
          try {
            const raw = window.localStorage.getItem(draftKey(id));
            if (raw) {
              const stored = JSON.parse(raw);
              const isDifferent = stored?.edit
                && JSON.stringify(buildAdminUpdatePayload(stored.edit))
                  !== JSON.stringify(buildAdminUpdatePayload(editable));
              if (isDifferent) recoverable = stored;
              else window.localStorage.removeItem(draftKey(id));
            }
          } catch { /* ignore malformed draft */ }
        }
        setRecoverableDraft(recoverable);
      } else if (!hasPendingRef.current) {
        // Live refresh for a pure viewer (no unsaved edits): adopt the fresh
        // version as the new edit base. Keeping the stale snapshot would make
        // the form show outdated values and a follow-up Save would silently
        // revert the other admin's change.
        const editable = editableFromDetail(data);
        setEdit(editable);
        baseEditRef.current = editable;
        baseUpdatedAtRef.current = data?.updated_at ?? null;
      }
      setOpenId(id);
      return data;
    } catch (detailErr) {
      setError(detailErr.message);
      return null;
    }
  }, [clearPendingAttachmentDrafts, setError, draftKey]);

  // Called when a live `submission:updated` event arrives. If it targets the open
  // ticket and was made by another admin, surface a banner. We advance the edit
  // base too — the user has been warned, so a follow-up save is intentional (the
  // server still 409s if the event was missed entirely).
  const noteRemoteUpdate = useCallback(({ id, updatedBy, updatedAt }) => {
    if (id == null || Number(id) !== Number(openIdRef.current)) return;
    if (updatedBy && currentUsername && updatedBy === currentUsername) return;
    if (updatedAt) baseUpdatedAtRef.current = updatedAt;
    // Only warn if the viewer has unsaved edits to lose; a pure viewer just gets
    // the silent live refresh that already happened.
    if (!hasPendingRef.current) return;
    setConflictInfo({ updatedBy: updatedBy || 'Another admin', at: updatedAt || null });
  }, [currentUsername]);

  const restoreDraft = useCallback(() => {
    setRecoverableDraft((d) => {
      if (d?.edit) setEdit(d.edit);
      return null;
    });
  }, []);
  const discardDraft = useCallback(() => {
    removeDraft(openIdRef.current);
    setRecoverableDraft(null);
  }, [removeDraft]);

  // ── Memos ──────────────────────────────────────────────────────────────────

  const modalTitle = useMemo(() => {
    if (!detail) return 'Submission Details';
    return `Submission #${detail.id}`;
  }, [detail]);

  const effectiveType = useMemo(() => {
    if (!edit) return '';
    if (edit.is_cleanup) {
      if (!edit.cleanup_tag_type || edit.cleanup_tag_type === 'cleanup_only') {
        return 'defect';
      }
      return edit.cleanup_tag_type;
    }
    return edit.type || '';
  }, [edit]);

  // EasyVista accepts a defect or an enhancement and nothing else, so the admin
  // picks which one a send goes out as. Pre-filled with the ticket's own type;
  // a Cleanup Only task is neither, so it stays null until they choose.
  // Mirrors `defaultSendAsType` in server/src/helpers/easyVistaPayload.js.
  const defaultSendAsType = useMemo(() => {
    if (!edit) return null;
    if (edit.is_cleanup) {
      if (!edit.cleanup_tag_type || edit.cleanup_tag_type === 'cleanup_only') return null;
      return edit.cleanup_tag_type === 'enhancement' ? 'enhancement' : 'defect';
    }
    return edit.type === 'enhancement' ? 'enhancement' : 'defect';
  }, [edit]);

  const resolvedSendAsType = sendAsType || defaultSendAsType;

  // Which fields block a send follows the chosen type, not the ticket's type —
  // send a cleanup task as an enhancement and it must satisfy enhancement rules.
  const easyVistaMissingRequirements = useMemo(() => {
    if (!detail || !edit) return [];
    const missing = [];
    if (resolvedSendAsType === 'enhancement') {
      if (!String(edit.impact_details || '').trim()) missing.push('Impact Details');
      if (!String(edit.enhancement_request_type || '').trim()) missing.push('Request Type');
      if (!String(edit.desired_completion_date || '').trim()) missing.push('Desired Completion Date');
    }
    if (resolvedSendAsType === 'defect') {
      if (!String(edit.summary_of_issue || '').trim()) missing.push('Summary of Issue');
      if (!String(edit.screen_title || '').trim()) missing.push('Screen Title');
      if (!String(edit.what_happened_exact_details || '').trim()) missing.push('Description');
    }
    return missing;
  }, [detail, edit, resolvedSendAsType]);

  const hasPendingChanges = useMemo(
    () => (
      hasPendingModalChanges(detail, edit)
      || pendingAttachmentFiles.length > 0
      || pendingRemovedAttachmentIds.length > 0
    ),
    [detail, edit, pendingAttachmentFiles.length, pendingRemovedAttachmentIds.length],
  );
  // Mirror pending-changes into a ref so the socket-driven conflict handler can
  // read it without being re-created on every keystroke.
  hasPendingRef.current = hasPendingChanges;

  const visibleExistingAttachments = useMemo(
    () => (detail?.attachments || []).map((att) => ({
      ...att,
      _isMarkedForRemoval: pendingRemovedAttachmentIds.includes(Number(att.id)),
    })),
    [detail, pendingRemovedAttachmentIds],
  );

  const pendingAttachmentItems = useMemo(
    () => pendingAttachmentFiles.map((item) => ({
      id: item.id,
      filename: item.file?.name || 'attachment',
      mime_type: item.file?.type || 'application/octet-stream',
      preview_url: item.preview_url || '',
      _isPendingUpload: true,
    })),
    [pendingAttachmentFiles],
  );

  const visibleAttachments = useMemo(
    () => [...visibleExistingAttachments, ...pendingAttachmentItems],
    [visibleExistingAttachments, pendingAttachmentItems],
  );

  const saveDisabledReason = working
    ? 'Saving in progress'
    : hasPendingChanges
      ? 'Save changes'
      : 'No unsaved changes';

  // ── Auto-clear error when edits change ─────────────────────────────────────

  useEffect(() => {
    const editChanged = previousDetailEditRef.current !== edit;
    const pendingFilesChanged = previousDetailPendingFilesCountRef.current !== pendingAttachmentFiles.length;
    const pendingRemovedChanged = previousDetailPendingRemovedCountRef.current !== pendingRemovedAttachmentIds.length;

    previousDetailEditRef.current = edit;
    previousDetailPendingFilesCountRef.current = pendingAttachmentFiles.length;
    previousDetailPendingRemovedCountRef.current = pendingRemovedAttachmentIds.length;

    if (!isDetailModalOpen || !detailError) return;
    if (editChanged || pendingFilesChanged || pendingRemovedChanged) {
      setDetailError('');
    }
  }, [edit, pendingAttachmentFiles.length, pendingRemovedAttachmentIds.length, isDetailModalOpen, detailError]);

  // ── Persist the in-progress draft locally (debounced) ──────────────────────
  // Paused while a recovered draft is being offered, so we don't wipe it before
  // the user decides to restore or discard.
  useEffect(() => {
    if (typeof window === 'undefined' || !openId || !edit || recoverableDraft) return undefined;
    const key = draftKey(openId);
    const handle = setTimeout(() => {
      try {
        if (hasPendingModalChanges(detail, edit)) {
          window.localStorage.setItem(key, JSON.stringify({ edit, savedAt: new Date().toISOString() }));
        } else {
          window.localStorage.removeItem(key);
        }
      } catch { /* ignore quota / serialization errors */ }
    }, 800);
    return () => clearTimeout(handle);
  }, [edit, detail, openId, recoverableDraft, draftKey]);

  // ── Action functions ───────────────────────────────────────────────────────

  async function saveEdits(source = 'footer') {
    if (!openId || !edit) return;
    const hasFieldChanges = hasPendingModalChanges(detail, edit);
    const hasAttachmentChanges = pendingAttachmentFiles.length > 0 || pendingRemovedAttachmentIds.length > 0;
    if (!hasFieldChanges && !hasAttachmentChanges) {
      if (source === 'header') {
        setModalTopNotice('No changes to save.');
        setModalBottomNotice('');
      } else {
        setModalBottomNotice('No changes to save.');
        setModalTopNotice('');
      }
      return;
    }
    try {
      setWorking(true);
      let saved = null;
      if (hasFieldChanges) {
        saved = await api.updateAdminSubmission(openId, {
          ...buildAdminUpdatePayload(edit),
          base_updated_at: baseUpdatedAtRef.current,
        });
        if (saved?.id) {
          setRows((prev) =>
            prev.map((row) => (
              Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row
            )),
          );
        }
      }

      const targetSubmissionId = Number(saved?.id || openId);

      if (pendingAttachmentFiles.length > 0) {
        const formData = new FormData();
        pendingAttachmentFiles.forEach((item) => {
          if (item?.file) formData.append('attachments', item.file);
        });
        await api.uploadAdminAttachment(targetSubmissionId, formData);
      }

      if (pendingRemovedAttachmentIds.length > 0) {
        for (const attachmentId of pendingRemovedAttachmentIds) {
          await api.deleteAdminAttachment(attachmentId);
        }
      }

      removeDraft(targetSubmissionId);
      await openDetail(targetSubmissionId);
      await loadRows();
      if (source === 'header') {
        setModalTopNotice('Saved successfully.');
        setModalBottomNotice('');
      } else {
        setModalBottomNotice('Saved successfully.');
        setModalTopNotice('');
      }
    } catch (saveError) {
      setModalTopNotice('');
      setModalBottomNotice('');
      if (saveError.status === 409) {
        // Another admin saved first. Reload the latest (keeping the user's draft),
        // re-base against it so a deliberate re-save can go through, and warn them.
        const fresh = await openDetail(openId, true);
        if (fresh) baseUpdatedAtRef.current = fresh.updated_at ?? null;
        setConflictInfo({ updatedBy: 'Another admin', at: saveError.body?.currentUpdatedAt || null });
        setDetailError('This item was changed by someone else while you had it open. The latest version is now loaded — resolve the overlapping fields below, then save again.');
      } else {
        setDetailError(saveError.message);
      }
    } finally {
      setWorking(false);
    }
  }

  async function retireCurrentItem() {
    if (!openId || !edit || edit.is_retired) return;
    try {
      setWorking(true);
      setDetailError('');
      const saved = await api.updateAdminSubmission(openId, { is_retired: true });
      if (saved?.id) {
        await openDetail(saved.id);
        // Refresh the table so retired filtering is applied consistently
        loadRows();
      }
      setModalTopNotice('Item retired.');
      setModalBottomNotice('');
    } catch (retireError) {
      setModalTopNotice('');
      setModalBottomNotice('');
      setDetailError(retireError.message);
    } finally {
      setWorking(false);
    }
  }

  async function unretireCurrentItem() {
    if (!openId || !edit || !edit.is_retired) return;
    try {
      setWorking(true);
      setDetailError('');
      const saved = await api.updateAdminSubmission(openId, { is_retired: false, unretire: true });
      if (saved?.id) {
        await openDetail(saved.id);
        // Refresh the table so retired filtering is applied consistently
        loadRows();
      }
      setModalTopNotice('Item unretired.');
      setModalBottomNotice('');
    } catch (unretireError) {
      setModalTopNotice('');
      setModalBottomNotice('');
      setDetailError(unretireError.message);
    } finally {
      setWorking(false);
    }
  }

  async function uploadAttachment(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    const queuedFiles = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      preview_url: file.type?.startsWith('image/') ? URL.createObjectURL(file) : '',
    }));
    setPendingAttachmentFiles((prev) => [...prev, ...queuedFiles]);
    setModalTopNotice('Attachment changes are staged. Click Save Changes to apply.');
    setModalBottomNotice('');
  }

  function removePendingAttachment(localId) {
    setPendingAttachmentFiles((prev) => {
      const target = prev.find((item) => item.id === localId);
      if (target?.preview_url) URL.revokeObjectURL(target.preview_url);
      return prev.filter((item) => item.id !== localId);
    });
  }

  function toggleAttachmentRemoval(attachmentId) {
    const normalizedId = Number(attachmentId);
    if (!Number.isFinite(normalizedId)) return;
    setPendingRemovedAttachmentIds((prev) => (
      prev.includes(normalizedId)
        ? prev.filter((id) => id !== normalizedId)
        : [...prev, normalizedId]
    ));
  }

  async function deleteAttachment(attachment) {
    if (attachment?._isPendingUpload) {
      removePendingAttachment(attachment.id);
      return;
    }
    toggleAttachmentRemoval(attachment.id);
    setModalTopNotice('Attachment changes are staged. Click Save Changes to apply.');
    setModalBottomNotice('');
  }

  async function submitEasyVista() {
    if (!openId || !edit) return;
    if (pendingAttachmentFiles.length > 0 || pendingRemovedAttachmentIds.length > 0) {
      setDetailError('You have unsaved attachment changes. Click Save Changes first.');
      return;
    }
    setShowEasyVistaRequirements(true);
    setEasyVistaConfirmation('');
    setDetailError('');
    if (!resolvedSendAsType) {
      setDetailError('Choose whether this goes to EasyVista as a Defect or an Enhancement.');
      return;
    }
    if (easyVistaMissingRequirements.length > 0) return;
    try {
      setWorking(true);
      const isResubmit = Boolean(detail?.easyvista_ticket_id);
      const draftPayload = hasPendingModalChanges(detail, edit) ? buildAdminUpdatePayload(edit) : null;

      if (!isResubmit && draftPayload) {
        await api.updateAdminSubmission(openId, {
          ...draftPayload,
          base_updated_at: baseUpdatedAtRef.current,
        });
      }

      const result = await api.submitToEasyVista(openId, {
        ...(isResubmit ? { draft: draftPayload } : {}),
        sendAsType: resolvedSendAsType,
        ...(easyVistaAttachmentIds ? { attachmentIds: easyVistaAttachmentIds } : {}),
      });

      let refreshed = null;
      if (result?.submission) {
        refreshed = await openDetail(result.submission.id || openId, true);
      } else {
        refreshed = await openDetail(openId, true);
      }

      if (refreshed) setEdit(editableFromDetail(refreshed));

      await loadRows();
      setShowEasyVistaRequirements(false);
      if (result?.resubmission) {
        setEasyVistaConfirmation(
          `Successfully re-submitted to EasyVista. New card #${result?.submission?.id || ''}, Ticket: ${result?.ticketId || 'created'}`,
        );
      } else {
        setEasyVistaConfirmation(`Successfully submitted to EasyVista. Ticket: ${result?.ticketId || 'created'}`);
      }
    } catch (submitError) {
      setEasyVistaConfirmation('');
      setModalTopNotice('');
      setModalBottomNotice('');
      setDetailError(submitError.message);
    } finally {
      setWorking(false);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    openId,
    setOpenId,
    detail,
    setDetail,
    edit,
    setEdit,
    pendingAttachmentFiles,
    pendingRemovedAttachmentIds,
    modalTopNotice,
    setModalTopNotice,
    modalBottomNotice,
    setModalBottomNotice,
    detailError,
    setDetailError,
    working,
    previewAttachment,
    setPreviewAttachment,
    easyVistaConfirmation,
    showHeaderSaveTooltip,
    setShowHeaderSaveTooltip,
    showFooterSaveTooltip,
    setShowFooterSaveTooltip,
    showEasyVistaRequirements,
    setShowEasyVistaRequirements,
    isDetailModalOpen,
    clearPendingAttachmentDrafts,
    openDetail,
    conflictInfo,
    setConflictInfo,
    noteRemoteUpdate,
    baseEdit: baseEditRef.current,
    recoverableDraft,
    restoreDraft,
    discardDraft,
    modalTitle,
    effectiveType,
    sendAsType,
    setSendAsType,
    resolvedSendAsType,
    defaultSendAsType,
    easyVistaAttachmentIds,
    setEasyVistaAttachmentIds,
    easyVistaMissingRequirements,
    hasPendingChanges,
    visibleExistingAttachments,
    pendingAttachmentItems,
    visibleAttachments,
    saveDisabledReason,
    saveEdits,
    retireCurrentItem,
    unretireCurrentItem,
    uploadAttachment,
    deleteAttachment,
    submitEasyVista,
  };
}
