import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { defaultBackdatedForm } from '../utils/formDefaults';

/**
 * Custom hook for the admin backdated-ticket modal.
 *
 * @param {Object} deps
 * @param {Object} deps.user - current admin user
 * @param {Function} deps.loadRows - reload the main submissions table
 * @param {Function} deps.setNotice - page-level notice setter
 * @returns Backdated modal state and handlers
 */
export function useBackdatedModal({ user, loadRows, setNotice }) {
  const [backdatedOpen, setBackdatedOpen] = useState(false);
  const [backdatedError, setBackdatedError] = useState('');
  const [backdatedWorking, setBackdatedWorking] = useState(false);
  const [backdatedForm, setBackdatedForm] = useState(defaultBackdatedForm(user?.username || ''));
  const previousBackdatedFormRef = useRef(null);

  // ── Auto-clear error when form changes ─────────────────────────────────────

  useEffect(() => {
    const backdatedChanged = previousBackdatedFormRef.current !== backdatedForm;
    previousBackdatedFormRef.current = backdatedForm;

    if (!backdatedOpen || !backdatedError) return;
    if (backdatedChanged) {
      setBackdatedError('');
    }
  }, [backdatedForm, backdatedOpen, backdatedError]);

  // ── Functions ──────────────────────────────────────────────────────────────

  function resetBackdatedForm() {
    setBackdatedForm(defaultBackdatedForm(user?.username || ''));
  }

  async function createBackdatedTicket() {
    const createdBy = String(backdatedForm.created_by || '').trim()
      || String(user?.username || '').trim()
      || 'Admin';

    if (!String(backdatedForm.summary_of_issue || '').trim()) {
      setBackdatedError('Backdated ticket requires Summary of Issue.');
      return;
    }

    try {
      setBackdatedWorking(true);
      setBackdatedError('');

      const statusEvents = [];

      if (backdatedForm.reported_at) {
        statusEvents.push({ status: 'New', changed_at: backdatedForm.reported_at });
      }

      for (const [statusKey, changedAt] of Object.entries(backdatedForm.status_dates)) {
        if (changedAt) {
          statusEvents.push({ status: statusKey, changed_at: changedAt });
        }
      }

      const payload = {
        created_via: String(backdatedForm.created_via || '').trim() || 'admin_backdated',
        type: backdatedForm.type,
        status: backdatedForm.status,
        created_by: createdBy,
        created_by_email: backdatedForm.created_by_email.trim() || '-',
        application_name: backdatedForm.application_name || 'Billing Center',
        summary_of_issue: backdatedForm.summary_of_issue.trim(),
        screen_title: backdatedForm.screen_title.trim() || '-',
        request: backdatedForm.request.trim() || '-',
        created_at: backdatedForm.reported_at || null,
        date_time_of_error: backdatedForm.reported_at || null,
        desired_completion_date: backdatedForm.desired_completion_date || null,
        jira_number: backdatedForm.jira_number.trim() || null,
        release_number: backdatedForm.release_number.trim() || null,
        logged_defect: Boolean(String(backdatedForm.jira_number || '').trim()),
        easyvista_ticket_id: String(backdatedForm.easyvista_ticket_id || '').trim() || null,
        easyvista_submitted_by: String(backdatedForm.easyvista_submitted_by || '').trim() || 'Unknown',
        status_events: statusEvents,
      };

      const created = await api.createAdminSubmission(payload);

      const hasImpactTrackingValues =
        String(backdatedForm.impact_notes || '').trim().length > 0
        || String(backdatedForm.policy_premium_impact || '').trim().length > 0
        || String(backdatedForm.direct_dollar_impact || '').trim().length > 0
        || String(backdatedForm.policies_affected_count || '').trim().length > 0;

      if (created?.id && hasImpactTrackingValues) {
        await api.updateAdminSubmission(created.id, {
          impact_notes: String(backdatedForm.impact_notes || '').trim() || null,
          policy_premium_impact:
            String(backdatedForm.policy_premium_impact || '').trim() === ''
              ? null
              : Number(backdatedForm.policy_premium_impact),
          direct_dollar_impact:
            String(backdatedForm.direct_dollar_impact || '').trim() === ''
              ? null
              : Number(backdatedForm.direct_dollar_impact),
          policies_affected_count:
            String(backdatedForm.policies_affected_count || '').trim() === ''
              ? null
              : Number(backdatedForm.policies_affected_count),
        });
      }

      await loadRows();
      setBackdatedOpen(false);
      resetBackdatedForm();
      setNotice(`Backdated ticket #${created?.id || ''} created successfully.`);
    } catch (createError) {
      setBackdatedError(createError.message);
    } finally {
      setBackdatedWorking(false);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    backdatedOpen,
    setBackdatedOpen,
    backdatedError,
    backdatedWorking,
    backdatedForm,
    setBackdatedForm,
    resetBackdatedForm,
    createBackdatedTicket,
  };
}
