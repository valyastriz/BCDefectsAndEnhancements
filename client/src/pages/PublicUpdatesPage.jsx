import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Notice } from '../components/bite-size/BitsizeUI';

import { PUBLIC_STATUSES, PUBLIC_FILTERS_STORAGE_KEY, PUBLIC_RETIRED_FILTER_STORAGE_KEY } from '../constants/publicConstants';
import { areAllPublicStatusesSelected, readSavedPublicFilters } from '../utils/publicFilterUtils';
import { PublicFiltersBar } from '../components/public/PublicFiltersBar';
import { PublicItemCard } from '../components/public/PublicItemCard';
import { PaginationControls } from '../components/common/PaginationControls';
import { AiSearchPanel } from '../components/common/AiSearchPanel';

export function PublicUpdatesPage() {
  const savedFilters = useMemo(() => readSavedPublicFilters(), []);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [dynamicPublicStatuses, setDynamicPublicStatuses] = useState(PUBLIC_STATUSES);
  const [dynamicPublicTypes, setDynamicPublicTypes] = useState(['defect', 'enhancement']);
  const [search, setSearch] = useState(savedFilters.search);
  const [typeFilter, setTypeFilter] = useState(savedFilters.typeFilter);
  const [selectedStatuses, setSelectedStatuses] = useState(savedFilters.selectedStatuses);
  const [retiredFilter, setRetiredFilter] = useState(savedFilters.retiredFilter);
  const [sortBy, setSortBy] = useState(savedFilters.sortBy);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // ── Data loading ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.listPublicSubmissions();
      setItems(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
    const socket = getSocket();
    const onUpdate = () => { setLive(true); setTimeout(() => setLive(false), 3000); load(); };
    socket.on('public:update', onUpdate);
    return () => { socket.off('public:update', onUpdate); };
  }, [load]);

  // ── Load dynamic meta options ─────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    Promise.resolve()
      .then(() => api.getMetaOptions())
      .then((meta) => {
        if (!isMounted) return;
        const nextStatuses = Array.isArray(meta?.defectEnhancementStatuses)
          ? meta.defectEnhancementStatuses.filter(Boolean)
          : [];
        const nextTypes = Array.isArray(meta?.submissionTypes)
          ? meta.submissionTypes.map((value) => String(value || '').toLowerCase()).filter(Boolean)
          : [];

        if (nextStatuses.length > 0) {
          setDynamicPublicStatuses(nextStatuses);
          setSelectedStatuses((prev) => (
            areAllPublicStatusesSelected(prev, PUBLIC_STATUSES)
              ? [...nextStatuses]
              : prev.filter((value) => nextStatuses.includes(value))
          ));
        }
        if (nextTypes.length > 0) {
          setDynamicPublicTypes(nextTypes);
          setTypeFilter((prev) => (prev && !nextTypes.includes(prev) ? '' : prev));
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, []);

  // ── Persist filters to localStorage ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const statusSelectionMode = areAllPublicStatusesSelected(selectedStatuses, dynamicPublicStatuses)
      ? 'all'
      : 'custom';
    window.localStorage.setItem(
      PUBLIC_FILTERS_STORAGE_KEY,
      JSON.stringify({
        search,
        typeFilter,
        selectedStatuses,
        retiredFilter,
        sortBy,
        statusSelectionMode,
      }),
    );
    window.localStorage.setItem(PUBLIC_RETIRED_FILTER_STORAGE_KEY, retiredFilter || 'non_retired');
  }, [search, typeFilter, selectedStatuses, retiredFilter, sortBy, dynamicPublicStatuses]);

  // ── Derived values ────────────────────────────────────────────────────────
  const hasItems = useMemo(() => items.length > 0, [items]);
  const publicApplications = useMemo(
    () => [...new Set(items.map((item) => item.application_name).filter(Boolean))].sort(),
    [items],
  );

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      const isRetired = Boolean(item.is_retired) || String(item.status || '') === 'Retired';
      if (retiredFilter === 'retired_only' && !isRetired) return false;
      if (retiredFilter === 'non_retired' && isRetired) return false;
      if (typeFilter && item.type !== typeFilter) return false;
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(item.status)) return false;
      if (!query) return true;

      const haystack = [
        item.id, item.created_by, item.policy_num, item.account_num,
        item.summary_of_issue, item.what_happened_exact_details, item.request,
        item.easyvista_ticket_id,
      ].map((value) => String(value || '').toLowerCase()).join(' ');

      return haystack.includes(query);
    });

    const toMillis = (value) => {
      const parsed = new Date(value || '').getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    filtered.sort((left, right) => {
      if (sortBy === 'updated_asc') return toMillis(left.updated_at) - toMillis(right.updated_at);
      if (sortBy === 'created_desc') return toMillis(right.created_at) - toMillis(left.created_at);
      if (sortBy === 'created_asc') return toMillis(left.created_at) - toMillis(right.created_at);
      return toMillis(right.updated_at) - toMillis(left.updated_at);
    });

    return filtered;
  }, [items, search, typeFilter, selectedStatuses, retiredFilter, sortBy]);

  useEffect(() => { setPage(1); }, [visibleItems]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pagedItems = useMemo(
    () => pageSize === 0 ? visibleItems : visibleItems.slice((page - 1) * pageSize, page * pageSize),
    [visibleItems, page, pageSize],
  );

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <>
      <div className="page-header">
        <h2>Status Board</h2>
        <p>
          Live view of submitted requests that have been marked "Public" by an admin — updates automatically when admins make changes.
          {live && <strong style={{ marginLeft: 8, color: 'var(--status-approved-fg)' }}>● Live update received</strong>}
        </p>
      </div>

      <Notice text={error} />

      <AiSearchPanel
        scope="public"
        applications={publicApplications}
        defaultApplication="all"
        subtitle="Search the public status board in plain language to see if an issue has already been reported and what happened to it — or paste a ticket, incident, or policy number to look it up."
        renderResults={(matches) => (
          <div className="public-list">
            {matches.map((item) => (
              <PublicItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      />

      <PublicFiltersBar
        search={search}
        setSearch={setSearch}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        dynamicPublicTypes={dynamicPublicTypes}
        selectedStatuses={selectedStatuses}
        setSelectedStatuses={setSelectedStatuses}
        dynamicPublicStatuses={dynamicPublicStatuses}
        retiredFilter={retiredFilter}
        setRetiredFilter={setRetiredFilter}
        sortBy={sortBy}
        setSortBy={setSortBy}
        onClear={() => {
          setSearch('');
          setTypeFilter('');
          setSelectedStatuses([...dynamicPublicStatuses]);
          setRetiredFilter('non_retired');
          setSortBy('updated_desc');
        }}
      />

      {!isLoading && (
        <p className="muted" style={{ marginTop: 0 }}>
          Showing {visibleItems.length} of {items.length} public item(s)
        </p>
      )}

      {/* ── Pagination controls ── */}
      {!isLoading && visibleItems.length > 0 && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          setPage={setPage}
          setPageSize={setPageSize}
          summary={pageSize === 0
            ? `Showing all ${visibleItems.length}`
            : `Showing ${Math.min((page - 1) * pageSize + 1, visibleItems.length)}–${Math.min(page * pageSize, visibleItems.length)} of ${visibleItems.length}`}
        />
      )}

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 16, color: 'var(--color-muted)' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p style={{ margin: 0, fontSize: 15 }}>Loading public updates&hellip;</p>
        </div>
      )}

      {!isLoading && !hasItems && !error && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          <p>No public updates yet. Check back after an admin marks requests as visible.</p>
        </div>
      )}

      {hasItems && visibleItems.length > 0 && (
        <div className="public-list">
          {pagedItems.map((item) => (
            <PublicItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {!isLoading && hasItems && visibleItems.length === 0 && !error && (
        <div className="empty-state">
          <p>No items match your current filters. Try adjusting or clearing the filters above.</p>
        </div>
      )}
    </>
  );
}
