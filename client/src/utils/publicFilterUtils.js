/**
 * Public status board filter utilities.
 *
 * The board holds one `filters` object rather than a state per control, the way
 * the admin queue does — the chips, the Filters badge, the band's summary line
 * and the no-matches state all have to describe the same thing, and deriving
 * them from one object is what keeps them from drifting apart.
 */
import {
  PUBLIC_STATUSES,
  PUBLIC_FILTERS_STORAGE_KEY,
  PUBLIC_RETIRED_FILTER_STORAGE_KEY,
  PUBLIC_FILTER_FIELDS,
  PUBLIC_STAGES,
  STAGED_STATUSES,
  DEFAULT_PUBLIC_SORT,
} from '../constants/publicConstants';
import { areAllSelected, normalizeRetiredFilter } from './filterShared';

// The Stage control's value for "anything that is not on the pipeline".
export const CLOSED_STAGE = 'closed';

const LABEL_BY_KEY = new Map(PUBLIC_FILTER_FIELDS.map((field) => [field.key, field.label]));

// Keys the chips never describe: `retiredFilter` is the always-visible scope
// control (its state is already legible there), `mineOnly` is the segmented
// All/Mine control beside it, and `sort` is not a filter.
const NEVER_CHIPPED = new Set(['retiredFilter', 'mineOnly', 'sort']);

/**
 * Check whether every option in `options` is present in `values`.
 */
export function areAllPublicStatusesSelected(values, options) {
  return areAllSelected(values, options);
}

/**
 * The board's filter state with nothing applied.
 *
 * `application` is deliberately not part of this: which queue you are looking
 * at is resolved once from the viewer envelope, so the page owns it and
 * "clear filters" must not throw it away.
 */
export function buildDefaultPublicFilters() {
  return {
    search: '',
    typeFilter: '',
    statuses: [...PUBLIC_STATUSES],
    year: '',
    easyvistaNumber: '',
    jiraNumber: '',
    referenceNumber: '',
    createdBy: '',
    retiredFilter: 'non_retired',
    mineOnly: false,
    sort: DEFAULT_PUBLIC_SORT,
  };
}

/**
 * Normalize a persisted statuses array against the canonical list.
 */
export function normalizeSavedPublicStatuses(statusesValue, statusSelectionMode = 'legacy') {
  if (statusSelectionMode === 'all') {
    return [...PUBLIC_STATUSES];
  }

  if (!Array.isArray(statusesValue)) {
    return [...PUBLIC_STATUSES];
  }

  const normalized = statusesValue.filter((value) => PUBLIC_STATUSES.includes(value));
  if (normalized.length === 0) {
    return [...PUBLIC_STATUSES];
  }

  if (statusSelectionMode === 'legacy') {
    return [...PUBLIC_STATUSES];
  }

  return normalized;
}

// ── Stage ⇄ statuses ────────────────────────────────────────────────────────
// Stage is not state of its own. The tiles and the Stage select are two ways of
// writing `filters.statuses`, the same way the column headers and the sort
// control are two ways of writing `filters.sort` — otherwise picking a tile and
// picking a stage could disagree about what the board is showing.

/** The statuses one stage covers, within the statuses this board knows about. */
export function statusesForStage(stageKey, allStatuses) {
  if (!stageKey) return [...allStatuses];
  if (stageKey === CLOSED_STAGE) return allStatuses.filter((status) => !STAGED_STATUSES.has(status));
  const stage = PUBLIC_STAGES.find((candidate) => candidate.key === stageKey);
  if (!stage) return [...allStatuses];
  return allStatuses.filter((status) => stage.statuses.includes(status));
}

/** The stage a status selection represents, or '' when it is not exactly one. */
export function stageForStatuses(statuses, allStatuses) {
  if (areAllSelected(statuses, allStatuses)) return '';
  const keys = [...PUBLIC_STAGES.map((stage) => stage.key), CLOSED_STAGE];
  return keys.find((key) => areAllSelected(statuses, statusesForStage(key, allStatuses))) || '';
}

const readText = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

/**
 * Build the initial public filter state from localStorage (or defaults).
 *
 * Tolerates the shape the board saved before it had a grouped filter panel:
 * that JSON carried `selectedStatuses` and `sortBy`, and none of the reference
 * or people filters. A stored key that no longer exists is ignored; one that
 * did not exist yet falls back to its default.
 */
export function readSavedPublicFilters() {
  const defaults = buildDefaultPublicFilters();

  if (typeof window === 'undefined') return defaults;

  const savedRetiredFilter = window.localStorage.getItem(PUBLIC_RETIRED_FILTER_STORAGE_KEY);
  const normalizedRetiredFilter = normalizeRetiredFilter(savedRetiredFilter, defaults.retiredFilter);

  const raw = window.localStorage.getItem(PUBLIC_FILTERS_STORAGE_KEY);
  if (!raw) {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }

  try {
    const parsed = JSON.parse(raw);
    const statusSelectionMode = parsed?.statusSelectionMode === 'all'
      ? 'all'
      : (parsed?.statusSelectionMode === 'custom' ? 'custom' : 'legacy');

    // `selectedStatuses` and `sortBy` are the pre-panel key names.
    const statuses = normalizeSavedPublicStatuses(
      Array.isArray(parsed?.statuses) ? parsed.statuses : parsed?.selectedStatuses,
      statusSelectionMode,
    );
    const storedSort = readText(parsed?.sort) || readText(parsed?.sortBy);

    return {
      ...defaults,
      search: readText(parsed?.search, defaults.search),
      typeFilter: readText(parsed?.typeFilter, defaults.typeFilter),
      statuses,
      year: readText(parsed?.year, defaults.year),
      easyvistaNumber: readText(parsed?.easyvistaNumber, defaults.easyvistaNumber),
      jiraNumber: readText(parsed?.jiraNumber, defaults.jiraNumber),
      referenceNumber: readText(parsed?.referenceNumber, defaults.referenceNumber),
      createdBy: readText(parsed?.createdBy, defaults.createdBy),
      retiredFilter: normalizeRetiredFilter(parsed?.retiredFilter, normalizedRetiredFilter),
      mineOnly: Boolean(parsed?.mineOnly),
      sort: storedSort.trim() ? storedSort : defaults.sort,
    };
  } catch {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }
}

/**
 * Human-readable value for one active filter, or '' when it isn't active.
 *
 * `statuses` is special, the same way it is on the admin queue: an all-selected
 * multi-select is the default view, not a filter, so it only becomes a chip
 * when a strict subset is chosen.
 */
function describe(key, value, statusOptions) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (key === 'statuses' && areAllSelected(value, statusOptions)) return '';
    if (value.length === 1) return value[0];
    return `${value.length} selected`;
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (key === 'typeFilter') return text.charAt(0).toUpperCase() + text.slice(1);
  return text;
}

/**
 * The active filters as [{ key, label, valueLabel }].
 *
 * One derivation shared by the Filters button badge, the chips, the list band's
 * summary line and the no-matches state.
 */
export function getActivePublicFilters(filters, statusOptions = PUBLIC_STATUSES) {
  const defaults = buildDefaultPublicFilters();
  const active = [];
  for (const key of Object.keys(defaults)) {
    if (NEVER_CHIPPED.has(key)) continue;
    const valueLabel = describe(key, filters?.[key], statusOptions);
    if (!valueLabel) continue;
    active.push({ key, label: LABEL_BY_KEY.get(key) || key, valueLabel });
  }
  return active;
}

/**
 * Does this row pass everything the filters ask for?
 *
 * `isMine` is passed in rather than read off the row: ownership has two sources
 * (the server's is_mine for a signed-in reporter, this browser's remembered ids
 * otherwise) and useViewer.isMine is the single place that decides between them.
 *
 * `statusOptions` is what the board currently offers. When every one of them is
 * selected — the default, and what "clear filters" returns to — the status
 * whitelist is dropped rather than applied, so a ticket sitting on a status
 * that has since been retired from the metadata does not silently vanish from
 * an unfiltered board. The admin queue does the same thing for the same reason
 * (AdminDashboardPage.loadRows).
 */
export function matchesPublicFilters(item, filters, isMine, statusOptions = PUBLIC_STATUSES) {
  const isRetired = Boolean(item.is_retired) || String(item.status || '') === 'Retired';
  if (filters.retiredFilter === 'retired_only' && !isRetired) return false;
  if (filters.retiredFilter === 'non_retired' && isRetired) return false;
  if (filters.mineOnly && !isMine(item)) return false;
  if (filters.typeFilter && item.type !== filters.typeFilter) return false;

  const everyStatusSelected = areAllSelected(filters.statuses, statusOptions);
  if (!everyStatusSelected && filters.statuses.length > 0 && !filters.statuses.includes(item.status)) {
    return false;
  }

  if (filters.year.trim()) {
    const reportedYear = String(new Date(item.created_at || '').getFullYear());
    if (reportedYear !== filters.year.trim()) return false;
  }

  const contains = (value, needle) => String(value || '').toLowerCase().includes(needle);

  const easyvista = filters.easyvistaNumber.trim().toLowerCase();
  if (easyvista && !contains(item.easyvista_ticket_id, easyvista)) return false;

  const jira = filters.jiraNumber.trim().toLowerCase();
  if (jira && !contains(item.jira_number, jira)) return false;

  // One box for two numbers: a reporter looking up "8842190" does not care
  // whether it was filed as the policy or the account.
  const reference = filters.referenceNumber.trim().toLowerCase();
  if (reference && !contains(item.policy_num, reference) && !contains(item.account_num, reference)) {
    return false;
  }

  const reporter = filters.createdBy.trim().toLowerCase();
  if (reporter && !contains(item.created_by, reporter)) return false;

  const query = filters.search.trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    item.id, item.created_by, item.policy_num, item.account_num,
    item.summary_of_issue, item.what_happened_exact_details, item.request,
    item.easyvista_ticket_id, item.jira_number,
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  return haystack.includes(query);
}
