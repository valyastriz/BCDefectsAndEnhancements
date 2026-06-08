import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ADMIN_META_CATEGORIES } from '../constants/adminConstants';

const EMPTY_META_OPTIONS = {
  statuses: [],
  types: [],
  cleanupStatuses: [],
  cleanupTagTypes: [],
  applications: [],
  enhancementRequestTypes: [],
  priorityLevels: [],
  submissionSources: [],
  occurrenceTimeframes: [],
};

function normalizeMetaResponse(meta) {
  const normalized = {};
  for (const key of Object.keys(EMPTY_META_OPTIONS)) {
    normalized[key] = Array.isArray(meta?.[key]) ? meta[key] : [];
  }
  return normalized;
}

/**
 * Shared admin-metadata CRUD core used by both the dashboard's useAdminMeta hook
 * and the standalone AdminMetadataPage. Holds the option lists, draft names,
 * load/save/add/reorder handlers, and category selection.
 *
 * @param {Object} [options]
 * @param {Function} [options.onLoaded]   Called with the normalized meta after each load (dashboard runtime-option sync).
 * @param {Function} [options.onNotice]   Called with a success message after save/add/reorder.
 * @param {boolean}  [options.resetNoticeBeforeAction] When true, clears the notice (onNotice('')) at the start of each action.
 * @param {Function} [options.filterReorderItem] Predicate (item, categoryKey) => boolean. When provided, reordering operates on the active items filtered by this predicate (e.g. to exclude a protected row); defaults to all active items.
 */
export function useMetaManagement({
  onLoaded,
  onNotice,
  resetNoticeBeforeAction = false,
  filterReorderItem,
} = {}) {
  const [adminMetaOptions, setAdminMetaOptions] = useState(EMPTY_META_OPTIONS);
  const [adminMetaLoading, setAdminMetaLoading] = useState(false);
  const [adminMetaSaving, setAdminMetaSaving] = useState(false);
  const [adminMetaError, setAdminMetaError] = useState('');
  const [selectedMetaCategory, setSelectedMetaCategory] = useState('statuses');
  const [newMetaName, setNewMetaName] = useState('');
  const [metaDraftNames, setMetaDraftNames] = useState({});

  // Keep callback/scope inputs in refs so the handlers below stay referentially stable.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  const filterReorderItemRef = useRef(filterReorderItem);
  filterReorderItemRef.current = filterReorderItem;

  const notify = useCallback((message) => {
    if (typeof onNoticeRef.current === 'function') onNoticeRef.current(message);
  }, []);

  const activeMetaCategoryConfig = useMemo(
    () => ADMIN_META_CATEGORIES.find((category) => category.key === selectedMetaCategory) || ADMIN_META_CATEGORIES[0],
    [selectedMetaCategory],
  );

  const activeMetaItems = useMemo(
    () => (Array.isArray(adminMetaOptions?.[activeMetaCategoryConfig.optionsKey])
      ? adminMetaOptions[activeMetaCategoryConfig.optionsKey]
      : []),
    [adminMetaOptions, activeMetaCategoryConfig],
  );

  const loadAdminMeta = useCallback(async () => {
    try {
      setAdminMetaLoading(true);
      setAdminMetaError('');
      const meta = await api.getAdminMetaOptions();
      const normalizedMeta = normalizeMetaResponse(meta);
      setAdminMetaOptions(normalizedMeta);
      if (typeof onLoadedRef.current === 'function') onLoadedRef.current(normalizedMeta);
    } catch (loadError) {
      setAdminMetaError(loadError.message || 'Failed to load metadata options.');
    } finally {
      setAdminMetaLoading(false);
    }
  }, []);

  const saveMetaItem = useCallback(async (item) => {
    if (!item || !activeMetaCategoryConfig) return;
    const draftName = String(metaDraftNames[item.id] ?? item.name ?? '').trim();
    try {
      setAdminMetaSaving(true);
      setAdminMetaError('');
      if (resetNoticeBeforeAction) notify('');
      await api.updateAdminMetaOption(activeMetaCategoryConfig.endpointCategory, item.id, {
        name: draftName,
        isActive: Boolean(item.isActive),
        isRetired: Boolean(item.isRetired),
        sortOrder: Number(item.sortOrder || 0),
      });
      await loadAdminMeta();
      notify('Metadata value saved.');
    } catch (saveError) {
      setAdminMetaError(saveError.message || 'Failed to save metadata value.');
    } finally {
      setAdminMetaSaving(false);
    }
  }, [activeMetaCategoryConfig, metaDraftNames, loadAdminMeta, notify, resetNoticeBeforeAction]);

  const addMetaItem = useCallback(async () => {
    const name = String(newMetaName || '').trim();
    if (!name || !activeMetaCategoryConfig) return;
    try {
      setAdminMetaSaving(true);
      setAdminMetaError('');
      if (resetNoticeBeforeAction) notify('');
      await api.createAdminMetaOption(activeMetaCategoryConfig.endpointCategory, { name });
      setNewMetaName('');
      await loadAdminMeta();
      notify('Metadata value added.');
    } catch (createError) {
      setAdminMetaError(createError.message || 'Failed to add metadata value.');
    } finally {
      setAdminMetaSaving(false);
    }
  }, [newMetaName, activeMetaCategoryConfig, loadAdminMeta, notify, resetNoticeBeforeAction]);

  const moveMetaItem = useCallback(async (itemId, direction) => {
    const filterFn = filterReorderItemRef.current;
    const items = typeof filterFn === 'function'
      ? activeMetaItems.filter((item) => filterFn(item, activeMetaCategoryConfig.key))
      : activeMetaItems;
    if (!activeMetaCategoryConfig || !Array.isArray(items) || items.length <= 1) {
      return;
    }
    const currentIndex = items.findIndex((item) => Number(item.id) === Number(itemId));
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const reordered = [...items];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    try {
      setAdminMetaSaving(true);
      setAdminMetaError('');
      if (resetNoticeBeforeAction) notify('');
      await api.reorderAdminMetaOptions(
        activeMetaCategoryConfig.endpointCategory,
        reordered.map((item) => item.id),
      );
      await loadAdminMeta();
      notify('Metadata order updated.');
    } catch (reorderError) {
      setAdminMetaError(reorderError.message || 'Failed to update metadata order.');
    } finally {
      setAdminMetaSaving(false);
    }
  }, [activeMetaCategoryConfig, activeMetaItems, loadAdminMeta, notify, resetNoticeBeforeAction]);

  // Reset draft names whenever the active item set changes.
  useEffect(() => {
    const nextDrafts = {};
    activeMetaItems.forEach((item) => {
      nextDrafts[item.id] = String(item.name || '');
    });
    setMetaDraftNames(nextDrafts);
  }, [activeMetaItems]);

  // Load on mount.
  useEffect(() => {
    loadAdminMeta();
  }, [loadAdminMeta]);

  return {
    adminMetaOptions,
    setAdminMetaOptions,
    adminMetaLoading,
    adminMetaSaving,
    adminMetaError,
    selectedMetaCategory,
    setSelectedMetaCategory,
    newMetaName,
    setNewMetaName,
    metaDraftNames,
    setMetaDraftNames,
    activeMetaCategoryConfig,
    activeMetaItems,
    loadAdminMeta,
    saveMetaItem,
    addMetaItem,
    moveMetaItem,
  };
}
