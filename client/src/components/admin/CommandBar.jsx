import { UNASSIGNED_APPLICATION, ALL_APPLICATIONS_SCOPE } from '../../constants/adminConstants';
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
  // The queue this admin has pinned as their default, and how to change it.
  pinnedApplication = null,
  onPinApplication,
  onOpenCustomize,
  onResetSaved,
  onClearAllFilters,
  // Offered only when a banner replaced the whole filter set; see
  // `filtersBeforeJump` in AdminDashboardPage.
  onRestoreFilters = null,
  restoreFiltersLabel,
}) {
  const isVisible = (key) => !visibleFilters || visibleFilters.includes(key);
  const activeCount = activeFilters.length;
  const retiredScope = filters.retiredFilter || 'non_retired';

  // ── Which kind of request ──────────────────────────────────────────────────
  // Built from the live type list rather than hardcoded labels, because the type
  // filter matches on the label the lookup gives it: hardcoding 'Report' here
  // would silently stop matching the day somebody renames the lookup value.
  const reportTypeLabel = runtimeTypeFilterOptions.find((label) => /^report/i.test(label)) || '';
  const otherTypeLabels = runtimeTypeFilterOptions.filter((label) => label !== reportTypeLabel);
  const kindSwitchOptions = [
    { key: 'all', label: 'All kinds', types: [] },
    { key: 'work', label: 'Defects & enhancements', types: otherTypeLabels },
    { key: 'report', label: 'Report requests', types: [reportTypeLabel] },
  ];
  // A segment is pressed only when the filter holds EXACTLY its set. Anything
  // hand-picked in the panel presses none of them, which is the truth.
  const selectedTypes = Array.isArray(filters.types) ? filters.types : [];
  const activeKind = kindSwitchOptions.find((option) => (
    option.types.length === selectedTypes.length
    && option.types.every((label) => selectedTypes.includes(label))
  ))?.key || '';
  // Pointless where report requests are not a type this portal has.
  const showKindSwitch = isVisible('types') && Boolean(reportTypeLabel) && otherTypeLabels.length > 0;
  // Pointless for someone who administers exactly one application — there is
  // nothing to switch between, and the summary tag already names it.
  const showApplicationScope = isVisible('application')
    && (scopeApplications.length > 1 || canSeeUnassigned);

  // The pin stores '__all__' for "every application"; the live filter uses ''.
  const currentScope = filters.application || ALL_APPLICATIONS_SCOPE;
  const isPinnedHere = pinnedApplication === currentScope;

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
          <span className="admin-scope">
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
            {/* Switching scope is a look; pinning is a decision. Only pinning
                changes where this admin lands tomorrow, which is why it is a
                separate deliberate click rather than a side effect of the
                select above. */}
            {onPinApplication && (
              <button
                type="button"
                className={`admin-scope-pin${isPinnedHere ? ' is-pinned' : ''}`}
                aria-pressed={isPinnedHere}
                title={isPinnedHere
                  ? 'This is your default queue — click to stop defaulting to it'
                  : 'Make this your default queue'}
                onClick={() => onPinApplication(isPinnedHere ? null : currentScope)}
              >
                <span aria-hidden="true">{isPinnedHere ? '★' : '☆'}</span>
                <span className="admin-scope-pin-text">
                  {isPinnedHere ? 'Default' : 'Make default'}
                </span>
              </button>
            )}
          </span>
        )}

        {/* Which KIND of request. Report requests and defects are different jobs
            done by different people, and an analyst who works reports should not
            have to open the filter panel and tick three boxes to stop seeing
            defects. It writes `filters.types` — the same value the panel's
            multi-select writes — so the chips, the badge and the table can never
            disagree about what is being shown, and a hand-picked combination in
            the panel simply leaves no segment pressed. */}
        {showKindSwitch && (
          <span className="bs-seg" role="group" aria-label="Kind of request">
            {kindSwitchOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={activeKind === option.key}
                onClick={() => setFilters((prev) => ({ ...prev, types: [...option.types] }))}
              >
                {option.label}
              </button>
            ))}
          </span>
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
        onRestore={onRestoreFilters}
        restoreLabel={restoreFiltersLabel}
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
