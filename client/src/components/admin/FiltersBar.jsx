import { Button, Input, MultiSelectDropdown, Select } from '../bite-size/BitsizeUI';
import { buildDefaultFilters } from '../../utils/filterUtils';
import { formatCreatedViaLabel } from '../../utils/formatUtils';
import {
  ADMIN_FILTERS_STORAGE_KEY,
  ADMIN_RETIRED_FILTER_STORAGE_KEY,
} from '../../constants/adminConstants';

/**
 * "Viewing new form submissions only" info bar + all filter controls.
 */
export function FiltersBar({
  filters,
  setFilters,
  runtimeStatusFilterOptions,
  runtimeTypeFilterOptions,
  runtimeCreatedViaOptions,
  dynamicCleanupStatuses,
  isViewingNewFormOnly,
  preNewSubmissionFiltersRef,
  visibleFilters,
  onOpenCustomize,
}) {
  // A filter shows when it's in the admin's visible set (no set yet → show all).
  const isVisible = (key) => !visibleFilters || visibleFilters.includes(key);
  return (
    <>
      {/* ── "Viewing new form submissions only" info bar ── */}
      {isViewingNewFormOnly && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          marginBottom: 10,
          borderRadius: 6,
          background: 'var(--slate-100, #f1f5f9)',
          border: '1px solid var(--slate-300, #cbd5e1)',
          fontSize: 13,
          color: 'var(--slate-700, #334155)',
        }}>
          <span style={{ flex: 1 }}>
            Showing only <strong>new form submissions</strong>.
          </span>
          <button
            type="button"
            onClick={() => {
              if (preNewSubmissionFiltersRef.current) {
                setFilters(preNewSubmissionFiltersRef.current);
                preNewSubmissionFiltersRef.current = null;
              } else {
                setFilters({
                  ...buildDefaultFilters(),
                  statuses: runtimeStatusFilterOptions.length > 0 ? [...runtimeStatusFilterOptions] : [],
                });
              }
            }}
            style={{
              background: 'var(--color-primary, #2563eb)',
              border: 'none',
              borderRadius: 5,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            View All Submissions
          </button>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="filters-bar">
        {isVisible('statuses') && (
          <MultiSelectDropdown
            label="Defect/Enhancement Status"
            options={runtimeStatusFilterOptions}
            selectedValues={filters.statuses}
            onChange={(nextStatuses) => setFilters((prev) => ({ ...prev, statuses: nextStatuses }))}
            placeholder="Select statuses"
          />
        )}
        {isVisible('retiredFilter') && (
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
        )}
        {isVisible('types') && (
          <MultiSelectDropdown
            label="Type"
            options={runtimeTypeFilterOptions}
            selectedValues={filters.types}
            onChange={(nextTypes) => setFilters((prev) => ({ ...prev, types: nextTypes }))}
            placeholder="All types"
          />
        )}
        {isVisible('cleanupRequired') && (
          <Select
            label="Cleanup Required"
            value={filters.cleanupRequired}
            onChange={(e) => setFilters((prev) => ({ ...prev, cleanupRequired: e.target.value }))}
          >
            <option value="">Show All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        )}
        {isVisible('cleanupStatuses') && (
          <MultiSelectDropdown
            label="Cleanup Status"
            options={dynamicCleanupStatuses}
            selectedValues={filters.cleanupStatuses}
            onChange={(nextCleanupStatuses) => setFilters((prev) => ({ ...prev, cleanupStatuses: nextCleanupStatuses }))}
            placeholder="All cleanup statuses"
          />
        )}
        {isVisible('search') && (
          <Input
            label="Search"
            placeholder="ID, policy, account, or keyword…"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
        )}
        {isVisible('requester') && (
          <Input
            label="Requester"
            placeholder="Filter by Requester Name"
            value={filters.requester}
            onChange={(e) => setFilters((prev) => ({ ...prev, requester: e.target.value }))}
          />
        )}
        {isVisible('submittedBy') && (
          <Input
            label="Submitted by (EasyVista)"
            placeholder="Filter by admin username"
            value={filters.submittedBy}
            onChange={(e) => setFilters((prev) => ({ ...prev, submittedBy: e.target.value }))}
          />
        )}
        {isVisible('createdVia') && (
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
        )}
        {isVisible('year') && (
          <Input
            label="Year"
            placeholder="YYYY"
            value={filters.year}
            onChange={(e) => setFilters((prev) => ({ ...prev, year: e.target.value }))}
          />
        )}
        {isVisible('inJira') && (
          <Select
            label="In JIRA"
            value={filters.inJira}
            onChange={(e) => setFilters((prev) => ({ ...prev, inJira: e.target.value }))}
          >
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        )}
        {isVisible('easyvistaNumber') && (
          <Input
            label="EASYVISTA #"
            placeholder="e.g. EV-123456"
            value={filters.easyvistaNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, easyvistaNumber: e.target.value }))}
          />
        )}
        {isVisible('jiraNumber') && (
          <Input
            label="JIRA #"
            placeholder="e.g. JIRA-123"
            value={filters.jiraNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, jiraNumber: e.target.value }))}
          />
        )}
        {isVisible('releaseNumber') && (
          <Input
            label="Release #"
            placeholder="e.g. v1.0.0"
            value={filters.releaseNumber}
            onChange={(e) => setFilters((prev) => ({ ...prev, releaseNumber: e.target.value }))}
          />
        )}
        <Button
          kind="ghost"
          type="button"
          onClick={onOpenCustomize}
        >
          Customize View
        </Button>
        <Button
          kind="ghost"
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(ADMIN_FILTERS_STORAGE_KEY);
              window.localStorage.removeItem(ADMIN_RETIRED_FILTER_STORAGE_KEY);
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
    </>
  );
}
