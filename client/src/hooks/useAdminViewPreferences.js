import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
  ADMIN_TABLE_COLUMNS,
  ADMIN_VIEW_PREFS_STORAGE_KEY,
  ALL_COLUMN_KEYS,
  ALL_FILTER_KEYS,
  DEFAULT_VISIBLE_COLUMN_KEYS,
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

function writeCache(columns, filters) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADMIN_VIEW_PREFS_STORAGE_KEY, JSON.stringify({ columns, filters }));
  } catch {
    // Cache is best-effort; the server remains the source of truth.
  }
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
function resolveFilters(raw) {
  const fils = sanitizeKeys(raw?.filters, KNOWN_FILTER_KEYS);
  return fils !== null ? fils : DEFAULT_VISIBLE_FILTER_KEYS;
}

export function useAdminViewPreferences() {
  // Seed from the local cache (lazy init) so the first paint matches the last
  // known view; the server fetch below then reconciles to the source of truth.
  const [columns, setColumns] = useState(() => resolveColumns(readCache()));
  const [filters, setFiltersState] = useState(() => resolveFilters(readCache()));

  useEffect(() => {
    let cancelled = false;
    api.getAdminViewPreferences()
      .then((server) => {
        if (cancelled) return;
        const cols = resolveColumns(server);
        const fils = resolveFilters(server);
        setColumns(cols);
        setFiltersState(fils);
        writeCache(cols, fils);
      })
      .catch(() => {
        // Offline / not authenticated yet — keep cached or default view.
      });
    return () => { cancelled = true; };
  }, []);

  const saveView = useCallback(async ({ columns: nextColumns, filters: nextFilters }) => {
    const cleanCols = sanitizeKeys(nextColumns, KNOWN_COLUMN_KEYS) || [];
    const cleanFils = sanitizeKeys(nextFilters, KNOWN_FILTER_KEYS) || [];
    const cols = cleanCols.length > 0 ? cleanCols : DEFAULT_VISIBLE_COLUMN_KEYS;
    setColumns(cols);
    setFiltersState(cleanFils);
    writeCache(cols, cleanFils);
    try {
      await api.saveAdminViewPreferences({ columns: cols, filters: cleanFils });
    } catch {
      // Optimistic update stands; the cache preserves the choice locally.
    }
  }, []);

  const resetView = useCallback(async () => {
    setColumns(DEFAULT_VISIBLE_COLUMN_KEYS);
    setFiltersState(DEFAULT_VISIBLE_FILTER_KEYS);
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

  return {
    columns,
    filters,
    orderedVisibleColumns,
    saveView,
    resetView,
  };
}
