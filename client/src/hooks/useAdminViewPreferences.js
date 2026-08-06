import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
  ADMIN_TABLE_COLUMNS,
  ADMIN_VIEW_PREFS_STORAGE_KEY,
  ALL_COLUMN_KEYS,
  ALL_FILTER_KEYS,
  DEFAULT_VISIBLE_COLUMN_KEYS,
  DEFAULT_VISIBLE_REPORT_COLUMN_KEYS,
  DEFAULT_VISIBLE_FILTER_KEYS,
} from '../constants/adminConstants';

const COLUMN_BY_KEY = new Map(ADMIN_TABLE_COLUMNS.map((column) => [column.key, column]));
// Sanitize against the FULL registries, not the default visible sets: the
// defaults are a subset, and a saved view may legitimately hold any registry key
// (e.g. an admin who kept `policyPremium` visible). Narrowing these to the
// defaults would silently strip such columns from saved views on every load.
const KNOWN_COLUMN_KEYS = new Set(ALL_COLUMN_KEYS);
const KNOWN_FILTER_KEYS = new Set(ALL_FILTER_KEYS);

/** Keep only known keys, drop duplicates, preserve order. null when not an array. */
function sanitizeKeys(list, allowed) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const key = typeof raw === 'string' ? raw : '';
    if (key && allowed.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

function readCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ADMIN_VIEW_PREFS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(columns, filters, pinnedApplication, reportColumns) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      ADMIN_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ columns, filters, pinnedApplication, reportColumns }),
    );
  } catch {
    // Cache is best-effort; the server remains the source of truth.
  }
}

// The queue scope this admin pinned, or null. A string is the application name;
// '__all__' is an explicit pin on every application, which is NOT the same as
// having no pin at all — one is a decision, the other is a blank slate that
// falls back to the home application.
function resolvePinned(raw) {
  const value = raw?.pinnedApplication;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

/**
 * Per-admin view preferences: which table columns show (and in what order) and
 * which filters show. The server is the source of truth (survives clearing
 * localStorage); the cache only avoids a flash before the server responds.
 *
 * Model: the saved list IS the visible set. A null/missing list (no saved row)
 * means "use defaults" (everything visible). An explicit empty filters list is a
 * valid "hide all filters" choice.
 */
// Resolve a raw {columns, filters} payload to safe visible-key arrays, applying
// defaults. Never allows zero columns (blank table).
function resolveColumns(raw) {
  const cols = sanitizeKeys(raw?.columns, KNOWN_COLUMN_KEYS);
  return cols && cols.length > 0 ? cols : DEFAULT_VISIBLE_COLUMN_KEYS;
}
// The report queue's own set. Absent means "never customised", which falls back
// to the report defaults — NOT to the shared set, which is the whole point: an
// admin who tailored the defect queue has said nothing about this one.
function resolveReportColumns(raw) {
  const cols = sanitizeKeys(raw?.reportColumns, KNOWN_COLUMN_KEYS);
  return cols && cols.length > 0 ? cols : DEFAULT_VISIBLE_REPORT_COLUMN_KEYS;
}
function resolveFilters(raw) {
  const fils = sanitizeKeys(raw?.filters, KNOWN_FILTER_KEYS);
  return fils !== null ? fils : DEFAULT_VISIBLE_FILTER_KEYS;
}

export function useAdminViewPreferences() {
  // Seed from the local cache (lazy init) so the first paint matches the last
  // known view; the server fetch below then reconciles to the source of truth.
  const [columns, setColumns] = useState(() => resolveColumns(readCache()));
  const [reportColumns, setReportColumns] = useState(() => resolveReportColumns(readCache()));
  const [filters, setFiltersState] = useState(() => resolveFilters(readCache()));
  const [pinnedApplication, setPinnedApplication] = useState(() => resolvePinned(readCache()));
  // The queue must not pick a scope until the pin is known, or a pinned admin
  // would see All applications flash past on every load.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getAdminViewPreferences()
      .then((server) => {
        if (cancelled) return;
        const cols = resolveColumns(server);
        const reportCols = resolveReportColumns(server);
        const fils = resolveFilters(server);
        const pin = resolvePinned(server);
        setColumns(cols);
        setReportColumns(reportCols);
        setFiltersState(fils);
        setPinnedApplication(pin);
        writeCache(cols, fils, pin, reportCols);
      })
      .catch(() => {
        // Offline / not authenticated yet — keep cached or default view.
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  /**
   * Save a column layout. `forReports` says WHICH of the two sets is being
   * edited — the queue's kind switch decides that, and the other set is carried
   * through untouched, because the endpoint replaces the whole row.
   */
  const saveView = useCallback(async ({ columns: nextColumns, filters: nextFilters, forReports = false }) => {
    const cleanCols = sanitizeKeys(nextColumns, KNOWN_COLUMN_KEYS) || [];
    const cleanFils = sanitizeKeys(nextFilters, KNOWN_FILTER_KEYS) || [];
    const fallback = forReports ? DEFAULT_VISIBLE_REPORT_COLUMN_KEYS : DEFAULT_VISIBLE_COLUMN_KEYS;
    const cols = cleanCols.length > 0 ? cleanCols : fallback;

    const nextDefault = forReports ? columns : cols;
    const nextReport = forReports ? cols : reportColumns;
    if (forReports) setReportColumns(cols); else setColumns(cols);
    setFiltersState(cleanFils);
    writeCache(nextDefault, cleanFils, pinnedApplication, nextReport);
    try {
      await api.saveAdminViewPreferences({
        columns: nextDefault,
        reportColumns: nextReport,
        filters: cleanFils,
        // Carried through untouched: saving a column layout must not silently
        // drop the pin, since the endpoint replaces the whole row.
        pinnedApplication,
      });
    } catch {
      // Optimistic update stands; the cache preserves the choice locally.
    }
  }, [pinnedApplication, columns, reportColumns]);

  /**
   * Pin (or with null, unpin) the application queue this admin lands on.
   *
   * Applied optimistically — this is a preference, not data, and a failed save
   * should not bounce the control back under someone who just clicked it.
   */
  const savePinnedApplication = useCallback(async (nextPinned) => {
    const pin = typeof nextPinned === 'string' && nextPinned.trim() ? nextPinned.trim() : null;
    setPinnedApplication(pin);
    writeCache(columns, filters, pin, reportColumns);
    try {
      await api.saveAdminViewPreferences({
        columns, reportColumns, filters, pinnedApplication: pin,
      });
    } catch {
      // Optimistic update stands; the cache preserves the choice locally.
    }
  }, [columns, filters, reportColumns]);

  const resetView = useCallback(async () => {
    setColumns(DEFAULT_VISIBLE_COLUMN_KEYS);
    setReportColumns(DEFAULT_VISIBLE_REPORT_COLUMN_KEYS);
    setFiltersState(DEFAULT_VISIBLE_FILTER_KEYS);
    setPinnedApplication(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ADMIN_VIEW_PREFS_STORAGE_KEY);
    }
    try {
      await api.resetAdminViewPreferences();
    } catch {
      // Local reset stands even if the server call fails.
    }
  }, []);

  const orderedVisibleColumns = useMemo(
    () => columns.map((key) => COLUMN_BY_KEY.get(key)).filter(Boolean),
    [columns],
  );
  const orderedReportColumns = useMemo(
    () => reportColumns.map((key) => COLUMN_BY_KEY.get(key)).filter(Boolean),
    [reportColumns],
  );

  return {
    columns,
    reportColumns,
    filters,
    pinnedApplication,
    loaded,
    orderedVisibleColumns,
    orderedReportColumns,
    saveView,
    savePinnedApplication,
    resetView,
  };
}
