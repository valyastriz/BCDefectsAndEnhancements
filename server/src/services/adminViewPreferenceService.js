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
function sanitizeViewPreference({ columns, filters, reportColumns, pinnedApplication } = {}) {
  return {
    columns: sanitizeKeyList(columns, COLUMN_KEY_SET),
    // The report-request queue keeps its OWN column set. The two kinds of work do
    // not share a useful set of columns — a report request has no Service Desk
    // number, no JIRA card and no cleanup status, and does have an assignee — so
    // one saved view serving both means customising either one spoils the other.
    reportColumns: sanitizeKeyList(reportColumns, COLUMN_KEY_SET),
    filters: sanitizeKeyList(filters, FILTER_KEY_SET),
    pinnedApplication: sanitizePinnedApplication(pinnedApplication),
  };
}

/**
 * Read a stored column set, accepting both shapes.
 *
 * `columns_json` used to hold a bare array and now holds
 * `{ default: [...], report: [...] }`. Stored in the one TEXT column rather than
 * a new one because it is the same preference asked twice, and because a shape
 * change costs nothing here while a migration on a live table is not free.
 *
 * A legacy array reads as the default set with no report set, which is exactly
 * what an admin who saved a view before this existed should see: their view,
 * untouched, and the report defaults until they customise those too.
 */
function parseStoredColumns(value) {
  if (!value) return { columns: null, reportColumns: null };
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) {
      return { columns: sanitizeKeyList(parsed, COLUMN_KEY_SET), reportColumns: null };
    }
    return {
      columns: parsed?.default ? sanitizeKeyList(parsed.default, COLUMN_KEY_SET) : null,
      reportColumns: parsed?.report ? sanitizeKeyList(parsed.report, COLUMN_KEY_SET) : null,
    };
  } catch {
    return { columns: null, reportColumns: null };
  }
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
  if (!row) return { columns: null, reportColumns: null, filters: null, pinnedApplication: null };
  const stored = parseStoredColumns(row.columns_json);
  return {
    columns: stored.columns,
    reportColumns: stored.reportColumns,
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
  // Both sets in the one field. Written as an object always, so a row saved once
  // never reads back through the legacy-array branch again.
  const columnsJson = JSON.stringify({ default: clean.columns, report: clean.reportColumns });
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
