import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { resetSocket } from '../lib/socket';
import { Card, Notice, Badge, Modal, Button } from '../components/bite-size/BitsizeUI';
import { AiSearchPanel } from '../components/common/AiSearchPanel';
import { BulkActionBar } from '../components/admin/BulkActionBar';

// ── Constants & utilities ───────────────────────────────────────────────────
import {
  CLEANUP_ONLY_STATUS,
  STATUS_TO_CLEANUP,
  ADMIN_FILTERS_STORAGE_KEY,
  ADMIN_RETIRED_FILTER_STORAGE_KEY,
  DEFAULT_VISIBLE_FILTER_KEYS,
} from '../constants/adminConstants';
import { toNumeric } from '../utils/formatUtils';
import {
  areAllStatusesSelected,
  buildDefaultFilters,
  defaultFilters,
  resetFilterValues,
} from '../utils/filterUtils';
import { normalizeAdminRow } from '../utils/mappers';

// ── Custom hooks ────────────────────────────────────────────────────────────
import { useAdminMeta } from '../hooks/useAdminMeta';
import { useAdminViewPreferences } from '../hooks/useAdminViewPreferences';
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
  CustomizeViewModal,
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
  // ── Bulk selection (single source of truth; page owns the full filtered `rows`) ──
  // A Set of selected row ids. `bulkConfirm` is null when closed, else
  // { isPublic, ids } — `ids` snapshots the confirmed selection at the moment the
  // modal opens so a background reload can't empty it before the admin confirms.
  // `applying` gates the in-flight bulk request (in-flight guard).
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [applying, setApplying] = useState(false);

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

  // ── Per-admin view preferences (visible columns/filters + column order) ────
  const viewPrefs = useAdminViewPreferences();
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const handleViewSave = useCallback((next) => {
    viewPrefs.saveView(next);
    setCustomizeOpen(false);
  }, [viewPrefs]);

  // A hidden filter must never silently constrain the table. Filter values are
  // restored from this browser's localStorage while the visible-filter set comes
  // from the server, so reconcile whenever the visible set resolves or changes
  // (covers save-time too — saveView updates viewPrefs.filters optimistically).
  useEffect(() => {
    const hiddenKeys = DEFAULT_VISIBLE_FILTER_KEYS.filter((key) => !viewPrefs.filters.includes(key));
    if (hiddenKeys.length > 0) {
      setFilters((prev) => resetFilterValues(prev, hiddenKeys));
    }
  }, [viewPrefs.filters]);

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
  const bulkConfirmOpen = bulkConfirm !== null;
  const isAnyAdminModalOpen = isDetailModalOpen || backdatedOpen || cleanupOpen || importModalOpen || exportModalOpen || customizeOpen || bulkConfirmOpen;

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

  // Clear an active bulk selection when the admin changes filters/search — a
  // selection must never straddle two different filtered sets. Keyed on
  // `filters` (mirroring the loadRows filter effect above), NOT on `rows`, so
  // benign live refreshes (socket updates, single-row quick edits, post-mutation
  // refetches) reuse the same filters and leave the selection intact. The
  // apply-time re-intersection with the current `rows` remains the hard
  // guarantee that a bulk change never touches a ticket outside the current view.
  useEffect(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [filters]);

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

  // ── Bulk visibility selection + apply ─────────────────────────────────────
  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Master checkbox: select/clear the ENTIRE filtered set (all pages), not just
  // the visible page — the flow is "filter, then select all, then apply".
  function toggleAllRows() {
    setSelectedIds((prev) => {
      const allSelected = rows.length > 0 && rows.every((row) => prev.has(row.id));
      return allSelected ? new Set() : new Set(rows.map((row) => row.id));
    });
  }

  // Open the confirmation modal with a SNAPSHOT of the confirmed ids taken at
  // click time (only ids currently in view), so a background reload can't empty
  // the selection between opening the modal and confirming.
  function openBulkConfirm(isPublic) {
    const ids = rows.filter((row) => selectedIds.has(row.id)).map((row) => Number(row.id));
    if (ids.length === 0) return;
    setBulkConfirm({ isPublic, ids });
  }

  async function applyBulkVisibility(snapshot) {
    if (applying || !snapshot) return;
    const { isPublic, ids: snapshotIds } = snapshot;
    // Re-intersect the snapshot with the CURRENT rows — the hard guarantee that a
    // bulk change never touches a ticket outside the current filtered view, even
    // if a live refresh dropped some tickets out of view since the modal opened.
    const visibleIds = new Set(rows.map((row) => Number(row.id)));
    const ids = snapshotIds.filter((id) => visibleIds.has(id));
    const label = isPublic ? 'Public' : 'Private';
    if (ids.length === 0) {
      setBulkConfirm(null);
      setNotice('');
      setError('Selection changed — nothing was applied, please re-select.');
      return;
    }
    const skipped = snapshotIds.length - ids.length;
    setApplying(true);
    try {
      setError('');
      const result = await api.bulkUpdateVisibility(ids, isPublic);
      const updated = result?.updated ?? ids.length;
      const failedCount = result?.failed?.length ?? 0;
      setSelectedIds(new Set());
      await loadRows();
      if (failedCount > 0) {
        setNotice('');
        setError(`Updated ${updated} of ${ids.length} ticket${ids.length === 1 ? '' : 's'} to ${label}; ${failedCount} could not be updated.`);
      } else {
        const skippedNote = skipped > 0 ? ` ${skipped} skipped — no longer in view.` : '';
        setNotice(`Updated ${updated} ticket${updated === 1 ? '' : 's'} to ${label}.${skippedNote}`);
      }
    } catch (bulkError) {
      setError(bulkError.message);
    } finally {
      setApplying(false);
      setBulkConfirm(null);
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
    // Drop the admin-authenticated socket so this browser stops receiving
    // admin-only events and releases any ticket presence it holds.
    resetSocket();
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

      <AiSearchPanel
        scope="admin"
        applications={dynamicApplications}
        defaultApplication="all"
        subtitle="Ask in plain language whether an issue has been reported before, and what happened to it. Searches all tickets, including internal notes."
        renderResults={(matches) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {matches.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openDetail(item.id)}
                style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--bs-border, #e2e6ee)', borderRadius: 8, padding: '10px 12px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{item.summary_of_issue || '(no summary)'}</strong>
                  {item.type && <Badge value={item.type} />}
                  {item.status && <Badge value={item.status} />}
                  {item.ai?.relevance && (
                    <Badge tone={item.ai.relevance === 'high' ? 'success' : item.ai.relevance === 'medium' ? 'info' : undefined}>
                      {item.ai.relevance}
                    </Badge>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  #{item.id} · {item.application_name || '-'} · {item.easyvista_ticket_id || 'no EV ticket'}
                </div>
                {item.ai?.why && <div style={{ fontSize: 13 }}>{item.ai.why}</div>}
              </button>
            ))}
          </div>
        )}
      />

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
          visibleFilters={viewPrefs.filters}
          onOpenCustomize={() => setCustomizeOpen(true)}
        />

        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            disabled={applying}
            onMakePublic={() => openBulkConfirm(true)}
            onMakePrivate={() => openBulkConfirm(false)}
            onClear={() => setSelectedIds(new Set())}
          />
        )}

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
          openDetail={openDetail}
          orderedVisibleColumns={viewPrefs.orderedVisibleColumns}
          updateStatusQuick={updateStatusQuick}
          updateCleanupStatusQuick={updateCleanupStatusQuick}
          updatePublicQuick={updatePublicQuick}
          updateJiraQuick={updateJiraQuick}
          runtimeStatusOptions={runtimeStatusOptions}
          runtimeCleanupInlineStatuses={runtimeCleanupInlineStatuses}
          cleanupOnlyStatus={cleanupOnlyStatus}
          statusToCleanup={statusToCleanup}
          selectedIds={selectedIds}
          onToggleRow={toggleRow}
          onToggleAll={toggleAllRows}
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

      {customizeOpen && (
        <CustomizeViewModal
          open={customizeOpen}
          onClose={() => setCustomizeOpen(false)}
          columns={viewPrefs.columns}
          filters={viewPrefs.filters}
          onSave={handleViewSave}
          onReset={() => {
            viewPrefs.resetView();
            setCustomizeOpen(false);
          }}
        />
      )}

      <Modal
        open={bulkConfirmOpen}
        onClose={() => { if (!applying) setBulkConfirm(null); }}
        title={bulkConfirm?.isPublic ? 'Make tickets public' : 'Make tickets private'}
      >
        <div className="stack">
          <p style={{ marginTop: 0 }}>
            {bulkConfirm?.isPublic
              ? `Make ${bulkConfirm?.ids.length} selected ticket${bulkConfirm?.ids.length === 1 ? '' : 's'} public? They will appear on the public status board.`
              : `Make ${bulkConfirm?.ids.length} selected ticket${bulkConfirm?.ids.length === 1 ? '' : 's'} private? They will be hidden from the public status board.`}
          </p>
          <div className="bs-actions">
            <Button type="button" disabled={applying} onClick={() => applyBulkVisibility(bulkConfirm)}>
              {applying ? 'Applying…' : (bulkConfirm?.isPublic ? 'Make Public' : 'Make Private')}
            </Button>
            <Button type="button" kind="ghost" disabled={applying} onClick={() => setBulkConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
