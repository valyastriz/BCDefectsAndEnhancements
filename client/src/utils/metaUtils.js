// ── Meta-management utility ─────────────────────────────────────────────────

/**
 * Check whether a meta item is the protected "Retired" status entry.
 * Used to prevent accidental deletion/reorder of the Retired status.
 */
export function isProtectedRetiredStatusMetaItem(categoryKey, item) {
  if (String(categoryKey || '') !== 'statuses') return false;
  const itemName = String(item?.name || '').trim().toLowerCase();
  return itemName === 'retired' || Boolean(item?.isRetired);
}
