import { UNASSIGNED_APPLICATION } from '../../constants/adminConstants';
import { buildDefaultFilters } from '../../utils/filterUtils';
import { ActiveFilterChips } from './ActiveFilterChips';

import { FilterPanel } from './FilterPanel';

const RETIRED_SCOPES = [
  { value: 'non_retired', label: 'Active' },
  { value: 'retired_only', label: 'Retired' },
  { value: 'all', label: 'All' },
];

/**
 * The command row: search, a Filters button carrying the applied-filter count, a
 * Customize-view button, and the Active/Retired/All scope control — plus the
 * removable chips for what's applied and the collapsible grouped panel.
 *
 * Replaces the previous always-expanded grid of fourteen controls. Two of those
 * fourteen are promoted here: `search` (the most-used) and `retiredFilter`, which
 * is a scope rather than a filter because it changes the meaning of every count
 * on the page. The remaining twelve live in the panel, drawn closed.
 *
 * Both promoted controls still honour the admin's visible-filter set, because the
 * page resets the value of any hidden filter — rendering one that is hidden would
 * show a control whose value is being cleared behind the scenes.
 */
export function CommandBar({
  filters,
  setFilters,
  filterPanelOpen,
  setFilterPanelOpen,
  activeFilters,
  runtimeStatusFilterOptions,
  runtimeTypeFilterOptions,
  runtimeCreatedViaOptions,
  dynamicCleanupStatuses,
  visibleFilters,
  // The applications this caller may actually see, and whether they can see the
  // tickets with none set. Both come from the viewer envelope.
  scopeApplications = [],
  canSeeUnassigned = false,
  onOpenCustomize,
  onResetSaved,
  onClearAllFilters,
}) {
  const isVisible = (key) => !visibleFilters || visibleFilters.includes(key);
  const activeCount = activeFilters.length;
  const retiredScope = filters.retiredFilter || 'non_retired';
  // Pointless for someone who administers exactly one application — there is
  // nothing to switch between, and the summary tag already names it.
  const showApplicationScope = isVisible('application')
    && (scopeApplications.length > 1 || canSeeUnassigned);

  // Removing one chip resets just that key to its default.
  function removeFilter(key) {
    const defaults = buildDefaultFilters();
    setFilters((prev) => ({ ...prev, [key]: defaults[key] }));
  }

  return (
    <div className="admin-command">
      <div className="admin-command-row">
        {isVisible('search') && (
          <span className="admin-search">
            <span className="admin-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              value={filters.search}
              placeholder="Search ID, incident #, Jira, reporter, policy, account, or keyword…"
              aria-label="Search tickets by ID, incident number, Jira number, reporter, policy, account, or keyword"
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            />
          </span>
        )}

        <span className="admin-command-inline">
          <button
            type="button"
            className="bs-btn bs-btn-ghost"
            aria-expanded={filterPanelOpen}
            aria-controls="admin-filter-panel"
            onClick={() => setFilterPanelOpen((prev) => !prev)}
          >
            Filters
            {activeCount > 0 && <span className="bs-count-pill">{activeCount}</span>}
            <span aria-hidden="true">{filterPanelOpen ? '▴' : '▾'}</span>
          </button>
          <button
            type="button"
            className="bs-icon-btn"
            title="Customize columns and filters"
            aria-label="Customize columns and filters"
            onClick={onOpenCustomize}
          >
            ⚙
          </button>
        </span>

        {showApplicationScope && (
          <select
            className="bs-inline-select admin-scope-select"
            value={filters.application || ''}
            aria-label="Application queue"
            onChange={(e) => setFilters((prev) => ({ ...prev, application: e.target.value }))}
          >
            <option value="">All applications</option>
            {scopeApplications.map((app) => (
              <option key={app.id} value={app.name}>{app.name}</option>
            ))}
            {canSeeUnassigned && (
              <option value={UNASSIGNED_APPLICATION}>No application set</option>
            )}
          </select>
        )}

        {isVisible('retiredFilter') && (
          <span className="bs-seg" role="group" aria-label="Retired scope">
            {RETIRED_SCOPES.map((scope) => (
              <button
                key={scope.value}
                type="button"
                aria-pressed={retiredScope === scope.value}
                onClick={() => setFilters((prev) => ({ ...prev, retiredFilter: scope.value }))}
              >
                {scope.label}
              </button>
            ))}
          </span>
        )}
      </div>

      <ActiveFilterChips
        activeFilters={activeFilters}
        onRemove={removeFilter}
        onClearAll={onClearAllFilters}
      />

      {filterPanelOpen && (
        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          runtimeStatusFilterOptions={runtimeStatusFilterOptions}
          runtimeTypeFilterOptions={runtimeTypeFilterOptions}
          runtimeCreatedViaOptions={runtimeCreatedViaOptions}
          dynamicCleanupStatuses={dynamicCleanupStatuses}
          visibleFilters={visibleFilters}
          activeCount={activeCount}
          onClose={() => setFilterPanelOpen(false)}
          onOpenCustomize={onOpenCustomize}
          onResetSaved={onResetSaved}
        />
      )}
    </div>
  );
}
