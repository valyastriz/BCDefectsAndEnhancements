// ── Filter utilities for admin dashboard ────────────────────────────────────
import {
  ADMIN_FILTERS_STORAGE_KEY,
  ADMIN_RETIRED_FILTER_STORAGE_KEY,
} from '../constants/adminConstants';
import { formatMetaTypeLabel } from './formatUtils';
import { areAllSelected, normalizeRetiredFilter } from './filterShared';

/**
 * Check whether every status option is currently selected.
 */
export function areAllStatusesSelected(values, options) {
  return areAllSelected(values, options);
}

/**
 * Return a fresh default-filters object with empty/default values.
 */
export function buildDefaultFilters() {
  return {
    statuses: [],
    retiredFilter: 'non_retired',
    types: [],
    cleanupRequired: '',
    cleanupStatuses: [],
    search: '',
    requester: '',
    submittedBy: '',
    createdVia: '',
    year: '',
    inJira: '',
    jiraNumber: '',
    easyvistaNumber: '',
    releaseNumber: '',
    sort: 'updated_desc',
  };
}

/**
 * Normalize a saved statuses value from localStorage.
 */
export function normalizeSavedAdminStatuses(statusesValue, statusSelectionMode = 'legacy') {
  if (statusSelectionMode === 'all' || statusSelectionMode === 'legacy') {
    return [];
  }
  if (!Array.isArray(statusesValue) || statusesValue.length === 0) {
    return [];
  }
  return statusesValue;
}

/**
 * Read admin filters from localStorage with robust fallbacks.
 */
export function readSavedAdminFilters() {
  const defaults = buildDefaultFilters();
  if (typeof window === 'undefined') return defaults;

  const savedRetiredFilter = window.localStorage.getItem(ADMIN_RETIRED_FILTER_STORAGE_KEY);
  const normalizedRetiredFilter = normalizeRetiredFilter(savedRetiredFilter, defaults.retiredFilter);

  const raw = window.localStorage.getItem(ADMIN_FILTERS_STORAGE_KEY);
  if (!raw) {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }

  try {
    const parsed = JSON.parse(raw);
    const retiredFilter = normalizeRetiredFilter(parsed?.retiredFilter, normalizedRetiredFilter);
    const statusSelectionMode = parsed?.statusSelectionMode === 'all'
      ? 'all'
      : (parsed?.statusSelectionMode === 'custom' ? 'custom' : 'legacy');
    const statusesFromStorage = normalizeSavedAdminStatuses(parsed?.statuses, statusSelectionMode);

    return {
      ...defaults,
      statuses: statusesFromStorage.length > 0 ? statusesFromStorage : defaults.statuses,
      retiredFilter,
      types: Array.isArray(parsed?.types) ? parsed.types
        : (typeof parsed?.type === 'string' && parsed.type ? [formatMetaTypeLabel(parsed.type)] : defaults.types),
      cleanupRequired: typeof parsed?.cleanupRequired === 'string' ? parsed.cleanupRequired : defaults.cleanupRequired,
      cleanupStatuses: Array.isArray(parsed?.cleanupStatuses) ? parsed.cleanupStatuses : defaults.cleanupStatuses,
      search: typeof parsed?.search === 'string' ? parsed.search : defaults.search,
      requester: typeof parsed?.requester === 'string' ? parsed.requester : defaults.requester,
      submittedBy: typeof parsed?.submittedBy === 'string' ? parsed.submittedBy : defaults.submittedBy,
      createdVia: typeof parsed?.createdVia === 'string' ? parsed.createdVia : defaults.createdVia,
      year: typeof parsed?.year === 'string' ? parsed.year : defaults.year,
      inJira: typeof parsed?.inJira === 'string' ? parsed.inJira : defaults.inJira,
      jiraNumber: typeof parsed?.jiraNumber === 'string' ? parsed.jiraNumber : defaults.jiraNumber,
      easyvistaNumber: typeof parsed?.easyvistaNumber === 'string' ? parsed.easyvistaNumber : defaults.easyvistaNumber,
      releaseNumber: typeof parsed?.releaseNumber === 'string' ? parsed.releaseNumber : defaults.releaseNumber,
      sort: typeof parsed?.sort === 'string' && parsed.sort.trim() ? parsed.sort : defaults.sort,
    };
  } catch {
    return { ...defaults, retiredFilter: normalizedRetiredFilter };
  }
}

/**
 * Convenience wrapper — returns filters from localStorage (or defaults).
 */
export function defaultFilters() {
  return readSavedAdminFilters();
}
