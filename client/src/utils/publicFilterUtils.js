/**
 * Public status board filter utilities.
 */
import {
  PUBLIC_STATUSES,
  PUBLIC_FILTERS_STORAGE_KEY,
  PUBLIC_RETIRED_FILTER_STORAGE_KEY,
} from '../constants/publicConstants';

/**
 * Check whether every option in `options` is present in `values`.
 */
export function areAllPublicStatusesSelected(values, options) {
  if (!Array.isArray(values) || !Array.isArray(options) || values.length !== options.length) {
    return false;
  }
  const selected = new Set(values);
  return options.every((value) => selected.has(value));
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

/**
 * Build the initial public filter state from localStorage (or defaults).
 */
export function readSavedPublicFilters() {
  const defaults = {
    search: '',
    typeFilter: '',
    selectedStatuses: [...PUBLIC_STATUSES],
    retiredFilter: 'non_retired',
    sortBy: 'updated_desc',
  };

  if (typeof window === 'undefined') return defaults;

  const savedRetiredFilter = window.localStorage.getItem(PUBLIC_RETIRED_FILTER_STORAGE_KEY);
  const normalizedRetiredFilter = ['non_retired', 'retired_only', 'all'].includes(savedRetiredFilter)
    ? savedRetiredFilter
    : defaults.retiredFilter;

  const raw = window.localStorage.getItem(PUBLIC_FILTERS_STORAGE_KEY);
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
