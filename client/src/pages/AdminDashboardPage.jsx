import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, Notice } from '../components/bite-size/BitsizeUI';

// ── Constants & utilities ───────────────────────────────────────────────────
import {
  CLEANUP_ONLY_STATUS,
  STATUS_TO_CLEANUP,
  ADMIN_FILTERS_STORAGE_KEY,
  ADMIN_RETIRED_FILTER_STORAGE_KEY,
} from '../constants/adminConstants';
import { toNumeric } from '../utils/formatUtils';
import {
  areAllStatusesSelected,
  buildDefaultFilters,
  defaultFilters,
} from '../utils/filterUtils';
import { normalizeAdminRow } from '../utils/mappers';

// ── Custom hooks ────────────────────────────────────────────────────────────
import { useAdminMeta } from '../hooks/useAdminMeta';
import { useAdminNotifications } from '../hooks/useAdminNotifications';
import { useDetailModal } from '../hooks/useDetailModal';
import { useTicketPresence } from '../hooks/useTicketPresence';
import { useBackdatedModal } from '../hooks/useBackdatedModal';
import { useCleanupModal } from '../hooks/useCleanupModal';
import { useImportModal } from '../hooks/useImportModal';
import { useExportModal } from '../hooks/useExportModal';

// ── Admin sub-components ────────────────────────────────────────────────────
import {
  AdminHeader,
  NewSubmissionsAlert,
  StatTiles,
  FiltersBar,
  SubmissionsTable,
  CleanupTaskModal,
  ExportModal,
  ImportModal,
  BackdatedTicketModal,
  DetailModal,
  ToastOverlay,
  AttachmentPreviewModal,
  CleanupPreviewModal,
} from '../components/admin';

const cleanupOnlyStatus = CLEANUP_ONLY_STATUS;
const statusToCleanup = STATUS_TO_CLEANUP;

export function AdminDashboardPage({ user, onLogout }) {
  const navigate = useNavigate();

  // ── Page-level state (filters, rows, pagination, notices) ─────────────────
  const [filters, setFilters] = useState(defaultFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  // Selectable status options (assigned after `meta` resolves below) — lets the
  // baseline totals fetch use the same status scope as the default/reset view.
  const statusFilterOptionsRef = useRef([]);
  const preNewSubmissionFiltersRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [newFormSubmissionsCount, setNewFormSubmissionsCount] = useState(0);
  // Totals for the top stat row — always all non-retired items, independent of UI filters.
  const [baselineCounts, setBaselineCounts] = useState({ total: 0, statuses: {} });

  // ── Independent totals of all non-retired submissions (never depend on UI filters) ──
  // All non-retired items regardless of status (no status whitelist), matching what
  // the default/reset table view shows.
  const loadBaselineCounts = useCallback(async () => {
    try {
      const data = await api.listAdminSubmissions(buildDefaultFilters());
      const nonRetired = (data || [])
        .map(normalizeAdminRow)
        .filter((row) => !row.is_retired);
      const statuses = {};
      for (const row of nonRetired) {
        // Cleanup-only items are displayed under "Cleanup Only", not their underlying
        // defect/enhancement status, so they don't count toward New/Approved/etc.
        // (normalizeAdminRow already defaults a blank status to 'New' for the rest.)
        if (row.is_cleanup && row.cleanup_tag_type === 'cleanup_only') continue;
        statuses[row.status] = (statuses[row.status] || 0) + 1;
      }
      setBaselineCounts({ total: nonRetired.length, statuses });
    } catch {
      // Silently ignore — tiles keep their last known totals
    }
  }, []);

  // ── Independent count of new form submissions (never depends on UI filters) ──
  const loadNewFormCount = useCallback(async () => {
    try {
      const data = await api.listAdminSubmissions({
        statuses: ['New'],
        createdVia: 'rep_form',
        retiredFilter: 'non_retired',
      });
      const normalized = (data || []).map(normalizeAdminRow);
      const count = normalized.filter(
        (r) => r.status === 'New' && r.created_via === 'rep_form' && !r.is_retired,
      ).length;
      setNewFormSubmissionsCount(count);
    } catch {
      // Silently ignore — banner just won't update
    }
  }, []);

  // ── Load rows callback (page-level so hooks can share it) ─────────────────
  const loadRows = useCallback(async (filtersParam) => {
    const f = filtersParam ?? filtersRef.current;
    try {
      setLoading(true);
      setError('');
      // When every selectable status is chosen (the default/reset state), drop the
      // status whitelist entirely so non-retired items are shown even if their own
      // status has since been retired (a retired status must not hide a live item).
      const apiFilters = areAllStatusesSelected(f.statuses, statusFilterOptionsRef.current)
        ? { ...f, statuses: [] }
        : { ...f };
      const data = await api.listAdminSubmissions(apiFilters);
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
    // Also refresh the filter-independent counts (new-form banner + top totals)
    loadNewFormCount();
    loadBaselineCounts();
  }, [loadNewFormCount, loadBaselineCounts]);

  // ── Custom hooks ──────────────────────────────────────────────────────────
  const meta = useAdminMeta({ setFilters, setNotice });
  const detailModal = useDetailModal({ loadRows, setRows, setNotice, setError, currentUsername: user?.username });
  const ticketPresence = useTicketPresence({ openId: detailModal.openId, currentUsername: user?.username });
  const backdated = useBackdatedModal({ user, loadRows, setNotice });
  const cleanup = useCleanupModal({ user, loadRows, setNotice });
  const importModal = useImportModal({ loadRows, setNotice });
  const exportModal = useExportModal({ filtersRef, setNotice });

  // Only the values used directly in the page body are destructured; the
  // DetailModal receives its full hook object via spread (see the modal JSX below).
  const {
    openId, setEdit, isDetailModalOpen, openDetail,
    previewAttachment, setPreviewAttachment,
  } = detailModal;

  // Destructure meta for convenience
  const {
    dynamicStatuses, dynamicCleanupStatuses, dynamicCleanupTagTypes,
    dynamicApplications, dynamicEnhancementRequestTypes, dynamicPriorityLevels,
    dynamicOccurrenceTimeframes,
    runtimeStatusFilterOptions, runtimeStatusOptions, runtimeCleanupInlineStatuses,
    runtimeCreatedViaOptions, runtimeTypeFilterOptions,
    dynamicCoreStatusSet, dynamicCleanupStatusSet,
  } = meta;
  // Keep the baseline-totals fetch in sync with the current selectable statuses.
  statusFilterOptionsRef.current = runtimeStatusFilterOptions;

  // Only the values used directly in the page body are destructured; each modal
  // receives its full hook object via spread (see the modal JSX below).
  const { backdatedOpen, openBackdatedModal } = backdated;

  const {
    cleanupOpen, openCleanupModal,
    cleanupPreviewIndex, setCleanupPreviewIndex, cleanupFilePreviews,
  } = cleanup;

  const {
    importFileInputRef, importModalOpen, importWorking,
    analyzeImportFile, openImportModal,
  } = importModal;

  const { exportModalOpen, exportWorking, openExportModal } = exportModal;

  // ── Composite flags ───────────────────────────────────────────────────────
  const isAnyAdminModalOpen = isDetailModalOpen || backdatedOpen || cleanupOpen || importModalOpen || exportModalOpen;

  // ── Notifications (depends on isAnyAdminModalOpen) ────────────────────────
  const { submissionToasts, setSubmissionToasts } = useAdminNotifications({
    loadRows, openId, openDetail, isAnyAdminModalOpen, setNotice,
    onRemoteUpdate: detailModal.noteRemoteUpdate,
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
      ADMIN_FILTERS_STORAGE_KEY,
      JSON.stringify({ ...filters, statusSelectionMode }),
    );
    window.localStorage.setItem(ADMIN_RETIRED_FILTER_STORAGE_KEY, filters.retiredFilter || 'non_retired');
  }, [filters, runtimeStatusFilterOptions]);

  // ── Row-derived memos ─────────────────────────────────────────────────────
  // True when filters match the "View New Submissions" preset
  const isViewingNewFormOnly = filters.statuses?.length === 1
    && filters.statuses[0] === 'New'
    && filters.createdVia === 'rep_form';

  // ── Top stat-row quick filters ────────────────────────────────────────────
  // Clicking a Row 1 tile resets to a clean non-retired view of that scope, so the
  // table matches the number on the tile.
  const selectTotalTile = () => setFilters({
    ...buildDefaultFilters(),
    statuses: runtimeStatusFilterOptions.length > 0 ? [...runtimeStatusFilterOptions] : [],
  });
  const selectStatusTile = (status) => setFilters({ ...buildDefaultFilters(), statuses: [status] });

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
      // Status changed without a full reload — refresh the top totals breakdown.
      loadBaselineCounts();
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

  async function logout() {
    await api.logout();
    onLogout();
  }

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="stack">
      <AdminHeader
        user={user}
        importFileInputRef={importFileInputRef}
        importWorking={importWorking}
        exportWorking={exportWorking}
        onOpenImport={openImportModal}
        onOpenExport={openExportModal}
        onOpenBackdated={openBackdatedModal}
        onOpenCleanup={openCleanupModal}
        onNavigateMetadata={() => navigate('/admin/metadata')}
        onLogout={logout}
        onImportFileChange={analyzeImportFile}
      />

      <NewSubmissionsAlert
        count={newFormSubmissionsCount}
        onViewNewSubmissions={() => {
          preNewSubmissionFiltersRef.current = { ...filters };
          setFilters({
            ...buildDefaultFilters(),
            statuses: ['New'],
            createdVia: 'rep_form',
            retiredFilter: 'non_retired',
          });
          setTimeout(() => {
            document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        }}
      />

      <StatTiles
        rows={rows}
        baselineCounts={baselineCounts}
        impactTotals={impactTotals}
        showActiveHint={(filters.retiredFilter || 'non_retired') !== 'non_retired'}
        onSelectTotal={selectTotalTile}
        onSelectStatus={selectStatusTile}
      />

      {!isAnyAdminModalOpen && error && <Notice text={error} />}
      {!isAnyAdminModalOpen && notice && <Notice text={notice} kind="success" />}

      <Card>
        <FiltersBar
          filters={filters}
          setFilters={setFilters}
          runtimeStatusFilterOptions={runtimeStatusFilterOptions}
          runtimeTypeFilterOptions={runtimeTypeFilterOptions}
          runtimeCreatedViaOptions={runtimeCreatedViaOptions}
          dynamicCleanupStatuses={dynamicCleanupStatuses}
          isViewingNewFormOnly={isViewingNewFormOnly}
          preNewSubmissionFiltersRef={preNewSubmissionFiltersRef}
        />

        <SubmissionsTable
          rows={rows}
          pagedRows={pagedRows}
          loading={loading}
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          setPage={setPage}
          setPageSize={setPageSize}
          filters={filters}
          setFilters={setFilters}
          loadRows={loadRows}
          openDetail={openDetail}
          updateStatusQuick={updateStatusQuick}
          updateCleanupStatusQuick={updateCleanupStatusQuick}
          updatePublicQuick={updatePublicQuick}
          updateJiraQuick={updateJiraQuick}
          runtimeStatusOptions={runtimeStatusOptions}
          runtimeCleanupInlineStatuses={runtimeCleanupInlineStatuses}
          cleanupOnlyStatus={cleanupOnlyStatus}
          statusToCleanup={statusToCleanup}
        />
      </Card>

      <CleanupTaskModal
        {...cleanup}
        dynamicCleanupStatuses={dynamicCleanupStatuses}
        dynamicCleanupTagTypes={dynamicCleanupTagTypes}
        dynamicApplications={dynamicApplications}
        dynamicEnhancementRequestTypes={dynamicEnhancementRequestTypes}
        dynamicPriorityLevels={dynamicPriorityLevels}
        runtimeCreatedViaOptions={runtimeCreatedViaOptions}
      />

      <ExportModal {...exportModal} />

      <ImportModal
        {...importModal}
        dynamicStatuses={dynamicStatuses}
      />

      <BackdatedTicketModal
        {...backdated}
        dynamicStatuses={dynamicStatuses}
        dynamicApplications={dynamicApplications}
        runtimeCreatedViaOptions={runtimeCreatedViaOptions}
      />

      <DetailModal
        {...detailModal}
        presence={ticketPresence}
        dynamicCleanupStatuses={dynamicCleanupStatuses}
        dynamicCleanupTagTypes={dynamicCleanupTagTypes}
        dynamicApplications={dynamicApplications}
        dynamicEnhancementRequestTypes={dynamicEnhancementRequestTypes}
        dynamicPriorityLevels={dynamicPriorityLevels}
        dynamicOccurrenceTimeframes={dynamicOccurrenceTimeframes}
        runtimeStatusOptions={runtimeStatusOptions}
        dynamicCoreStatusSet={dynamicCoreStatusSet}
        dynamicCleanupStatusSet={dynamicCleanupStatusSet}
      />

      <AttachmentPreviewModal
        previewAttachment={previewAttachment}
        setPreviewAttachment={setPreviewAttachment}
      />

      <CleanupPreviewModal
        cleanupPreviewIndex={cleanupPreviewIndex}
        cleanupFilePreviews={cleanupFilePreviews}
        setCleanupPreviewIndex={setCleanupPreviewIndex}
      />

      <ToastOverlay
        submissionToasts={submissionToasts}
        setSubmissionToasts={setSubmissionToasts}
      />
    </div>
  );
}
