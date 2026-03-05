import { Button, Card, Modal, Notice, Select } from '../bite-size/BitsizeUI';
import { RETIRED_STATUS } from '../../constants/adminConstants';

/**
 * Modal for importing Excel files with column mapping.
 */
export function ImportModal({
  importModalOpen,
  closeImportModal,
  importWorking,
  importMode,
  setImportMode,
  importAvailableHeaders,
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
  visibleImportMappingTargets,
  sortedImportAvailableHeaders,
  importFileInputRef,
  analyzeImportFile,
  importBackdatedExcel,
  resetImportModal,
  // Meta options
  dynamicStatuses,
}) {
  return (
    <Modal
      open={importModalOpen}
      onClose={closeImportModal}
      title="Import Excel (.xlsx)"
    >
      <div className="stack">
        {importStatusText && <Notice text={importStatusText} kind={importStatusKind === 'success' ? 'success' : undefined} />}

        <p className="muted" style={{ marginTop: 0 }}>
          Choose import type, upload file, then review detected column mappings before importing.
        </p>

        {importHistory.length > 0 && (
          <Card title="Recent Upload Results">
            <div className="stack import-history-list" style={{ gap: 10 }}>
              {importHistory.map((entry) => (
                <details key={entry.id} className="import-history-item">
                  <summary>
                    {new Date(entry.created_at || entry.createdAt || Date.now()).toLocaleString()} · {String(entry.import_mode || entry.mode || '').toUpperCase()} · {entry.file_name || entry.fileName}
                  </summary>
                  <div className="stack" style={{ gap: 6 }}>
                    <p style={{ margin: 0 }}>{entry.summary_message || entry.message}</p>
                    {entry.errors?.length > 0 && (
                      <div className="import-history-errors">
                        <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 18 }}>
                          {entry.errors.map((line, idx) => (
                            <li key={`${entry.id}-err-${idx}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </Card>
        )}

        <Select
          label="Import As"
          value={importMode}
          onChange={(event) => setImportMode(event.target.value)}
        >
          <option value="">Select type</option>
          <option value="defect">Defect</option>
          <option value="enhancement">Enhancement</option>
          <option value="cleanup">Cleanup</option>
        </Select>

        {pendingImportFile && (
          <p className="muted" style={{ marginTop: 0 }}>
            Selected file: <strong>{pendingImportFile.name}</strong>
          </p>
        )}

        {importAvailableHeaders.length > 0 && (
          <p className="muted" style={{ marginTop: 0 }}>
            Detected columns: {importAvailableHeaders.join(', ')}
          </p>
        )}

        {importRequiresApplicationDefault && (
          <Select
            label="Default Application (required)"
            value={importDefaultApplicationName}
            onChange={(event) => setImportDefaultApplicationName(event.target.value)}
          >
            <option value="">Select application</option>
            <option value="Billing Center">Billing Center</option>
            <option value="Policy Center">Policy Center</option>
          </Select>
        )}

        {importUnknownStatuses.length > 0 && (
          <Card title="Map Unknown Status Values">
            <div className="bs-grid two">
              {importUnknownStatuses.map((statusValue) => (
                <Select
                  key={statusValue}
                  label={`Status in file: ${statusValue}`}
                  value={importStatusValueMappings[statusValue] || ''}
                  onChange={(event) => {
                    const mappedStatus = event.target.value;
                    setImportStatusValueMappings((prev) => ({
                      ...(prev || {}),
                      [statusValue]: mappedStatus,
                    }));
                  }}
                >
                  <option value="">Select DB status</option>
                  {[...(importAllowedStatuses.length > 0 ? importAllowedStatuses : [...dynamicStatuses, RETIRED_STATUS])]
                    .sort((left, right) => String(left || '').localeCompare(String(right || '')))
                    .map((allowedStatus) => (
                    <option key={`${statusValue}-${allowedStatus}`} value={allowedStatus}>{allowedStatus}</option>
                    ))}
                </Select>
              ))}
            </div>
          </Card>
        )}

        {importAction && (
          <p className="muted" style={{ marginTop: 0 }}>
            {importAction === 'analyzing' ? 'Analyzing file...' : 'Importing records...'}
          </p>
        )}

        {importSummary && (
          <p className="muted" style={{ marginTop: 0 }}>
            Result: Imported {importSummary.imported} of {importSummary.total}; Skipped {importSummary.invalid}.
          </p>
        )}

        {importResultErrors.length > 0 && (
          <div>
            <p className="muted" style={{ marginTop: 0, marginBottom: 6 }}>Row errors (first {importResultErrors.length}):</p>
            <ul style={{ marginTop: 0, paddingLeft: 18 }}>
              {importResultErrors.map((line, index) => (
                <li key={`${line}-${index}`} style={{ marginBottom: 4 }}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {sortedImportAvailableHeaders.length > 0 && (
          <div className="import-mapping-scroll">
            <div className="bs-grid two">
              {sortedImportAvailableHeaders.map((header) => (
              <Select
                key={header}
                label={`Column: ${header}`}
                value={importTargetByHeader[header] || ''}
                onChange={(event) => {
                  const selectedTargetKey = event.target.value;
                  setImportColumnMappings((prev) => {
                    const next = { ...(prev || {}) };
                    let currentTargetForHeader = '';

                    for (const [targetKey, mappedHeader] of Object.entries(next)) {
                      if (String(mappedHeader || '').trim() === header) {
                        currentTargetForHeader = targetKey;
                        break;
                      }
                    }

                    if (currentTargetForHeader) {
                      delete next[currentTargetForHeader];
                    }

                    if (!selectedTargetKey) {
                      return next;
                    }

                    for (const [targetKey, mappedHeader] of Object.entries(next)) {
                      if (targetKey !== selectedTargetKey && String(mappedHeader || '').trim() === header) {
                        delete next[targetKey];
                      }
                    }

                    next[selectedTargetKey] = header;
                    return next;
                  });
                }}
              >
                <option value="">Not mapped</option>
                {visibleImportMappingTargets.map((target) => (
                  <option key={`${header}-${target.key}`} value={target.key}>{target.label}</option>
                ))}
              </Select>
              ))}
            </div>
          </div>
        )}

        <div className="bs-actions">
          <Button
            type="button"
            onClick={() => {
              setImportStatusText('');
              setImportStatusKind('');
              if (pendingImportFile) {
                if (importRequiresApplicationDefault && !importDefaultApplicationName) {
                  setImportStatusText('Select a default application before importing.');
                  setImportStatusKind('error');
                  return;
                }
                if (importUnknownStatuses.some((statusValue) => !String(importStatusValueMappings[statusValue] || '').trim())) {
                  setImportStatusText('Map all unknown statuses before importing.');
                  setImportStatusKind('error');
                  return;
                }
                importBackdatedExcel(pendingImportFile);
                return;
              }
              importFileInputRef.current?.click();
            }}
            disabled={importWorking || !importMode}
          >
            {importWorking ? 'Working…' : (pendingImportFile ? 'Import File' : 'Choose Excel File')}
          </Button>
          <Button
            type="button"
            kind="ghost"
            onClick={() => {
              resetImportModal();
              closeImportModal();
            }}
            disabled={importWorking}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
