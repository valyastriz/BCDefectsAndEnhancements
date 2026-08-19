import { Button, Input, MultiSelectDropdown, Select } from '../bite-size/BitsizeUI';
import { ADMIN_FILTER_GROUPS } from '../../constants/adminConstants';
import { formatCreatedViaLabel } from '../../utils/formatUtils';
import { TRACKER_LABEL } from '../../constants/tracker';

/**
 * The grouped filter panel — everything except the two controls that live in the
 * command row (`search` and `retiredFilter`).
 *
 * Fourteen flat labels forced an admin to read all of them to find one; four
 * named groups let them jump. Each control is the same design-system control it
 * was before, with the same value and the same setter.
 *
 * A filter still only renders when it is in the admin's visible set — hiding a
 * filter in Customize View must keep hiding it, since the page also resets the
 * values of hidden filters so they can't silently constrain the table.
 */
export function FilterPanel({
  filters,
  setFilters,
  runtimeStatusFilterOptions,
  runtimeTypeFilterOptions,
  runtimeCreatedViaOptions,
  dynamicCleanupStatuses,
  visibleFilters,
  activeCount,
  onClose,
  onOpenCustomize,
  onResetSaved,
}) {
  const isVisible = (key) => !visibleFilters || visibleFilters.includes(key);
  const patch = (key) => (value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const CONTROLS = {
    statuses: () => (
      <MultiSelectDropdown
        label="Defect/Enhancement Status"
        options={runtimeStatusFilterOptions}
        selectedValues={filters.statuses}
        onChange={patch('statuses')}
        placeholder="Select statuses"
      />
    ),
    types: () => (
      <MultiSelectDropdown
        label="Type"
        options={runtimeTypeFilterOptions}
        selectedValues={filters.types}
        onChange={patch('types')}
        placeholder="All types"
      />
    ),
    year: () => (
      <Input
        label="Year"
        placeholder="YYYY"
        value={filters.year}
        onChange={(e) => patch('year')(e.target.value)}
      />
    ),
    cleanupRequired: () => (
      <Select
        label="Cleanup Required"
        value={filters.cleanupRequired}
        onChange={(e) => patch('cleanupRequired')(e.target.value)}
      >
        <option value="">Show All</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    ),
    cleanupStatuses: () => (
      <MultiSelectDropdown
        label="Cleanup Status"
        options={dynamicCleanupStatuses}
        selectedValues={filters.cleanupStatuses}
        onChange={patch('cleanupStatuses')}
        placeholder="All cleanup statuses"
      />
    ),
    requester: () => (
      <Input
        label="Requester"
        placeholder="Filter by Requester Name"
        value={filters.requester}
        onChange={(e) => patch('requester')(e.target.value)}
      />
    ),
    submittedBy: () => (
      <Input
        label={`Submitted by (${TRACKER_LABEL})`}
        placeholder="Filter by admin username"
        value={filters.submittedBy}
        onChange={(e) => patch('submittedBy')(e.target.value)}
      />
    ),
    createdVia: () => (
      <Select
        label="Created Via"
        value={filters.createdVia}
        onChange={(e) => patch('createdVia')(e.target.value)}
      >
        <option value="">All sources</option>
        {runtimeCreatedViaOptions.map((sourceOption) => (
          <option key={sourceOption} value={sourceOption}>{formatCreatedViaLabel(sourceOption)}</option>
        ))}
      </Select>
    ),
    easyvistaNumber: () => (
      <Input
        label="EASYVISTA #"
        placeholder="e.g. EV-123456"
        value={filters.easyvistaNumber}
        onChange={(e) => patch('easyvistaNumber')(e.target.value)}
      />
    ),
    jiraNumber: () => (
      <Input
        label="JIRA #"
        placeholder="e.g. JIRA-123"
        value={filters.jiraNumber}
        onChange={(e) => patch('jiraNumber')(e.target.value)}
      />
    ),
    releaseNumber: () => (
      <Input
        label="Release #"
        placeholder="e.g. v1.0.0"
        value={filters.releaseNumber}
        onChange={(e) => patch('releaseNumber')(e.target.value)}
      />
    ),
    inJira: () => (
      <Select
        label="In JIRA"
        value={filters.inJira}
        onChange={(e) => patch('inJira')(e.target.value)}
      >
        <option value="">All</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    ),
    // Three states, because a ticket nobody flagged is neither open nor handled.
    workaround: () => (
      <Select
        label="Workaround"
        value={filters.workaround}
        onChange={(e) => patch('workaround')(e.target.value)}
      >
        <option value="">All</option>
        <option value="open">Open request</option>
        <option value="handled">Handled</option>
        <option value="any">Requested (either)</option>
      </Select>
    ),
    // Tickets people are still reporting. The last two options are why this
    // filter exists at all: a challenged closure and a returned fix are
    // otherwise invisible, because nobody opens a rejected or a deployed ticket
    // to notice its count went up.
    recurrenceFilter: () => (
      <Select
        label="Reported again"
        value={filters.recurrenceFilter}
        onChange={(e) => patch('recurrenceFilter')(e.target.value)}
      >
        <option value="">All</option>
        <option value="any">Reported again at all</option>
        <option value="challenged">Challenged — reported after it was closed</option>
        <option value="regressed">Came back after its fix shipped</option>
        <option value="blocked">Somebody is blocked and waiting</option>
      </Select>
    ),
  };

  // Groups with no visible filters left are dropped entirely rather than
  // rendering an empty heading.
  const groups = ADMIN_FILTER_GROUPS
    .map((group) => ({ ...group, keys: group.filterKeys.filter((key) => isVisible(key) && CONTROLS[key]) }))
    .filter((group) => group.keys.length > 0);

  return (
    <div className="filter-panel" id="admin-filter-panel">
      <div className="filter-panel-head">
        <h4>All filters</h4>
        <span className="filter-panel-count">
          {activeCount === 0 ? 'None applied' : `${activeCount} applied`}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          Every filter is hidden in your saved view. Use Customize view to bring some back.
        </p>
      ) : (
        <div className="filter-groups">
          {groups.map((group) => (
            <div className="filter-group" key={group.key}>
              <span className="filter-group-label">{group.label}</span>
              {group.keys.map((key) => (
                <div key={key}>{CONTROLS[key]()}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="filter-panel-foot">
        <button type="button" className="bs-link-btn" onClick={onResetSaved}>
          Reset to my saved defaults
        </button>
        <div className="bs-actions">
          <Button type="button" kind="ghost" onClick={onOpenCustomize}>Customize view</Button>
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
