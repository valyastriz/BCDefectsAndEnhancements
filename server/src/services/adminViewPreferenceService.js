const {
  ADMIN_VIEW_COLUMN_KEYS,
  ADMIN_VIEW_FILTER_KEYS,
  UNASSIGNED_APPLICATION,
} = require('../constants');

const COLUMN_KEY_SET = new Set(ADMIN_VIEW_COLUMN_KEYS);
const FILTER_KEY_SET = new Set(ADMIN_VIEW_FILTER_KEYS);

// The pinned scope is stored as the application NAME, matching the value the
// queue filter already uses, plus two sentinels. Names are not validated against
// the applications table here: an application can be renamed or retired, and a
// pin that no longer resolves should quietly fall back rather than 400 on save.
const ALL_APPLICATIONS = '__all__';
const PINNED_MAX_LENGTH = 120;

/**
 * Allow-list a pinned scope. Anything unrecognisable becomes null, which reads
 * as "no pin" — the safe answer, since the client then derives from the home
 * application rather than showing the wrong queue.
 */
function sanitizePinnedApplication(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > PINNED_MAX_LENGTH) return null;
  return text;
}

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
function sanitizeViewPreference({ columns, filters, pinnedApplication } = {}) {
  return {
    columns: sanitizeKeyList(columns, COLUMN_KEY_SET),
    filters: sanitizeKeyList(filters, FILTER_KEY_SET),
    pinnedApplication: sanitizePinnedApplication(pinnedApplication),
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
  // SELECT * rather than naming pinned_application, so this keeps working
  // against a database where the boot-time sync has not added that column yet.
  // The server is documented to start even when the sync fails (src/index.js),
  // and losing an admin's whole saved view over a missing pin would be a far
  // worse failure than simply having no pin.
  const row = await db.get(
    'SELECT * FROM admin_view_preferences WHERE user_id = ?',
    [userId],
  );
  if (!row) return { columns: null, filters: null, pinnedApplication: null };
  return {
    columns: parseStoredList(row.columns_json, COLUMN_KEY_SET),
    filters: parseStoredList(row.filters_json, FILTER_KEY_SET),
    pinnedApplication: sanitizePinnedApplication(row.pinned_application),
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

  // Same reasoning as the read: if pinned_application is not there yet, still
  // save the columns and filters rather than failing the whole request. The pin
  // starts persisting on its own once the sync has run.
  try {
    if (existing) {
      await db.run(
        'UPDATE admin_view_preferences SET columns_json = ?, filters_json = ?, pinned_application = ?, updated_at = ? WHERE user_id = ?',
        [columnsJson, filtersJson, clean.pinnedApplication, updatedAt, userId],
      );
    } else {
      await db.run(
        'INSERT INTO admin_view_preferences (user_id, columns_json, filters_json, pinned_application, updated_at) VALUES (?, ?, ?, ?, ?)',
        [userId, columnsJson, filtersJson, clean.pinnedApplication, updatedAt],
      );
    }
    return clean;
  } catch (error) {
    if (!/pinned_application/i.test(String(error?.message || ''))) throw error;
    console.warn('admin_view_preferences.pinned_application is missing; saving without the pin.');
  }

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
  return { ...clean, pinnedApplication: null };
}

/**
 * Reset to default by removing the admin's saved row (defaults then apply).
 */
async function resetViewPreference(db, userId) {
  await db.run('DELETE FROM admin_view_preferences WHERE user_id = ?', [userId]);
  return { columns: null, filters: null, pinnedApplication: null };
}

module.exports = {
  sanitizeViewPreference,
  sanitizePinnedApplication,
  getViewPreference,
  saveViewPreference,
  resetViewPreference,
  ALL_APPLICATIONS,
  UNASSIGNED_APPLICATION,
};
