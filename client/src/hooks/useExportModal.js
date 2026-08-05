import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { exportKeysForColumns } from '../constants/adminConstants';

/**
 * Custom hook for the admin export-to-Excel modal.
 *
 * @param {Object} deps
 * @param {React.MutableRefObject} deps.filtersRef - ref to current filters
 * @param {number} deps.matchingRowCount - how many tickets the queue's current
 *   filters match. The dialog leads with this: it is the one fact the old dialog
 *   never stated, and "export the filtered set" is meaningless without it.
 * @param {string[]} deps.visibleColumnKeys - this admin's visible queue columns,
 *   which is what makes "what's on screen" an answer about their screen.
 * @param {Function} deps.setNotice - page-level notice setter
 */
export function useExportModal({ filtersRef, matchingRowCount = 0, visibleColumnKeys = [], setNotice }) {
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportFields, setExportFields] = useState([]);
  const [exportGroups, setExportGroups] = useState([]);
  const [selectedExportFieldKeys, setSelectedExportFieldKeys] = useState([]);

  // ── Memos ──────────────────────────────────────────────────────────────────

  const selectedExportFieldSet = useMemo(
    () => new Set((selectedExportFieldKeys || []).map((value) => String(value || ''))),
    [selectedExportFieldKeys],
  );

  const exportFieldKeySet = useMemo(
    () => new Set(exportFields.map((field) => String(field?.key || ''))),
    [exportFields],
  );

  /**
   * The export fields behind the columns this admin has on screen. Filtered
   * against the real field list, so a column whose export field the server has
   * since dropped simply does not appear rather than selecting nothing.
   */
  const onScreenFieldKeys = useMemo(
    () => exportKeysForColumns(visibleColumnKeys).filter((key) => exportFieldKeySet.has(key)),
    [visibleColumnKeys, exportFieldKeySet],
  );

  /**
   * The groups the dialog draws, each with its fields and how many are ticked.
   * Empty groups are dropped — the server sends an "Other fields" group that only
   * has members when an export field was added without being grouped.
   */
  const exportFieldGroups = useMemo(() => {
    const byGroup = new Map();
    for (const field of exportFields) {
      const groupKey = String(field?.group || 'other');
      if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
      byGroup.get(groupKey).push(field);
    }
    // Server order first; anything the server did not declare still renders, after
    // the declared groups, so a field can never be silently unreachable.
    const declared = exportGroups.map((group) => group.key);
    const orderedKeys = [...declared, ...[...byGroup.keys()].filter((key) => !declared.includes(key))];
    const labelByKey = new Map(exportGroups.map((group) => [group.key, group.label]));

    return orderedKeys
      .map((key) => {
        const fields = byGroup.get(key) || [];
        return {
          key,
          label: labelByKey.get(key) || key,
          fields,
          selectedCount: fields.filter((field) => selectedExportFieldSet.has(String(field.key))).length,
        };
      })
      .filter((group) => group.fields.length > 0);
  }, [exportFields, exportGroups, selectedExportFieldSet]);

  /**
   * The preset buttons, each with the count it would select. Counts are computed
   * from the live field list rather than written down, so a button cannot promise
   * a number the click does not deliver.
   */
  const exportPresets = useMemo(() => {
    const keysInGroup = (groupKey) => exportFields
      .filter((field) => String(field?.group || '') === groupKey)
      .map((field) => String(field.key));

    return [
      { key: 'screen', label: 'What’s on screen', keys: onScreenFieldKeys },
      { key: 'impact', label: 'Impact figures', keys: keysInGroup('impact') },
      { key: 'handoff', label: 'Hand-off', keys: keysInGroup('handoff') },
      { key: 'all', label: 'Everything', keys: exportFields.map((field) => String(field.key)) },
    ].filter((preset) => preset.keys.length > 0);
  }, [exportFields, onScreenFieldKeys]);

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const loadExportFields = useCallback(async () => {
    try {
      setExportError('');
      const response = await api.getAdminExportFields();
      const fields = Array.isArray(response?.fields) ? response.fields : [];
      const groups = Array.isArray(response?.groups) ? response.groups : [];
      setExportFields(fields);
      setExportGroups(groups);
      setSelectedExportFieldKeys((prev) => {
        const allowed = new Set(fields.map((field) => String(field?.key || '')));
        if (Array.isArray(prev) && prev.length > 0) {
          const retained = prev.map((value) => String(value || '')).filter((value) => allowed.has(value));
          if (retained.length > 0) return retained;
        }
        // First open of the session: the columns they are looking at. All 48 would
        // be a spreadsheet nobody asked for, and "Everything" is one click away.
        const onScreen = exportKeysForColumns(visibleColumnKeys).filter((key) => allowed.has(key));
        if (onScreen.length > 0) return onScreen;
        return fields.map((field) => String(field?.key || '')).filter(Boolean);
      });
    } catch (loadError) {
      setExportFields([]);
      setExportGroups([]);
      setSelectedExportFieldKeys([]);
      setExportError(loadError.message || 'Failed to load export fields.');
    }
  }, [visibleColumnKeys]);

  const closeExportModal = useCallback(() => {
    if (exportWorking) return;
    setExportModalOpen(false);
    setExportError('');
  }, [exportWorking]);

  const toggleExportField = useCallback((fieldKey) => {
    const normalizedFieldKey = String(fieldKey || '').trim();
    if (!normalizedFieldKey) return;
    setSelectedExportFieldKeys((prev) => {
      const nextSet = new Set((prev || []).map((value) => String(value || '')));
      if (nextSet.has(normalizedFieldKey)) {
        nextSet.delete(normalizedFieldKey);
      } else {
        nextSet.add(normalizedFieldKey);
      }
      return Array.from(nextSet);
    });
  }, []);

  /** A preset REPLACES the selection — "start from" is the label, and adding to
   *  what was already ticked would make the count on the button a lie. */
  const applyExportPreset = useCallback((presetKey) => {
    if (presetKey === 'none') {
      setSelectedExportFieldKeys([]);
      return;
    }
    const preset = exportPresets.find((candidate) => candidate.key === presetKey);
    if (preset) setSelectedExportFieldKeys([...preset.keys]);
  }, [exportPresets]);

  /** One group's All/None. Off only when every field in it is already on. */
  const toggleExportGroup = useCallback((groupKey) => {
    const group = exportFieldGroups.find((candidate) => candidate.key === groupKey);
    if (!group) return;
    const groupKeys = group.fields.map((field) => String(field.key));
    const turningOn = group.selectedCount < groupKeys.length;
    setSelectedExportFieldKeys((prev) => {
      const nextSet = new Set((prev || []).map((value) => String(value || '')));
      for (const key of groupKeys) {
        if (turningOn) nextSet.add(key);
        else nextSet.delete(key);
      }
      return Array.from(nextSet);
    });
  }, [exportFieldGroups]);

  const exportFilteredSubmissions = useCallback(async () => {
    const selectedKeys = (selectedExportFieldKeys || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    if (selectedKeys.length === 0) {
      setExportError('Choose at least one column to export.');
      return;
    }

    try {
      setExportWorking(true);
      setExportError('');
      await api.exportAdminSubmissionsXlsx({
        filters: filtersRef.current,
        fields: selectedKeys,
      });
      setExportModalOpen(false);
      setNotice(
        `Exported ${matchingRowCount} ticket${matchingRowCount === 1 ? '' : 's'} × ${selectedKeys.length} column${selectedKeys.length === 1 ? '' : 's'}.`,
      );
    } catch (downloadError) {
      setExportError(downloadError.message || 'Failed to export submissions.');
    } finally {
      setExportWorking(false);
    }
  }, [selectedExportFieldKeys, filtersRef, matchingRowCount, setNotice]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!exportModalOpen) return;
    loadExportFields();
  }, [exportModalOpen, loadExportFields]);

  // ── Public API ─────────────────────────────────────────────────────────────

  function openExportModal() {
    setExportError('');
    setExportModalOpen(true);
  }

  return {
    exportModalOpen,
    exportWorking,
    exportError,
    exportFields,
    exportFieldGroups,
    exportPresets,
    selectedExportFieldKeys,
    selectedExportFieldSet,
    exportMatchingRowCount: matchingRowCount,
    openExportModal,
    closeExportModal,
    toggleExportField,
    toggleExportGroup,
    applyExportPreset,
    exportFilteredSubmissions,
  };
}
