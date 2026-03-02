import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import {
  Badge,
  Button,
  Input,
  MultiSelectDropdown,
  Notice,
  Select,
} from '../components/bite-size/BitsizeUI';

const publicStatuses = [
  'New',
  'Approved',
  'Redirected',
  'Backlog - Monitoring Impact',
  'Future Consideration',
  'Deferred – Not in Current Scope',
  'Rejected',
  'Duplicate',
  'Submitted',
  'Deployed',
];
const publicFiltersStorageKey = 'bc.public.filters';
const publicRetiredFilterStorageKey = 'bc.public.retiredFilter';

function areAllStatusesSelected(values, options) {
  if (!Array.isArray(values) || !Array.isArray(options) || values.length !== options.length) {
    return false;
  }
  const selected = new Set(values);
  return options.every((value) => selected.has(value));
}

function normalizeSavedPublicStatuses(statusesValue, statusSelectionMode = 'legacy') {
  if (statusSelectionMode === 'all') {
    return [...publicStatuses];
  }

  if (!Array.isArray(statusesValue)) {
    return [...publicStatuses];
  }

  const normalized = statusesValue.filter((value) => publicStatuses.includes(value));
  if (normalized.length === 0) {
    return [...publicStatuses];
  }

  if (statusSelectionMode === 'legacy') {
    return [...publicStatuses];
  }

  return normalized;
}

function readSavedPublicFilters() {
  const defaults = {
    search: '',
    typeFilter: '',
    selectedStatuses: [...publicStatuses],
    retiredFilter: 'non_retired',
    sortBy: 'updated_desc',
  };

  if (typeof window === 'undefined') return defaults;

  const savedRetiredFilter = window.localStorage.getItem(publicRetiredFilterStorageKey);
  const normalizedRetiredFilter = ['non_retired', 'retired_only', 'all'].includes(savedRetiredFilter)
    ? savedRetiredFilter
    : defaults.retiredFilter;

  const raw = window.localStorage.getItem(publicFiltersStorageKey);
  if (!raw) {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }

  try {
    const parsed = JSON.parse(raw);
    const statusSelectionMode = parsed?.statusSelectionMode === 'all'
      ? 'all'
      : (parsed?.statusSelectionMode === 'custom' ? 'custom' : 'legacy');
    const selectedStatuses = normalizeSavedPublicStatuses(parsed?.selectedStatuses, statusSelectionMode);
    const retiredFilter = ['non_retired', 'retired_only', 'all'].includes(parsed?.retiredFilter)
      ? parsed.retiredFilter
      : normalizedRetiredFilter;

    return {
      search: typeof parsed?.search === 'string' ? parsed.search : defaults.search,
      typeFilter: typeof parsed?.typeFilter === 'string' ? parsed.typeFilter : defaults.typeFilter,
      selectedStatuses,
      retiredFilter,
      sortBy: typeof parsed?.sortBy === 'string' && parsed.sortBy.trim()
        ? parsed.sortBy
        : defaults.sortBy,
    };
  } catch {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }
}

export function PublicUpdatesPage() {
  const savedFilters = useMemo(() => readSavedPublicFilters(), []);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [dynamicPublicStatuses, setDynamicPublicStatuses] = useState(publicStatuses);
  const [dynamicPublicTypes, setDynamicPublicTypes] = useState(['defect', 'enhancement']);
  const [search, setSearch] = useState(savedFilters.search);
  const [typeFilter, setTypeFilter] = useState(savedFilters.typeFilter);
  const [selectedStatuses, setSelectedStatuses] = useState(savedFilters.selectedStatuses);
  const [retiredFilter, setRetiredFilter] = useState(savedFilters.retiredFilter);
  const [sortBy, setSortBy] = useState(savedFilters.sortBy);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.listPublicSubmissions();
      setItems(data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
    const socket = getSocket();
    const onUpdate = () => { setLive(true); setTimeout(() => setLive(false), 3000); load(); };
    socket.on('public:update', onUpdate);
    return () => { socket.off('public:update', onUpdate); };
  }, [load]);

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
            areAllStatusesSelected(prev, publicStatuses)
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

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const statusSelectionMode = areAllStatusesSelected(selectedStatuses, dynamicPublicStatuses)
      ? 'all'
      : 'custom';
    window.localStorage.setItem(
      publicFiltersStorageKey,
      JSON.stringify({
        search,
        typeFilter,
        selectedStatuses,
        retiredFilter,
        sortBy,
        statusSelectionMode,
      }),
    );
    window.localStorage.setItem(publicRetiredFilterStorageKey, retiredFilter || 'non_retired');
  }, [search, typeFilter, selectedStatuses, retiredFilter, sortBy, dynamicPublicStatuses]);

  const hasItems = useMemo(() => items.length > 0, [items]);

  // Reset to page 1 whenever visible items change
  useEffect(() => { setPage(1); }, [visibleItems]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pagedItems = useMemo(
    () => pageSize === 0 ? visibleItems : visibleItems.slice((page - 1) * pageSize, page * pageSize),
    [visibleItems, page, pageSize],
  );

  function submittedDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString();
  }

  function statusDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function descriptionForItem(item) {
    const defectDescription = String(item.what_happened_exact_details || '').trim();
    const enhancementDescription = String(item.request || '').trim();
    return defectDescription || enhancementDescription || '-';
  }

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      const isRetired = Boolean(item.is_retired) || String(item.status || '') === 'Retired';
      if (retiredFilter === 'retired_only' && !isRetired) {
        return false;
      }
      if (retiredFilter === 'non_retired' && isRetired) {
        return false;
      }
      if (typeFilter && item.type !== typeFilter) {
        return false;
      }
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(item.status)) {
        return false;
      }
      if (!query) {
        return true;
      }

      const haystack = [
        item.id,
        item.created_by,
        item.policy_num,
        item.account_num,
        item.summary_of_issue,
        item.what_happened_exact_details,
        item.request,
        item.easyvista_ticket_id,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });

    const toMillis = (value) => {
      const parsed = new Date(value || '').getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    filtered.sort((left, right) => {
      if (sortBy === 'updated_asc') {
        return toMillis(left.updated_at) - toMillis(right.updated_at);
      }
      if (sortBy === 'created_desc') {
        return toMillis(right.created_at) - toMillis(left.created_at);
      }
      if (sortBy === 'created_asc') {
        return toMillis(left.created_at) - toMillis(right.created_at);
      }
      return toMillis(right.updated_at) - toMillis(left.updated_at);
    });

    return filtered;
  }, [items, search, typeFilter, selectedStatuses, retiredFilter, sortBy]);

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

      <div className="filters-bar" style={{ marginBottom: 14 }}>
        <Input
          label="Search"
          placeholder="Search by summary, description, policy/account, Requester, EV ticket"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select label="Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All types</option>
          {dynamicPublicTypes.includes('defect') && <option value="defect">Defect</option>}
          {dynamicPublicTypes.includes('enhancement') && <option value="enhancement">Enhancement</option>}
        </Select>
        <MultiSelectDropdown
          label="Status"
          options={dynamicPublicStatuses}
          selectedValues={selectedStatuses}
          onChange={setSelectedStatuses}
          placeholder="Select statuses"
        />
        <Select label="Retired" value={retiredFilter} onChange={(event) => setRetiredFilter(event.target.value)}>
          <option value="non_retired">Non-Retired Only</option>
          <option value="retired_only">Retired Only</option>
          <option value="all">Show All</option>
        </Select>
        <Select label="Sort" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="updated_desc">Recently Updated (Newest)</option>
          <option value="updated_asc">Recently Updated (Oldest)</option>
          <option value="created_desc">Date Submitted (Newest)</option>
          <option value="created_asc">Date Submitted (Oldest)</option>
        </Select>
        <Button
          kind="ghost"
          type="button"
          onClick={() => {
            setSearch('');
            setTypeFilter('');
            setSelectedStatuses([...dynamicPublicStatuses]);
            setRetiredFilter('non_retired');
            setSortBy('updated_desc');
          }}
        >
          Clear
        </Button>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Showing {visibleItems.length} of {items.length} public item(s)
      </p>

      {/* ── Pagination controls ── */}
      {visibleItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {pageSize === 0
              ? `Showing all ${visibleItems.length}`
              : `Showing ${Math.min((page - 1) * pageSize + 1, visibleItems.length)}–${Math.min(page * pageSize, visibleItems.length)} of ${visibleItems.length}`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
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
      )}

      {!hasItems && !error && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          <p>No public updates yet. Check back after an admin marks requests as visible.</p>
        </div>
      )}

      {hasItems && visibleItems.length > 0 && (
        <div className="public-list">
          {pagedItems.map((item) => (
            <article key={item.id} className="public-item">
              <div className="public-top" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0 }}>{item.summary_of_issue || '-'}</h4>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Reported: {submittedDate(item.created_at)}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Latest update: {submittedDate(item.latest_status_changed_at || item.updated_at)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge value={item.type} />
                  <Badge value={item.status} />
                  {(item.is_retired || item.status === 'Retired') && <Badge value="Retired" />}
                </div>
              </div>
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Show details</summary>
                <div style={{ marginTop: 10 }}><strong>#{item.id}</strong></div>
                <div className="public-meta">
                  <div className="pub-cols">
                    <div className="pub-col">
                      <div className="pub-field">
                        <span className="pub-label">Reported</span>
                        <span>{submittedDate(item.created_at)}</span>
                      </div>
                      <div className="pub-field">
                        <span className="pub-label">Policy / Account</span>
                        <span>{item.policy_num || '-'} / {item.account_num || '-'}</span>
                      </div>
                      <div className="pub-field">
                        <span className="pub-label">Latest Status</span>
                        <span>
                          {item.status === 'New'
                            ? 'Reported'
                            : item.status === 'Submitted'
                              ? 'Submitted to EV'
                              : (item.latest_status_value || item.status)
                          } on {submittedDate(item.latest_status_changed_at)}
                        </span>
                      </div>
                      {item.status === 'Duplicate' && (
                        <div className="pub-field">
                          <span className="pub-label">Marked Duplicate</span>
                          <span>{statusDate(item.duplicate_status_at || item.latest_status_changed_at)}</span>
                        </div>
                      )}
                      {(item.is_retired || item.status === 'Retired') && !!item.retired_status_at && (
                        <div className="pub-field">
                          <span className="pub-label">Retired</span>
                          <span>{statusDate(item.retired_status_at)}</span>
                        </div>
                      )}
                    </div>
                    <div className="pub-col">
                      <div className="pub-field">
                        <span className="pub-label">Requester</span>
                        <span>{item.created_by || '-'}</span>
                      </div>
                      <div className="pub-field">
                        <span className="pub-label">Application</span>
                        <span>{item.application_name || '-'}</span>
                      </div>
                      <div className="pub-field">
                        <span className="pub-label">EV Ticket</span>
                        <span>{item.easyvista_ticket_id || '-'}</span>
                      </div>
                      <div className="pub-field">
                        <span className="pub-label">JIRA Card #</span>
                        <span>{item.jira_number || '-'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="pub-field pub-field-full">
                    <span className="pub-label">Description</span>
                    <span>{descriptionForItem(item)}</span>
                  </div>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}

      {hasItems && visibleItems.length === 0 && !error && (
        <div className="empty-state">
          <p>No items match your current search/filter settings.</p>
        </div>
      )}
    </>
  );
}
