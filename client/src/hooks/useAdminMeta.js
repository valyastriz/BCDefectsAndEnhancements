import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { areAllStatusesSelected } from '../utils/filterUtils';
import { formatMetaTypeLabel } from '../utils/formatUtils';
import {
  CLEANUP_ONLY_STATUS,
  CLEANUP_MARKED_STATUS,
  ADMIN_META_CATEGORIES,
} from '../constants/adminConstants';

/**
 * Custom hook for admin metadata management (dynamic dropdown options).
 *
 * @param {Object} deps
 * @param {Function} deps.setFilters - page-level filters state setter
 * @param {Function} deps.setNotice - page-level notice setter
 * @returns Admin meta state, dynamic options, and management handlers
 */
export function useAdminMeta({ setFilters, setNotice }) {
  // ── Dynamic option lists ───────────────────────────────────────────────────

  const [dynamicStatuses, setDynamicStatuses] = useState([]);
  const [dynamicFilterStatuses, setDynamicFilterStatuses] = useState([]);
  const [dynamicCleanupStatuses, setDynamicCleanupStatuses] = useState([]);
  const [dynamicSubmissionTypes, setDynamicSubmissionTypes] = useState(['defect', 'enhancement']);
  const [dynamicCleanupTagTypes, setDynamicCleanupTagTypes] = useState(['cleanup_only', 'defect', 'enhancement']);
  const [dynamicApplications, setDynamicApplications] = useState([]);
  const [dynamicEnhancementRequestTypes, setDynamicEnhancementRequestTypes] = useState([]);
  const [dynamicPriorityLevels, setDynamicPriorityLevels] = useState([]);
  const [dynamicOccurrenceTimeframes, setDynamicOccurrenceTimeframes] = useState(['Day', 'Week', 'Month', 'Quarter', 'Year']);

  // ── Meta management state ─────────────────────────────────────────────────

  const [adminMetaOptions, setAdminMetaOptions] = useState({
    statuses: [],
    types: [],
    cleanupStatuses: [],
    cleanupTagTypes: [],
    applications: [],
    enhancementRequestTypes: [],
    priorityLevels: [],
    submissionSources: [],
  });
  const [adminMetaLoading, setAdminMetaLoading] = useState(false);
  const [adminMetaSaving, setAdminMetaSaving] = useState(false);
  const [adminMetaError, setAdminMetaError] = useState('');
  const [selectedMetaCategory, setSelectedMetaCategory] = useState('statuses');
  const [newMetaName, setNewMetaName] = useState('');
  const [metaDraftNames, setMetaDraftNames] = useState({});

  const statusFilterOptionsRef = useRef([]);

  // ── Computed runtime options ───────────────────────────────────────────────

  const runtimeStatusFilterOptions = useMemo(
    () => [...dynamicFilterStatuses, CLEANUP_ONLY_STATUS, CLEANUP_MARKED_STATUS],
    [dynamicFilterStatuses],
  );

  const runtimeStatusOptions = useMemo(
    () => [...dynamicStatuses, CLEANUP_ONLY_STATUS],
    [dynamicStatuses],
  );

  const runtimeCleanupInlineStatuses = useMemo(
    () => ['No Cleanup', ...dynamicCleanupStatuses],
    [dynamicCleanupStatuses],
  );

  const runtimeCreatedViaOptions = useMemo(() => {
    const dynamicSources = Array.isArray(adminMetaOptions?.submissionSources)
      ? adminMetaOptions.submissionSources
        .filter((item) => item?.isActive)
        .map((item) => String(item.name || '').trim().toLowerCase())
        .filter(Boolean)
      : [];
    if (dynamicSources.length > 0) {
      return dynamicSources;
    }
    return [
      'rep_form',
      'admin_excel_import',
      'admin_backdated',
      'admin_cleanup',
      'admin_manual',
      'admin_easyvista_resubmission',
    ];
  }, [adminMetaOptions]);

  const runtimeTypeFilterOptions = useMemo(
    () => [...dynamicSubmissionTypes.map(formatMetaTypeLabel), 'Cleanup Only'],
    [dynamicSubmissionTypes],
  );

  const dynamicCoreStatusSet = useMemo(() => new Set(dynamicStatuses), [dynamicStatuses]);
  const dynamicCleanupStatusSet = useMemo(
    () => new Set(['No Cleanup', ...dynamicCleanupStatuses]),
    [dynamicCleanupStatuses],
  );

  const activeMetaCategoryConfig = useMemo(
    () => ADMIN_META_CATEGORIES.find((category) => category.key === selectedMetaCategory) || ADMIN_META_CATEGORIES[0],
    [selectedMetaCategory],
  );

  const activeMetaItems = useMemo(
    () => Array.isArray(adminMetaOptions?.[activeMetaCategoryConfig.optionsKey])
      ? adminMetaOptions[activeMetaCategoryConfig.optionsKey]
      : [],
    [adminMetaOptions, activeMetaCategoryConfig],
  );

  // ── Sync filter options ref ────────────────────────────────────────────────

  useEffect(() => {
    statusFilterOptionsRef.current = runtimeStatusFilterOptions;
  }, [runtimeStatusFilterOptions]);

  // ── Reset draft names when meta items change ───────────────────────────────

  useEffect(() => {
    const nextDrafts = {};
    activeMetaItems.forEach((item) => {
      nextDrafts[item.id] = String(item.name || '');
    });
    setMetaDraftNames(nextDrafts);
  }, [activeMetaItems]);

  // ── Core callbacks ─────────────────────────────────────────────────────────

  const syncRuntimeOptionsFromMeta = useCallback((meta) => {
    const nextStatuses = Array.isArray(meta?.statuses)
      ? meta.statuses.filter((item) => item?.isActive && !item?.isRetired).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];
    const nextFilterStatuses = Array.isArray(meta?.statuses)
      ? meta.statuses.filter((item) => !item?.isRetired).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];
    const nextCleanupStatuses = Array.isArray(meta?.cleanupStatuses)
      ? meta.cleanupStatuses.filter((item) => item?.isActive).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];
    const nextSubmissionTypes = Array.isArray(meta?.types)
      ? meta.types.filter((item) => item?.isActive).map((item) => String(item.name || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const nextCleanupTagTypes = Array.isArray(meta?.cleanupTagTypes)
      ? meta.cleanupTagTypes.filter((item) => item?.isActive).map((item) => String(item.name || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const nextApplications = Array.isArray(meta?.applications)
      ? meta.applications.filter((item) => item?.isActive).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];
    const nextEnhancementRequestTypes = Array.isArray(meta?.enhancementRequestTypes)
      ? meta.enhancementRequestTypes.filter((item) => item?.isActive).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];
    const nextPriorityLevels = Array.isArray(meta?.priorityLevels)
      ? meta.priorityLevels.filter((item) => item?.isActive).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];
    const nextOccurrenceTimeframes = Array.isArray(meta?.occurrenceTimeframes)
      ? meta.occurrenceTimeframes.filter((item) => item?.isActive).map((item) => String(item.name || '').trim()).filter(Boolean)
      : [];

    if (nextStatuses.length > 0) setDynamicStatuses(nextStatuses);

    if (nextFilterStatuses.length > 0) {
      setDynamicFilterStatuses(nextFilterStatuses);
      const nextStatusFilterOptions = [...nextFilterStatuses, CLEANUP_ONLY_STATUS, CLEANUP_MARKED_STATUS];
      setFilters((prev) => ({
        ...prev,
        statuses:
          prev.statuses.length === 0 || areAllStatusesSelected(prev.statuses, statusFilterOptionsRef.current)
            ? nextStatusFilterOptions
            : prev.statuses.filter((value) => nextStatusFilterOptions.includes(value)),
      }));
    }
    if (nextCleanupStatuses.length > 0) setDynamicCleanupStatuses(nextCleanupStatuses);
    if (nextSubmissionTypes.length > 0) setDynamicSubmissionTypes(nextSubmissionTypes);
    if (nextCleanupTagTypes.length > 0) setDynamicCleanupTagTypes(nextCleanupTagTypes);
    if (nextApplications.length > 0) setDynamicApplications(nextApplications);
    if (nextEnhancementRequestTypes.length > 0) setDynamicEnhancementRequestTypes(nextEnhancementRequestTypes);
    if (nextPriorityLevels.length > 0) setDynamicPriorityLevels(nextPriorityLevels);
    if (nextOccurrenceTimeframes.length > 0) setDynamicOccurrenceTimeframes(nextOccurrenceTimeframes);
  }, [setFilters]);

  const loadAdminMeta = useCallback(async () => {
    try {
      setAdminMetaLoading(true);
      setAdminMetaError('');
      const meta = await api.getAdminMetaOptions();
      const normalizedMeta = {
        statuses: Array.isArray(meta?.statuses) ? meta.statuses : [],
        types: Array.isArray(meta?.types) ? meta.types : [],
        cleanupStatuses: Array.isArray(meta?.cleanupStatuses) ? meta.cleanupStatuses : [],
        cleanupTagTypes: Array.isArray(meta?.cleanupTagTypes) ? meta.cleanupTagTypes : [],
        applications: Array.isArray(meta?.applications) ? meta.applications : [],
        enhancementRequestTypes: Array.isArray(meta?.enhancementRequestTypes) ? meta.enhancementRequestTypes : [],
        priorityLevels: Array.isArray(meta?.priorityLevels) ? meta.priorityLevels : [],
        submissionSources: Array.isArray(meta?.submissionSources) ? meta.submissionSources : [],
        occurrenceTimeframes: Array.isArray(meta?.occurrenceTimeframes) ? meta.occurrenceTimeframes : [],
      };
      setAdminMetaOptions(normalizedMeta);
      syncRuntimeOptionsFromMeta(normalizedMeta);
    } catch (loadError) {
      setAdminMetaError(loadError.message || 'Failed to load metadata options.');
    } finally {
      setAdminMetaLoading(false);
    }
  }, [syncRuntimeOptionsFromMeta]);

  const saveMetaItem = useCallback(async (item) => {
    if (!item || !activeMetaCategoryConfig) return;
    const draftName = String(metaDraftNames[item.id] ?? item.name ?? '').trim();
    try {
      setAdminMetaSaving(true);
      setAdminMetaError('');
      await api.updateAdminMetaOption(activeMetaCategoryConfig.endpointCategory, item.id, {
        name: draftName,
        isActive: Boolean(item.isActive),
        isRetired: Boolean(item.isRetired),
        sortOrder: Number(item.sortOrder || 0),
      });
      await loadAdminMeta();
      setNotice('Metadata value saved.');
    } catch (saveError) {
      setAdminMetaError(saveError.message || 'Failed to save metadata value.');
    } finally {
      setAdminMetaSaving(false);
    }
  }, [activeMetaCategoryConfig, metaDraftNames, loadAdminMeta, setNotice]);

  const addMetaItem = useCallback(async () => {
    const name = String(newMetaName || '').trim();
    if (!name || !activeMetaCategoryConfig) return;
    try {
      setAdminMetaSaving(true);
      setAdminMetaError('');
      await api.createAdminMetaOption(activeMetaCategoryConfig.endpointCategory, { name });
      setNewMetaName('');
      await loadAdminMeta();
      setNotice('Metadata value added.');
    } catch (createError) {
      setAdminMetaError(createError.message || 'Failed to add metadata value.');
    } finally {
      setAdminMetaSaving(false);
    }
  }, [newMetaName, activeMetaCategoryConfig, loadAdminMeta, setNotice]);

  const moveMetaItem = useCallback(async (itemId, direction) => {
    if (!activeMetaCategoryConfig || !Array.isArray(activeMetaItems) || activeMetaItems.length <= 1) {
      return;
    }
    const currentIndex = activeMetaItems.findIndex((item) => Number(item.id) === Number(itemId));
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= activeMetaItems.length) return;

    const reordered = [...activeMetaItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    try {
      setAdminMetaSaving(true);
      setAdminMetaError('');
      await api.reorderAdminMetaOptions(
        activeMetaCategoryConfig.endpointCategory,
        reordered.map((item) => item.id),
      );
      await loadAdminMeta();
      setNotice('Metadata order updated.');
    } catch (reorderError) {
      setAdminMetaError(reorderError.message || 'Failed to update metadata order.');
    } finally {
      setAdminMetaSaving(false);
    }
  }, [activeMetaCategoryConfig, activeMetaItems, loadAdminMeta, setNotice]);

  // ── Load meta on mount ─────────────────────────────────────────────────────

  useEffect(() => {
    loadAdminMeta();
  }, [loadAdminMeta]);

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    // Dynamic option lists
    dynamicStatuses,
    dynamicFilterStatuses,
    dynamicCleanupStatuses,
    dynamicSubmissionTypes,
    dynamicCleanupTagTypes,
    dynamicApplications,
    dynamicEnhancementRequestTypes,
    dynamicPriorityLevels,
    dynamicOccurrenceTimeframes,
    // Runtime computed options
    runtimeStatusFilterOptions,
    runtimeStatusOptions,
    runtimeCleanupInlineStatuses,
    runtimeCreatedViaOptions,
    runtimeTypeFilterOptions,
    dynamicCoreStatusSet,
    dynamicCleanupStatusSet,
    // Meta management
    adminMetaOptions,
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
