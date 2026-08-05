import { Button, Input, MultiSelectDropdown, Select } from '../bite-size/BitsizeUI';
import { ALL_APPLICATIONS, PUBLIC_FILTER_GROUPS, PUBLIC_STAGES } from '../../constants/publicConstants';
import { CLOSED_STAGE, stageForStatuses, statusesForStage } from '../../utils/publicFilterUtils';

/**
 * The grouped filter panel for the status board — the public twin of the admin
 * queue's FilterPanel, drawn closed until the Filters button opens it.
 *
 * Every control here reads a field the public payload actually carries
 * (PUBLIC_SUBMISSION_FIELDS in server/src/helpers/mappers.js). Nothing internal
 * is filterable, because nothing internal is on this surface to filter.
 *
 * `Stage` is not a filter of its own: it reads and writes `statuses`, exactly
 * as the tiles above the list do.
 */
export function PublicFilterPanel({
  filters,
  setFilters,
  statusOptions,
  typeOptions,
  applications,
  activeCount,
  onClose,
  onReset,
}) {
  const patch = (key) => (value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const stage = stageForStatuses(filters.statuses, statusOptions);

  const CONTROLS = {
    typeFilter: () => (
      <Select
        label="Type"
        value={filters.typeFilter}
        onChange={(event) => patch('typeFilter')(event.target.value)}
      >
        <option value="">All types</option>
        {typeOptions.includes('defect') && <option value="defect">Defect</option>}
        {typeOptions.includes('enhancement') && <option value="enhancement">Enhancement</option>}
      </Select>
    ),
    statuses: () => (
      <MultiSelectDropdown
        label="Status"
        options={statusOptions}
        selectedValues={filters.statuses}
        onChange={patch('statuses')}
        placeholder="Select statuses"
      />
    ),
    year: () => (
      <Input
        label="Reported in year"
        placeholder="YYYY"
        inputMode="numeric"
        value={filters.year}
        onChange={(event) => patch('year')(event.target.value)}
      />
    ),
    stage: () => (
      <Select
        label="Stage"
        value={stage}
        onChange={(event) => patch('statuses')(statusesForStage(event.target.value, statusOptions))}
      >
        <option value="">Any stage</option>
        {PUBLIC_STAGES.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
        <option value={CLOSED_STAGE}>Closed outcome</option>
      </Select>
    ),
    retiredFilter: () => (
      <Select
        label="Retired"
        value={filters.retiredFilter}
        onChange={(event) => patch('retiredFilter')(event.target.value)}
      >
        <option value="non_retired">Active only</option>
        <option value="retired_only">Retired only</option>
        <option value="all">Show all</option>
      </Select>
    ),
    easyvistaNumber: () => (
      <Input
        label="Incident #"
        placeholder="e.g. EV-41001"
        value={filters.easyvistaNumber}
        onChange={(event) => patch('easyvistaNumber')(event.target.value)}
      />
    ),
    jiraNumber: () => (
      <Input
        label="JIRA #"
        placeholder="e.g. JIRA-101"
        value={filters.jiraNumber}
        onChange={(event) => patch('jiraNumber')(event.target.value)}
      />
    ),
    referenceNumber: () => (
      <Input
        label="Policy / Account #"
        placeholder="Either number"
        value={filters.referenceNumber}
        onChange={(event) => patch('referenceNumber')(event.target.value)}
      />
    ),
    createdBy: () => (
      <Input
        label="Reported by"
        placeholder="Filter by reporter"
        value={filters.createdBy}
        onChange={(event) => patch('createdBy')(event.target.value)}
      />
    ),
    // Only where there is more than one to choose between — a board with a
    // single application has nothing to switch to.
    application: () => (applications.length > 1 ? (
      <Select
        label="Application"
        value={filters.application || ALL_APPLICATIONS}
        onChange={(event) => patch('application')(event.target.value)}
      >
        <option value={ALL_APPLICATIONS}>All applications</option>
        {applications.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </Select>
    ) : null),
  };

  // Groups whose every control rendered nothing are dropped rather than left as
  // an empty heading.
  const groups = PUBLIC_FILTER_GROUPS
    .map((group) => ({
      ...group,
      controls: group.filterKeys
        .map((key) => ({ key, node: CONTROLS[key] ? CONTROLS[key]() : null }))
        .filter((control) => control.node !== null),
    }))
    .filter((group) => group.controls.length > 0);

  return (
    <div className="pb-filters" id="public-filter-panel">
      <div className="pb-filters-head">
        <h4>All filters</h4>
        <span className="pb-filters-count">
          {activeCount === 0 ? 'None applied' : `${activeCount} applied`}
        </span>
      </div>

      <div className="pb-filter-groups">
        {groups.map((group) => (
          <div className="pb-filter-group" key={group.key}>
            <span className="pb-filter-group-label">{group.label}</span>
            {group.controls.map((control) => (
              <div key={control.key}>{control.node}</div>
            ))}
          </div>
        ))}
      </div>

      <div className="pb-filters-foot">
        <button type="button" className="pb-linkbtn" onClick={onReset}>
          Reset to defaults
        </button>
        <div className="bs-actions">
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
