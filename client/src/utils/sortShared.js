// ── Sort helpers shared by the admin queue and the public status board ──────
//
// Both surfaces sort the same way — a field plus a direction, written as one
// string value ('updated_desc') — over different registries of fields. The
// registry differs; the mechanics do not, so they live here once.

// Direction wording per field type. First entry is that type's default, which
// preserves the existing habit of numeric columns opening high→low.
export const SORT_DIRECTIONS_BY_TYPE = {
  date: [{ dir: 'desc', label: 'Newest first' }, { dir: 'asc', label: 'Oldest first' }],
  number: [{ dir: 'desc', label: 'Highest first' }, { dir: 'asc', label: 'Lowest first' }],
  text: [{ dir: 'asc', label: 'A → Z' }, { dir: 'desc', label: 'Z → A' }],
  bool: [{ dir: 'desc', label: 'Yes first' }, { dir: 'asc', label: 'No first' }],
};

/** Direction options for a field type, defaulting to text wording. */
export function directionsForType(type) {
  return SORT_DIRECTIONS_BY_TYPE[type] || SORT_DIRECTIONS_BY_TYPE.text;
}

/** The default direction for a field type — numbers open high→low. */
export function defaultDirectionFor(type) {
  return directionsForType(type)[0].dir;
}

/**
 * Bind the helpers above to one surface's registry.
 *
 * `fields` is the ordered [{ key, label, type }] list the sort control offers;
 * `cols` maps each key to its { asc, desc } value pair; `fallbackKey` is the
 * field an unknown or legacy stored value falls back to.
 */
export function createSortRegistry(fields, cols, fallbackKey) {
  const fieldByKeyMap = new Map(fields.map((field) => [field.key, field]));

  /** Look up a sort field definition by its registry key. */
  function fieldByKey(key) {
    return fieldByKeyMap.get(key) || null;
  }

  /**
   * Resolve a raw sort value (e.g. 'updated_desc') back to { field, dir }.
   * Unknown or legacy values fall back to the surface's default sort.
   */
  function parseSortValue(sortValue) {
    for (const field of fields) {
      const pair = cols[field.key];
      if (!pair) continue;
      if (sortValue === pair.asc) return { field, dir: 'asc' };
      if (sortValue === pair.desc) return { field, dir: 'desc' };
    }
    return { field: fieldByKeyMap.get(fallbackKey) || null, dir: 'desc' };
  }

  /** The field type behind a column key ('text' when unknown). */
  function typeForColumn(colKey) {
    const pair = cols[colKey];
    if (!pair) return 'text';
    return parseSortValue(pair.asc)?.field?.type || 'text';
  }

  /** The stored value for a field key and direction, or null. */
  function sortValueFor(key, dir) {
    return cols[key]?.[dir] || null;
  }

  return { fieldByKey, parseSortValue, typeForColumn, sortValueFor };
}
