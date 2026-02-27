import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  MultiSelectDropdown,
  Notice,
  Select,
  Textarea,
} from '../components/bite-size/BitsizeUI';

const retiredStatus = 'Retired';
const statuses = ['New', 'Approved', 'Rejected', 'Duplicate', 'Submitted', 'Deployed'];
const cleanupOnlyStatus = 'Cleanup Only';
const cleanupMarkedStatus = 'Cleanup Marked';
const statusFilterStatuses = [...statuses, retiredStatus];
const statusFilterOptions = [...statusFilterStatuses, cleanupOnlyStatus, cleanupMarkedStatus];
const statusOptions = [...statuses, cleanupOnlyStatus];
const cleanupStatuses = ['Not Started', 'In Progress', 'Completed'];
const cleanupInlineStatuses = ['No Cleanup', ...cleanupStatuses];
const statusToCleanup = {
  New: 'Not Started',
  Approved: 'In Progress',
  Submitted: 'In Progress',
  Deployed: 'Completed',
  Retired: 'Completed',
};
const enhancementRequestTypes = [
  'Build-PPM Funded Project',
  'Build-Small Enhancement',
  'Build-Small Project (Not PPM Funded)',
  'Run-Compliance/Regulatory/Rate Revision',
  'Run-Other Operational Work',
];
const enhancementPriorityLevels = ['1 - Urgent', '2 - High', '3 - Medium', '4 - Low'];
const applications = ['Billing Center', 'Policy Center'];
const adminFiltersStorageKey = 'bc.admin.filters';
const adminRetiredFilterStorageKey = 'bc.admin.retiredFilter';

const coreStatusSet = new Set([...statuses]);
const cleanupStatusSet = new Set(['No Cleanup', ...cleanupStatuses]);

function buildDefaultFilters() {
  return {
    statuses: [...statusFilterOptions],
    retiredFilter: 'non_retired',
    type: '',
    search: '',
    requester: '',
    submittedBy: '',
    year: '',
    inJira: '',
    jiraNumber: '',
    releaseNumber: '',
    sort: 'updated_desc',
  };
}

function ensureRetiredStatusForAllMode(statusesValue, retiredFilterValue) {
  const normalized = Array.isArray(statusesValue)
    ? statusesValue.filter((value) => statusFilterOptions.includes(value))
    : [];
  if (normalized.length === 0) {
    return [...statusFilterOptions];
  }
  if (retiredFilterValue === 'all' && !normalized.includes(retiredStatus)) {
    return [...normalized, retiredStatus];
  }
  return normalized;
}

function readSavedAdminFilters() {
  const defaults = buildDefaultFilters();
  if (typeof window === 'undefined') return defaults;

  const savedRetiredFilter = window.localStorage.getItem(adminRetiredFilterStorageKey);
  const normalizedRetiredFilter = ['non_retired', 'retired_only', 'all'].includes(savedRetiredFilter)
    ? savedRetiredFilter
    : defaults.retiredFilter;

  const raw = window.localStorage.getItem(adminFiltersStorageKey);
  if (!raw) {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }

  try {
    const parsed = JSON.parse(raw);
    const retiredFilter = ['non_retired', 'retired_only', 'all'].includes(parsed?.retiredFilter)
      ? parsed.retiredFilter
      : normalizedRetiredFilter;
    const statusesFromStorage = ensureRetiredStatusForAllMode(parsed?.statuses, retiredFilter);

    return {
      ...defaults,
      statuses: statusesFromStorage.length > 0 ? statusesFromStorage : defaults.statuses,
      retiredFilter,
      type: typeof parsed?.type === 'string' ? parsed.type : defaults.type,
      search: typeof parsed?.search === 'string' ? parsed.search : defaults.search,
      requester: typeof parsed?.requester === 'string' ? parsed.requester : defaults.requester,
      submittedBy: typeof parsed?.submittedBy === 'string' ? parsed.submittedBy : defaults.submittedBy,
      year: typeof parsed?.year === 'string' ? parsed.year : defaults.year,
      inJira: typeof parsed?.inJira === 'string' ? parsed.inJira : defaults.inJira,
      jiraNumber: typeof parsed?.jiraNumber === 'string' ? parsed.jiraNumber : defaults.jiraNumber,
      releaseNumber: typeof parsed?.releaseNumber === 'string' ? parsed.releaseNumber : defaults.releaseNumber,
      sort: typeof parsed?.sort === 'string' && parsed.sort.trim() ? parsed.sort : defaults.sort,
    };
  } catch {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }
}

function defaultFilters() {
  return readSavedAdminFilters();
}

function defaultBackdatedForm(defaultRequester = '') {
  return {
    type: 'defect',
    status: 'New',
    is_cleanup: false,
    cleanup_status: 'Not Started',
    created_by: String(defaultRequester || '').trim() || 'Admin',
    created_by_email: '',
    application_name: 'Billing Center',
    summary_of_issue: '',
    screen_title: '',
    request: '',
    impact_notes: '',
    policy_premium_impact: '',
    direct_dollar_impact: '',
    policies_affected_count: '',
    reported_at: '',
    desired_completion_date: '',
    jira_number: '',
    release_number: '',
    easyvista_ticket_id: '',
    easyvista_submitted_by: '',
    status_dates: {
      Approved: '',
      Rejected: '',
      Duplicate: '',
      Submitted: '',
      Deployed: '',
      Retired: '',
    },
  };
}

function defaultCleanupForm(currentUser) {
  return {
    type: 'defect',
    is_cleanup: true,
    cleanup_status: 'Not Started',
    cleanup_tag_type: 'cleanup_only',
    submit_to_easyvista: false,
    created_by: String(currentUser || '').trim() || 'Admin',
    created_by_email: '',
    application_name: 'Billing Center',
    summary_of_issue: '',
    description: '',
    what_happened_exact_details: '',
    screen_title: '',
    steps_to_reproduce: '',
    request: '',
    date_of_error: '',
    time_of_error: '',
    date_time_of_error: '',
    desired_completion_date: '',
    impact_details: '',
    enhancement_request_type: '',
    priority_level: '3 - Medium',
    impact_notes: '',
    policy_premium_impact: '',
    direct_dollar_impact: '',
    policies_affected_count: '',
    policy_num: '',
    account_num: '',
    transaction_num: '',
    jira_number: '',
    release_number: '',
    easyvista_ticket_id: '',
    easyvista_submitted_by: '',
  };
}

const SORT_COLS = {
  reportedDate:     { asc: 'created_asc',                 desc: 'created_desc' },
  statusUpdate:     { asc: 'updated_asc',                 desc: 'updated_desc' },
  type:             { asc: 'type_asc',                    desc: 'type_desc' },
  requester:        { asc: 'requester_asc',               desc: 'requester_desc' },
  summary:          { asc: 'summary_asc',                 desc: 'summary_desc' },
  status:           { asc: 'status_asc',                  desc: 'status_desc' },
  isPublic:         { asc: 'public_asc',                  desc: 'public_desc' },
  inJira:           { asc: 'logged_defect_asc',           desc: 'logged_defect_desc' },
  jiraCard:         { asc: 'jira_number_asc',             desc: 'jira_number_desc' },
  releaseNum:       { asc: 'release_number_asc',          desc: 'release_number_desc' },
  policyPremium:    { asc: 'policy_premium_impact_asc',   desc: 'policy_premium_impact_desc' },
  directImpact:     { asc: 'direct_dollar_impact_asc',    desc: 'direct_dollar_impact_desc' },
  policiesImpacted: { asc: 'policies_affected_count_asc', desc: 'policies_affected_count_desc' },
  easyvista:        { asc: 'easyvista_asc',               desc: 'easyvista_desc' },
  submittedBy:      { asc: 'submitted_by_asc',            desc: 'submitted_by_desc' },
};

function toNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function editableFromDetail(detail) {
  if (!detail) return null;
  const cleanupTagType = detail.cleanup_tag_type || (detail.is_cleanup ? 'cleanup_only' : '');
  const normalizedEnhancementRequestType = enhancementRequestTypes.includes(detail.enhancement_request_type)
    ? detail.enhancement_request_type
    : '';
  return {
    type: detail.type || 'defect',
    is_cleanup: Boolean(detail.is_cleanup),
    cleanup_status: detail.cleanup_status || statusToCleanup[detail.status] || 'Not Started',
    cleanup_tag_type: cleanupTagType,
    application_name: detail.application_name || 'Billing Center',
    policy_num: detail.policy_num || '',
    account_num: detail.account_num || '',
    transaction_num: detail.transaction_num || '',
    screen_title: detail.screen_title || '',
    summary_of_issue: detail.summary_of_issue || '',
    steps_to_reproduce: detail.steps_to_reproduce || '',
    what_happened_exact_details: detail.what_happened_exact_details || '',
    request: detail.request || '',
    date_time_of_error: detail.date_time_of_error ? detail.date_time_of_error.slice(0, 16) : '',
    desired_completion_date: detail.desired_completion_date
      ? detail.desired_completion_date.slice(0, 10)
      : '',
    status: detail.status || 'New',
    reviewer: detail.reviewer || '',
    decision_notes: detail.decision_notes || '',
    fingerprint: detail.fingerprint || '',
    impact_details: detail.impact_details || '',
    impact_notes: detail.impact_notes || '',
    policy_premium_impact:
      detail.policy_premium_impact === null || detail.policy_premium_impact === undefined
        ? ''
        : String(detail.policy_premium_impact),
    direct_dollar_impact:
      detail.direct_dollar_impact === null || detail.direct_dollar_impact === undefined
        ? ''
        : String(detail.direct_dollar_impact),
    policies_affected_count:
      detail.policies_affected_count === null || detail.policies_affected_count === undefined
        ? ''
        : String(detail.policies_affected_count),
    enhancement_request_type: normalizedEnhancementRequestType,
    priority_level: detail.priority_level || '3 - Medium',
    jira_number: detail.jira_number || '',
    release_number: detail.release_number || '',
    release_notes: detail.release_notes || '',
    logged_defect: Boolean(detail.logged_defect),
    duplicate_of: detail.duplicate_reference || detail.duplicate_of || '',
    is_retired: Boolean(detail.is_retired),
    is_public: Boolean(detail.is_public),
  };
}

function normalizeAdminRow(row) {
  if (!row) return row;
  const isCleanup = Boolean(row.is_cleanup);
  const baseStatus = row.status || row.defect_enhancement_status || 'New';
  const isRetired = Boolean(row.is_retired) || String(baseStatus) === retiredStatus;
  const cleanupStatus = isCleanup
    ? (row.cleanup_status || statusToCleanup[baseStatus] || 'Not Started')
    : null;

  return {
    ...row,
    status: baseStatus,
    defect_enhancement_status: baseStatus,
    is_retired: isRetired,
    is_cleanup: isCleanup,
    cleanup_status: cleanupStatus,
    cleanup_status_display: cleanupStatus || 'No Cleanup',
    is_resubmission: Boolean(row.is_resubmission),
    resubmission_of_submission_id: row.resubmission_of_submission_id || null,
    resubmission_of_easyvista_ticket_id: row.resubmission_of_easyvista_ticket_id || null,
    has_resubmission: Boolean(row.has_resubmission),
    latest_resubmission_submission_id: row.latest_resubmission_submission_id || null,
    latest_resubmission_easyvista_ticket_id: row.latest_resubmission_easyvista_ticket_id || null,
  };
}

function inlineDisplayType(row) {
  if (!row) return 'defect';
  if (row.is_cleanup) {
    if (row.cleanup_tag_type === 'cleanup_only') return 'Cleanup Only';
    if (row.cleanup_tag_type === 'enhancement') return 'enhancement';
    if (row.cleanup_tag_type === 'defect') return 'defect';
    return 'Cleanup Only';
  }
  return row.type || 'defect';
}

function buildAdminUpdatePayload(editValue) {
  if (!editValue) return null;
  return {
    ...editValue,
    is_retired: Boolean(editValue.is_retired),
    duplicate_of: editValue.duplicate_of,
    date_time_of_error: editValue.date_time_of_error || null,
    desired_completion_date: editValue.desired_completion_date || null,
  };
}

function hasPendingModalChanges(detailValue, editValue) {
  if (!detailValue || !editValue) return false;
  const currentEdit = editableFromDetail(normalizeAdminRow(detailValue));
  const currentPayload = buildAdminUpdatePayload(currentEdit);
  const draftPayload = buildAdminUpdatePayload(editValue);
  return JSON.stringify(currentPayload) !== JSON.stringify(draftPayload);
}

export function AdminDashboardPage({ user, onLogout }) {
  const [filters, setFilters] = useState(defaultFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState(null);
  const [modalTopNotice, setModalTopNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [easyVistaConfirmation, setEasyVistaConfirmation] = useState('');
  const [backdatedOpen, setBackdatedOpen] = useState(false);
  const [backdatedWorking, setBackdatedWorking] = useState(false);
  const [backdatedForm, setBackdatedForm] = useState(defaultBackdatedForm(user?.username || ''));
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupWorking, setCleanupWorking] = useState(false);
  const [cleanupForm, setCleanupForm] = useState(defaultCleanupForm(user?.username || ''));
  const [cleanupFiles, setCleanupFiles] = useState([]);
  const [cleanupPreviewIndex, setCleanupPreviewIndex] = useState(null);
  const cleanupFileInputRef = useRef(null);
  const [showHeaderSaveTooltip, setShowHeaderSaveTooltip] = useState(false);
  const [showFooterSaveTooltip, setShowFooterSaveTooltip] = useState(false);
  const [showEasyVistaRequirements, setShowEasyVistaRequirements] = useState(false);

  const loadRows = useCallback(async (filtersParam) => {
    const f = filtersParam ?? filtersRef.current;
    try {
      setLoading(true);
      setError('');
      const data = await api.listAdminSubmissions({ ...f });

      const normalizedRows = (data || []).map(normalizeAdminRow);
      const retiredMode = f?.retiredFilter || 'non_retired';
      const retiredFilteredRows = retiredMode === 'retired_only'
        ? normalizedRows.filter((row) => row.is_retired)
        : retiredMode === 'non_retired'
          ? normalizedRows.filter((row) => !row.is_retired)
          : normalizedRows;
      setRows(retiredFilteredRows);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const openDetail = useCallback(async (id, preserveEdit = false) => {
    try {
      setError('');
      if (!preserveEdit) {
        setEasyVistaConfirmation('');
        setShowEasyVistaRequirements(false);
      }
      const data = await api.getAdminSubmissionDetail(id);
      setDetail(data);
      if (!preserveEdit) {
        setEdit(editableFromDetail(data));
      }
      setOpenId(id);
      return data;
    } catch (detailError) {
      setError(detailError.message);
      return null;
    }
  }, []);

  useEffect(() => {
    loadRows(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(adminFiltersStorageKey, JSON.stringify(filters));
    window.localStorage.setItem(adminRetiredFilterStorageKey, filters.retiredFilter || 'non_retired');
  }, [filters]);

  useEffect(() => {
    const socket = getSocket();
    const onNotification = (payload) => {
      const message = payload?.event ? `Live update: ${payload.event}` : 'Live update received';
      setNotice(message);
      loadRows();
      if (openId) {
        openDetail(openId, true);
      }
    };

    socket.on('admin:notification', onNotification);
    return () => {
      socket.off('admin:notification', onNotification);
    };
  }, [loadRows, openId, openDetail]);

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

  const easyVistaMissingRequirements = useMemo(() => {
    if (!detail || !edit) {
      return [];
    }

    const missing = [];
    if (effectiveType === 'enhancement') {
      if (!String(edit.impact_details || '').trim()) {
        missing.push('Impact Details');
      }
      if (!String(edit.enhancement_request_type || '').trim()) {
        missing.push('Request Type');
      }
    }

    if (effectiveType === 'defect') {
      if (!String(edit.summary_of_issue || '').trim()) {
        missing.push('Summary of Issue');
      }
      if (!String(edit.screen_title || '').trim()) {
        missing.push('Screen Title');
      }
      if (!String(edit.what_happened_exact_details || '').trim()) {
        missing.push('Description');
      }
    }

    return missing;
  }, [detail, edit, effectiveType]);

  const hasPendingChanges = useMemo(
    () => hasPendingModalChanges(detail, edit),
    [detail, edit],
  );
  const saveDisabledReason = working
    ? 'Saving in progress'
    : hasPendingChanges
      ? 'Save changes'
      : 'No unsaved changes';

  async function updateStatusQuick(submissionId, status, rowContext = null) {
    try {
      setError('');
      const payload = status === cleanupOnlyStatus
        ? {
          status: 'New',
          is_cleanup: true,
          cleanup_status: rowContext?.cleanup_status || statusToCleanup[rowContext?.status] || 'Not Started',
          cleanup_tag_type: 'cleanup_only',
          type: 'defect',
        }
        : {
          status,
          ...(rowContext?.cleanup_tag_type === 'cleanup_only'
            ? {
              cleanup_tag_type:
                rowContext?.type === 'enhancement' ? 'enhancement' : 'defect',
            }
            : {}),
        };
      const saved = await api.updateAdminSubmission(submissionId, payload);
      if (saved?.id) {
        setRows((prev) =>
          prev.map((row) => (
            Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row
          )),
        );
        if (Number(openId) === Number(saved.id)) {
          await openDetail(saved.id, true);
        }
      }
      if (status === cleanupOnlyStatus) {
        setNotice('Marked as Cleanup Only.');
      } else {
        setNotice('Status updated.');
      }
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function updateCleanupStatusQuick(submissionId, cleanupStatus, rowContext = null) {
    const isNoCleanup = cleanupStatus === 'No Cleanup';
    const preservedCleanupTagType =
      rowContext?.cleanup_tag_type
      || (rowContext?.type === 'enhancement' ? 'enhancement' : 'defect');
    setRows((prev) =>
      prev.map((row) => {
        if (Number(row.id) !== Number(submissionId)) {
          return row;
        }
        return {
          ...row,
          is_cleanup: !isNoCleanup,
          cleanup_status: isNoCleanup ? null : cleanupStatus,
          cleanup_tag_type: isNoCleanup ? null : (row.cleanup_tag_type || preservedCleanupTagType),
        };
      }),
    );

    if (Number(openId) === Number(submissionId)) {
      setEdit((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          is_cleanup: !isNoCleanup,
          cleanup_status: isNoCleanup ? '' : cleanupStatus,
          cleanup_tag_type: isNoCleanup
            ? ''
            : (prev.cleanup_tag_type || (prev.type === 'enhancement' ? 'enhancement' : 'defect')),
        };
      });
    }

    try {
      setError('');
      const payload = {
        is_cleanup: !isNoCleanup,
        cleanup_status: isNoCleanup ? null : cleanupStatus,
      };
      if (isNoCleanup) {
        payload.cleanup_tag_type = null;
      } else {
        payload.cleanup_tag_type = preservedCleanupTagType;
      }

      const saved = await api.updateAdminSubmission(submissionId, payload);

      if (saved?.id) {
        setRows((prev) =>
          prev.map((row) => (
            Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row
          )),
        );
        if (Number(openId) === Number(saved.id)) {
          await openDetail(saved.id, true);
        }
      }

      setNotice(isNoCleanup ? 'Cleanup status cleared.' : 'Cleanup status updated.');
    } catch (updateError) {
      setError(updateError.message);
      await loadRows();
      if (Number(openId) === Number(submissionId)) {
        await openDetail(submissionId);
      }
    }
  }

  async function updatePublicQuick(submissionId, isPublic) {
    try {
      setError('');
      await api.updateAdminSubmission(submissionId, { is_public: isPublic });
      await loadRows();
      if (openId === submissionId) {
        await openDetail(submissionId, true);
        setEdit((prev) => (prev ? { ...prev, is_public: isPublic } : prev));
      }
      setNotice(`Public visibility updated to ${isPublic ? 'Yes' : 'No'}.`);
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function updateLoggedDefectQuick(submissionId, loggedDefect) {
    try {
      setError('');
      await api.updateAdminSubmission(submissionId, { logged_defect: loggedDefect });
      await loadRows();
      if (openId === submissionId) {
        await openDetail(submissionId, true);
        setEdit((prev) => (prev ? { ...prev, logged_defect: loggedDefect } : prev));
      }
      setNotice(`In JIRA updated to ${loggedDefect ? 'Yes' : 'No'}.`);
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function updateJiraQuick(submissionId, jiraNumber) {
    try {
      setError('');
      await api.updateAdminSubmission(submissionId, { jira_number: jiraNumber || null });
      await loadRows();
      if (openId === submissionId) {
        await openDetail(submissionId, true);
        setEdit((prev) => (prev ? { ...prev, jira_number: jiraNumber || '' } : prev));
      }
      setNotice('JIRA card number updated.');
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function updateReleaseNumberQuick(submissionId, releaseNumber) {
    try {
      setError('');
      await api.updateAdminSubmission(submissionId, { release_number: releaseNumber || null });
      await loadRows();
      if (openId === submissionId) {
        await openDetail(submissionId, true);
        setEdit((prev) => (prev ? { ...prev, release_number: releaseNumber || '' } : prev));
      }
      setNotice('Release number updated.');
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function saveEdits(source = 'footer') {
    if (!openId || !edit) return;
    if (!hasPendingModalChanges(detail, edit)) {
      setNotice('No changes to save.');
      setModalTopNotice(source === 'header' ? 'No changes to save.' : '');
      return;
    }
    try {
      setWorking(true);
      const saved = await api.updateAdminSubmission(openId, buildAdminUpdatePayload(edit));

      if (saved?.id) {
        setRows((prev) =>
          prev.map((row) => (
            Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row
          )),
        );
        await openDetail(saved.id);
      }
      setNotice('Saved successfully.');
      setModalTopNotice(source === 'header' ? 'Saved successfully.' : '');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setWorking(false);
    }
  }

  async function retireCurrentItem() {
    if (!openId || !edit || edit.is_retired) return;
    try {
      setWorking(true);
      setError('');
      const saved = await api.updateAdminSubmission(openId, { is_retired: true });
      if (saved?.id) {
        setRows((prev) =>
          prev.map((row) => (
            Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row
          )),
        );
        await openDetail(saved.id);
      }
      setNotice('Item retired.');
      setModalTopNotice('Item retired.');
    } catch (retireError) {
      setError(retireError.message);
    } finally {
      setWorking(false);
    }
  }

  async function unretireCurrentItem() {
    if (!openId || !edit || !edit.is_retired) return;
    try {
      setWorking(true);
      setError('');
      const saved = await api.updateAdminSubmission(openId, { is_retired: false, unretire: true });
      if (saved?.id) {
        setRows((prev) =>
          prev.map((row) => (
            Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row
          )),
        );
        await openDetail(saved.id);
      }
      setNotice('Item unretired.');
      setModalTopNotice('Item unretired.');
    } catch (unretireError) {
      setError(unretireError.message);
    } finally {
      setWorking(false);
    }
  }

  async function uploadAttachment(event) {
    if (!openId) return;
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach((file) => formData.append('attachments', file));

    try {
      setWorking(true);
      await api.uploadAdminAttachment(openId, formData);
      await openDetail(openId, true);
      await loadRows();
      setNotice('Attachment uploaded.');
      event.target.value = '';
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setWorking(false);
    }
  }

  async function deleteAttachment(attachmentId) {
    try {
      setWorking(true);
      await api.deleteAdminAttachment(attachmentId);
      await openDetail(openId, true);
      await loadRows();
      setNotice('Attachment removed.');
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setWorking(false);
    }
  }

  async function submitEasyVista() {
    if (!openId || !edit) return;
    setShowEasyVistaRequirements(true);
    setEasyVistaConfirmation('');
    setError('');
    if (easyVistaMissingRequirements.length > 0) {
      return;
    }
    try {
      setWorking(true);
      const isResubmit = Boolean(detail?.easyvista_ticket_id);
      const draftPayload = hasPendingModalChanges(detail, edit)
        ? buildAdminUpdatePayload(edit)
        : null;

      if (!isResubmit && draftPayload) {
        await api.updateAdminSubmission(openId, buildAdminUpdatePayload(edit));
      }

      const result = await api.submitToEasyVista(
        openId,
        isResubmit ? { draft: draftPayload } : undefined,
      );

      let refreshed = null;
      if (result?.submission) {
        refreshed = await openDetail(result.submission.id || openId, true);
      } else {
        refreshed = await openDetail(openId, true);
      }

      if (refreshed) {
        setEdit(editableFromDetail(refreshed));
      }

      await loadRows();
      setShowEasyVistaRequirements(false);
      if (result?.resubmission) {
        setEasyVistaConfirmation(
          `Successfully re-submitted to EasyVista. New card #${result?.submission?.id || ''}, Ticket: ${result?.ticketId || 'created'}`,
        );
        setNotice(
          `Re-submitted to EasyVista. New card #${result?.submission?.id || ''}, Ticket: ${result?.ticketId || 'created'}`,
        );
      } else {
        setEasyVistaConfirmation(`Successfully submitted to EasyVista. Ticket: ${result?.ticketId || 'created'}`);
        setNotice(`Submitted to EasyVista. Ticket: ${result?.ticketId || 'created'}`);
      }
    } catch (submitError) {
      setEasyVistaConfirmation('');
      setError(submitError.message);
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    await api.logout();
    onLogout();
  }

  function resetBackdatedForm() {
    setBackdatedForm(defaultBackdatedForm(user?.username || ''));
  }

  function resetCleanupForm() {
    setCleanupForm(defaultCleanupForm(user?.username || ''));
    setCleanupFiles([]);
  }

  async function createBackdatedTicket() {
    const createdBy = String(backdatedForm.created_by || '').trim()
      || String(user?.username || '').trim()
      || 'Admin';

    if (!String(backdatedForm.summary_of_issue || '').trim()) {
      setError('Backdated ticket requires Summary of Issue.');
      return;
    }

    try {
      setBackdatedWorking(true);
      setError('');

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
      setError(createError.message);
    } finally {
      setBackdatedWorking(false);
    }
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
      if (cleanupFiles.length < 1) {
        missing.push('At least one screenshot');
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
      setError(`Missing required field(s): ${missing.join(', ')}`);
      return;
    }

    try {
      setCleanupWorking(true);
      setError('');

      const defectDateTime = isDefectTagged && cleanupForm.date_of_error
        ? `${cleanupForm.date_of_error}T${cleanupForm.time_of_error || '00:00'}`
        : '';

      const payload = {
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
      setError(createError.message);
    } finally {
      setCleanupWorking(false);
    }
  }

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const impactTotals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.policyPremiumImpact += toNumeric(row.policy_premium_impact);
        acc.directDollarImpact += toNumeric(row.direct_dollar_impact);
        acc.policiesAffectedCount += toNumeric(row.policies_affected_count);
        return acc;
      },
      {
        policyPremiumImpact: 0,
        directDollarImpact: 0,
        policiesAffectedCount: 0,
      },
    );
  }, [rows]);

  const cleanupRequiresEasyVistaFields = useMemo(
    () => Boolean(cleanupForm.submit_to_easyvista)
      && (cleanupForm.cleanup_tag_type === 'defect' || cleanupForm.cleanup_tag_type === 'enhancement'),
    [cleanupForm.submit_to_easyvista, cleanupForm.cleanup_tag_type],
  );

  const cleanupFilePreviews = useMemo(
    () => cleanupFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [cleanupFiles],
  );

  useEffect(() => {
    return () => {
      cleanupFilePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [cleanupFilePreviews]);

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value || 0);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-US').format(toNumeric(value));
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function formatDateOnly(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString();
  }

  function formatTimelineStatus(statusValue) {
    const value = String(statusValue || '').trim();
    if (!value) {
      return 'Status update';
    }
    if (value === retiredStatus) {
      return 'Updated Status: Retired';
    }
    if (value === 'Unretired') {
      return 'Updated Status: Unretired';
    }
    if (value.startsWith('Defect/Enhancement Status:') || value.startsWith('Cleanup Status:')) {
      return value;
    }
    if (coreStatusSet.has(value)) {
      return `Defect/Enhancement Status: ${value}`;
    }
    if (cleanupStatusSet.has(value)) {
      return `Cleanup Status: ${value}`;
    }
    if (value === cleanupOnlyStatus) {
      return `Defect/Enhancement Status: ${value}`;
    }
    return value;
  }

  function handleColSort(colKey) {
    const { asc, desc } = SORT_COLS[colKey];
    const numericFirst = ['policyPremium', 'directImpact', 'policiesImpacted'];
    let nextSort;
    if (filters.sort === asc) nextSort = desc;
    else if (filters.sort === desc) nextSort = asc;
    else nextSort = numericFirst.includes(colKey) ? desc : asc;
    const nextFilters = { ...filters, sort: nextSort };
    setFilters(nextFilters);
    loadRows(nextFilters);
  }

  function sortTh(colKey, label, style) {
    const { asc, desc } = SORT_COLS[colKey];
    const isAsc = filters.sort === asc;
    const isActive = isAsc || filters.sort === desc;
    return (
      <th
        style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'normal', verticalAlign: 'bottom' }}
        onClick={() => handleColSort(colKey)}
      >
        {(() => {
          const spaceIdx = label.indexOf(' ');
          const firstWord = spaceIdx === -1 ? label : label.slice(0, spaceIdx);
          const rest = spaceIdx === -1 ? '' : label.slice(spaceIdx);
          return (
            <>
              <span style={{ whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 10, opacity: isActive ? 1 : 0.3, marginRight: 2 }}>
                  {isAsc ? '▲' : '▼'}
                </span>{firstWord}
              </span>{rest}
            </>
          );
        })()}
      </th>
    );
  }

  return (
    <div className="stack">
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h2>Admin Queue</h2>
          <p>Signed in as <strong>{user.username}</strong></p>
        </div>
        <div className="bs-actions">
          <Button
            kind="secondary"
            onClick={() => {
              setError('');
              resetBackdatedForm();
              setBackdatedOpen(true);
            }}
          >
            Add Backdated Ticket
          </Button>
          <Button
            kind="secondary"
            onClick={() => {
              setError('');
              resetCleanupForm();
              setCleanupOpen(true);
            }}
          >
            Add Cleanup Task
          </Button>
          <Button kind="ghost" onClick={logout}>Sign Out</Button>
        </div>
      </div>

      {/* ── Stat tiles ── */}
      {rows.length > 0 && (
        <div className="stat-row">
          <div className="stat-tile"><div className="stat-num">{rows.length}</div><div className="stat-lbl">Total</div></div>
          {['New', 'Approved', 'Submitted', 'Deployed'].map((s) => (
            <div className="stat-tile" key={s}>
              <div className="stat-num">{statusCounts[s] || 0}</div>
              <div className="stat-lbl">{s}</div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="stat-row">
          <div className="stat-tile">
            <div className="stat-num">{rows.length}</div>
            <div className="stat-lbl">Filtered Items</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{formatCurrency(impactTotals.policyPremiumImpact)}</div>
            <div className="stat-lbl">Policy Premium Impact</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{formatCurrency(impactTotals.directDollarImpact)}</div>
            <div className="stat-lbl">Direct Dollar Impact</div>
          </div>
          <div className="stat-tile">
            <div className="stat-num">{Math.trunc(impactTotals.policiesAffectedCount)}</div>
            <div className="stat-lbl">Policies Impacted</div>
          </div>
        </div>
      )}

      {error && <Notice text={error} />}
      {notice && <Notice text={notice} kind="success" />}

      <Card>
        {/* ── Filters ── */}
        <div className="filters-bar">
          <MultiSelectDropdown
            label="Status"
            options={statusFilterOptions}
            selectedValues={filters.statuses}
            onChange={(nextStatuses) => setFilters((prev) => ({ ...prev, statuses: nextStatuses }))}
            placeholder="Select statuses"
          />
          <Select
            label="Retired"
            value={filters.retiredFilter}
            onChange={(e) => {
              const nextRetiredFilter = e.target.value;
              setFilters((prev) => ({
                ...prev,
                retiredFilter: nextRetiredFilter,
                statuses: ensureRetiredStatusForAllMode(prev.statuses, nextRetiredFilter),
              }));
            }}
          >
            <option value="non_retired">Non-Retired Only</option>
            <option value="retired_only">Retired Only</option>
            <option value="all">Show All</option>
          </Select>
          <Select
            label="Type"
            value={filters.type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="">All types</option>
            <option value="defect">Defect</option>
            <option value="enhancement">Enhancement</option>
            <option value="cleanup">Clean Up</option>
          </Select>
          <Input
            label="Search"
            placeholder="ID, policy, account, or keyword…"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
          <Input
            label="Requester"
            placeholder="Filter by Requester Name"
            value={filters.requester}
            onChange={(e) => setFilters((prev) => ({ ...prev, requester: e.target.value }))}
          />
          <Input
            label="Submitted by (EasyVista)"
            placeholder="Filter by admin username"
            value={filters.submittedBy}
            onChange={(e) => setFilters((prev) => ({ ...prev, submittedBy: e.target.value }))}
          />
          <Input
            label="Year"
            placeholder="YYYY"
            value={filters.year}
            onChange={(e) => setFilters((prev) => ({ ...prev, year: e.target.value }))}
          />
          <Select
            label="In JIRA"
            value={filters.inJira}
            onChange={(e) => setFilters((prev) => ({ ...prev, inJira: e.target.value }))}
          >
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
          <Input
            label="JIRA #"
            placeholder="e.g. JIRA-123"
            value={filters.jiraNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, jiraNumber: e.target.value }))}
          />
          <Input
            label="Release #"
            placeholder="e.g. v1.0.0"
            value={filters.releaseNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, releaseNumber: e.target.value }))}
          />
          <Button
            kind="ghost"
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.localStorage.removeItem(adminFiltersStorageKey);
                window.localStorage.removeItem(adminRetiredFilterStorageKey);
              }
              setFilters(buildDefaultFilters());
            }}
          >
            Reset Saved Filters
          </Button>
        </div>

        {loading && <p className="muted">Loading…</p>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {sortTh('reportedDate',     'Reported Date',      { width: 110, minWidth: 110 })}
                {sortTh('statusUpdate',     'Status Update',      { width: 110, minWidth: 110 })}
                {sortTh('type',             'Type',               { width: 110 })}
                {sortTh('summary',          'Summary',            { minWidth: 200 })}
                {sortTh('status',           'Defect/Enhancement Status', { width: 210, minWidth: 210 })}
                <th style={{ width: 170, minWidth: 170 }}>Cleanup Status</th>
                {sortTh('isPublic',         'Public',             { width: 110, minWidth: 110 })}
                {sortTh('jiraCard',         'JIRA Card #',        { width: 170, minWidth: 170 })}
                {sortTh('releaseNum',       'Release #',          { width: 150, minWidth: 150 })}
                {sortTh('policyPremium',    'Policy Premium ($)', { width: 160 })}
                {sortTh('directImpact',     'Direct Impact ($)',  { width: 160 })}
                {sortTh('policiesImpacted', 'Policies Impacted',  { width: 140 })}
                {sortTh('easyvista',        'EasyVista',          { width: 110 })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 12px' }}>No submissions match the current filters.</td></tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={(e) => {
                    if (e.target.closest('select, input, button, a, textarea, label')) {
                      return;
                    }
                    openDetail(row.id);
                  }}
                  className="clickable"
                >
                  <td style={{ width: 110, minWidth: 110 }}>{formatDateOnly(row.created_at)}</td>
                  <td style={{ width: 110, minWidth: 110 }}>{formatDateOnly(row.status_update_at || row.updated_at)}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <Badge value={inlineDisplayType(row)} />
                      {row.is_cleanup && row.cleanup_tag_type !== 'cleanup_only' && <Badge value="Clean Up" />}
                      {row.has_resubmission && row.latest_resubmission_easyvista_ticket_id && (
                        <Badge value={`Resubmitted: ${row.latest_resubmission_easyvista_ticket_id}`} />
                      )}
                      {row.is_resubmission && row.resubmission_of_easyvista_ticket_id && (
                        <Badge value={`Resubmit of: ${row.resubmission_of_easyvista_ticket_id}`} />
                      )}
                    </div>
                  </td>
                  <td style={{ minWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.summary_of_issue}</td>
                  <td style={{ minWidth: 170 }}>
                    <select
                      className="bs-inline-select"
                      aria-label={`Update defect or enhancement status for #${row.id}`}
                      value={row.is_cleanup && row.cleanup_tag_type === 'cleanup_only' ? cleanupOnlyStatus : row.status}
                      disabled={row.is_retired}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateStatusQuick(row.id, e.target.value, row);
                      }}
                    >
                      {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 170 }}>
                    <select
                      className="bs-inline-select"
                      aria-label={`Update cleanup status for #${row.id}`}
                      value={row.is_cleanup ? (row.cleanup_status || statusToCleanup[row.status] || 'Not Started') : 'No Cleanup'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateCleanupStatusQuick(row.id, e.target.value, row);
                      }}
                    >
                      {cleanupInlineStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 110 }}>
                    <select
                      className="bs-inline-select"
                      aria-label={`Update public visibility for #${row.id}`}
                      value={row.is_public ? 'yes' : 'no'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updatePublicQuick(row.id, e.target.value === 'yes');
                      }}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </td>
                  <td style={{ minWidth: 170 }}>
                    <input
                      className="bs-inline-input"
                      aria-label={`Update JIRA number for #${row.id}`}
                      defaultValue={row.jira_number || ''}
                      placeholder="JIRA-123"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          updateJiraQuick(row.id, e.currentTarget.value.trim());
                        }
                      }}
                      onBlur={(e) => {
                        e.stopPropagation();
                        updateJiraQuick(row.id, e.currentTarget.value.trim());
                      }}
                    />
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        className="bs-inline-input"
                        aria-label={`Update release number for #${row.id}`}
                        defaultValue={row.release_number || ''}
                        placeholder="v1.0.0"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            updateReleaseNumberQuick(row.id, e.currentTarget.value.trim());
                          }
                        }}
                        onBlur={(e) => {
                          e.stopPropagation();
                          updateReleaseNumberQuick(row.id, e.currentTarget.value.trim());
                        }}
                      />
                      {!!row.release_notes && (
                        <span
                          title="Release notes available"
                          style={{ fontSize: 14, color: 'var(--blue-500)', cursor: 'default', flexShrink: 0 }}
                        >📋</span>
                      )}
                    </div>
                  </td>
                  <td>{formatCurrency(row.policy_premium_impact)}</td>
                  <td>{formatCurrency(row.direct_dollar_impact)}</td>
                  <td>{formatNumber(row.policies_affected_count)}</td>
                  <td className="muted">{row.easyvista_ticket_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={cleanupOpen}
        onClose={() => {
          setError('');
          setCleanupOpen(false);
          resetCleanupForm();
        }}
        title="Add Cleanup Task"
      >
        <div className="stack">
          <p className="muted" style={{ marginTop: 0 }}>
            Cleanup tasks are internal by default. Tag as Defect or Enhancement only if it should be EasyVista-eligible.
          </p>

          <div className="bs-grid two">
            <Input label="Type" value="Clean Up" readOnly />
            <Select
              label="Status"
              value={cleanupForm.cleanup_status}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, cleanup_status: e.target.value }))}
            >
              {cleanupStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </Select>

            <Select
              label="Tag as (optional)"
              value={cleanupForm.cleanup_tag_type}
              onChange={(e) =>
                setCleanupForm((prev) => ({
                  ...prev,
                  cleanup_tag_type: e.target.value,
                  submit_to_easyvista:
                    e.target.value === 'defect' || e.target.value === 'enhancement'
                      ? prev.submit_to_easyvista
                      : false,
                  desired_completion_date:
                    e.target.value === 'enhancement' ? prev.desired_completion_date : '',
                  impact_details: e.target.value === 'enhancement' ? prev.impact_details : '',
                  enhancement_request_type:
                    e.target.value === 'enhancement' ? prev.enhancement_request_type : '',
                  priority_level:
                    e.target.value === 'enhancement' ? (prev.priority_level || '3 - Medium') : '3 - Medium',
                  date_time_of_error: e.target.value === 'defect' ? prev.date_time_of_error : '',
                  date_of_error: e.target.value === 'defect' ? prev.date_of_error : '',
                  time_of_error: e.target.value === 'defect' ? prev.time_of_error : '',
                  screen_title: e.target.value === 'defect' ? prev.screen_title : '',
                  policy_num: e.target.value === 'defect' ? prev.policy_num : '',
                  account_num: e.target.value === 'defect' ? prev.account_num : '',
                  transaction_num: e.target.value === 'defect' ? prev.transaction_num : '',
                  steps_to_reproduce: e.target.value === 'defect' ? prev.steps_to_reproduce : '',
                  what_happened_exact_details:
                    e.target.value === 'defect' ? prev.what_happened_exact_details : '',
                  request: e.target.value === 'enhancement' ? prev.request : '',
                }))
              }
            >
              <option value="cleanup_only">Cleanup Only</option>
              <option value="defect">Defect</option>
              <option value="enhancement">Enhancement</option>
            </Select>

            <Input
              label="Requester Name"
              value={cleanupForm.created_by}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, created_by: e.target.value }))}
            />

            <Select
              label="Application"
              value={cleanupForm.application_name}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, application_name: e.target.value }))}
            >
              {applications.map((application) => (
                <option key={application} value={application}>{application}</option>
              ))}
            </Select>

            {cleanupForm.cleanup_tag_type === 'defect' && (
              <>
                <Input
                  label="Date of Error"
                  type="date"
                  required={cleanupRequiresEasyVistaFields}
                  value={cleanupForm.date_of_error}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, date_of_error: e.target.value }))}
                />

                <Input
                  label="Time of Error (optional)"
                  type="time"
                  value={cleanupForm.time_of_error}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, time_of_error: e.target.value }))}
                />

                <Input
                  label="Screen Title"
                  required={cleanupRequiresEasyVistaFields}
                  value={cleanupForm.screen_title}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, screen_title: e.target.value }))}
                />
                <Input
                  label="Policy #"
                  value={cleanupForm.policy_num}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, policy_num: e.target.value }))}
                />
                <Input
                  label="Account #"
                  value={cleanupForm.account_num}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, account_num: e.target.value }))}
                />
                <Input
                  label="Transaction #"
                  value={cleanupForm.transaction_num}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, transaction_num: e.target.value }))}
                />
              </>
            )}

            {cleanupForm.cleanup_tag_type === 'enhancement' && (
              <>
                <Input
                  label="Desired Completion Date"
                  type="date"
                  required={cleanupRequiresEasyVistaFields}
                  value={cleanupForm.desired_completion_date}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, desired_completion_date: e.target.value }))}
                />
                <Input label="Application Name" value="Billing Center" readOnly />
                <Select
                  label="Request Type"
                  value={cleanupForm.enhancement_request_type}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, enhancement_request_type: e.target.value }))}
                >
                  <option value="">Select one</option>
                  {enhancementRequestTypes.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
                <Select
                  label="Priority Level"
                  value={cleanupForm.priority_level}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, priority_level: e.target.value }))}
                >
                  {enhancementPriorityLevels.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              </>
            )}
          </div>

          <Input
            label={cleanupForm.cleanup_tag_type === 'defect' ? 'Summary of Issue' : 'Summary'}
            required
            value={cleanupForm.summary_of_issue}
            onChange={(e) => setCleanupForm((prev) => ({ ...prev, summary_of_issue: e.target.value }))}
          />

          {cleanupForm.cleanup_tag_type === 'cleanup_only' && (
            <Textarea
              label="Description"
              required
              rows={4}
              value={cleanupForm.description}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          )}

          {cleanupForm.cleanup_tag_type && (
            <>
              <p className="section-label">Impact Tracking</p>
              <Textarea
                label="Impact Notes"
                rows={3}
                value={cleanupForm.impact_notes}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, impact_notes: e.target.value }))}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 12,
                }}
              >
                <Input
                  label="Policy Premium Impact ($)"
                  type="number"
                  step="0.01"
                  value={cleanupForm.policy_premium_impact}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, policy_premium_impact: e.target.value }))}
                />
                <Input
                  label="Direct Dollar Impact ($)"
                  type="number"
                  step="0.01"
                  value={cleanupForm.direct_dollar_impact}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, direct_dollar_impact: e.target.value }))}
                />
                <Input
                  label="Policies Affected Count"
                  type="number"
                  step="1"
                  min="0"
                  value={cleanupForm.policies_affected_count}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, policies_affected_count: e.target.value }))}
                />
              </div>
            </>
          )}

          {cleanupForm.cleanup_tag_type === 'defect' && (
            <>
              <Textarea
                label="Steps to Reproduce"
                rows={3}
                value={cleanupForm.steps_to_reproduce}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, steps_to_reproduce: e.target.value }))}
              />
              <Textarea
                label="What Happened? (Exact Details)"
                required={cleanupRequiresEasyVistaFields}
                rows={4}
                value={cleanupForm.what_happened_exact_details}
                onChange={(e) =>
                  setCleanupForm((prev) => ({ ...prev, what_happened_exact_details: e.target.value }))
                }
              />
            </>
          )}

          {cleanupForm.cleanup_tag_type === 'enhancement' && (
            <>
              <Textarea
                label="Request Details"
                required={cleanupRequiresEasyVistaFields}
                rows={4}
                value={cleanupForm.request}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, request: e.target.value }))}
              />
              <Textarea
                label="Impact Details"
                required={cleanupRequiresEasyVistaFields}
                rows={4}
                value={cleanupForm.impact_details}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, impact_details: e.target.value }))}
              />
            </>
          )}

          {(cleanupForm.cleanup_tag_type === 'defect' || cleanupForm.cleanup_tag_type === 'enhancement') && (
            <label className="bs-field">
              <span>
                {cleanupForm.cleanup_tag_type === 'defect'
                  ? (
                    cleanupRequiresEasyVistaFields
                      ? 'Screenshots (required for EasyVista Defect submission)'
                      : 'Screenshots (optional unless submitting to EasyVista)'
                  )
                  : 'Supporting files (optional)'}
              </span>
              <input
                ref={cleanupFileInputRef}
                type="file"
                accept={cleanupForm.cleanup_tag_type === 'enhancement' ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []);
                  setCleanupFiles((prev) => {
                    const merged = [...prev];
                    for (const nextFile of selected) {
                      const exists = merged.some(
                        (existing) =>
                          existing.name === nextFile.name
                          && existing.size === nextFile.size
                          && existing.lastModified === nextFile.lastModified,
                      );
                      if (!exists) merged.push(nextFile);
                    }
                    return merged.slice(0, 3);
                  });
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                kind="secondary"
                style={{ width: 'auto', alignSelf: 'flex-start' }}
                onClick={() => cleanupFileInputRef.current?.click()}
              >
                Choose files
              </Button>
              <span className="muted" style={{ fontSize: '12px' }}>
                {cleanupFiles.length}/3 selected
              </span>
            </label>
          )}

          {cleanupFilePreviews.length > 0 && (
            <div className="thumb-grid">
              {cleanupFilePreviews.map((preview, index) => (
                <article key={`${preview.file.name}-${preview.file.size}-${index}`} className="thumb-item">
                  <button
                    type="button"
                    className="thumb-open-btn"
                    onClick={() => setCleanupPreviewIndex(index)}
                  >
                    <img src={preview.url} alt={preview.file.name} />
                  </button>
                  <div className="thumb-meta">
                    <span className="thumb-name">{preview.file.name}</span>
                    <Button
                      type="button"
                      kind="danger"
                      onClick={() => {
                        setCleanupFiles((prev) => prev.filter((_, i) => i !== index));
                        setCleanupPreviewIndex((current) => {
                          if (current === null) return current;
                          if (current === index) return null;
                          return current > index ? current - 1 : current;
                        });
                      }}
                      disabled={cleanupWorking}
                    >
                      Remove
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {(cleanupForm.cleanup_tag_type === 'defect' || cleanupForm.cleanup_tag_type === 'enhancement') && (
            <>
              <label className="toggle-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(cleanupForm.submit_to_easyvista)}
                  onChange={(e) =>
                    setCleanupForm((prev) => ({
                      ...prev,
                      submit_to_easyvista: e.target.checked,
                    }))
                  }
                />
                <span>Submit to EasyVista after create</span>
              </label>
              <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>
                When checked, all required fields for the selected Defect/Enhancement form must be completed before submit.
              </p>
            </>
          )}

          {error && <Notice text={error} />}

          <div className="bs-actions">
            <Button type="button" onClick={createCleanupTask} disabled={cleanupWorking}>Save Changes</Button>
            <Button
              kind="ghost"
              type="button"
              onClick={() => {
                setError('');
                setCleanupOpen(false);
                resetCleanupForm();
              }}
              disabled={cleanupWorking}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={backdatedOpen}
        onClose={() => {
          setError('');
          setBackdatedOpen(false);
          resetBackdatedForm();
        }}
        title="Add Backdated Ticket"
      >
        <div className="stack">
          <p className="muted" style={{ marginTop: 0 }}>
            Creates a historical ticket directly in Admin. This does not submit to EasyVista API.
          </p>

          <div className="bs-grid two">
            <Select
              label="Type"
              value={backdatedForm.type}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, type: e.target.value }))}
            >
              <option value="defect">Defect</option>
              <option value="enhancement">Enhancement</option>
            </Select>

            <Select
              label="Current Status"
              value={backdatedForm.status}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, status: e.target.value }))}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </Select>

            <Input
              label="Requester Name"
              required
              value={backdatedForm.created_by}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_by: e.target.value }))}
            />

            <Input
              label="Requester Email"
              value={backdatedForm.created_by_email}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_by_email: e.target.value }))}
            />

            <Select
              label="Application"
              value={backdatedForm.application_name}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, application_name: e.target.value }))}
            >
              {applications.map((application) => (
                <option key={application} value={application}>{application}</option>
              ))}
            </Select>

            <Input
              label="Reported Date / Time"
              type="datetime-local"
              value={backdatedForm.reported_at}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, reported_at: e.target.value }))}
            />

            {backdatedForm.type === 'enhancement' && (
              <Input
                label="Desired Completion Date"
                type="date"
                value={backdatedForm.desired_completion_date}
                onChange={(e) => setBackdatedForm((prev) => ({ ...prev, desired_completion_date: e.target.value }))}
              />
            )}

            <Input
              label="JIRA Number"
              placeholder="JIRA-123"
              value={backdatedForm.jira_number}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, jira_number: e.target.value }))}
            />

            <Input
              label="Release #"
              placeholder="v1.0.0"
              value={backdatedForm.release_number}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, release_number: e.target.value }))}
            />
          </div>

          <Input
            label="Summary of Issue"
            required
            value={backdatedForm.summary_of_issue}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, summary_of_issue: e.target.value }))}
          />

          <Input
            label="Screen Title"
            value={backdatedForm.screen_title}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, screen_title: e.target.value }))}
          />

          <Textarea
            label="Request Details"
            rows={3}
            value={backdatedForm.request}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, request: e.target.value }))}
          />

          <p className="section-label">Impact Tracking</p>
          <Textarea
            label="Impact Notes"
            rows={3}
            value={backdatedForm.impact_notes}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, impact_notes: e.target.value }))}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <Input
              label="Policy Premium Impact ($)"
              type="number"
              step="0.01"
              value={backdatedForm.policy_premium_impact}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, policy_premium_impact: e.target.value }))}
            />
            <Input
              label="Direct Dollar Impact ($)"
              type="number"
              step="0.01"
              value={backdatedForm.direct_dollar_impact}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, direct_dollar_impact: e.target.value }))}
            />
            <Input
              label="Policies Affected Count"
              type="number"
              step="1"
              min="0"
              value={backdatedForm.policies_affected_count}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, policies_affected_count: e.target.value }))}
            />
          </div>

          <div className="bs-grid two">
            <Input
              label="EasyVista Ticket ID"
              placeholder="EV-123456"
              value={backdatedForm.easyvista_ticket_id}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, easyvista_ticket_id: e.target.value }))}
            />
            <Input
              label="Submitted to EV By"
              placeholder="Defaults to Unknown"
              value={backdatedForm.easyvista_submitted_by}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, easyvista_submitted_by: e.target.value }))}
            />
            <Input
              label="Submitted Date"
              type="datetime-local"
              value={backdatedForm.status_dates.Submitted}
              onChange={(e) =>
                setBackdatedForm((prev) => ({
                  ...prev,
                  status_dates: { ...prev.status_dates, Submitted: e.target.value },
                }))
              }
            />
            <Input
              label="Deployed Date"
              type="datetime-local"
              value={backdatedForm.status_dates.Deployed}
              onChange={(e) =>
                setBackdatedForm((prev) => ({
                  ...prev,
                  status_dates: { ...prev.status_dates, Deployed: e.target.value },
                }))
              }
            />
          </div>

          <p className="section-label">Optional status dates (historical timeline)</p>
          <div className="bs-grid two">
            {['Approved', 'Rejected', 'Duplicate', 'Retired'].map((statusKey) => (
              <Input
                key={statusKey}
                label={`${statusKey} Date`}
                type="datetime-local"
                value={backdatedForm.status_dates[statusKey]}
                onChange={(e) =>
                  setBackdatedForm((prev) => ({
                    ...prev,
                    status_dates: { ...prev.status_dates, [statusKey]: e.target.value },
                  }))
                }
              />
            ))}
          </div>

          {error && <Notice text={error} />}

          <div className="bs-actions">
            <Button type="button" onClick={createBackdatedTicket} disabled={backdatedWorking}>Create Backdated Ticket</Button>
            <Button
              kind="ghost"
              type="button"
              onClick={() => {
                setError('');
                setBackdatedOpen(false);
                resetBackdatedForm();
              }}
              disabled={backdatedWorking}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(openId && detail && edit)}
        onClose={() => {
          setOpenId(null);
          setModalTopNotice('');
          setShowEasyVistaRequirements(false);
        }}
        title={modalTitle}
        headerActions={(
          <span
            style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setShowHeaderSaveTooltip(true)}
            onMouseLeave={() => setShowHeaderSaveTooltip(false)}
          >
            <Button
              onClick={() => saveEdits('header')}
              disabled={working || !hasPendingChanges}
            >
              Save Changes
            </Button>
            {(working || !hasPendingChanges) && showHeaderSaveTooltip && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--slate-900)',
                  color: 'white',
                  fontSize: 12,
                  lineHeight: 1.2,
                  padding: '6px 8px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  zIndex: 30,
                }}
              >
                {saveDisabledReason}
              </span>
            )}
          </span>
        )}
      >
        {detail && edit && (
          <div className="stack">
            {modalTopNotice && <Notice text={modalTopNotice} kind="success" />}
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
            {/* ── Triage ── */}
            <p className="section-label">Triage</p>
            <div className="bs-grid two">
              <label className="toggle-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(edit.is_cleanup)}
                  onChange={(e) =>
                    setEdit((p) => ({
                      ...p,
                      is_cleanup: e.target.checked,
                      cleanup_status: e.target.checked
                        ? (p.cleanup_status || statusToCleanup[p.status] || 'Not Started')
                        : '',
                      cleanup_tag_type: e.target.checked
                        ? (
                            p.cleanup_tag_type
                            || (p.type === 'enhancement' ? 'enhancement' : 'defect')
                          )
                        : '',
                    }))
                  }
                />
                <span>Clean Up Task</span>
              </label>

              <Select
                label="Type"
                value={edit.is_cleanup ? (edit.cleanup_tag_type || 'cleanup_only') : edit.type}
                onChange={(e) =>
                  setEdit((p) => {
                    if (p.is_cleanup) {
                      const nextCleanupTagType = e.target.value;
                      return {
                        ...p,
                        cleanup_tag_type: nextCleanupTagType,
                        type: nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect',
                      };
                    }
                    return { ...p, type: e.target.value };
                  })
                }
              >
                {edit.is_cleanup && <option value="cleanup_only">Cleanup Only</option>}
                <option value="defect">Defect</option>
                <option value="enhancement">Enhancement</option>
              </Select>

              <Select
                label="Defect/Enhancement Status"
                value={edit.is_cleanup && edit.cleanup_tag_type === 'cleanup_only' ? cleanupOnlyStatus : edit.status}
                disabled={edit.is_retired}
                onChange={(e) =>
                  setEdit((p) => ({
                    ...p,
                    is_cleanup: e.target.value === cleanupOnlyStatus ? true : p.is_cleanup,
                    cleanup_status:
                      e.target.value === cleanupOnlyStatus
                        ? (p.cleanup_status || statusToCleanup[p.status] || 'Not Started')
                        : p.cleanup_status,
                    status: e.target.value === cleanupOnlyStatus ? 'New' : e.target.value,
                    cleanup_tag_type:
                      e.target.value === cleanupOnlyStatus
                        ? 'cleanup_only'
                        : (
                            p.cleanup_tag_type === 'cleanup_only'
                              ? (p.type === 'enhancement' ? 'enhancement' : 'defect')
                              : p.cleanup_tag_type
                          ),
                    type: e.target.value === cleanupOnlyStatus ? 'defect' : p.type,
                  }))
                }
              >
                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select
                label="Cleanup Status"
                value={edit.cleanup_status || 'Not Started'}
                onChange={(e) => setEdit((p) => ({ ...p, cleanup_status: e.target.value }))}
                disabled={!edit.is_cleanup}
              >
                {cleanupStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Input label="Reviewer" value={edit.reviewer} onChange={(e) => setEdit((p) => ({ ...p, reviewer: e.target.value }))} />
              <Input label="Duplicate Reference (EasyVista / JIRA / ID)" value={edit.duplicate_of} onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))} />
              <Input label="JIRA Number" value={edit.jira_number} onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))} placeholder="JIRA-123" />
              <Input label="EasyVista Ticket" value={detail.easyvista_ticket_id || ''} readOnly placeholder="—" />
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Triage/Release Info</summary>
              <div className="bs-form" style={{ marginTop: 12 }}>
                <Textarea label="Decision Notes" rows={2} value={edit.decision_notes} onChange={(e) => setEdit((p) => ({ ...p, decision_notes: e.target.value }))} />
                <Input label="Release #" placeholder="e.g. v1.2.0" value={edit.release_number} onChange={(e) => setEdit((p) => ({ ...p, release_number: e.target.value }))} />
                <Textarea label="Release Notes" rows={3} value={edit.release_notes} onChange={(e) => setEdit((p) => ({ ...p, release_notes: e.target.value }))} />
              </div>
            </details>

            <p className="section-label">Status Timeline</p>
            <Card className="inner">
              {!detail.status_events || detail.status_events.length === 0 ? (
                <p className="muted">No status history found.</p>
              ) : (
                <div className="bs-form" style={{ gap: 10 }}>
                  <div style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                    <p style={{ margin: 0 }}>
                      <strong>{formatTimelineStatus(detail.status_events[0].status)}</strong> on {formatDateTime(detail.status_events[0].changed_at)}
                    </p>
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                      Updated by: {detail.status_events[0].changed_by || 'Unknown'}
                    </p>
                  </div>
                  {detail.status_events.length > 1 && (
                    <details>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                        Show previous statuses ({detail.status_events.length - 1})
                      </summary>
                      <div className="bs-form" style={{ gap: 8, marginTop: 10 }}>
                        {detail.status_events.slice(1).map((event) => (
                          <div key={event.id} style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                            <p style={{ margin: 0 }}>
                              <strong>{formatTimelineStatus(event.status)}</strong> on {formatDateTime(event.changed_at)}
                            </p>
                            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                              Updated by: {event.changed_by || 'Unknown'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </Card>

            {/* ── Submission details ── */}
            <p className="section-label">Submission Details</p>
            <Input label="Summary" value={edit.summary_of_issue} onChange={(e) => setEdit((p) => ({ ...p, summary_of_issue: e.target.value }))} />

            {(effectiveType === 'defect' || !effectiveType) && (
              <Input label="Date / Time of Error" type="datetime-local" value={edit.date_time_of_error} onChange={(e) => setEdit((p) => ({ ...p, date_time_of_error: e.target.value }))} />
            )}
            {effectiveType === 'enhancement' && (
              <Input label="Desired Completion Date" type="date" value={edit.desired_completion_date} onChange={(e) => setEdit((p) => ({ ...p, desired_completion_date: e.target.value }))} />
            )}

            <Textarea label="Exact Details / What Happened" rows={3} value={edit.what_happened_exact_details} onChange={(e) => setEdit((p) => ({ ...p, what_happened_exact_details: e.target.value }))} />

            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>More Submission Details</summary>
              <div className="bs-form" style={{ marginTop: 12 }}>
                <div className="bs-grid two">
                  <Select
                    label="Application"
                    value={edit.application_name || 'Billing Center'}
                    onChange={(e) => setEdit((p) => ({ ...p, application_name: e.target.value }))}
                  >
                    {applications.map((application) => (
                      <option key={application} value={application}>{application}</option>
                    ))}
                  </Select>
                  <Input label="Policy #" value={edit.policy_num} onChange={(e) => setEdit((p) => ({ ...p, policy_num: e.target.value }))} />
                  <Input label="Account #" value={edit.account_num} onChange={(e) => setEdit((p) => ({ ...p, account_num: e.target.value }))} />
                  <Input label="Transaction #" value={edit.transaction_num} onChange={(e) => setEdit((p) => ({ ...p, transaction_num: e.target.value }))} />
                  <Input label="Fingerprint" value={edit.fingerprint} onChange={(e) => setEdit((p) => ({ ...p, fingerprint: e.target.value }))} />
                </div>
                <Input label="Screen Title" value={edit.screen_title} onChange={(e) => setEdit((p) => ({ ...p, screen_title: e.target.value }))} />
                <Textarea label="Steps to Reproduce" rows={3} value={edit.steps_to_reproduce} onChange={(e) => setEdit((p) => ({ ...p, steps_to_reproduce: e.target.value }))} />
                <Textarea label="Request Details" rows={3} value={edit.request} onChange={(e) => setEdit((p) => ({ ...p, request: e.target.value }))} />
              </div>
            </details>

            <p className="section-label">Impact Analysis</p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 12,
              }}
            >
              <Input
                label="Policy Premium Impact ($)"
                type="number"
                step="0.01"
                value={edit.policy_premium_impact}
                onChange={(e) => setEdit((p) => ({ ...p, policy_premium_impact: e.target.value }))}
              />
              <Input
                label="Direct Dollar Impact ($)"
                type="number"
                step="0.01"
                value={edit.direct_dollar_impact}
                onChange={(e) => setEdit((p) => ({ ...p, direct_dollar_impact: e.target.value }))}
              />
              <Input
                label="Policies Affected Count"
                type="number"
                step="1"
                min="0"
                value={edit.policies_affected_count}
                onChange={(e) => setEdit((p) => ({ ...p, policies_affected_count: e.target.value }))}
              />
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Impact Notes</summary>
              <div className="bs-form" style={{ marginTop: 12 }}>
                <Textarea
                  label="Impact Notes"
                  rows={3}
                  value={edit.impact_notes}
                  onChange={(e) => setEdit((p) => ({ ...p, impact_notes: e.target.value }))}
                />
              </div>
            </details>

            {/* ── Enhancement admin ── */}
            {effectiveType === 'enhancement' && (
              <>
                <p className="section-label">Enhancement — Admin Fields</p>
                <Card className="inner">
                  <div className="bs-form">
                    <Textarea label="Impact Details" required rows={4} value={edit.impact_details} onChange={(e) => setEdit((p) => ({ ...p, impact_details: e.target.value }))} />
                    <div className="bs-grid two">
                      <Select label="Request Type" required value={edit.enhancement_request_type} onChange={(e) => setEdit((p) => ({ ...p, enhancement_request_type: e.target.value }))}>
                        <option value="">Select one</option>
                        {enhancementRequestTypes.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Select label="Priority Level" value={edit.priority_level} onChange={(e) => setEdit((p) => ({ ...p, priority_level: e.target.value }))}>
                        {enhancementPriorityLevels.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Input label="JIRA Number" value={edit.jira_number} onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))} />
                      <Select label="In JIRA" value={edit.logged_defect ? 'yes' : 'no'} onChange={(e) => setEdit((p) => ({ ...p, logged_defect: e.target.value === 'yes' }))}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Select>
                    </div>
                  </div>
                </Card>
              </>
            )}

            {/* ── Visibility toggle ── */}
            <div className="bs-actions" style={{ alignItems: 'center' }}>
              <label className="toggle-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={edit.is_public}
                  onChange={(e) => setEdit((p) => ({ ...p, is_public: e.target.checked }))}
                />
                <span>Visible on Public Status Board</span>
              </label>
            </div>

            {/* ── Attachments ── */}
            <p className="section-label">Attachments</p>
            <Card className="inner">
              <div className="bs-form">
                <label className="bs-field">
                  <span>{effectiveType === 'enhancement' ? 'Supporting Documentation (images / documents)' : 'Add Screenshots'}</span>
                  <input
                    type="file"
                    accept={effectiveType === 'enhancement' ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
                    multiple
                    onChange={uploadAttachment}
                  />
                </label>
                {detail.attachments?.length > 0 && (
                  <div className="thumb-grid">
                    {detail.attachments.map((att) => (
                      <article key={att.id} className="thumb-item">
                        {att.mime_type?.startsWith('image/') ? (
                          <button type="button" className="thumb-open-btn" onClick={() => setPreviewAttachment(att)}>
                            <img src={`/${att.file_path}`} alt={att.filename} />
                          </button>
                        ) : (
                          <a href={`/${att.file_path}`} target="_blank" rel="noreferrer" className="file-link">{att.filename}</a>
                        )}
                        <div className="thumb-meta">
                          <span className="thumb-name">{att.filename}</span>
                          <Button kind="danger" onClick={() => deleteAttachment(att.id)}>Remove</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {showEasyVistaRequirements && easyVistaMissingRequirements.length > 0 && (
              <Notice text={`Complete before EasyVista submission: ${easyVistaMissingRequirements.join(', ')}`} />
            )}

            {/* ── Actions ── */}
            <div className="bs-actions">
              <span
                style={{ position: 'relative', display: 'inline-block' }}
                onMouseEnter={() => setShowFooterSaveTooltip(true)}
                onMouseLeave={() => setShowFooterSaveTooltip(false)}
              >
                <Button
                  onClick={() => saveEdits('footer')}
                  disabled={working || !hasPendingChanges}
                >
                  Save Changes
                </Button>
                {(working || !hasPendingChanges) && showFooterSaveTooltip && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 6px)',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'var(--slate-900)',
                      color: 'white',
                      fontSize: 12,
                      lineHeight: 1.2,
                      padding: '6px 8px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                      zIndex: 30,
                    }}
                  >
                    {saveDisabledReason}
                  </span>
                )}
              </span>
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
            {easyVistaConfirmation && <Notice text={easyVistaConfirmation} kind="success" />}
            {error && <Notice text={error} />}
            {detail.easyvista_ticket_id && (
              <p className="muted" style={{ fontSize: 13 }}>EasyVista ticket: <strong>{detail.easyvista_ticket_id}</strong></p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(previewAttachment)}
        onClose={() => setPreviewAttachment(null)}
        title={previewAttachment?.filename || 'Attachment Preview'}
      >
        {previewAttachment && (
          <img
            className="bs-preview-image"
            src={`/${previewAttachment.file_path}`}
            alt={previewAttachment.filename}
          />
        )}
      </Modal>

      <Modal
        open={cleanupPreviewIndex !== null && Boolean(cleanupFilePreviews[cleanupPreviewIndex])}
        onClose={() => setCleanupPreviewIndex(null)}
        title={cleanupFilePreviews[cleanupPreviewIndex]?.file?.name || 'Attachment Preview'}
      >
        {cleanupPreviewIndex !== null && cleanupFilePreviews[cleanupPreviewIndex] && (
          <img
            className="bs-preview-image"
            src={cleanupFilePreviews[cleanupPreviewIndex].url}
            alt={cleanupFilePreviews[cleanupPreviewIndex].file.name}
          />
        )}
      </Modal>
    </div>
  );
}
