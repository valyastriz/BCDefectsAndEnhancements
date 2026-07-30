// ── Active-filter derivation (admin queue chips + counts) ───────────────────
import { ADMIN_FILTER_FIELDS } from '../constants/adminConstants';
import { buildDefaultFilters } from './filterUtils';
import { formatCreatedViaLabel } from './formatUtils';

const LABEL_BY_KEY = new Map(ADMIN_FILTER_FIELDS.map((field) => [field.key, field.label]));

// Keys the chips never describe: `retiredFilter` is the always-visible scope
// control (its state is already legible there) and `sort` is not a filter.
const NEVER_CHIPPED = new Set(['retiredFilter', 'sort']);

const YES_NO_LABELS = { yes: 'Yes', no: 'No' };

/**
 * Human-readable value for one active filter, or '' when it isn't active.
 *
 * `statuses` is special: an all-selected multi-select is the default view, not a
 * filter, so it only becomes a chip when a strict subset is chosen.
 */
function describe(key, value, statusOptionCount) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (key === 'statuses' && statusOptionCount > 0 && value.length >= statusOptionCount) return '';
    if (value.length === 1) return value[0];
    return `${value.length} selected`;
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (key === 'createdVia') return formatCreatedViaLabel(text);
  if (key === 'cleanupRequired' || key === 'inJira') return YES_NO_LABELS[text] || text;
  return text;
}

/**
 * The active filters as [{ key, label, valueLabel }].
 *
 * One derivation shared by the Filters button badge, the chips, the
 * filtered-view band's summary line and the empty state — computing it in more
 * than one place is how those four would drift apart.
 */
export function getActiveFilters(filters, statusOptionCount) {
  const defaults = buildDefaultFilters();
  const active = [];
  for (const key of Object.keys(defaults)) {
    if (NEVER_CHIPPED.has(key)) continue;
    const valueLabel = describe(key, filters?.[key], statusOptionCount);
    if (!valueLabel) continue;
    active.push({ key, label: LABEL_BY_KEY.get(key) || key, valueLabel });
  }
  return active;
}
