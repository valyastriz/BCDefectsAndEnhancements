import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * Custom hook for the admin export-to-Excel modal.
 *
 * @param {Object} deps
 * @param {React.MutableRefObject} deps.filtersRef - ref to current filters
 * @param {Function} deps.setNotice - page-level notice setter
 * @returns Export modal state and handlers
 */
export function useExportModal({ filtersRef, setNotice }) {
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportFields, setExportFields] = useState([]);
  const [selectedExportFieldKeys, setSelectedExportFieldKeys] = useState([]);
  const [exportFieldSearch, setExportFieldSearch] = useState('');

  // ── Memos ──────────────────────────────────────────────────────────────────

  const visibleExportFields = useMemo(() => {
    const needle = String(exportFieldSearch || '').trim().toLowerCase();
    if (!needle) return exportFields;
    return exportFields.filter((field) => {
      const label = String(field?.label || '').toLowerCase();
      const key = String(field?.key || '').toLowerCase();
      return label.includes(needle) || key.includes(needle);
    });
  }, [exportFields, exportFieldSearch]);

  const selectedExportFieldSet = useMemo(
    () => new Set((selectedExportFieldKeys || []).map((value) => String(value || ''))),
    [selectedExportFieldKeys],
  );

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const loadExportFields = useCallback(async () => {
    try {
      setExportError('');
      const response = await api.getAdminExportFields();
      const fields = Array.isArray(response?.fields) ? response.fields : [];
      setExportFields(fields);
      setSelectedExportFieldKeys((prev) => {
        if (Array.isArray(prev) && prev.length > 0) {
          const allowed = new Set(fields.map((field) => String(field?.key || '')));
          const retained = prev
            .map((value) => String(value || ''))
            .filter((value) => allowed.has(value));
          if (retained.length > 0) return retained;
        }
        return fields.map((field) => String(field?.key || '')).filter(Boolean);
      });
    } catch (loadError) {
      setExportFields([]);
      setSelectedExportFieldKeys([]);
      setExportError(loadError.message || 'Failed to load export fields.');
    }
  }, []);

  const closeExportModal = useCallback(() => {
    if (exportWorking) return;
    setExportModalOpen(false);
    setExportError('');
    setExportFieldSearch('');
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

  const selectAllVisibleExportFields = useCallback(() => {
    setSelectedExportFieldKeys((prev) => {
      const nextSet = new Set((prev || []).map((value) => String(value || '')));
      visibleExportFields.forEach((field) => {
        const key = String(field?.key || '').trim();
        if (key) nextSet.add(key);
      });
      return Array.from(nextSet);
    });
  }, [visibleExportFields]);

  const clearVisibleExportFields = useCallback(() => {
    const visibleKeys = new Set(
      visibleExportFields
        .map((field) => String(field?.key || '').trim())
        .filter(Boolean),
    );
    setSelectedExportFieldKeys((prev) =>
      (prev || [])
        .map((value) => String(value || ''))
        .filter((value) => !visibleKeys.has(value)),
    );
  }, [visibleExportFields]);

  const exportFilteredSubmissions = useCallback(async () => {
    const selectedKeys = (selectedExportFieldKeys || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    if (selectedKeys.length === 0) {
      setExportError('Select at least one field to export.');
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
      setExportFieldSearch('');
      setNotice('Export downloaded successfully.');
    } catch (downloadError) {
      setExportError(downloadError.message || 'Failed to export submissions.');
    } finally {
      setExportWorking(false);
    }
  }, [selectedExportFieldKeys, filtersRef, setNotice]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!exportModalOpen) return;
    loadExportFields();
  }, [exportModalOpen, loadExportFields]);

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    exportModalOpen,
    setExportModalOpen,
    exportWorking,
    exportError,
    exportFields,
    selectedExportFieldKeys,
    exportFieldSearch,
    setExportFieldSearch,
    visibleExportFields,
    selectedExportFieldSet,
    closeExportModal,
    toggleExportField,
    selectAllVisibleExportFields,
    clearVisibleExportFields,
    exportFilteredSubmissions,
  };
}
