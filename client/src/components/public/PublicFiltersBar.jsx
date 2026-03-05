import {
  Button,
  Input,
  MultiSelectDropdown,
  Select,
} from '../bite-size/BitsizeUI';

/**
 * Filter controls for the public status board.
 */
export function PublicFiltersBar({
  search,
  setSearch,
  typeFilter,
  setTypeFilter,
  dynamicPublicTypes,
  selectedStatuses,
  setSelectedStatuses,
  dynamicPublicStatuses,
  retiredFilter,
  setRetiredFilter,
  sortBy,
  setSortBy,
  onClear,
}) {
  return (
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
      <Button kind="ghost" type="button" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
