// Shared filter helpers used by both the admin and public filter utilities.

export const RETIRED_FILTER_MODES = ['non_retired', 'retired_only', 'all'];

/**
 * True when `values` contains exactly the same members as `options`.
 */
export function areAllSelected(values, options) {
  if (!Array.isArray(values) || !Array.isArray(options) || values.length !== options.length) {
    return false;
  }
  const selected = new Set(values);
  return options.every((value) => selected.has(value));
}

/**
 * Coerce a persisted retired-filter value to a known mode, else the fallback.
 */
export function normalizeRetiredFilter(value, fallback = 'non_retired') {
  return RETIRED_FILTER_MODES.includes(value) ? value : fallback;
}
