import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';

import {
  ALL_APPLICATIONS,
  PUBLIC_STAGES,
  PUBLIC_STATUSES,
  PUBLIC_FILTERS_STORAGE_KEY,
  PUBLIC_RETIRED_FILTER_STORAGE_KEY,
  STAGED_STATUSES,
} from '../constants/publicConstants';
import {
  areAllPublicStatusesSelected,
  buildDefaultPublicFilters,
  getActivePublicFilters,
  matchesPublicFilters,
  readSavedPublicFilters,
  statusesForStage,
} from '../utils/publicFilterUtils';
import { sortPublicItems } from '../utils/publicSortUtils';
import { useViewer } from '../hooks/useViewer';
import { PublicCommandBar } from '../components/public/PublicCommandBar';
import { StatusBoardList } from '../components/public/StatusBoardList';
import { StatusBoardRow } from '../components/public/StatusBoardRow';
import { StatusBoardSkeleton, StatusBoardState } from '../components/public/StatusBoardStates';
import { AiSearchPanel } from '../components/common/AiSearchPanel';

export function PublicUpdatesPage() {
  const savedFilters = useMemo(() => readSavedPublicFilters(), []);
  const { viewer, ownership, isMine, iReportedTooo, isMineOrReported } = useViewer();

  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [lastChangeAt, setLastChangeAt] = useState(null);
  const [statusOptions, setStatusOptions] = useState(PUBLIC_STATUSES);
  const [typeOptions, setTypeOptions] = useState(['defect', 'enhancement']);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // One object, the way the admin queue holds its filters: the chips, the
  // Filters badge, the band's summary line and the no-matches state all have to
  // describe the same thing. `application` starts '' — not "all" — so the board
  // never flashes one application's tickets before the viewer envelope answers.
  const [filters, setFilters] = useState(() => ({ ...savedFilters, application: '' }));

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
    const onUpdate = () => {
      setLive(true);
      setLastChangeAt(new Date().toISOString());
      setTimeout(() => setLive(false), 3000);
      load();
    };
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
          setStatusOptions(nextStatuses);
          setFilters((prev) => ({
            ...prev,
            statuses: areAllPublicStatusesSelected(prev.statuses, PUBLIC_STATUSES)
              ? [...nextStatuses]
              : prev.statuses.filter((value) => nextStatuses.includes(value)),
          }));
        }
        if (nextTypes.length > 0) {
          setTypeOptions(nextTypes);
          setFilters((prev) => (
            prev.typeFilter && !nextTypes.includes(prev.typeFilter)
              ? { ...prev, typeFilter: '' }
              : prev
          ));
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, []);

  // The board opens on the application this person works in — from their AD
  // groups, or failing that whatever they file against most (the server decides;
  // see viewerService.resolveHomeApplicationId). Runs once, and only while the
  // picker is still untouched, so it can never yank the view out from under
  // someone who has already chosen.
  //
  // ONLY for a signed-in viewer. The anonymous envelope still carries a
  // homeApplicationId — it is the submit form's prefill — but a stranger has no
  // home application, and honouring it here silently hid half the board behind a
  // picker they had no reason to touch.
  useEffect(() => {
    setFilters((prev) => {
      if (prev.application !== '') return prev;
      if (!viewer.isAuthenticated) return { ...prev, application: ALL_APPLICATIONS };
      if (!viewer.homeApplicationId) return prev;
      const home = (viewer.applications || []).find((app) => app.id === viewer.homeApplicationId);
      return { ...prev, application: home ? home.name : ALL_APPLICATIONS };
    });
  }, [viewer.isAuthenticated, viewer.applications, viewer.homeApplicationId]);

  // ── Persist filters to localStorage ───────────────────────────────────────
  // `application` is left out on purpose: it is resolved from the viewer
  // envelope on every load, and a stale saved queue would fight that.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persisted = { ...filters };
    delete persisted.application;
    window.localStorage.setItem(
      PUBLIC_FILTERS_STORAGE_KEY,
      JSON.stringify({
        ...persisted,
        statusSelectionMode: areAllPublicStatusesSelected(filters.statuses, statusOptions)
          ? 'all'
          : 'custom',
      }),
    );
    window.localStorage.setItem(PUBLIC_RETIRED_FILTER_STORAGE_KEY, filters.retiredFilter || 'non_retired');
  }, [filters, statusOptions]);

  // ── Derived values ────────────────────────────────────────────────────────
  const hasItems = items.length > 0;

  const applications = useMemo(
    () => [...new Set(items.map((item) => item.application_name).filter(Boolean))].sort(),
    [items],
  );

  // Everything in the chosen application, before any filter. This is what the
  // tiles count — they are a picture of the whole board, so a filtered list must
  // not change them (the badge on the scope card says exactly that).
  const inScope = useMemo(() => {
    if (!filters.application || filters.application === ALL_APPLICATIONS) return items;
    return items.filter((item) => item.application_name === filters.application);
  }, [items, filters.application]);

  // Counts everything I have a stake in — filed OR reported as happening to me.
  // Matches what the Mine control then shows, or the badge would promise rows the
  // filter does not deliver.
  const mineCount = useMemo(
    () => inScope.filter(isMineOrReported).length,
    [inScope, isMineOrReported],
  );

  const tileCounts = useMemo(() => {
    const counts = { total: inScope.length, other: 0 };
    for (const stage of PUBLIC_STAGES) counts[stage.key] = 0;
    for (const item of inScope) {
      const stage = PUBLIC_STAGES.find((candidate) => candidate.statuses.includes(item.status));
      if (stage) counts[stage.key] += 1;
      else counts.other += 1;
    }
    return counts;
  }, [inScope]);

  const otherStatuses = useMemo(
    () => statusOptions.filter((status) => !STAGED_STATUSES.has(status)),
    [statusOptions],
  );

  const allStatusesSelected = areAllPublicStatusesSelected(filters.statuses, statusOptions);

  const activeFilters = useMemo(
    () => getActivePublicFilters(filters, statusOptions),
    [filters, statusOptions],
  );

  const visibleItems = useMemo(() => {
    const matched = inScope.filter((item) => matchesPublicFilters(item, filters, isMineOrReported, statusOptions));
    return sortPublicItems(matched, filters.sort);
  }, [inScope, filters, isMineOrReported, statusOptions]);

  useEffect(() => { setPage(1); }, [visibleItems]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pagedItems = useMemo(
    () => (pageSize === 0 ? visibleItems : visibleItems.slice((page - 1) * pageSize, page * pageSize)),
    [visibleItems, page, pageSize],
  );

  function selectStage(statuses) {
    // Clicking the tile you are already on clears back to everything, so a tile
    // is a toggle rather than a one-way trip that needs the filter panel to undo.
    setFilters((prev) => {
      const alreadyOnlyThis = prev.statuses.length === statuses.length
        && statuses.every((status) => prev.statuses.includes(status));
      return { ...prev, statuses: alreadyOnlyThis ? [...statusOptions] : [...statuses] };
    });
  }

  // Clears every filter while keeping the two things that are scope rather than
  // filter: which application you are looking at, and how you sorted it.
  function clearAllFilters() {
    setFilters((prev) => ({
      ...buildDefaultPublicFilters(),
      statuses: [...statusOptions],
      application: prev.application,
      sort: prev.sort,
    }));
  }

  const scopeLabel = !filters.application || filters.application === ALL_APPLICATIONS
    ? 'All applications'
    : filters.application;

  // ── States ────────────────────────────────────────────────────────────────
  const showSkeleton = isLoading;
  const showError = Boolean(error) && !isLoading;
  const showEmptyBoard = !isLoading && !error && !hasItems;
  const showNoMatches = !isLoading && !error && hasItems && visibleItems.length === 0;
  const showList = !showSkeleton && !showError && hasItems && visibleItems.length > 0;

  return (
    <div className="pb-page">
      <div className="pb-head">
        <div>
          <h1>Status Board</h1>
          <p>
            Every issue the team has been told about, and where each one stands.
            Find yours by number, or check whether something has already been reported.
          </p>
        </div>
        <div className="pb-head-right">
          <p className={`pb-live${live ? ' pb-live--fresh' : ''}`}>
            <span className="pb-live-dot" aria-hidden="true" />
            <b>Live</b>
            <span className="pb-sep">·</span>
            <span aria-live="polite">
              {lastChangeAt ? 'updated just now' : 'updates as the team makes changes'}
            </span>
          </p>
          {viewer.isAuthenticated && viewer.user && (
            <span className="pb-viewer">
              <span className="pb-viewer-av" aria-hidden="true">
                {String(viewer.user.displayName || viewer.user.username).slice(0, 2).toUpperCase()}
              </span>
              <span>
                <b>{viewer.user.displayName}</b>
                {scopeLabel !== 'All applications' && ` · ${scopeLabel}`}
              </span>
            </span>
          )}
          <a className="pb-headlink" href="/">Report an issue →</a>
        </div>
      </div>

      <PublicCommandBar
        filters={filters}
        setFilters={setFilters}
        filterPanelOpen={filterPanelOpen}
        setFilterPanelOpen={setFilterPanelOpen}
        activeFilters={activeFilters}
        statusOptions={statusOptions}
        typeOptions={typeOptions}
        applications={applications}
        canFilterToMine={ownership !== 'none'}
        mineCount={mineCount}
        onClearAllFilters={clearAllFilters}
      />

      <AiSearchPanel
        scope="public"
        applications={applications}
        defaultApplication="all"
        collapsible
        entryHint="describe the problem in plain language and let AI find near matches"
        subtitle="Search the public status board in plain language to see if an issue has already been reported and what happened to it — or paste a ticket, incident, or policy number to look it up."
        renderResults={(matches) => (
          <div className="sb-panel">
            <div className="sb-rows">
              {matches.map((match) => (
                <StatusBoardRow key={match.id} item={match} isMine={isMine(match)} iReportedTooo={iReportedTooo(match)} />
              ))}
            </div>
          </div>
        )}
      />

      {!showError && !showEmptyBoard && (
        <section className="pb-scope">
          <div className="pb-scope-head">
            <span className="pb-scopebadge">Whole board</span>
            <span className="pb-scope-title"><b>{tileCounts.total}</b> tickets</span>
            <span className="pb-scope-hint">
              Your filters never change these numbers. Pick one to narrow the list.
            </span>
          </div>
          <div className="pb-tiles">
            <button
              className="pb-tile pb-tile--all"
              type="button"
              aria-pressed={allStatusesSelected}
              onClick={() => setFilters((prev) => ({ ...prev, statuses: [...statusOptions] }))}
            >
              <span className="pb-tile-num">{tileCounts.total}</span>
              <span className="pb-tile-lbl">Everything</span>
              <span className="pb-tile-meter" style={{ width: '100%' }} />
            </button>
            {PUBLIC_STAGES.map((stage) => {
              const count = tileCounts[stage.key];
              const share = tileCounts.total > 0 ? Math.round((count / tileCounts.total) * 100) : 0;
              const stageStatuses = statusesForStage(stage.key, statusOptions);
              const selected = !allStatusesSelected
                && filters.statuses.length === stageStatuses.length
                && stageStatuses.every((status) => filters.statuses.includes(status));
              return (
                <button
                  key={stage.key}
                  className={`pb-tile ${stage.modifier}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectStage(stageStatuses)}
                >
                  <span className="pb-tile-num">{count}</span>
                  <span className="pb-tile-lbl">{stage.label}</span>
                  <span className="pb-tile-meter" style={{ width: `${share}%` }} />
                </button>
              );
            })}
            {otherStatuses.length > 0 && (
              <button
                className="pb-tile pb-tile--closed"
                type="button"
                aria-pressed={!allStatusesSelected && filters.statuses.length === otherStatuses.length}
                onClick={() => selectStage(otherStatuses)}
              >
                <span className="pb-tile-num">{tileCounts.other}</span>
                <span className="pb-tile-lbl">{otherStatuses.length} other outcomes</span>
                <span
                  className="pb-tile-meter"
                  style={{ width: `${tileCounts.total > 0 ? Math.round((tileCounts.other / tileCounts.total) * 100) : 0}%` }}
                />
              </button>
            )}
          </div>
        </section>
      )}

      {showSkeleton && <StatusBoardSkeleton />}

      {showError && (
        <StatusBoardState
          tone="error"
          icon="!"
          title="The board could not load"
          actions={(
            <button className="pb-filterbtn" type="button" onClick={() => { setIsLoading(true); load(); }}>
              Try again
            </button>
          )}
        >
          {error} Your filters are still saved.
        </StatusBoardState>
      )}

      {showList && (
        <StatusBoardList
          items={visibleItems}
          pagedItems={pagedItems}
          totalInScope={tileCounts.total}
          scopeLabel={scopeLabel}
          activeFilterCount={activeFilters.length}
          mineOnly={filters.mineOnly}
          sortValue={filters.sort}
          onSortChange={(sort) => setFilters((prev) => ({ ...prev, sort }))}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          totalPages={totalPages}
          isMine={isMine}
          iReportedTooo={iReportedTooo}
        />
      )}

      {showEmptyBoard && (
        <StatusBoardState icon="☐" title="Nothing on the board yet">
          Reports appear here once the team marks them public. Check back shortly.
        </StatusBoardState>
      )}

      {showNoMatches && (
        <StatusBoardState
          icon="⌕"
          title={filters.mineOnly ? 'None of these are yours' : 'Nothing matches those filters'}
          actions={(
            <>
              {filters.mineOnly && (
                <button
                  className="pb-filterbtn"
                  type="button"
                  onClick={() => setFilters((prev) => ({ ...prev, mineOnly: false }))}
                >
                  Show all reports
                </button>
              )}
              <button className="pb-filterbtn" type="button" onClick={clearAllFilters}>
                Clear filters
              </button>
            </>
          )}
        >
          {filters.mineOnly
            ? 'Switch back to all reports, or widen the filters to see the rest of the board.'
            : 'Try a different search, or clear the filters to see the whole board again.'}
        </StatusBoardState>
      )}
    </div>
  );
}
