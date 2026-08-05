import { ALL_APPLICATIONS } from '../../constants/publicConstants';
import { buildDefaultPublicFilters } from '../../utils/publicFilterUtils';
import { PublicFilterChips } from './PublicFilterChips';
import { PublicFilterPanel } from './PublicFilterPanel';

const RETIRED_SCOPES = [
  { value: 'non_retired', label: 'Active' },
  { value: 'retired_only', label: 'Retired' },
  { value: 'all', label: 'All' },
];

/**
 * The command row for the status board: search, a Filters button carrying the
 * applied-filter count, the application scope, the Active/Retired/All scope and
 * the All/My reports switch — plus the removable chips and the grouped panel,
 * drawn closed.
 *
 * Deliberately the same shape as the admin queue's CommandBar. Two controls are
 * promoted out of the panel for the same reasons they are there: `search` is
 * the most-used, and `retiredFilter` is a scope rather than a filter — it
 * changes the meaning of every count on the page.
 */
export function PublicCommandBar({
  filters,
  setFilters,
  filterPanelOpen,
  setFilterPanelOpen,
  activeFilters,
  statusOptions,
  typeOptions,
  applications,
  // Hidden with nothing to show: an anonymous browser that has never filed
  // anything has no "mine" to switch to, and a toggle that can only ever return
  // nothing is worse than no toggle.
  canFilterToMine,
  mineCount,
  onClearAllFilters,
}) {
  const activeCount = activeFilters.length;
  const retiredScope = filters.retiredFilter || 'non_retired';

  // Removing one chip resets just that key to its default.
  function removeFilter(key) {
    const defaults = buildDefaultPublicFilters();
    setFilters((prev) => ({ ...prev, [key]: defaults[key] }));
  }

  return (
    <div className="pb-cmd">
      <div className="pb-cmd-row">
        <span className="pb-search">
          <span className="pb-search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            value={filters.search}
            placeholder="Ticket number, incident number, policy, account, reporter, or a keyword…"
            aria-label="Search the status board"
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
        </span>

        <button
          type="button"
          className="pb-filterbtn"
          aria-expanded={filterPanelOpen}
          aria-controls="public-filter-panel"
          onClick={() => setFilterPanelOpen((previous) => !previous)}
        >
          Filters
          {activeCount > 0 && <span className="bs-count-pill">{activeCount}</span>}
          <span aria-hidden="true">{filterPanelOpen ? ' ▴' : ' ▾'}</span>
        </button>

        {applications.length > 1 && (
          <select
            className="bs-inline-select"
            value={filters.application || ALL_APPLICATIONS}
            aria-label="Application"
            onChange={(event) => setFilters((prev) => ({ ...prev, application: event.target.value }))}
          >
            {applications.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            <option value={ALL_APPLICATIONS}>All applications</option>
          </select>
        )}

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

        {canFilterToMine && (
          <span className="bs-seg" role="group" aria-label="Whose reports to show">
            <button
              type="button"
              aria-pressed={!filters.mineOnly}
              onClick={() => setFilters((prev) => ({ ...prev, mineOnly: false }))}
            >
              All reports
            </button>
            <button
              type="button"
              aria-pressed={filters.mineOnly}
              onClick={() => setFilters((prev) => ({ ...prev, mineOnly: true }))}
            >
              My reports
              {mineCount > 0 && <span className="bs-count-pill">{mineCount}</span>}
            </button>
          </span>
        )}
      </div>

      <PublicFilterChips
        activeFilters={activeFilters}
        onRemove={removeFilter}
        onClearAll={onClearAllFilters}
      />

      {filterPanelOpen && (
        <PublicFilterPanel
          filters={filters}
          setFilters={setFilters}
          statusOptions={statusOptions}
          typeOptions={typeOptions}
          applications={applications}
          activeCount={activeCount}
          onClose={() => setFilterPanelOpen(false)}
          onReset={onClearAllFilters}
        />
      )}
    </div>
  );
}
