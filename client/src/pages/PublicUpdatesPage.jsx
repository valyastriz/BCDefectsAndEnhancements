import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Notice } from '../components/bite-size/BitsizeUI';

import { PUBLIC_STATUSES, PUBLIC_FILTERS_STORAGE_KEY, PUBLIC_RETIRED_FILTER_STORAGE_KEY } from '../constants/publicConstants';
import { areAllPublicStatusesSelected, readSavedPublicFilters } from '../utils/publicFilterUtils';
import { useViewer } from '../hooks/useViewer';
import { PublicFiltersBar } from '../components/public/PublicFiltersBar';
import { PublicItemCard } from '../components/public/PublicItemCard';
import { PaginationControls } from '../components/common/PaginationControls';
import { AiSearchPanel } from '../components/common/AiSearchPanel';

// The scope tiles, in pipeline order. Each is a quick filter onto the statuses
// it covers; everything not named here falls into the trailing "other outcomes"
// tile, so the tile numbers always sum to the total rather than quietly losing
// tickets the way a fixed four-tile row would.
const SCOPE_TILES = [
  { key: 'reported', label: 'Reported', statuses: ['New'], modifier: 'pb-tile--reported' },
  { key: 'approved', label: 'Approved', statuses: ['Approved'], modifier: 'pb-tile--approved' },
  { key: 'submitted', label: 'In EasyVista', statuses: ['Submitted'], modifier: 'pb-tile--submitted' },
  { key: 'deployed', label: 'Deployed', statuses: ['Deployed'], modifier: 'pb-tile--deployed' },
];
const TILED_STATUSES = new Set(SCOPE_TILES.flatMap((tile) => tile.statuses));

const ALL_APPLICATIONS = '__all__';

export function PublicUpdatesPage() {
  const savedFilters = useMemo(() => readSavedPublicFilters(), []);
  const { viewer, ownership, isMine } = useViewer();

  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [lastChangeAt, setLastChangeAt] = useState(null);
  const [dynamicPublicStatuses, setDynamicPublicStatuses] = useState(PUBLIC_STATUSES);
  const [dynamicPublicTypes, setDynamicPublicTypes] = useState(['defect', 'enhancement']);
  const [search, setSearch] = useState(savedFilters.search);
  const [typeFilter, setTypeFilter] = useState(savedFilters.typeFilter);
  const [selectedStatuses, setSelectedStatuses] = useState(savedFilters.selectedStatuses);
  const [retiredFilter, setRetiredFilter] = useState(savedFilters.retiredFilter);
  const [sortBy, setSortBy] = useState(savedFilters.sortBy);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  // '' until the viewer envelope answers, so the board never flashes one
  // application's tickets before switching to another.
  const [application, setApplication] = useState('');

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
    if (application !== '') return;
    if (!viewer.isAuthenticated) {
      setApplication(ALL_APPLICATIONS);
      return;
    }
    if (!viewer.homeApplicationId) return;
    const home = (viewer.applications || []).find((app) => app.id === viewer.homeApplicationId);
    setApplication(home ? home.name : ALL_APPLICATIONS);
  }, [application, viewer.isAuthenticated, viewer.applications, viewer.homeApplicationId]);

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
  const hasItems = items.length > 0;

  const publicApplications = useMemo(
    () => [...new Set(items.map((item) => item.application_name).filter(Boolean))].sort(),
    [items],
  );

  // Everything in the chosen application, before any filter. This is what the
  // tiles count — they are a picture of the whole board, so a filtered list must
  // not change them (the badge on the scope card says exactly that).
  const inScope = useMemo(() => {
    if (!application || application === ALL_APPLICATIONS) return items;
    return items.filter((item) => item.application_name === application);
  }, [items, application]);

  const mineCount = useMemo(() => inScope.filter(isMine).length, [inScope, isMine]);

  const tileCounts = useMemo(() => {
    const counts = { total: inScope.length, other: 0 };
    for (const tile of SCOPE_TILES) counts[tile.key] = 0;
    for (const item of inScope) {
      const tile = SCOPE_TILES.find((candidate) => candidate.statuses.includes(item.status));
      if (tile) counts[tile.key] += 1;
      else counts.other += 1;
    }
    return counts;
  }, [inScope]);

  const otherStatuses = useMemo(
    () => dynamicPublicStatuses.filter((status) => !TILED_STATUSES.has(status)),
    [dynamicPublicStatuses],
  );

  const allStatusesSelected = areAllPublicStatusesSelected(selectedStatuses, dynamicPublicStatuses);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = inScope.filter((item) => {
      const isRetired = Boolean(item.is_retired) || String(item.status || '') === 'Retired';
      if (retiredFilter === 'retired_only' && !isRetired) return false;
      if (retiredFilter === 'non_retired' && isRetired) return false;
      if (mineOnly && !isMine(item)) return false;
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
  }, [inScope, search, typeFilter, selectedStatuses, retiredFilter, sortBy, mineOnly, isMine]);

  useEffect(() => { setPage(1); }, [visibleItems]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pagedItems = useMemo(
    () => (pageSize === 0 ? visibleItems : visibleItems.slice((page - 1) * pageSize, page * pageSize)),
    [visibleItems, page, pageSize],
  );

  const activeFilterCount = [
    search.trim() !== '',
    typeFilter !== '',
    !allStatusesSelected,
    retiredFilter !== 'non_retired',
  ].filter(Boolean).length;

  function selectTile(statuses) {
    // Clicking the tile you are already on clears back to everything, so a tile
    // is a toggle rather than a one-way trip that needs the filter panel to undo.
    const alreadyOnlyThis = selectedStatuses.length === statuses.length
      && statuses.every((status) => selectedStatuses.includes(status));
    setSelectedStatuses(alreadyOnlyThis ? [...dynamicPublicStatuses] : [...statuses]);
  }

  const scopeLabel = !application || application === ALL_APPLICATIONS
    ? 'All applications'
    : application;

  // ── States ────────────────────────────────────────────────────────────────
  const showSkeleton = isLoading;
  const showError = Boolean(error) && !isLoading;
  const showEmptyBoard = !isLoading && !error && !hasItems;
  const showNoMatches = !isLoading && !error && hasItems && visibleItems.length === 0;

  return (
    <div className="pb-page">
      <div className="pb-head">
        <div>
          <h1>Status Board</h1>
          <p>
            Every issue the team has been told about, and where each one stands.
            Find yours by number, or check whether something has already been reported.
          </p>
          <p className={`pb-live${live ? ' pb-live--fresh' : ''}`}>
            <span className="pb-live-dot" aria-hidden="true" />
            <b>Live</b>
            <span className="pb-sep">·</span>
            <span aria-live="polite">
              {lastChangeAt ? 'updated just now' : 'updates as the team makes changes'}
            </span>
          </p>
        </div>
        <div className="pb-head-right">
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

      <div className="pb-find">
        <div className="pb-find-row">
          <span className="pb-search">
            <span className="pb-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              placeholder="Ticket number, incident number, policy, account, reporter, or a keyword…"
              aria-label="Search the status board"
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
          <span className="pb-find-inline">
            <button
              className="pb-filterbtn"
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((prev) => !prev)}
            >
              Filters
              {activeFilterCount > 0 && <span className="bs-count-pill">{activeFilterCount}</span>}
              <span aria-hidden="true">{filtersOpen ? ' ▴' : ' ▾'}</span>
            </button>
            {/* Hidden with nothing to show: an anonymous browser that has never
                filed anything has no "mine" to switch to, and a toggle that can
                only ever return nothing is worse than no toggle. */}
            {ownership !== 'none' && (
              <span className="bs-seg" role="group" aria-label="Whose reports to show">
                <button type="button" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>
                  All reports
                </button>
                <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>
                  My reports
                  {mineCount > 0 && <span className="bs-count-pill">{mineCount}</span>}
                </button>
              </span>
            )}
          </span>
        </div>

        {filtersOpen && (
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
        )}

        <AiSearchPanel
          scope="public"
          applications={publicApplications}
          defaultApplication="all"
          collapsible
          entryHint="describe the problem in plain language and let AI find near matches"
          subtitle="Search the public status board in plain language to see if an issue has already been reported and what happened to it — or paste a ticket, incident, or policy number to look it up."
          renderResults={(matches) => (
            <div className="pb-list">
              {matches.map((match) => (
                <PublicItemCard key={match.id} item={match} isMine={isMine(match)} />
              ))}
            </div>
          )}
        />
      </div>

      {showError && <Notice text={error} />}

      {!showError && !showEmptyBoard && (
        <section className="pb-scope">
          <div className="pb-scope-head">
            <span className="pb-scopebadge">Whole board</span>
            {publicApplications.length > 1 && (
              <span className="pb-apppick">
                <select
                  className="bs-inline-select"
                  value={application || ALL_APPLICATIONS}
                  aria-label="Application"
                  onChange={(event) => setApplication(event.target.value)}
                >
                  {publicApplications.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value={ALL_APPLICATIONS}>All applications</option>
                </select>
              </span>
            )}
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
              onClick={() => setSelectedStatuses([...dynamicPublicStatuses])}
            >
              <span className="pb-tile-num">{tileCounts.total}</span>
              <span className="pb-tile-meter"><i style={{ width: '100%' }} /></span>
              <span className="pb-tile-lbl">Everything</span>
            </button>
            {SCOPE_TILES.map((tile) => {
              const count = tileCounts[tile.key];
              const share = tileCounts.total > 0 ? Math.round((count / tileCounts.total) * 100) : 0;
              const selected = !allStatusesSelected
                && selectedStatuses.length === tile.statuses.length
                && tile.statuses.every((status) => selectedStatuses.includes(status));
              return (
                <button
                  key={tile.key}
                  className={`pb-tile ${tile.modifier}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectTile(tile.statuses)}
                >
                  <span className="pb-tile-num">{count}</span>
                  <span className="pb-tile-meter"><i style={{ width: `${share}%` }} /></span>
                  <span className="pb-tile-lbl">{tile.label}</span>
                </button>
              );
            })}
            {otherStatuses.length > 0 && (
              <button
                className="pb-tile pb-tile--closed"
                type="button"
                aria-pressed={!allStatusesSelected && selectedStatuses.length === otherStatuses.length}
                onClick={() => selectTile(otherStatuses)}
              >
                <span className="pb-tile-num">{tileCounts.other}</span>
                <span className="pb-tile-meter">
                  <i style={{ width: `${tileCounts.total > 0 ? Math.round((tileCounts.other / tileCounts.total) * 100) : 0}%` }} />
                </span>
                <span className="pb-tile-lbl">{otherStatuses.length} other outcomes</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* Placeholders shaped like the real rows, so nothing jumps when the data
          lands. Hidden from assistive tech — there is nothing here to read. */}
      {showSkeleton && (
        <div className="pb-listwrap" aria-busy="true">
          <div className="pb-band">
            <div className="pb-band-head">
              <span className="pb-scopebadge pb-scopebadge--list">This list</span>
              <span className="sk-bar" style={{ width: 120 }} />
              <span className="pb-band-hint">Loading tickets…</span>
            </div>
          </div>
          <div className="pb-list" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <article className="pb-item" key={row}>
                <div className="pb-item-top">
                  <span className="sk-bar" style={{ width: 68 }} />
                  <span className="sk-bar" style={{ width: 96 }} />
                  <span className="sk-bar" style={{ width: 74 }} />
                </div>
                <span className="sk-bar" style={{ width: '62%', height: 15, marginTop: 4 }} />
                <span className="sk-bar" style={{ width: '100%', height: 34, marginTop: 12 }} />
                <span className="sk-bar" style={{ width: 220, marginTop: 10 }} />
              </article>
            ))}
          </div>
        </div>
      )}

      {!showSkeleton && !showError && hasItems && visibleItems.length > 0 && (
        <div className="pb-listwrap">
          <div className="pb-band">
            <div className="pb-band-head">
              <span className="pb-scopebadge pb-scopebadge--list">This list</span>
              <span className="pb-band-title">
                <b>{visibleItems.length}</b> of {tileCounts.total} tickets
              </span>
              {/* The explicit {' '} matter: JSX strips the whitespace between
                  elements on separate lines, and .pb-sep carries no margin —
                  without them the hint reads "filter·Billing Center·no filters". */}
              <span className="pb-band-hint">
                Changes with every filter
                {' '}
                <span className="pb-sep">·</span>
                {' '}
                {scopeLabel}
                {mineOnly && (
                  <>
                    {' '}
                    <span className="pb-sep">·</span>
                    {' '}
                    Yours only
                  </>
                )}
                {' '}
                <span className="pb-sep">·</span>
                {' '}
                {activeFilterCount === 0
                  ? 'no filters applied'
                  : `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied`}
              </span>
            </div>
            <div className="pb-band-row">
              <span className="pb-band-sort">
                Sort
                <select
                  className="bs-inline-select"
                  value={sortBy}
                  aria-label="Sort tickets"
                  onChange={(event) => setSortBy(event.target.value)}
                >
                  <option value="updated_desc">Recently updated</option>
                  <option value="updated_asc">Oldest update</option>
                  <option value="created_desc">Newest report</option>
                  <option value="created_asc">Oldest report</option>
                </select>
              </span>
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
            </div>
          </div>

          <div className="pb-list">
            {pagedItems.map((item) => (
              <PublicItemCard key={item.id} item={item} isMine={isMine(item)} />
            ))}
          </div>
        </div>
      )}

      {showEmptyBoard && (
        <div className="pb-state">
          <span className="pb-state-icon" aria-hidden="true">☐</span>
          <h4>Nothing on the board yet</h4>
          <p>Reports appear here once the team marks them public. Check back shortly.</p>
        </div>
      )}

      {showNoMatches && (
        <div className="pb-state">
          <span className="pb-state-icon" aria-hidden="true">⌕</span>
          <h4>{mineOnly ? 'None of these are yours' : 'Nothing matches those filters'}</h4>
          <p>
            {mineOnly
              ? 'Switch back to all reports, or widen the filters to see the rest of the board.'
              : 'Try a different search, or clear the filters to see the whole board again.'}
          </p>
          <div className="pb-state-acts">
            {mineOnly && (
              <button className="pb-filterbtn" type="button" onClick={() => setMineOnly(false)}>
                Show all reports
              </button>
            )}
            <button
              className="pb-filterbtn"
              type="button"
              onClick={() => {
                setSearch('');
                setTypeFilter('');
                setSelectedStatuses([...dynamicPublicStatuses]);
                setRetiredFilter('non_retired');
                setMineOnly(false);
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
