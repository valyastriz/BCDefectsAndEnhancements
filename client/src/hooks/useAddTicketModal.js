import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  ADD_TICKET_CREATED_VIA,
  addTicketStatusStops,
  defaultAddTicketForm,
} from '../utils/formDefaults';
import { TRACKER_LABEL_THE } from '../constants/tracker';
import { SUBMISSION_TYPE_REPORT, statusesForRequestType } from '../constants/statusConstants';

/**
 * Which field set the dialog is asking for.
 *
 * A cleanup task is a flag plus a tag in the data, not a third peer of defect and
 * enhancement — but "what am I adding?" has three answers for the person filling
 * the form in. The computed branch reconciles the two: defect -> defect,
 * enhancement -> enhancement, cleanup -> whatever it is tagged as ('none' when it
 * is internal only). One value to key off instead of a rule per type/tag pair.
 */
export function addTicketBranch(form) {
  const type = String(form?.type || '').trim().toLowerCase();
  if (type === 'defect' || type === 'enhancement' || type === SUBMISSION_TYPE_REPORT) return type;
  const tag = String(form?.cleanup_tag_type || 'cleanup_only').trim().toLowerCase();
  if (tag === 'defect' || tag === 'enhancement') return tag;
  return 'none';
}

/**
 * A report request's own sub-branch: something new, or a change to one that
 * exists. Mirrors the submit form, where the same choice reshapes the same card —
 * a change asks WHICH report first, and a new one asks for measures and sources.
 */
export function addTicketReportBranch(form) {
  return form?.is_new_dashboard === false ? 'change' : 'new';
}

/**
 * Turn the dialog's form into the POST /api/admin/submissions body.
 *
 * Only fields belonging to the visible subset are sent: the form keeps what was
 * typed into a branch the admin has since navigated away from (so flipping back
 * does not erase it), but a hidden field must not reach the record.
 */
export function buildAddTicketPayload(form) {
  const branch = addTicketBranch(form);
  const isCleanup = String(form.type || '').toLowerCase() === 'cleanup';
  const isHistorical = form.mode === 'hist';
  const isDefectBranch = branch === 'defect';
  const isEnhancementBranch = branch === 'enhancement';
  const isReportBranch = branch === SUBMISSION_TYPE_REPORT;
  const isNewDashboard = addTicketReportBranch(form) === 'new';
  // An internal-only cleanup has no defect/enhancement narrative, so its one
  // Description field fills both — the same shape the cleanup modal used, so
  // existing internal cleanup rows and new ones read identically.
  const internalDescription = String(form.description || '').trim();

  const defectDateTime = isDefectBranch && form.date_of_error
    ? `${form.date_of_error}T${form.time_of_error || '00:00'}`
    : '';

  const statusEvents = [];
  if (isHistorical) {
    if (form.reported_at) {
      statusEvents.push({ status: 'New', changed_at: form.reported_at });
    }
    // The stops this type actually has: a report request's timeline reaches
    // In progress and Delivered, never Submitted or Deployed.
    for (const stop of addTicketStatusStops(form.type)) {
      const changedAt = form.status_dates?.[stop];
      if (changedAt) statusEvents.push({ status: stop, changed_at: changedAt });
    }
  }

  return {
    created_via: String(form.created_via || '').trim()
      || ADD_TICKET_CREATED_VIA[isHistorical ? 'hist' : 'new'],
    // The stored type stays defect/enhancement; "cleanup" is the is_cleanup flag
    // plus the tag, which is what every query in the app already reads. A report
    // request IS its own stored type — it is not a cleanup tag and never becomes
    // one, which is why it is the one branch that changes this line.
    type: isReportBranch ? SUBMISSION_TYPE_REPORT : (isEnhancementBranch ? 'enhancement' : 'defect'),
    is_cleanup: isCleanup,
    cleanup_status: isCleanup ? (form.cleanup_status || null) : null,
    cleanup_tag_type: isCleanup ? (branch === 'none' ? 'cleanup_only' : branch) : null,
    // A new ticket always starts at New, whatever the historical select last held.
    status: isHistorical ? form.status : 'New',
    created_by: String(form.created_by || '').trim(),
    created_by_email: String(form.created_by_email || '').trim() || '-',
    application_name: form.application_name || null,
    summary_of_issue: String(form.summary_of_issue || '').trim(),

    screen_title: isDefectBranch ? (String(form.screen_title || '').trim() || '-') : '-',
    steps_to_reproduce: isDefectBranch ? (String(form.steps_to_reproduce || '').trim() || '-') : '-',
    // Six of a report request's fields reuse existing columns rather than adding
    // their own — "Describe what you need" is what_happened_exact_details, which
    // the import layer already labels Description, and "what's not working" is
    // `request`. A second column for either would be the same defect the source
    // field list has with Complete / Completed / Complete Date.
    what_happened_exact_details: (isDefectBranch || isReportBranch)
      ? (String(form.what_happened_exact_details || '').trim() || '-')
      : (branch === 'none' ? (internalDescription || '-') : '-'),
    request: (isEnhancementBranch || (isReportBranch && !isNewDashboard))
      ? (String(form.request || '').trim() || '-')
      : (branch === 'none' ? (internalDescription || '-') : '-'),
    policy_num: isDefectBranch ? (String(form.policy_num || '').trim() || null) : null,
    account_num: isDefectBranch ? (String(form.account_num || '').trim() || null) : null,
    transaction_num: isDefectBranch ? (String(form.transaction_num || '').trim() || null) : null,
    date_time_of_error: defectDateTime || null,

    enhancement_request_type: isEnhancementBranch ? (form.enhancement_request_type || null) : null,
    // Shared with the report branch: "When do you need it by?" is the same column
    // as an enhancement's desired completion date.
    desired_completion_date: (isEnhancementBranch || isReportBranch)
      ? (form.desired_completion_date || null)
      : null,
    priority_level: isEnhancementBranch ? (form.priority_level || null) : null,
    impact_details: isEnhancementBranch ? (String(form.impact_details || '').trim() || null) : null,

    // ── The report-request branch ─────────────────────────────────────────────
    // Each sub-branch sends only its own fields: a change request has no measures
    // and sources, and a new dashboard has nothing that is not working yet.
    ...(isReportBranch ? {
      is_new_dashboard: isNewDashboard,
      needed_data: String(form.needed_data || '').trim() || null,
      measures_and_sources: isNewDashboard
        ? (String(form.measures_and_sources || '').trim() || null)
        : null,
      primary_contact: isNewDashboard ? (String(form.primary_contact || '').trim() || null) : null,
      existing_report_link: isNewDashboard
        ? null
        : (String(form.existing_report_link || '').trim() || null),
      changes_requested: isNewDashboard ? null : (String(form.changes_requested || '').trim() || null),
      report_usage_frequency: String(form.report_usage_frequency || '').trim() || null,
      department: String(form.department || '').trim() || null,
    } : {}),

    // Historical only. A new ticket has not been anywhere yet, and recording a
    // hand-off number against one would be a claim about work nobody did.
    created_at: isHistorical ? (form.reported_at || null) : null,
    easyvista_ticket_id: isHistorical ? (String(form.easyvista_ticket_id || '').trim() || null) : null,
    easyvista_submitted_by: isHistorical
      ? (String(form.easyvista_submitted_by || '').trim() || 'Unknown')
      : 'Unknown',
    jira_number: isHistorical ? (String(form.jira_number || '').trim() || null) : null,
    release_number: isHistorical ? (String(form.release_number || '').trim() || null) : null,
    logged_defect: isHistorical && Boolean(String(form.jira_number || '').trim()),
    status_events: statusEvents,
  };
}

/**
 * Every required field the current mode/branch is actually showing, by label.
 * Returned as labels because that is what the error line says; the caller never
 * needs the keys.
 */
export function missingAddTicketFields(form, { requiresHandoffFields = false } = {}) {
  const branch = addTicketBranch(form);
  const isHistorical = form.mode === 'hist';
  const isCleanup = String(form.type || '').toLowerCase() === 'cleanup';
  const blank = (value) => !String(value ?? '').trim();
  const missing = [];

  if (blank(form.summary_of_issue)) missing.push('Summarize it in one line');
  if (blank(form.created_by)) missing.push('Reported by');
  if (blank(form.application_name)) missing.push('Application');
  if (isCleanup && blank(form.cleanup_status)) missing.push('Cleanup status');
  if (isHistorical) {
    if (blank(form.status)) missing.push('Current status');
    if (blank(form.reported_at)) missing.push('Reported date & time');
  }

  if (branch === 'none') {
    if (blank(form.description)) missing.push('Description');
  }

  if (branch === 'defect') {
    if (blank(form.screen_title)) missing.push('Screen title');
    if (blank(form.date_of_error)) missing.push('Date it happened');
    if (blank(form.what_happened_exact_details)) missing.push('Exactly what they saw');
  }

  if (branch === 'enhancement') {
    if (blank(form.request)) missing.push('Request details');
    if (blank(form.enhancement_request_type)) missing.push('Request type');
    // Only the hand-off needs this one, and only for an enhancement: it is what
    // the Service Desk refuses the send without.
    if (requiresHandoffFields && blank(form.impact_details)) missing.push('Impact details');
  }

  // Deliberately the same short list the submit form requires, and no longer:
  // the field set is a SAMPLE, and somebody blocked by a question they cannot
  // answer types anything to get past it — which is worse than a blank.
  if (branch === SUBMISSION_TYPE_REPORT) {
    if (blank(form.what_happened_exact_details)) missing.push('Describe what they need');
    if (addTicketReportBranch(form) === 'new') {
      if (blank(form.measures_and_sources)) missing.push('Measures, and where they come from');
    } else {
      if (blank(form.existing_report_link)) missing.push('Which report is it?');
      if (blank(form.changes_requested)) missing.push('What should change?');
    }
  }

  return missing;
}

/**
 * Custom hook for the admin "Add a ticket" dialog.
 *
 * Replaces the separate backdated-ticket and cleanup-task modals: one dialog with
 * a New/Historical mode and a Defect/Enhancement/Cleanup type, because those were
 * always two views of the same act.
 *
 * @param {Object} deps
 * @param {Object} deps.user - current admin user
 * @param {Array<{id:number,name:string,reportsOnly:boolean}>} deps.applications -
 *   every active application, from the viewer envelope; the first one that takes
 *   more than report requests is preselected rather than a hardcoded name
 * @param {Function} deps.loadRows - reload the main submissions table
 * @param {Function} deps.setNotice - page-level notice setter
 */
export function useAddTicketModal({ user, applications = [], loadRows, setNotice }) {
  // The dialog opens on the defect branch, so the preselection has to be an
  // application that takes a defect. A reports-only one sorts last (created with
  // sort_order = max + 1) so it would not be first today — but relying on that
  // would make the preselection depend on row order rather than on the rule.
  const defaultApplication = applications.find((application) => !application?.reportsOnly)?.name || '';
  // Names this dialog must drop when the type stops being a report request.
  const reportsOnlyNames = useMemo(
    () => new Set(
      applications.filter((application) => application?.reportsOnly).map((application) => application.name),
    ),
    [applications],
  );
  const [addTicketOpen, setAddTicketOpen] = useState(false);
  const [addTicketError, setAddTicketError] = useState('');
  const [addTicketWorking, setAddTicketWorking] = useState(false);
  const [addTicketForm, setAddTicketForm] = useState(
    () => defaultAddTicketForm(user?.username || '', defaultApplication),
  );
  // Screenshots, held outside the form because they are Files rather than field
  // values and they go up as a separate multipart request after the create.
  const [addTicketFiles, setAddTicketFiles] = useState([]);
  const [addTicketPreviewUrl, setAddTicketPreviewUrl] = useState(null);
  const previousFormRef = useRef(null);
  const previousFileCountRef = useRef(0);

  // One object URL per attached file, index-aligned with the file list because
  // that is what ScreenshotDropZone reads, and revoked whenever the list changes
  // or the dialog unmounts — building them in render leaks one per keystroke.
  const addTicketFileUrls = useMemo(
    () => addTicketFiles.map((file) => URL.createObjectURL(file)),
    [addTicketFiles],
  );
  useEffect(
    () => () => addTicketFileUrls.forEach((url) => URL.revokeObjectURL(url)),
    [addTicketFileUrls],
  );

  const branch = addTicketBranch(addTicketForm);
  const reportBranch = addTicketReportBranch(addTicketForm);

  // Ticking the hand-off makes the branch's Service-Desk-required fields
  // mandatory. Only a NEW, tagged cleanup task can offer it at all.
  const requiresHandoffFields = useMemo(
    () => Boolean(addTicketForm.submit_to_easyvista)
      && addTicketForm.mode === 'new'
      && (branch === 'defect' || branch === 'enhancement')
      && String(addTicketForm.type || '').toLowerCase() === 'cleanup',
    [addTicketForm.submit_to_easyvista, addTicketForm.mode, addTicketForm.type, branch],
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  // Clear a stale validation error as soon as the admin changes anything —
  // attaching or removing a screenshot counts, since a failed send can be about
  // the files.
  useEffect(() => {
    const formChanged = previousFormRef.current !== addTicketForm;
    const filesChanged = previousFileCountRef.current !== addTicketFiles.length;
    previousFormRef.current = addTicketForm;
    previousFileCountRef.current = addTicketFiles.length;
    if (!addTicketOpen || !addTicketError) return;
    if (formChanged || filesChanged) setAddTicketError('');
  }, [addTicketForm, addTicketFiles.length, addTicketOpen, addTicketError]);

  // The application list arrives after the first render, so preselect once it
  // does — but never overwrite a choice the admin has already made.
  useEffect(() => {
    if (!defaultApplication) return;
    setAddTicketForm((prev) => (prev.application_name
      ? prev
      : { ...prev, application_name: defaultApplication }));
  }, [defaultApplication]);

  // ── Functions ──────────────────────────────────────────────────────────────

  function resetAddTicketForm() {
    setAddTicketForm(defaultAddTicketForm(user?.username || '', defaultApplication));
    setAddTicketFiles([]);
    setAddTicketPreviewUrl(null);
  }

  /** Mode owns `created_via` and the hand-off offer, so switching it resets both. */
  function setAddTicketMode(mode) {
    setAddTicketForm((prev) => ({
      ...prev,
      mode,
      created_via: ADD_TICKET_CREATED_VIA[mode] || prev.created_via,
      submit_to_easyvista: mode === 'new' ? prev.submit_to_easyvista : false,
    }));
  }

  /**
   * Leaving Cleanup drops the tag's hand-off offer with it.
   *
   * And the historical status has to survive the switch only if the new type can
   * hold it: 'Deployed' picked as a defect's end state is not a word a report
   * request has, and leaving it in the form would submit a status the select is no
   * longer showing. Asked by passing the one status to the same registry the
   * dropdown uses, so there is no second rule to keep in step.
   *
   * The APPLICATION goes the same way for the same reason. A reports-only one is
   * offered on the report branch only, so leaving it selected while switching to a
   * defect points the picker at an option it is no longer rendering — it draws
   * blank, and the save is refused server-side by helpers/applicationScope.js.
   * Dropped back to the default rather than to nothing: blank is a required field.
   */
  function setAddTicketType(type) {
    setAddTicketForm((prev) => {
      const keepsApplication = type === SUBMISSION_TYPE_REPORT
        || !reportsOnlyNames.has(prev.application_name);
      return {
        ...prev,
        type,
        status: statusesForRequestType(type, [prev.status]).length > 0 ? prev.status : 'New',
        application_name: keepsApplication ? prev.application_name : defaultApplication,
        submit_to_easyvista: type === 'cleanup' ? prev.submit_to_easyvista : false,
      };
    });
  }

  /** A report request's sub-branch. Held as the boolean the column stores. */
  function setAddTicketReportBranch(next) {
    setAddTicketForm((prev) => ({ ...prev, is_new_dashboard: next !== 'change' }));
  }

  /** Untagging a cleanup task removes the only route to a hand-off. */
  function setAddTicketTag(tag) {
    setAddTicketForm((prev) => ({
      ...prev,
      cleanup_tag_type: tag,
      submit_to_easyvista: tag === 'cleanup_only' ? false : prev.submit_to_easyvista,
    }));
  }

  async function createAddTicket() {
    const missing = missingAddTicketFields(addTicketForm, { requiresHandoffFields });
    if (missing.length > 0) {
      setAddTicketError(`Missing required field(s): ${missing.join(', ')}`);
      return;
    }

    const isHandoffRequested = requiresHandoffFields;
    const noun = String(addTicketForm.type || '').toLowerCase() === 'cleanup'
      ? 'Cleanup task'
      : (branch === SUBMISSION_TYPE_REPORT ? 'Report request' : 'Ticket');

    try {
      setAddTicketWorking(true);
      setAddTicketError('');

      const created = await api.createAdminSubmission(buildAddTicketPayload(addTicketForm));

      // The create endpoint does not carry the impact figures, so they follow as
      // an update — the one path that runs them through the money coercion every
      // other submission response already uses.
      const hasImpactValues = ['impact_notes', 'policy_premium_impact', 'direct_dollar_impact', 'policies_affected_count']
        .some((key) => String(addTicketForm[key] || '').trim().length > 0);

      if (created?.id && hasImpactValues) {
        const toNumberOrNull = (value) => (String(value || '').trim() === '' ? null : Number(value));
        await api.updateAdminSubmission(created.id, {
          impact_notes: String(addTicketForm.impact_notes || '').trim() || null,
          policy_premium_impact: toNumberOrNull(addTicketForm.policy_premium_impact),
          direct_dollar_impact: toNumberOrNull(addTicketForm.direct_dollar_impact),
          policies_affected_count: toNumberOrNull(addTicketForm.policies_affected_count),
        });
      }

      // Before the hand-off, not after: the send reads the ticket's own
      // attachments to decide which files travel with it, so uploading second
      // would hand off a ticket with nothing attached.
      let attachmentError = '';
      if (created?.id && addTicketFiles.length > 0) {
        try {
          const formData = new FormData();
          addTicketFiles.forEach((file) => formData.append('attachments', file));
          await api.uploadAdminAttachment(created.id, formData);
        } catch (uploadError) {
          // The ticket exists and its fields are saved. Losing the screenshots
          // silently would be the worse failure, so it is reported and the rest
          // of the flow continues.
          attachmentError = uploadError.message;
        }
      }

      let handoffTicketId = '';
      let handoffError = '';
      if (created?.id && isHandoffRequested) {
        try {
          const result = await api.submitToEasyVista(created.id);
          handoffTicketId = result?.ticketId || '';
        } catch (submitError) {
          handoffError = submitError.message;
        }
      }

      await loadRows();
      setAddTicketOpen(false);
      resetAddTicketForm();

      const reference = `#${created?.id || ''}`;
      const shots = addTicketFiles.length;
      // What actually happened, in one line, including the parts that did not.
      const attached = attachmentError
        ? ` The screenshot${shots === 1 ? '' : 's'} did not upload: ${attachmentError}`
        : (shots > 0 ? ` ${shots} screenshot${shots === 1 ? '' : 's'} attached.` : '');

      if (handoffTicketId) {
        setNotice(`${noun} ${reference} created and sent to ${TRACKER_LABEL_THE} (${handoffTicketId}).${attached}`);
      } else if (handoffError) {
        setNotice(`${noun} ${reference} created, but the hand-off failed: ${handoffError}${attached}`);
      } else {
        setNotice(`${noun} ${reference} created successfully.${attached}`);
      }
    } catch (createError) {
      setAddTicketError(createError.message);
    } finally {
      setAddTicketWorking(false);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function openAddTicketModal() {
    setAddTicketError('');
    resetAddTicketForm();
    setAddTicketOpen(true);
  }

  function closeAddTicketModal() {
    if (addTicketWorking) return;
    setAddTicketError('');
    setAddTicketOpen(false);
    resetAddTicketForm();
  }

  return {
    addTicketOpen,
    addTicketError,
    addTicketWorking,
    addTicketForm,
    setAddTicketForm,
    addTicketFiles,
    setAddTicketFiles,
    addTicketFileUrls,
    addTicketPreviewUrl,
    setAddTicketPreviewUrl,
    addTicketBranch: branch,
    addTicketReportBranch: reportBranch,
    requiresHandoffFields,
    setAddTicketMode,
    setAddTicketType,
    setAddTicketTag,
    setAddTicketReportBranch,
    createAddTicket,
    openAddTicketModal,
    closeAddTicketModal,
  };
}
