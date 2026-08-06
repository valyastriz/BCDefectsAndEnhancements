import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { areAllStatusesSelected } from '../utils/filterUtils';
import { formatMetaTypeLabel } from '../utils/formatUtils';
import {
  CLEANUP_ONLY_STATUS,
  CLEANUP_MARKED_STATUS,
} from '../constants/adminConstants';
import { useMetaManagement } from './useMetaManagement';

/**
 * Custom hook for admin metadata management (dynamic dropdown options).
 *
 * Delegates the metadata CRUD core to useMetaManagement and layers on the
 * dashboard-specific runtime option lists and filter synchronization.
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
  // Report requests. Empty until the meta load lands — the Metadata page owns
  // this list, so there is no sensible hardcoded fallback to guess at.
  const [dynamicLevelsOfEffort, setDynamicLevelsOfEffort] = useState([]);

  const statusFilterOptionsRef = useRef([]);

  // ── Sync dashboard runtime options from a loaded meta payload ───────────────

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
    const nextLevelsOfEffort = Array.isArray(meta?.levelsOfEffort)
      ? meta.levelsOfEffort.filter((item) => item?.isActive).map((item) => String(item.name || '').trim()).filter(Boolean)
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
    if (nextLevelsOfEffort.length > 0) setDynamicLevelsOfEffort(nextLevelsOfEffort);
  }, [setFilters]);

  // ── Metadata CRUD core (shared with AdminMetadataPage) ─────────────────────
  //
  // The dashboard only needs the loaded lists; editing them is the metadata page's
  // job. So only what the queue actually reads is taken out of the shared hook —
  // re-exporting the edit surface here would be a public API nothing calls.

  const { adminMetaOptions, loadAdminMeta } = useMetaManagement({
    onLoaded: syncRuntimeOptionsFromMeta,
    onNotice: setNotice,
  });

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

  // ── Sync filter options ref ────────────────────────────────────────────────

  useEffect(() => {
    statusFilterOptionsRef.current = runtimeStatusFilterOptions;
  }, [runtimeStatusFilterOptions]);

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
    dynamicLevelsOfEffort,
    // Runtime computed options
    runtimeStatusFilterOptions,
    runtimeStatusOptions,
    runtimeCleanupInlineStatuses,
    runtimeCreatedViaOptions,
    runtimeTypeFilterOptions,
    dynamicCoreStatusSet,
    dynamicCleanupStatusSet,
    // The loaded lists, for anything that needs more than the name arrays above.
    adminMetaOptions,
    loadAdminMeta,
  };
}
