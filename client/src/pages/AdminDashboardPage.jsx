import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
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

// ── Constants & utilities ───────────────────────────────────────────────────
import {
  RETIRED_STATUS,
  CLEANUP_ONLY_STATUS,
  CLEANUP_MARKED_STATUS,
  STATUS_TO_CLEANUP,
  ADMIN_META_CATEGORIES,
  ADMIN_FILTERS_STORAGE_KEY,
  ADMIN_RETIRED_FILTER_STORAGE_KEY,
  SORT_COLS,
} from '../constants/adminConstants';
import {
  toNumeric,
  formatMetaTypeLabel,
  formatCreatedViaLabel,
  resolveAttachmentUrl,
  isAutoEasyVistaReporter,
  formatCurrency,
  formatNumber,
  formatDateTime,
  formatDateOnly,
  formatTimelineStatus,
} from '../utils/formatUtils';
import {
  areAllStatusesSelected,
  buildDefaultFilters,
  defaultFilters,
} from '../utils/filterUtils';
import {
  normalizeAdminRow,
  inlineDisplayType,
} from '../utils/mappers';
import { isProtectedRetiredStatusMetaItem } from '../utils/metaUtils';

// ── Custom hooks ────────────────────────────────────────────────────────────
import { useAdminMeta } from '../hooks/useAdminMeta';
import { useAdminNotifications } from '../hooks/useAdminNotifications';
import { useDetailModal } from '../hooks/useDetailModal';
import { useBackdatedModal } from '../hooks/useBackdatedModal';
import { useCleanupModal } from '../hooks/useCleanupModal';
import { useImportModal } from '../hooks/useImportModal';
import { useExportModal } from '../hooks/useExportModal';

// Aliases to keep JSX working with the original variable names
const retiredStatus = RETIRED_STATUS;
const cleanupOnlyStatus = CLEANUP_ONLY_STATUS;
const cleanupMarkedStatus = CLEANUP_MARKED_STATUS;
const statusToCleanup = STATUS_TO_CLEANUP;
const adminMetaCategories = ADMIN_META_CATEGORIES;
const adminFiltersStorageKey = ADMIN_FILTERS_STORAGE_KEY;
const adminRetiredFilterStorageKey = ADMIN_RETIRED_FILTER_STORAGE_KEY;

export function AdminDashboardPage({ user, onLogout }) {
  const navigate = useNavigate();

  // ── Page-level state (filters, rows, pagination, notices) ─────────────────
  const [filters, setFilters] = useState(defaultFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [rows, setRows] = useState([]);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // ── Load rows callback (page-level so hooks can share it) ─────────────────
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

  // ── Custom hooks ──────────────────────────────────────────────────────────
  const meta = useAdminMeta({ setFilters, setNotice });
  const detailModal = useDetailModal({ loadRows, setRows, setNotice, setError });
  const backdated = useBackdatedModal({ user, loadRows, setNotice });
  const cleanup = useCleanupModal({ user, loadRows, setNotice });
  const importModal = useImportModal({ loadRows, setNotice });
  const exportModal = useExportModal({ filtersRef, setNotice });

  // Destructure detail modal for convenience (used extensively in JSX)
  const {
    openId, setOpenId, detail, edit, setEdit, isDetailModalOpen,
    openDetail, detailError, setDetailError, working,
    modalTopNotice, setModalTopNotice, modalBottomNotice, setModalBottomNotice,
    previewAttachment, setPreviewAttachment,
    easyVistaConfirmation, showEasyVistaRequirements, setShowEasyVistaRequirements,
    showHeaderSaveTooltip, setShowHeaderSaveTooltip,
    showFooterSaveTooltip, setShowFooterSaveTooltip,
    modalTitle, effectiveType, easyVistaMissingRequirements,
    hasPendingChanges, visibleAttachments, saveDisabledReason,
    saveEdits, retireCurrentItem, unretireCurrentItem, uploadAttachment, deleteAttachment, submitEasyVista,
    pendingAttachmentFiles, pendingRemovedAttachmentIds,
  } = detailModal;

  // Destructure meta for convenience
  const {
    dynamicStatuses, dynamicCleanupStatuses, dynamicSubmissionTypes, dynamicCleanupTagTypes,
    dynamicApplications, dynamicEnhancementRequestTypes, dynamicPriorityLevels, dynamicOccurrenceTimeframes,
    runtimeStatusFilterOptions, runtimeStatusOptions, runtimeCleanupInlineStatuses,
    runtimeCreatedViaOptions, runtimeTypeFilterOptions,
    dynamicCoreStatusSet, dynamicCleanupStatusSet,
    adminMetaOptions, adminMetaLoading, adminMetaSaving, adminMetaError,
    selectedMetaCategory, setSelectedMetaCategory, newMetaName, setNewMetaName,
    metaDraftNames, setMetaDraftNames,
    activeMetaCategoryConfig, activeMetaItems,
    loadAdminMeta, saveMetaItem, addMetaItem, moveMetaItem,
  } = meta;

  // Destructure backdated modal
  const {
    backdatedOpen, setBackdatedOpen, backdatedError, backdatedWorking,
    backdatedForm, setBackdatedForm, resetBackdatedForm, createBackdatedTicket,
  } = backdated;

  // Destructure cleanup modal
  const {
    cleanupOpen, setCleanupOpen, cleanupError, cleanupWorking,
    cleanupForm, setCleanupForm, cleanupFiles, setCleanupFiles,
    cleanupPreviewIndex, setCleanupPreviewIndex, cleanupFileInputRef,
    cleanupRequiresEasyVistaFields, cleanupFilePreviews,
    resetCleanupForm, createCleanupTask,
  } = cleanup;

  // Destructure import modal
  const {
    importFileInputRef, importModalOpen, setImportModalOpen, importWorking,
    importMode, setImportMode, importAvailableHeaders,
    importMappingTargets, importColumnMappings, setImportColumnMappings,
    pendingImportFile, importStatusText, importStatusKind,
    importResultErrors, importSummary, importAction, importHistory,
    importRequiresApplicationDefault, importDefaultApplicationName, setImportDefaultApplicationName,
    importUnknownStatuses, importAllowedStatuses,
    importStatusValueMappings, setImportStatusValueMappings,
    importTargetByHeader, sortedImportMappingTargets,
    visibleImportMappingTargets, sortedImportAvailableHeaders,
    analyzeImportFile, importBackdatedExcel,
  } = importModal;

  // Destructure export modal
  const {
    exportModalOpen, setExportModalOpen, exportWorking, exportError,
    exportFields, selectedExportFieldKeys, exportFieldSearch, setExportFieldSearch,
    visibleExportFields, selectedExportFieldSet,
    closeExportModal, toggleExportField, selectAllVisibleExportFields,
    clearVisibleExportFields, exportFilteredSubmissions,
  } = exportModal;

  // ── Composite flags ───────────────────────────────────────────────────────
  const isAnyAdminModalOpen = isDetailModalOpen || backdatedOpen || cleanupOpen || importModalOpen || exportModalOpen;

  // ── Notifications (depends on isAnyAdminModalOpen) ────────────────────────
  const { submissionToasts } = useAdminNotifications({
    loadRows, openId, openDetail, isAnyAdminModalOpen, setNotice,
  });

  // ── Filter effects ────────────────────────────────────────────────────────
  useEffect(() => {
    loadRows(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const statusSelectionMode = areAllStatusesSelected(filters.statuses, runtimeStatusFilterOptions)
      ? 'all'
      : 'custom';
    window.localStorage.setItem(
      adminFiltersStorageKey,
      JSON.stringify({ ...filters, statusSelectionMode }),
    );
    window.localStorage.setItem(adminRetiredFilterStorageKey, filters.retiredFilter || 'non_retired');
  }, [filters, runtimeStatusFilterOptions]);

  // ── Row-derived memos ─────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const newFormSubmissionsCount = useMemo(
    () => rows.filter((row) => row.status === 'New' && row.created_via === 'rep_form').length,
    [rows],
  );

  const impactTotals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.policyPremiumImpact += toNumeric(row.policy_premium_impact);
        acc.directDollarImpact += toNumeric(row.direct_dollar_impact);
        acc.policiesAffectedCount += toNumeric(row.policies_affected_count);
        return acc;
      },
      { policyPremiumImpact: 0, directDollarImpact: 0, policiesAffectedCount: 0 },
    );
  }, [rows]);

  useEffect(() => { setPage(1); }, [rows]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = useMemo(
    () => pageSize === 0 ? rows : rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  // ── Quick-update handlers (need both rows + detail modal state) ───────────
  async function updateStatusQuick(submissionId, status, rowContext = null) {
    try {
      setError('');
      const nextStatus = status === cleanupOnlyStatus ? 'New' : status;
      const nextCleanupTagType = status === cleanupOnlyStatus
        ? 'cleanup_only'
        : (rowContext?.cleanup_tag_type === 'cleanup_only'
          ? (rowContext?.type === 'enhancement' ? 'enhancement' : 'defect')
          : rowContext?.cleanup_tag_type);
      const payload = status === cleanupOnlyStatus
        ? {
          status: 'New',
          is_cleanup: true,
          cleanup_status: rowContext?.cleanup_status || statusToCleanup[rowContext?.status] || 'New',
          cleanup_tag_type: 'cleanup_only',
          type: 'defect',
        }
        : {
          status,
          ...(rowContext?.cleanup_tag_type === 'cleanup_only'
            ? { cleanup_tag_type: rowContext?.type === 'enhancement' ? 'enhancement' : 'defect' }
            : {}),
        };

      setRows((prev) =>
        prev.map((row) => {
          if (Number(row.id) !== Number(submissionId)) return row;
          return normalizeAdminRow({
            ...row,
            status: nextStatus,
            defect_enhancement_status: nextStatus,
            ...(status === cleanupOnlyStatus
              ? { is_cleanup: true, cleanup_status: row.cleanup_status || statusToCleanup[row.status] || 'New', cleanup_tag_type: 'cleanup_only', type: 'defect' }
              : { ...(row.cleanup_tag_type === 'cleanup_only' ? { cleanup_tag_type: row.type === 'enhancement' ? 'enhancement' : 'defect' } : {}) }),
          });
        }),
      );

      const saved = await api.updateAdminSubmission(submissionId, payload);
      if (saved?.id) {
        setRows((prev) =>
          prev.map((row) => (
            Number(row.id) === Number(saved.id)
              ? normalizeAdminRow({
                ...row, ...saved, status: nextStatus, defect_enhancement_status: nextStatus,
                ...(status === cleanupOnlyStatus ? { is_cleanup: true, type: 'defect' } : {}),
                ...(nextCleanupTagType ? { cleanup_tag_type: nextCleanupTagType } : {}),
              })
              : row
          )),
        );
        if (Number(openId) === Number(saved.id)) await openDetail(saved.id, true);
      }
      setNotice(status === cleanupOnlyStatus ? 'Marked as Cleanup Only.' : 'Status updated.');
    } catch (updateError) {
      await loadRows();
      setError(updateError.message);
    }
  }

  async function updateCleanupStatusQuick(submissionId, cleanupStatus, rowContext = null) {
    const isNoCleanup = cleanupStatus === 'No Cleanup';
    const preservedCleanupTagType =
      rowContext?.cleanup_tag_type || (rowContext?.type === 'enhancement' ? 'enhancement' : 'defect');
    setRows((prev) =>
      prev.map((row) => {
        if (Number(row.id) !== Number(submissionId)) return row;
        return { ...row, is_cleanup: !isNoCleanup, cleanup_status: isNoCleanup ? null : cleanupStatus, cleanup_tag_type: isNoCleanup ? null : (row.cleanup_tag_type || preservedCleanupTagType) };
      }),
    );
    if (Number(openId) === Number(submissionId)) {
      setEdit((prev) => {
        if (!prev) return prev;
        return { ...prev, is_cleanup: !isNoCleanup, cleanup_status: isNoCleanup ? '' : cleanupStatus, cleanup_tag_type: isNoCleanup ? '' : (prev.cleanup_tag_type || (prev.type === 'enhancement' ? 'enhancement' : 'defect')) };
      });
    }
    try {
      setError('');
      const payload = { is_cleanup: !isNoCleanup, cleanup_status: isNoCleanup ? null : cleanupStatus };
      payload.cleanup_tag_type = isNoCleanup ? null : preservedCleanupTagType;
      const saved = await api.updateAdminSubmission(submissionId, payload);
      if (saved?.id) {
        setRows((prev) => prev.map((row) => (Number(row.id) === Number(saved.id) ? normalizeAdminRow({ ...row, ...saved }) : row)));
        if (Number(openId) === Number(saved.id)) await openDetail(saved.id, true);
      }
      setNotice(isNoCleanup ? 'Cleanup status cleared.' : 'Cleanup status updated.');
    } catch (updateError) {
      setError(updateError.message);
      await loadRows();
      if (Number(openId) === Number(submissionId)) await openDetail(submissionId);
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

  // ── Sorting ───────────────────────────────────────────────────────────────
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

  async function logout() {
    await api.logout();
    onLogout();
  }

  return (
    <div className="stack">
      {/* ── Page header ── */}
      <div className="admin-header-row">
        <div className="page-header admin-page-header" style={{ marginBottom: 0 }}>
          <h2>Admin Queue</h2>
          <p>Signed in as <strong>{user.username}</strong></p>
        </div>
        <div className="bs-actions admin-header-actions">
          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              analyzeImportFile(file);
            }}
          />
          <Button
            kind="secondary"
            disabled={importWorking}
            onClick={() => {
              setImportStatusText('');
              setImportStatusKind('');
              setImportModalOpen(true);
            }}
          >
            {importWorking ? 'Importing…' : 'Import Excel (.xlsx)'}
          </Button>
          <Button
            kind="secondary"
            disabled={exportWorking}
            onClick={() => {
              setExportError('');
              setExportFieldSearch('');
              setExportModalOpen(true);
            }}
          >
            {exportWorking ? 'Exporting…' : 'Export Excel (.xlsx)'}
          </Button>
          <Button
            kind="secondary"
            onClick={() => {
              setBackdatedError('');
              resetBackdatedForm();
              setBackdatedOpen(true);
            }}
          >
            Add Backdated Ticket
          </Button>
          <Button
            kind="secondary"
            onClick={() => {
              setCleanupError('');
              resetCleanupForm();
              setCleanupOpen(true);
            }}
          >
            Add Cleanup Task
          </Button>
          <Button kind="secondary" onClick={() => navigate('/admin/metadata')}>Manage Metadata</Button>
          <Button kind="ghost" onClick={logout}>Sign Out</Button>
        </div>
      </div>

      {/* ── New submissions alert card ── */}
      {newFormSubmissionsCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 18px',
          borderRadius: 8,
          background: 'var(--color-primary)',
          color: '#fff',
          fontWeight: 600,
          fontSize: 14,
        }}>
          <span style={{
            background: 'rgba(255,255,255,0.25)',
            borderRadius: '50%',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 800,
            flexShrink: 0,
          }}>{newFormSubmissionsCount}</span>
          <span style={{ flex: 1 }}>
            {newFormSubmissionsCount === 1
              ? '1 new form submission is awaiting review'
              : `${newFormSubmissionsCount} new form submissions are awaiting review`}
          </span>
          <button
            type="button"
            onClick={() => {
              setFilters((prev) => ({ ...prev, statuses: ['New'], createdVia: 'rep_form' }));
              setTimeout(() => {
                document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 100);
            }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.5)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              padding: '5px 14px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            View New Submissions
          </button>
        </div>
      )}

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

      {!isAnyAdminModalOpen && error && <Notice text={error} />}
      {!isAnyAdminModalOpen && notice && <Notice text={notice} kind="success" />}

      <Card>
        {/* ── Filters ── */}
        <div className="filters-bar">
          <MultiSelectDropdown
            label="Defect/Enhancement Status"
            options={runtimeStatusFilterOptions}
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
              }));
            }}
          >
            <option value="non_retired">Non-Retired Only</option>
            <option value="retired_only">Retired Only</option>
            <option value="all">Show All</option>
          </Select>
          <MultiSelectDropdown
            label="Type"
            options={runtimeTypeFilterOptions}
            selectedValues={filters.types}
            onChange={(nextTypes) => setFilters((prev) => ({ ...prev, types: nextTypes }))}
            placeholder="All types"
          />
          <Select
            label="Cleanup Required"
            value={filters.cleanupRequired}
            onChange={(e) => setFilters((prev) => ({ ...prev, cleanupRequired: e.target.value }))}
          >
            <option value="">Show All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
          <MultiSelectDropdown
            label="Cleanup Status"
            options={dynamicCleanupStatuses}
            selectedValues={filters.cleanupStatuses}
            onChange={(nextCleanupStatuses) => setFilters((prev) => ({ ...prev, cleanupStatuses: nextCleanupStatuses }))}
            placeholder="All cleanup statuses"
          />
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
          <Select
            label="Created Via"
            value={filters.createdVia}
            onChange={(e) => setFilters((prev) => ({ ...prev, createdVia: e.target.value }))}
          >
            <option value="">All sources</option>
            {runtimeCreatedViaOptions.map((sourceOption) => (
              <option key={sourceOption} value={sourceOption}>{formatCreatedViaLabel(sourceOption)}</option>
            ))}
          </Select>
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
            label="EASYVISTA #"
            placeholder="e.g. EV-123456"
            value={filters.easyvistaNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, easyvistaNumber: e.target.value }))}
          />
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
              setFilters({
                ...buildDefaultFilters(),
                statuses: runtimeStatusFilterOptions.length > 0 ? [...runtimeStatusFilterOptions] : [],
              });
            }}
          >
            Reset Saved Filters
          </Button>
        </div>

        {loading && <p className="muted">Loading…</p>}

        {/* ── Pagination controls ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {rows.length === 0
              ? 'No results'
              : pageSize === 0
                ? `Showing all ${rows.length} item(s)`
                : `Showing ${Math.min((page - 1) * pageSize + 1, rows.length)}–${Math.min(page * pageSize, rows.length)} of ${rows.length}`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
            <label style={{ fontSize: 13, color: 'var(--color-muted)' }}>Per page:</label>
            <select
              className="bs-inline-select"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              <option value={50}>50</option>
              <option value={75}>75</option>
              <option value={100}>100</option>
              <option value={0}>All</option>
            </select>
            {pageSize !== 0 && (
              <>
                <button
                  type="button"
                  className="bs-page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >&#8592;</button>
                <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
                <button
                  type="button"
                  className="bs-page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >&#8594;</button>
              </>
            )}
          </div>
        </div>

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
                {sortTh('easyvista',        'EasyVista',          { width: 110 })}
                {sortTh('jiraCard',         'JIRA Card #',        { width: 140, minWidth: 140 })}
                {sortTh('policyPremium',    'Policy Premium ($)', { width: 160 })}
                {sortTh('directImpact',     'Direct Impact ($)',  { width: 160 })}
                {sortTh('policiesImpacted', 'Policies Impacted',  { width: 140 })}
                {sortTh('frequency',        'Frequency',          { width: 160 })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={13} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 12px' }}>No submissions match the current filters.</td></tr>
              )}
              {pagedRows.map((row) => (
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
                      {runtimeStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 170 }}>
                    <select
                      className="bs-inline-select"
                      aria-label={`Update cleanup status for #${row.id}`}
                      value={row.is_cleanup ? (row.cleanup_status || statusToCleanup[row.status] || 'New') : 'No Cleanup'}
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
                      {runtimeCleanupInlineStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
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
                  <td className="muted">{row.easyvista_ticket_id || '—'}</td>
                  <td style={{ minWidth: 140 }}>
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
                  <td>{formatCurrency(row.policy_premium_impact)}</td>
                  <td>{formatCurrency(row.direct_dollar_impact)}</td>
                  <td>{formatNumber(row.policies_affected_count)}</td>
                  <td>
                    {row.occurrence_count && row.occurrence_timeframe
                      ? `${row.occurrence_count} per ${row.occurrence_timeframe_count > 1 ? `${row.occurrence_timeframe_count} ` : ''}${row.occurrence_timeframe}${row.occurrence_timeframe_count > 1 ? 's' : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={cleanupOpen}
        onClose={() => {
          setCleanupError('');
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
              {dynamicCleanupStatuses.map((status) => (
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
              {dynamicCleanupTagTypes.map((option) => (
                <option key={option} value={option}>{formatMetaTypeLabel(option)}</option>
              ))}
            </Select>

            <Input
              label="Requester Name"
              value={cleanupForm.created_by}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, created_by: e.target.value }))}
            />

            <Select
              label="Created Via"
              value={cleanupForm.created_via}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, created_via: e.target.value }))}
            >
              {runtimeCreatedViaOptions.map((sourceOption) => (
                <option key={sourceOption} value={sourceOption}>{formatCreatedViaLabel(sourceOption)}</option>
              ))}
            </Select>

            <Select
              label="Application"
              value={cleanupForm.application_name}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, application_name: e.target.value }))}
            >
              {dynamicApplications.map((application) => (
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
                  {dynamicEnhancementRequestTypes.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
                <Select
                  label="Priority Level"
                  value={cleanupForm.priority_level}
                  onChange={(e) => setCleanupForm((prev) => ({ ...prev, priority_level: e.target.value }))}
                >
                  {dynamicPriorityLevels.map((option) => (
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

          {cleanupError && <Notice text={cleanupError} />}

          <div className="bs-actions">
            <Button type="button" onClick={createCleanupTask} disabled={cleanupWorking}>Save Changes</Button>
            <Button
              kind="ghost"
              type="button"
              onClick={() => {
                setCleanupError('');
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
        open={exportModalOpen}
        onClose={closeExportModal}
        title="Export to Excel"
      >
        <div className="stack">
          <p className="muted" style={{ marginTop: 0 }}>
            Exports currently filtered admin items. Choose which fields to include in the spreadsheet.
          </p>

          <Input
            label="Search fields"
            placeholder="Filter by field name"
            value={exportFieldSearch}
            onChange={(event) => setExportFieldSearch(event.target.value)}
          />

          <div className="bs-actions" style={{ marginTop: 0 }}>
            <Button type="button" kind="ghost" onClick={selectAllVisibleExportFields} disabled={exportWorking || visibleExportFields.length === 0}>
              Select Visible
            </Button>
            <Button type="button" kind="ghost" onClick={clearVisibleExportFields} disabled={exportWorking || visibleExportFields.length === 0}>
              Clear Visible
            </Button>
          </div>

          {exportError && <Notice text={exportError} />}

          <Card title={`Fields (${selectedExportFieldKeys.length} selected)`}>
            <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
              {visibleExportFields.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No fields match the current search.</p>
              ) : (
                <div className="stack" style={{ gap: 8 }}>
                  {visibleExportFields.map((field) => {
                    const fieldKey = String(field?.key || '').trim();
                    const checked = selectedExportFieldSet.has(fieldKey);
                    return (
                      <label key={fieldKey} className="toggle-row" style={{ cursor: exportWorking ? 'default' : 'pointer', justifyContent: 'flex-start', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleExportField(fieldKey)}
                          disabled={exportWorking}
                        />
                        <span>{field.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <div className="bs-actions">
            <Button type="button" onClick={exportFilteredSubmissions} disabled={exportWorking || selectedExportFieldKeys.length === 0}>
              {exportWorking ? 'Exporting…' : 'Download Excel'}
            </Button>
            <Button type="button" kind="ghost" onClick={closeExportModal} disabled={exportWorking}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={importModalOpen}
        onClose={() => {
          if (importWorking) return;
          setImportModalOpen(false);
          setImportAvailableHeaders([]);
          setImportMappingTargets([]);
          setImportColumnMappings({});
          setPendingImportFile(null);
          setImportStatusText('');
          setImportStatusKind('');
          setImportResultErrors([]);
          setImportSummary(null);
          setImportAction('');
          setImportRequiresApplicationDefault(false);
          setImportDefaultApplicationName('');
          setImportUnknownStatuses([]);
          setImportAllowedStatuses([]);
          setImportStatusValueMappings({});
        }}
        title="Import Excel (.xlsx)"
      >
        <div className="stack">
          {importStatusText && <Notice text={importStatusText} kind={importStatusKind === 'success' ? 'success' : undefined} />}

          <p className="muted" style={{ marginTop: 0 }}>
            Choose import type, upload file, then review detected column mappings before importing.
          </p>

          {importHistory.length > 0 && (
            <Card title="Recent Upload Results">
              <div className="stack import-history-list" style={{ gap: 10 }}>
                {importHistory.map((entry) => (
                  <details key={entry.id} className="import-history-item">
                    <summary>
                      {new Date(entry.created_at || entry.createdAt || Date.now()).toLocaleString()} · {String(entry.import_mode || entry.mode || '').toUpperCase()} · {entry.file_name || entry.fileName}
                    </summary>
                    <div className="stack" style={{ gap: 6 }}>
                      <p style={{ margin: 0 }}>{entry.summary_message || entry.message}</p>
                      {entry.errors?.length > 0 && (
                        <div className="import-history-errors">
                          <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 18 }}>
                            {entry.errors.map((line, idx) => (
                              <li key={`${entry.id}-err-${idx}`}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          )}

          <Select
            label="Import As"
            value={importMode}
            onChange={(event) => setImportMode(event.target.value)}
          >
            <option value="">Select type</option>
            <option value="defect">Defect</option>
            <option value="enhancement">Enhancement</option>
            <option value="cleanup">Cleanup</option>
          </Select>

          {pendingImportFile && (
            <p className="muted" style={{ marginTop: 0 }}>
              Selected file: <strong>{pendingImportFile.name}</strong>
            </p>
          )}

          {importAvailableHeaders.length > 0 && (
            <p className="muted" style={{ marginTop: 0 }}>
              Detected columns: {importAvailableHeaders.join(', ')}
            </p>
          )}

          {importRequiresApplicationDefault && (
            <Select
              label="Default Application (required)"
              value={importDefaultApplicationName}
              onChange={(event) => setImportDefaultApplicationName(event.target.value)}
            >
              <option value="">Select application</option>
              <option value="Billing Center">Billing Center</option>
              <option value="Policy Center">Policy Center</option>
            </Select>
          )}

          {importUnknownStatuses.length > 0 && (
            <Card title="Map Unknown Status Values">
              <div className="bs-grid two">
                {importUnknownStatuses.map((statusValue) => (
                  <Select
                    key={statusValue}
                    label={`Status in file: ${statusValue}`}
                    value={importStatusValueMappings[statusValue] || ''}
                    onChange={(event) => {
                      const mappedStatus = event.target.value;
                      setImportStatusValueMappings((prev) => ({
                        ...(prev || {}),
                        [statusValue]: mappedStatus,
                      }));
                    }}
                  >
                    <option value="">Select DB status</option>
                    {[...(importAllowedStatuses.length > 0 ? importAllowedStatuses : [...dynamicStatuses, retiredStatus])]
                      .sort((left, right) => String(left || '').localeCompare(String(right || '')))
                      .map((allowedStatus) => (
                      <option key={`${statusValue}-${allowedStatus}`} value={allowedStatus}>{allowedStatus}</option>
                      ))}
                  </Select>
                ))}
              </div>
            </Card>
          )}

          {importAction && (
            <p className="muted" style={{ marginTop: 0 }}>
              {importAction === 'analyzing' ? 'Analyzing file...' : 'Importing records...'}
            </p>
          )}

          {importSummary && (
            <p className="muted" style={{ marginTop: 0 }}>
              Result: Imported {importSummary.imported} of {importSummary.total}; Skipped {importSummary.invalid}.
            </p>
          )}

          {importResultErrors.length > 0 && (
            <div>
              <p className="muted" style={{ marginTop: 0, marginBottom: 6 }}>Row errors (first {importResultErrors.length}):</p>
              <ul style={{ marginTop: 0, paddingLeft: 18 }}>
                {importResultErrors.map((line, index) => (
                  <li key={`${line}-${index}`} style={{ marginBottom: 4 }}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {importMappingTargets.length > 0 && (
            <div className="import-mapping-scroll">
              <div className="bs-grid two">
                {sortedImportAvailableHeaders.map((header) => (
                <Select
                  key={header}
                  label={`Column: ${header}`}
                  value={importTargetByHeader[header] || ''}
                  onChange={(event) => {
                    const selectedTargetKey = event.target.value;
                    setImportColumnMappings((prev) => {
                      const next = { ...(prev || {}) };
                      let currentTargetForHeader = '';

                      for (const [targetKey, mappedHeader] of Object.entries(next)) {
                        if (String(mappedHeader || '').trim() === header) {
                          currentTargetForHeader = targetKey;
                          break;
                        }
                      }

                      if (currentTargetForHeader) {
                        delete next[currentTargetForHeader];
                      }

                      if (!selectedTargetKey) {
                        return next;
                      }

                      for (const [targetKey, mappedHeader] of Object.entries(next)) {
                        if (targetKey !== selectedTargetKey && String(mappedHeader || '').trim() === header) {
                          delete next[targetKey];
                        }
                      }

                      next[selectedTargetKey] = header;
                      return next;
                    });
                  }}
                >
                  <option value="">Not mapped</option>
                  {visibleImportMappingTargets.map((target) => (
                    <option key={`${header}-${target.key}`} value={target.key}>{target.label}</option>
                  ))}
                </Select>
                ))}
              </div>
            </div>
          )}

          <div className="bs-actions">
            <Button
              type="button"
              onClick={() => {
                setImportStatusText('');
                setImportStatusKind('');
                if (pendingImportFile) {
                  if (importRequiresApplicationDefault && !importDefaultApplicationName) {
                    setImportStatusText('Select a default application before importing.');
                    setImportStatusKind('error');
                    return;
                  }
                  if (importUnknownStatuses.some((statusValue) => !String(importStatusValueMappings[statusValue] || '').trim())) {
                    setImportStatusText('Map all unknown statuses before importing.');
                    setImportStatusKind('error');
                    return;
                  }
                  importBackdatedExcel(pendingImportFile);
                  return;
                }
                importFileInputRef.current?.click();
              }}
              disabled={importWorking || !importMode}
            >
              {importWorking ? 'Working…' : (pendingImportFile ? 'Import File' : 'Choose Excel File')}
            </Button>
            <Button
              type="button"
              kind="ghost"
              onClick={() => {
                setImportModalOpen(false);
                setImportAvailableHeaders([]);
                setImportMappingTargets([]);
                setImportColumnMappings({});
                setPendingImportFile(null);
                setImportStatusText('');
                setImportStatusKind('');
                setImportResultErrors([]);
                setImportSummary(null);
                setImportAction('');
                setImportRequiresApplicationDefault(false);
                setImportDefaultApplicationName('');
                setImportUnknownStatuses([]);
                setImportAllowedStatuses([]);
                setImportStatusValueMappings({});
              }}
              disabled={importWorking}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={backdatedOpen}
        onClose={() => {
          setBackdatedError('');
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
              {dynamicStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </Select>

            <Input
              label="Requester Name"
              required
              value={backdatedForm.created_by}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_by: e.target.value }))}
            />

            <Select
              label="Created Via"
              value={backdatedForm.created_via}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_via: e.target.value }))}
            >
              {runtimeCreatedViaOptions.map((sourceOption) => (
                <option key={sourceOption} value={sourceOption}>{formatCreatedViaLabel(sourceOption)}</option>
              ))}
            </Select>

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
              {dynamicApplications.map((application) => (
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

          {backdatedError && <Notice text={backdatedError} />}

          <div className="bs-actions">
            <Button type="button" onClick={createBackdatedTicket} disabled={backdatedWorking}>Create Backdated Ticket</Button>
            <Button
              kind="ghost"
              type="button"
              onClick={() => {
                setBackdatedError('');
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
          clearPendingAttachmentDrafts();
          setOpenId(null);
          setModalTopNotice('');
          setModalBottomNotice('');
          setDetailError('');
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
                        ? (p.cleanup_status || statusToCleanup[p.status] || 'New')
                        : p.cleanup_status,
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
                {dynamicCleanupTagTypes.map((option) => {
                  if (!edit.is_cleanup && option === 'cleanup_only') {
                    return null;
                  }
                  return <option key={option} value={option}>{formatMetaTypeLabel(option)}</option>;
                })}
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
                {runtimeStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select
                label="Cleanup Status"
                value={edit.cleanup_status || 'New'}
                onChange={(e) => setEdit((p) => ({ ...p, cleanup_status: e.target.value }))}
                disabled={!edit.is_cleanup}
              >
                {dynamicCleanupStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Input label="Reviewer" value={edit.reviewer} onChange={(e) => setEdit((p) => ({ ...p, reviewer: e.target.value }))} />
              <Input label="Duplicate Reference (EasyVista / JIRA / ID)" value={edit.duplicate_of} onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))} />
              <Input
                label="Submitted to EV By"
                value={edit.easyvista_submitted_by}
                readOnly={isAutoEasyVistaReporter(edit.easyvista_submitted_by)}
                onChange={(e) => setEdit((p) => ({ ...p, easyvista_submitted_by: e.target.value }))}
                placeholder="Unknown"
              />
              <Input
                label="Created Via"
                value={formatCreatedViaLabel(edit.created_via || detail.created_via || '')}
                readOnly
                placeholder="—"
              />
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

            {/* ── Submission details ── */}
            <p className="section-label">Submission Details</p>
            <Input label="Summary" value={edit.summary_of_issue} onChange={(e) => setEdit((p) => ({ ...p, summary_of_issue: e.target.value }))} />
            <div className="bs-grid two">
              <Input label="Reported Date" value={formatDateOnly(detail.created_at)} readOnly />
              <Input label="Requester Name" value={detail.created_by || ''} readOnly />
            </div>

            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>More Submission Details</summary>
              <div className="bs-form" style={{ marginTop: 12 }}>
                {(effectiveType === 'defect' || !effectiveType) && (
                  <Input label="Date / Time of Error" type="datetime-local" value={edit.date_time_of_error} onChange={(e) => setEdit((p) => ({ ...p, date_time_of_error: e.target.value }))} />
                )}
                {effectiveType === 'enhancement' && (
                  <Input label="Desired Completion Date" type="date" value={edit.desired_completion_date} onChange={(e) => setEdit((p) => ({ ...p, desired_completion_date: e.target.value }))} />
                )}
                {(effectiveType === 'defect' || !effectiveType) && (
                  <Textarea label="Exact Details / What Happened" rows={3} value={edit.what_happened_exact_details} onChange={(e) => setEdit((p) => ({ ...p, what_happened_exact_details: e.target.value }))} />
                )}
                {effectiveType === 'enhancement' && (
                  <Textarea label="Request Details" rows={3} value={edit.request} onChange={(e) => setEdit((p) => ({ ...p, request: e.target.value }))} />
                )}
                {(effectiveType === 'defect' || !effectiveType) && (
                  <Textarea label="Steps to Reproduce" rows={3} value={edit.steps_to_reproduce} onChange={(e) => setEdit((p) => ({ ...p, steps_to_reproduce: e.target.value }))} />
                )}
                <div className="bs-grid two">
                  <Select
                    label="Application"
                    value={edit.application_name || 'Billing Center'}
                    onChange={(e) => setEdit((p) => ({ ...p, application_name: e.target.value }))}
                  >
                    {dynamicApplications.map((application) => (
                      <option key={application} value={application}>{application}</option>
                    ))}
                  </Select>
                  <Input label="Policy #" value={edit.policy_num} onChange={(e) => setEdit((p) => ({ ...p, policy_num: e.target.value }))} />
                  <Input label="Account #" value={edit.account_num} onChange={(e) => setEdit((p) => ({ ...p, account_num: e.target.value }))} />
                  <Input label="Transaction #" value={edit.transaction_num} onChange={(e) => setEdit((p) => ({ ...p, transaction_num: e.target.value }))} />
                  <Input label="Fingerprint" value={edit.fingerprint} onChange={(e) => setEdit((p) => ({ ...p, fingerprint: e.target.value }))} />
                </div>
                <Input label="Screen Title" value={edit.screen_title} onChange={(e) => setEdit((p) => ({ ...p, screen_title: e.target.value }))} />
              </div>
            </details>

            {/* ── Description As Submitted To EasyVista ── */}
            {detail.easyvista_ticket_id && isAutoEasyVistaReporter(detail.easyvista_submitted_by) && (() => {
              const evDesc = [
                `Type: ${detail.type || ''}`,
                `Application: ${detail.application_name || ''}`,
                `Created By: ${detail.created_by || ''} (${detail.created_by_email || ''})`,
                `Policy #: ${detail.policy_num || 'N/A'}`,
                `Account #: ${detail.account_num || 'N/A'}`,
                `Transaction #: ${detail.transaction_num || 'N/A'}`,
                `Screen Title: ${detail.screen_title || ''}`,
                `Date/Time of Error: ${detail.date_time_of_error || ''}`,
                `Desired Completion Date: ${detail.desired_completion_date || 'N/A'}`,
                `Enhancement Request Type: ${detail.enhancement_request_type || 'N/A'}`,
                `Priority Level: ${detail.priority_level || 'N/A'}`,
                `JIRA Number: ${detail.jira_number || 'N/A'}`,
                '',
                'Summary:',
                detail.summary_of_issue || '',
                '',
                'Steps to Reproduce:',
                detail.steps_to_reproduce || '',
                '',
                'What Happened (Exact Details):',
                `${detail.created_by || 'Requester'} submitted the following:`,
                detail.what_happened_exact_details || '',
                '',
                'Request:',
                detail.request || '',
                '',
                'Impact Details:',
                detail.impact_details || 'N/A',
              ].join('\n');
              return (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-primary)' }}>
                    As Submitted To EasyVista
                  </summary>
                  <Card className="inner" style={{ marginTop: 10 }}>
                    <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text)', background: 'var(--color-surface)', padding: 12, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                      {evDesc}
                    </pre>
                  </Card>
                </details>
              );
            })()}

            <p className="section-label">Status Timeline</p>
            <Card className="inner">
              {!detail.status_events || detail.status_events.length === 0 ? (
                <p className="muted">No status history found.</p>
              ) : (
                <div className="bs-form" style={{ gap: 10 }}>
                  <div style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                    <p style={{ margin: 0 }}>
                      <strong>{formatTimelineStatus(detail.status_events[0].status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}</strong> on {formatDateTime(detail.status_events[0].changed_at)}
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
                              <strong>{formatTimelineStatus(event.status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}</strong> on {formatDateTime(event.changed_at)}
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

            <p style={{ fontWeight: 600, margin: '14px 0 6px' }}>Frequency</p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 12,
              }}
            >
              <Input
                label="# of Occurrences"
                type="number"
                step="1"
                min="0"
                value={edit.occurrence_count}
                onChange={(e) => setEdit((p) => ({ ...p, occurrence_count: e.target.value }))}
              />
              <Input
                label="Per How Many"
                type="number"
                step="1"
                min="1"
                value={edit.occurrence_timeframe_count}
                onChange={(e) => setEdit((p) => ({ ...p, occurrence_timeframe_count: e.target.value }))}
              />
              <Select
                label="Time Frame"
                value={edit.occurrence_timeframe}
                onChange={(e) => setEdit((p) => ({ ...p, occurrence_timeframe: e.target.value }))}
              >
                <option value="">Select</option>
                {dynamicOccurrenceTimeframes.map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </Select>
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
                        {dynamicEnhancementRequestTypes.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Select label="Priority Level" value={edit.priority_level} onChange={(e) => setEdit((p) => ({ ...p, priority_level: e.target.value }))}>
                        {dynamicPriorityLevels.map((o) => <option key={o} value={o}>{o}</option>)}
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
                {visibleAttachments.length > 0 && (
                  <div className="thumb-grid">
                    {visibleAttachments.map((att) => (
                      <article key={att.id} className="thumb-item">
                        {att._isPendingUpload ? (
                          att.mime_type?.startsWith('image/') && att.preview_url ? (
                            <button
                              type="button"
                              className="thumb-open-btn"
                              onClick={() => setPreviewAttachment(att)}
                            >
                              <img src={att.preview_url} alt={att.filename} />
                            </button>
                          ) : (
                            <span className="file-link">{att.filename}</span>
                          )
                        ) : att.mime_type?.startsWith('image/') ? (
                          <button type="button" className="thumb-open-btn" onClick={() => setPreviewAttachment(att)}>
                            <img src={resolveAttachmentUrl(att.file_path)} alt={att.filename} />
                          </button>
                        ) : (
                          <a href={resolveAttachmentUrl(att.file_path)} target="_blank" rel="noreferrer" className="file-link">{att.filename}</a>
                        )}
                        <div className="thumb-meta">
                          <span className="thumb-name">{att.filename}</span>
                          {att._isPendingUpload ? (
                            <Badge tone="warning">Pending upload</Badge>
                          ) : att._isMarkedForRemoval ? (
                            <Badge tone="danger">Pending removal</Badge>
                          ) : null}
                          <Button
                            kind="danger"
                            onClick={() => deleteAttachment(att)}
                          >
                            {att._isPendingUpload
                              ? 'Discard'
                              : att._isMarkedForRemoval
                                ? 'Undo Remove'
                                : 'Remove'}
                          </Button>
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
            {modalBottomNotice && <Notice text={modalBottomNotice} kind="success" />}
            {easyVistaConfirmation && <Notice text={easyVistaConfirmation} kind="success" />}
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
            src={previewAttachment._isPendingUpload
              ? previewAttachment.preview_url
              : resolveAttachmentUrl(previewAttachment.file_path)}
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

      {/* ── New submission toast overlay ── */}
      {submissionToasts.length > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'none',
        }}>
          {submissionToasts.map((t) => (
            <div
              key={t.id}
              style={{
                pointerEvents: 'auto',
                background: 'var(--color-primary)',
                color: '#fff',
                borderRadius: 10,
                padding: '14px 18px',
                minWidth: 280,
                maxWidth: 360,
                boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>&#128202;</span> New Submission
              </div>
              <div style={{ fontSize: 13, opacity: 0.95, lineHeight: 1.4 }}>{t.heading}</div>
              {(t.from || t.type) && (
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {[t.from && `From: ${t.from}`, t.type && `Type: ${t.type}`].filter(Boolean).join(' · ')}
                </div>
              )}
              <button
                onClick={() => setSubmissionToasts((prev) => prev.filter((x) => x.id !== t.id))}
                style={{
                  alignSelf: 'flex-end',
                  marginTop: 4,
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  borderRadius: 4,
                  color: '#fff',
                  fontSize: 11,
                  padding: '2px 8px',
                  cursor: 'pointer',
                }}
              >Dismiss</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
