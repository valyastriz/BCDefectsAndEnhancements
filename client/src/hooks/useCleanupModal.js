import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { defaultCleanupForm } from '../utils/formDefaults';

/**
 * Custom hook for the admin cleanup-task modal.
 *
 * @param {Object} deps
 * @param {Object} deps.user - current admin user
 * @param {Function} deps.loadRows - reload the main submissions table
 * @param {Function} deps.setNotice - page-level notice setter
 * @returns Cleanup modal state and handlers
 */
export function useCleanupModal({ user, loadRows, setNotice }) {
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const [cleanupWorking, setCleanupWorking] = useState(false);
  const [cleanupForm, setCleanupForm] = useState(defaultCleanupForm(user?.username || ''));
  const [cleanupFiles, setCleanupFiles] = useState([]);
  const [cleanupPreviewIndex, setCleanupPreviewIndex] = useState(null);
  const previousCleanupFormRef = useRef(null);
  const previousCleanupFilesCountRef = useRef(0);
  const cleanupFileInputRef = useRef(null);

  // ── Memos ──────────────────────────────────────────────────────────────────

  const cleanupRequiresEasyVistaFields = useMemo(
    () => Boolean(cleanupForm.submit_to_easyvista)
      && (cleanupForm.cleanup_tag_type === 'defect' || cleanupForm.cleanup_tag_type === 'enhancement'),
    [cleanupForm.submit_to_easyvista, cleanupForm.cleanup_tag_type],
  );

  const cleanupFilePreviews = useMemo(
    () => cleanupFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [cleanupFiles],
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  // Auto-clear error when form or files change
  useEffect(() => {
    const cleanupFormChanged = previousCleanupFormRef.current !== cleanupForm;
    const cleanupFilesChanged = previousCleanupFilesCountRef.current !== cleanupFiles.length;

    previousCleanupFormRef.current = cleanupForm;
    previousCleanupFilesCountRef.current = cleanupFiles.length;

    if (!cleanupOpen || !cleanupError) return;
    if (cleanupFormChanged || cleanupFilesChanged) {
      setCleanupError('');
    }
  }, [cleanupForm, cleanupFiles.length, cleanupOpen, cleanupError]);

  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      cleanupFilePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [cleanupFilePreviews]);

  // ── Functions ──────────────────────────────────────────────────────────────

  function resetCleanupForm() {
    setCleanupForm(defaultCleanupForm(user?.username || ''));
    setCleanupFiles([]);
  }

  async function createCleanupTask() {
    const cleanupTagType = String(cleanupForm.cleanup_tag_type || '').trim();
    const createdBy = String(cleanupForm.created_by || '').trim()
      || String(user?.username || '').trim()
      || 'Admin';

    const isDefectTagged = cleanupTagType === 'defect';
    const isEnhancementTagged = cleanupTagType === 'enhancement';
    const isTagged = isDefectTagged || isEnhancementTagged;
    const isCleanupOnly = cleanupTagType === 'cleanup_only' || !cleanupTagType;
    const submitToEasyVista = Boolean(cleanupForm.submit_to_easyvista);
    const requiresEasyVistaFields = submitToEasyVista && isTagged;

    const missing = [];

    if (!String(cleanupForm.summary_of_issue || '').trim()) {
      missing.push(isDefectTagged ? 'Summary of Issue' : 'Summary');
    }

    if (!isTagged && !String(cleanupForm.description || '').trim()) {
      missing.push('Description');
    }

    if (submitToEasyVista && !isTagged) {
      missing.push('Tag as Defect or Enhancement (required for EasyVista submission)');
    }

    if (requiresEasyVistaFields && isDefectTagged) {
      if (!String(cleanupForm.screen_title || '').trim()) {
        missing.push('Screen Title');
      }
      if (!String(cleanupForm.what_happened_exact_details || '').trim()) {
        missing.push('What Happened (Exact Details)');
      }
      if (!String(cleanupForm.date_of_error || '').trim()) {
        missing.push('Date of Error');
      }
    }

    if (requiresEasyVistaFields && isEnhancementTagged) {
      if (!String(cleanupForm.request || '').trim()) {
        missing.push('Request Details');
      }
      if (!String(cleanupForm.desired_completion_date || '').trim()) {
        missing.push('Desired Completion Date');
      }
      if (!String(cleanupForm.impact_details || '').trim()) {
        missing.push('Impact Details');
      }
      if (!String(cleanupForm.enhancement_request_type || '').trim()) {
        missing.push('Request Type');
      }
    }

    if (missing.length > 0) {
      setCleanupError(`Missing required field(s): ${missing.join(', ')}`);
      return;
    }

    try {
      setCleanupWorking(true);
      setCleanupError('');

      const defectDateTime = isDefectTagged && cleanupForm.date_of_error
        ? `${cleanupForm.date_of_error}T${cleanupForm.time_of_error || '00:00'}`
        : '';

      const payload = {
        created_via: String(cleanupForm.created_via || '').trim() || 'admin_cleanup',
        type: isEnhancementTagged ? 'enhancement' : 'defect',
        is_cleanup: true,
        cleanup_status: cleanupForm.cleanup_status,
        cleanup_tag_type: isCleanupOnly ? 'cleanup_only' : cleanupTagType,
        status: 'New',
        created_by: createdBy,
        created_by_email: String(cleanupForm.created_by_email || '-').trim() || '-',
        application_name: isEnhancementTagged
          ? 'Billing Center'
          : (cleanupForm.application_name || 'Billing Center'),
        summary_of_issue: cleanupForm.summary_of_issue.trim(),
        what_happened_exact_details: isDefectTagged
          ? cleanupForm.what_happened_exact_details.trim()
          : (isEnhancementTagged ? '-' : cleanupForm.description.trim()),
        request: isEnhancementTagged
          ? cleanupForm.request.trim()
          : (isDefectTagged ? '-' : cleanupForm.description.trim()),
        steps_to_reproduce:
          isDefectTagged
            ? (String(cleanupForm.steps_to_reproduce || '-').trim() || '-')
            : '-',
        screen_title:
          isDefectTagged
            ? (String(cleanupForm.screen_title || '-').trim() || '-')
            : '-',
        date_time_of_error: isDefectTagged ? (defectDateTime || cleanupForm.date_time_of_error || null) : null,
        desired_completion_date:
          isEnhancementTagged ? (cleanupForm.desired_completion_date || null) : null,
        impact_details: isEnhancementTagged ? (cleanupForm.impact_details || null) : null,
        enhancement_request_type:
          isEnhancementTagged ? (cleanupForm.enhancement_request_type || null) : null,
        priority_level:
          isEnhancementTagged ? (cleanupForm.priority_level || '3 - Medium') : null,
        policy_num: isDefectTagged ? (cleanupForm.policy_num || null) : null,
        account_num: isDefectTagged ? (cleanupForm.account_num || null) : null,
        transaction_num: isDefectTagged ? (cleanupForm.transaction_num || null) : null,
        jira_number: cleanupForm.jira_number || null,
        release_number: cleanupForm.release_number || null,
        logged_defect: Boolean(String(cleanupForm.jira_number || '').trim()),
        easyvista_ticket_id: cleanupForm.easyvista_ticket_id || null,
        easyvista_submitted_by: cleanupForm.easyvista_submitted_by || 'Unknown',
      };

      const created = await api.createAdminSubmission(payload);

      const hasImpactTrackingValues =
        String(cleanupForm.impact_notes || '').trim().length > 0
        || String(cleanupForm.policy_premium_impact || '').trim().length > 0
        || String(cleanupForm.direct_dollar_impact || '').trim().length > 0
        || String(cleanupForm.policies_affected_count || '').trim().length > 0;

      if (created?.id && hasImpactTrackingValues) {
        await api.updateAdminSubmission(created.id, {
          impact_notes: String(cleanupForm.impact_notes || '').trim() || null,
          policy_premium_impact:
            String(cleanupForm.policy_premium_impact || '').trim() === ''
              ? null
              : Number(cleanupForm.policy_premium_impact),
          direct_dollar_impact:
            String(cleanupForm.direct_dollar_impact || '').trim() === ''
              ? null
              : Number(cleanupForm.direct_dollar_impact),
          policies_affected_count:
            String(cleanupForm.policies_affected_count || '').trim() === ''
              ? null
              : Number(cleanupForm.policies_affected_count),
        });
      }

      if (created?.id && cleanupFiles.length > 0) {
        const formData = new FormData();
        cleanupFiles.slice(0, 3).forEach((file) => formData.append('attachments', file));
        await api.uploadAdminAttachment(created.id, formData);
      }

      let easyVistaResult = null;
      let easyVistaError = '';
      if (created?.id && cleanupForm.submit_to_easyvista && isTagged) {
        try {
          easyVistaResult = await api.submitToEasyVista(created.id);
        } catch (submitError) {
          easyVistaError = submitError.message;
        }
      }

      await loadRows();
      setCleanupOpen(false);
      resetCleanupForm();
      if (easyVistaResult?.ticketId) {
        setNotice(`Cleanup task #${created?.id || ''} created and submitted to EasyVista (${easyVistaResult.ticketId}).`);
      } else if (easyVistaError) {
        setNotice(`Cleanup task #${created?.id || ''} created, but EasyVista submission failed: ${easyVistaError}`);
      } else {
        setNotice(`Cleanup task #${created?.id || ''} created successfully.`);
      }
    } catch (createError) {
      setCleanupError(createError.message);
    } finally {
      setCleanupWorking(false);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function openCleanupModal() {
    setCleanupError('');
    resetCleanupForm();
    setCleanupOpen(true);
  }

  function closeCleanupModal() {
    setCleanupError('');
    setCleanupOpen(false);
    resetCleanupForm();
  }

  return {
    cleanupOpen,
    setCleanupOpen,
    cleanupError,
    setCleanupError,
    cleanupWorking,
    cleanupForm,
    setCleanupForm,
    cleanupFiles,
    setCleanupFiles,
    cleanupPreviewIndex,
    setCleanupPreviewIndex,
    cleanupFileInputRef,
    cleanupRequiresEasyVistaFields,
    cleanupFilePreviews,
    resetCleanupForm,
    createCleanupTask,
    openCleanupModal,
    closeCleanupModal,
  };
}
