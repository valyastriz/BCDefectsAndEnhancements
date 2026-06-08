import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * Custom hook for the admin Excel import modal.
 *
 * @param {Object} deps
 * @param {Function} deps.loadRows - reload the main submissions table
 * @param {Function} deps.setNotice - page-level notice setter
 * @returns Import modal state and handlers
 */
export function useImportModal({ loadRows }) {
  const importFileInputRef = useRef(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importWorking, setImportWorking] = useState(false);
  const [importMode, setImportMode] = useState('');
  const [importAvailableHeaders, setImportAvailableHeaders] = useState([]);
  const [importMappingTargets, setImportMappingTargets] = useState([]);
  const [importColumnMappings, setImportColumnMappings] = useState({});
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [importStatusText, setImportStatusText] = useState('');
  const [importStatusKind, setImportStatusKind] = useState('');
  const [importResultErrors, setImportResultErrors] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [importAction, setImportAction] = useState('');
  const [importHistory, setImportHistory] = useState([]);
  const [importRequiresApplicationDefault, setImportRequiresApplicationDefault] = useState(false);
  const [importDefaultApplicationName, setImportDefaultApplicationName] = useState('');
  const [importUnknownStatuses, setImportUnknownStatuses] = useState([]);
  const [importAllowedStatuses, setImportAllowedStatuses] = useState([]);
  const [importStatusValueMappings, setImportStatusValueMappings] = useState({});

  // ── Memos ──────────────────────────────────────────────────────────────────

  const importTargetByHeader = useMemo(() => {
    const inverse = {};
    for (const [targetKey, headerName] of Object.entries(importColumnMappings || {})) {
      const normalizedHeader = String(headerName || '').trim();
      if (!normalizedHeader) continue;
      if (!inverse[normalizedHeader]) {
        inverse[normalizedHeader] = targetKey;
      }
    }
    return inverse;
  }, [importColumnMappings]);

  const sortedImportMappingTargets = useMemo(
    () => [...(importMappingTargets || [])].sort((left, right) => String(left?.label || '').localeCompare(String(right?.label || ''))),
    [importMappingTargets],
  );

  const visibleImportMappingTargets = useMemo(() => {
    if (importMode === 'cleanup') {
      return sortedImportMappingTargets;
    }

    const enhancementOnlyKeys = new Set([
      'enhancement_request_type',
      'priority_level',
      'impact_details',
      'desired_completion_date',
    ]);
    const defectOnlyKeys = new Set([
      'policy_num',
      'account_num',
      'combined_policy_account',
      'transaction_num',
      'screen_title',
      'steps_to_reproduce',
      'what_happened_exact_details',
      'date_time_of_error',
    ]);

    if (importMode === 'defect') {
      return sortedImportMappingTargets.filter((target) => !enhancementOnlyKeys.has(target.key));
    }
    if (importMode === 'enhancement') {
      return sortedImportMappingTargets.filter((target) => !defectOnlyKeys.has(target.key));
    }
    return sortedImportMappingTargets;
  }, [importMode, sortedImportMappingTargets]);

  const sortedImportAvailableHeaders = useMemo(
    () => [...(importAvailableHeaders || [])].sort((left, right) => String(left || '').localeCompare(String(right || ''))),
    [importAvailableHeaders],
  );

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const loadImportHistory = useCallback(async () => {
    try {
      const history = await api.listAdminSubmissionsImportHistory({ limit: 5 });
      setImportHistory(Array.isArray(history) ? history : []);
    } catch {
      setImportHistory([]);
    }
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!importModalOpen) return;
    loadImportHistory();
  }, [importModalOpen, loadImportHistory]);

  // ── Functions ──────────────────────────────────────────────────────────────

  async function analyzeImportFile(file) {
    if (!file) return;
    if (!importMode) {
      setImportStatusText('Choose Import As (Defect, Enhancement, or Cleanup) before selecting a file.');
      setImportStatusKind('error');
      if (importFileInputRef.current) {
        importFileInputRef.current.value = '';
      }
      return;
    }

    try {
      setImportWorking(true);
      setImportAction('analyzing');
      setImportStatusText('Analyzing file and detecting column mappings...');
      setImportStatusKind('');
      setImportSummary(null);
      setImportResultErrors([]);

      const formData = new FormData();
      formData.append('file', file);
      const analysis = await api.analyzeAdminSubmissionsXlsx(formData);

      setPendingImportFile(file);
      setImportAvailableHeaders(Array.isArray(analysis?.headers) ? analysis.headers : []);
      setImportMappingTargets(Array.isArray(analysis?.mappingTargets) ? analysis.mappingTargets : []);
      setImportColumnMappings(analysis?.suggestedMappings && typeof analysis.suggestedMappings === 'object'
        ? analysis.suggestedMappings
        : {});
      setImportRequiresApplicationDefault(Boolean(analysis?.requiresApplicationDefault));
      setImportAllowedStatuses(Array.isArray(analysis?.allowedStatuses) ? analysis.allowedStatuses : []);
      setImportUnknownStatuses(Array.isArray(analysis?.unknownStatuses) ? analysis.unknownStatuses : []);
      setImportStatusValueMappings((prev) => {
        const next = { ...(prev || {}) };
        const unknowns = Array.isArray(analysis?.unknownStatuses) ? analysis.unknownStatuses : [];
        unknowns.forEach((statusValue) => {
          if (!Object.prototype.hasOwnProperty.call(next, statusValue)) {
            next[statusValue] = '';
          }
        });
        Object.keys(next).forEach((key) => {
          if (!unknowns.includes(key)) {
            delete next[key];
          }
        });
        return next;
      });
      setImportStatusText(`Detected ${Number(analysis?.totalRows || 0)} row(s). Review mappings and click Import File.`);
      setImportStatusKind('success');
    } catch (analysisError) {
      setImportStatusText(analysisError.message || 'Failed to analyze file.');
      setImportStatusKind('error');
      setPendingImportFile(null);
      setImportAvailableHeaders([]);
      setImportMappingTargets([]);
      setImportColumnMappings({});
      setImportRequiresApplicationDefault(false);
      setImportDefaultApplicationName('');
      setImportUnknownStatuses([]);
      setImportAllowedStatuses([]);
      setImportStatusValueMappings({});
    } finally {
      setImportWorking(false);
      setImportAction('');
      if (importFileInputRef.current) {
        importFileInputRef.current.value = '';
      }
    }
  }

  async function importBackdatedExcel(file) {
    if (!file) return;
    if (!importMode) {
      setImportStatusText('Choose Import As (Defect, Enhancement, or Cleanup) before uploading.');
      setImportStatusKind('error');
      if (importFileInputRef.current) {
        importFileInputRef.current.value = '';
      }
      return;
    }
    try {
      setImportWorking(true);
      setImportAction('importing');
      setImportStatusText('Importing rows...');
      setImportStatusKind('');
      setImportResultErrors([]);

      const formData = new FormData();
      formData.append('file', file);
      formData.append(
        'columnMappings',
        JSON.stringify(importColumnMappings || {}),
      );
      if (importDefaultApplicationName) {
        formData.append('defaultApplicationName', importDefaultApplicationName);
      }
      formData.append('statusValueMappings', JSON.stringify(importStatusValueMappings || {}));

      const result = await api.importAdminSubmissionsXlsx(formData, { importMode });

      await loadRows();
      const imported = Number(result?.insertedRows || 0);
      const total = Number(result?.totalRows || 0);
      const invalid = Number(result?.invalidRows || 0);
      const resultErrors = Array.isArray(result?.errors) ? result.errors : [];
      const summaryMessage = `Import complete: ${imported} of ${total} rows added.${invalid > 0 ? ` Skipped ${invalid} invalid row(s).` : ''}`;

      setImportSummary({ imported, total, invalid });
      setImportResultErrors(resultErrors.slice(0, 20));
      setImportStatusText(summaryMessage);
      setImportStatusKind(invalid > 0 ? '' : 'success');
      if (result?.historyEntry) {
        setImportHistory((prev) => [result.historyEntry, ...prev].slice(0, 5));
      } else {
        await loadImportHistory();
      }
      setImportAvailableHeaders([]);
      setImportMappingTargets([]);
      setImportColumnMappings({});
      setPendingImportFile(null);
      setImportRequiresApplicationDefault(false);
      setImportDefaultApplicationName('');
      setImportUnknownStatuses([]);
      setImportStatusValueMappings({});
    } catch (importError) {
      const failureMessage = importError.message || 'Import failed.';
      const fileName = String(file?.name || 'uploaded-file.xlsx');
      setImportStatusText(failureMessage);
      setImportStatusKind('error');
      const responseBody = importError?.body;
      if (responseBody?.mappingRequired && responseBody?.mappingField === 'statusValueMappings') {
        setImportUnknownStatuses(Array.isArray(responseBody.unknownStatuses) ? responseBody.unknownStatuses : []);
        setImportAllowedStatuses(Array.isArray(responseBody.allowedStatuses) ? responseBody.allowedStatuses : []);
      }
      if (responseBody?.mappingRequired && responseBody?.mappingField === 'defaultApplicationName') {
        setImportRequiresApplicationDefault(true);
      }
      setImportHistory((prev) => ([
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          mode: importMode,
          fileName,
          imported: 0,
          total: 0,
          invalid: 0,
          errors: [failureMessage],
          message: failureMessage,
          kind: 'error',
        },
        ...prev,
      ].slice(0, 5)));
    } finally {
      setImportWorking(false);
      setImportAction('');
      if (importFileInputRef.current) {
        importFileInputRef.current.value = '';
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resetImportModal() {
    setImportAvailableHeaders([]);
    setImportMappingTargets([]);
    setImportColumnMappings({});
    setPendingImportFile(null);
    setImportStatusText('');
    setImportStatusKind('');
    setImportResultErrors([]);
    setImportSummary(null);
    setImportAction('');
    setImportRequiresApplicationDefault(false);
    setImportDefaultApplicationName('');
    setImportUnknownStatuses([]);
    setImportAllowedStatuses([]);
    setImportStatusValueMappings({});
  }

  function openImportModal() {
    setImportStatusText('');
    setImportStatusKind('');
    setImportModalOpen(true);
  }

  function closeImportModal() {
    if (importWorking) return;
    resetImportModal();
    setImportModalOpen(false);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    importFileInputRef,
    importModalOpen,
    setImportModalOpen,
    importWorking,
    importMode,
    setImportMode,
    importAvailableHeaders,
    importMappingTargets,
    importColumnMappings,
    setImportColumnMappings,
    pendingImportFile,
    importStatusText,
    setImportStatusText,
    importStatusKind,
    setImportStatusKind,
    importResultErrors,
    importSummary,
    importAction,
    importHistory,
    importRequiresApplicationDefault,
    importDefaultApplicationName,
    setImportDefaultApplicationName,
    importUnknownStatuses,
    importAllowedStatuses,
    importStatusValueMappings,
    setImportStatusValueMappings,
    importTargetByHeader,
    sortedImportMappingTargets,
    visibleImportMappingTargets,
    sortedImportAvailableHeaders,
    analyzeImportFile,
    importBackdatedExcel,
    resetImportModal,
    openImportModal,
    closeImportModal,
  };
}
