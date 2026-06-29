const { ADMIN_VIEW_COLUMN_KEYS, ADMIN_VIEW_FILTER_KEYS } = require('../constants');

const COLUMN_KEY_SET = new Set(ADMIN_VIEW_COLUMN_KEYS);
const FILTER_KEY_SET = new Set(ADMIN_VIEW_FILTER_KEYS);

/**
 * Allow-list a saved list of keys: keep only known keys, drop duplicates, and
 * preserve the caller's order (column order is meaningful). Non-array input
 * collapses to an empty list.
 */
function sanitizeKeyList(value, allowedSet) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key || !allowedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

/**
 * Validate an incoming view preference payload down to known column/filter keys.
 * Pure (no DB) so it can be unit-tested in isolation.
 */
function sanitizeViewPreference({ columns, filters } = {}) {
  return {
    columns: sanitizeKeyList(columns, COLUMN_KEY_SET),
    filters: sanitizeKeyList(filters, FILTER_KEY_SET),
  };
}

function parseStoredList(value, allowedSet) {
  if (!value) return null;
  try {
    return sanitizeKeyList(JSON.parse(String(value)), allowedSet);
  } catch {
    return null;
  }
}

/**
 * Read the current admin's saved view, or { columns: null, filters: null } when
 * no row exists (the client then applies its defaults).
 */
async function getViewPreference(db, userId) {
  const row = await db.get(
    'SELECT columns_json, filters_json FROM admin_view_preferences WHERE user_id = ?',
    [userId],
  );
  if (!row) return { columns: null, filters: null };
  return {
    columns: parseStoredList(row.columns_json, COLUMN_KEY_SET),
    filters: parseStoredList(row.filters_json, FILTER_KEY_SET),
  };
}

/**
 * Upsert the current admin's view preference (validated). Returns the stored
 * shape so the client can reconcile against what was actually persisted.
 */
async function saveViewPreference(db, userId, payload) {
  const clean = sanitizeViewPreference(payload);
  const columnsJson = JSON.stringify(clean.columns);
  const filtersJson = JSON.stringify(clean.filters);
  const updatedAt = new Date().toISOString();

  const existing = await db.get(
    'SELECT id FROM admin_view_preferences WHERE user_id = ?',
    [userId],
  );
  if (existing) {
    await db.run(
      'UPDATE admin_view_preferences SET columns_json = ?, filters_json = ?, updated_at = ? WHERE user_id = ?',
      [columnsJson, filtersJson, updatedAt, userId],
    );
  } else {
    await db.run(
      'INSERT INTO admin_view_preferences (user_id, columns_json, filters_json, updated_at) VALUES (?, ?, ?, ?)',
      [userId, columnsJson, filtersJson, updatedAt],
    );
  }
  return clean;
}

/**
 * Reset to default by removing the admin's saved row (defaults then apply).
 */
async function resetViewPreference(db, userId) {
  await db.run('DELETE FROM admin_view_preferences WHERE user_id = ?', [userId]);
  return { columns: null, filters: null };
}

module.exports = {
  sanitizeViewPreference,
  getViewPreference,
  saveViewPreference,
  resetViewPreference,
};
