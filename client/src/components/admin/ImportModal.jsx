import { Fragment, useState } from 'react';
import { Button, Modal, Notice } from '../bite-size/BitsizeUI';
import { RETIRED_STATUS } from '../../constants/adminConstants';

const IMPORT_STEPS = [
  { step: 1, label: 'File' },
  { step: 2, label: 'Check the columns' },
  { step: 3, label: 'Import' },
];

const ROW_TYPES = [
  { value: 'defect', label: 'Defects' },
  { value: 'enhancement', label: 'Enhancements' },
  { value: 'cleanup', label: 'Cleanup tasks' },
  // The fourth. The mode sets the type of every row, so without this entry a sheet
  // of report requests could only be imported as defects — and its report columns
  // were never read.
  { value: 'report', label: 'Report requests' },
];

function formatImportHistoryDate(entry) {
  const value = entry.created_at || entry.createdAt;
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString();
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The 1–2–3 rail. `aria-current` marks where you are for a screen reader. */
function StepRail({ current }) {
  return (
    <div className="xl-steps">
      {IMPORT_STEPS.map(({ step, label }, index) => (
        <Fragment key={step}>
          {index > 0 && <span className="xl-step-bar" />}
          <span
            className={`xl-step${step === current ? ' xl-step--on' : ''}${step < current ? ' xl-step--done' : ''}`}
            aria-current={step === current ? 'step' : undefined}
          >
            <span className="xl-step-n" aria-hidden="true">{step}</span>
            {label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One column of the sheet and where it is going. `state` drives the amber
 * treatment: a column nobody claimed is a decision the admin still owes, and it
 * stops being amber the moment they make it.
 */
function MappingRow({ label, note, todo, ariaLabel, value, onChange, children }) {
  return (
    <div className={`xl-map${todo ? ' xl-map--todo' : ''}`}>
      <span className="xl-map-src">
        {label}
        <span>{note}</span>
      </span>
      <span className="xl-map-arrow" aria-hidden="true">→</span>
      <select aria-label={ariaLabel} value={value} onChange={onChange}>
        {children}
      </select>
    </div>
  );
}

/**
 * Import from Excel — three steps, because it always was three: pick a file,
 * check what the columns became, then write.
 *
 * The point of the middle step is that most columns match themselves. Only the
 * ones needing a decision are surfaced; the rest sit behind "Review all N
 * mappings", and the first rows are shown as they will be imported BEFORE
 * anything is written.
 */
export function ImportModal({
  importModalOpen,
  closeImportModal,
  importWorking,
  importMode,
  setImportMode,
  importAvailableHeaders,
  setImportColumnMappings,
  pendingImportFile,
  importStatusText,
  setImportStatusText,
  importStatusKind,
  setImportStatusKind,
  importResultErrors,
  importResultWarnings = [],
  importSummary,
  importAction,
  importHistory,
  importRequiresApplicationDefault,
  importDefaultApplicationName,
  setImportDefaultApplicationName,
  importUnknownStatuses,
  importUnknownStatusCounts,
  importAllowedStatuses,
  importStatusValueMappings,
  setImportStatusValueMappings,
  importTargetByHeader,
  visibleImportMappingTargets,
  sortedImportAvailableHeaders,
  importFileInputRef,
  analyzeImportFile,
  importBackdatedExcel,
  startAnotherImport,
  resetImportModal,
  // The sequence
  importStep,
  importTotalRows,
  importDecisionHeaders,
  importUndecidedHeaderCount,
  importUnmappedStatusCount,
  importMatchedHeaderSet,
  importPreview,
  // Meta options
  dynamicStatuses,
  dynamicApplications,
}) {
  const [dragOver, setDragOver] = useState(false);

  const columnCount = importAvailableHeaders.length;
  const matchedCount = importMatchedHeaderSet.size;
  const decisionCount = importDecisionHeaders.length;

  // Reassigning a target has to take it off whatever column held it, or two
  // columns would both claim to be Summary and only one would win silently.
  const mapHeaderToTarget = (header) => (event) => {
    const selectedTargetKey = event.target.value;
    setImportColumnMappings((prev) => {
      const next = { ...(prev || {}) };
      for (const [targetKey, mappedHeader] of Object.entries(next)) {
        if (String(mappedHeader || '').trim() === header) delete next[targetKey];
      }
      if (!selectedTargetKey) return next;
      next[selectedTargetKey] = header;
      return next;
    });
  };

  const targetOptions = (header) => visibleImportMappingTargets.map((target) => (
    <option key={`${header}-${target.key}`} value={target.key}>{target.label}</option>
  ));

  const statusOptions = [...(importAllowedStatuses.length > 0
    ? importAllowedStatuses
    : [...dynamicStatuses, RETIRED_STATUS])]
    .sort((left, right) => String(left || '').localeCompare(String(right || '')));

  function beginImport() {
    setImportStatusText('');
    setImportStatusKind('');
    if (importRequiresApplicationDefault && !importDefaultApplicationName) {
      setImportStatusText('Choose an application for the rows that do not name one.');
      setImportStatusKind('error');
      return;
    }
    if (importUnmappedStatusCount > 0) {
      setImportStatusText('Say what every unrecognised status means before importing.');
      setImportStatusKind('error');
      return;
    }
    importBackdatedExcel(pendingImportFile);
  }

  // A drop and the file picker end in the same analyze call — the picker's own
  // change handler is `analyzeImportFile` too (AdminDashboardPage wires it), so
  // there is one path into step 2 regardless of how the file arrived.
  function takeDroppedFile(event) {
    event.preventDefault();
    setDragOver(false);
    if (importWorking || !importMode) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) analyzeImportFile(file);
  }

  const historyFold = importHistory.length > 0 && (
    <details className="at-fold">
      <summary>
        Recent imports <span>last {importHistory.length}</span>
      </summary>
      <div className="at-fold-body">
        {importHistory.map((entry) => (
          <p key={entry.id} className="at-hint" style={{ margin: 0 }}>
            {formatImportHistoryDate(entry)}
            {' · '}
            {String(entry.import_mode || entry.mode || '—')}
            {' · '}
            {entry.file_name || entry.fileName}
            {' — '}
            {entry.summary_message || entry.message}
          </p>
        ))}
      </div>
    </details>
  );

  const footer = importStep === 3
    ? (
      <div className="at-foot">
        <Button type="button" onClick={closeImportModal}>Done</Button>
        <Button type="button" kind="ghost" onClick={startAnotherImport} disabled={importWorking}>
          Import another file
        </Button>
      </div>
    )
    : (
      <div className="at-foot">
        <Button
          type="button"
          onClick={importStep === 2 ? beginImport : () => importFileInputRef.current?.click()}
          disabled={importWorking || !importMode}
        >
          {importWorking
            ? (importAction === 'analyzing' ? 'Reading the file…' : 'Importing…')
            : (importStep === 2
              ? `Import ${importTotalRows} row${importTotalRows === 1 ? '' : 's'}`
              : 'Choose an Excel file')}
        </Button>
        <Button
          type="button"
          kind="ghost"
          onClick={() => { resetImportModal(); closeImportModal(); }}
          disabled={importWorking}
        >
          Cancel
        </Button>
        <span className="at-foot-note">
          {importStep === 2
            ? 'Nothing is written until you press Import.'
            : 'Pick the sheet first — the next step shows what its columns became.'}
        </span>
      </div>
    );

  return (
    <Modal
      open={importModalOpen}
      onClose={closeImportModal}
      title="Import from Excel"
      className="xl-modal"
      footer={footer}
    >
      <div className="xl-body">
        <StepRail current={importStep} />

        {importStatusText && (
          <Notice text={importStatusText} kind={importStatusKind === 'success' ? 'success' : undefined} />
        )}

        {/* ── Step 1: the file ── */}
        {importStep === 1 && (
          <>
            <label className="at-f">
              <span className="at-f-lbl">These rows are<em className="at-req" aria-hidden="true">*</em></span>
              <select value={importMode} onChange={(event) => setImportMode(event.target.value)}>
                <option value="">Select one</option>
                {ROW_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="at-hint">Sets the type of every row in the file.</span>
            </label>

            <div
              className="xl-drop"
              style={dragOver ? { borderStyle: 'solid' } : undefined}
              onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={takeDroppedFile}
            >
              <b>Drop an .xlsx or .xls file here</b>
              <Button
                type="button"
                kind="ghost"
                disabled={importWorking || !importMode}
                onClick={() => importFileInputRef.current?.click()}
              >
                Choose a file
              </Button>
              <span className="xl-drop-hint">
                {importMode
                  ? 'The first worksheet is read. Nothing is written until you have checked the columns.'
                  : 'Say what the rows are first — it decides which fields the columns can map to.'}
              </span>
            </div>

            {historyFold}
          </>
        )}

        {/* ── Step 2: check the columns ── */}
        {importStep === 2 && (
          <>
            <div className="xl-file">
              <b>{pendingImportFile?.name}</b>
              <span className="xl-file-meta">
                {importTotalRows} row{importTotalRows === 1 ? '' : 's'} · {columnCount} column
                {columnCount === 1 ? '' : 's'}
                {formatFileSize(pendingImportFile?.size) && ` · ${formatFileSize(pendingImportFile?.size)}`}
              </span>
              <Button
                type="button"
                kind="ghost"
                disabled={importWorking}
                onClick={() => importFileInputRef.current?.click()}
              >
                Choose a different file
              </Button>
            </div>

            <div className="at-row at-row--2">
              <label className="at-f">
                <span className="at-f-lbl">These rows are<em className="at-req" aria-hidden="true">*</em></span>
                <select value={importMode} onChange={(event) => setImportMode(event.target.value)}>
                  {ROW_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="at-hint">Sets the type of every row in the file.</span>
              </label>

              {importRequiresApplicationDefault && (
                <label className="at-f">
                  <span className="at-f-lbl">
                    Application for rows that don’t name one<em className="at-req" aria-hidden="true">*</em>
                  </span>
                  <select
                    value={importDefaultApplicationName}
                    onChange={(event) => setImportDefaultApplicationName(event.target.value)}
                  >
                    <option value="">Select one</option>
                    {dynamicApplications.map((application) => (
                      <option key={application} value={application}>{application}</option>
                    ))}
                  </select>
                  <span className="at-hint">
                    Read from the Applications list, so a newly added application appears here.
                  </span>
                </label>
              )}
            </div>

            <div className="xl-matched">
              <b>{matchedCount} of {columnCount} column{columnCount === 1 ? '' : 's'}</b>
              {' '}matched the portal’s fields by name.
            </div>

            {decisionCount > 0 && (
              <>
                <div className="xl-needs">
                  {importUndecidedHeaderCount > 0 ? (
                    <>
                      <b>
                        {importUndecidedHeaderCount} column{importUndecidedHeaderCount === 1 ? '' : 's'} need
                        {importUndecidedHeaderCount === 1 ? 's' : ''} a decision.
                      </b>
                      {' '}Everything else is already mapped — you only have to look at these, then import.
                    </>
                  ) : (
                    <>
                      <b>Every column is now accounted for.</b>{' '}
                      {decisionCount} did not match by name and you have decided what to do with{' '}
                      {decisionCount === 1 ? 'it' : 'them'}.
                    </>
                  )}
                </div>

                <div className="xl-maps">
                  {importDecisionHeaders.map((header) => (
                    <MappingRow
                      key={header}
                      label={header}
                      note={importTargetByHeader[header] ? 'you mapped this column' : 'column unmatched'}
                      todo={!importTargetByHeader[header]}
                      ariaLabel={`Map ${header}`}
                      value={importTargetByHeader[header] || ''}
                      onChange={mapHeaderToTarget(header)}
                    >
                      <option value="">Don’t import this column</option>
                      {targetOptions(header)}
                    </MappingRow>
                  ))}
                </div>
              </>
            )}

            {importUnknownStatuses.length > 0 && (
              <>
                <div className="xl-needs">
                  <b>
                    {importUnknownStatuses.length} status value
                    {importUnknownStatuses.length === 1 ? " isn’t" : "s aren’t"} one of ours.
                  </b>
                  {' '}Tell the portal what {importUnknownStatuses.length === 1 ? 'it means' : 'they mean'} and the
                  mapping is remembered for the rest of the file.
                </div>
                <div className="xl-maps">
                  {importUnknownStatuses.map((statusValue) => {
                    const rowCount = Number(importUnknownStatusCounts?.[statusValue] || 0);
                    return (
                      <MappingRow
                        key={statusValue}
                        label={`“${statusValue}”`}
                        note={rowCount > 0 ? `appears in ${rowCount} row${rowCount === 1 ? '' : 's'}` : 'in this file'}
                        todo={!String(importStatusValueMappings[statusValue] || '').trim()}
                        ariaLabel={`Map status ${statusValue}`}
                        value={importStatusValueMappings[statusValue] || ''}
                        onChange={(event) => setImportStatusValueMappings((prev) => ({
                          ...(prev || {}),
                          [statusValue]: event.target.value,
                        }))}
                      >
                        <option value="">Choose a status</option>
                        {statusOptions.map((allowedStatus) => (
                          <option key={`${statusValue}-${allowedStatus}`} value={allowedStatus}>
                            {allowedStatus}
                          </option>
                        ))}
                      </MappingRow>
                    );
                  })}
                </div>
              </>
            )}

            <details className="at-fold">
              <summary>
                Review all {columnCount} mapping{columnCount === 1 ? '' : 's'}{' '}
                <span>{matchedCount} already matched</span>
              </summary>
              <div className="at-fold-body">
                <div className="xl-maps import-mapping-scroll">
                  {sortedImportAvailableHeaders.map((header) => (
                    <MappingRow
                      key={header}
                      label={header}
                      note={importMatchedHeaderSet.has(header) ? 'column matched by name' : 'column unmatched'}
                      ariaLabel={`Map ${header}`}
                      value={importTargetByHeader[header] || ''}
                      onChange={mapHeaderToTarget(header)}
                    >
                      <option value="">Don’t import this column</option>
                      {targetOptions(header)}
                    </MappingRow>
                  ))}
                </div>
              </div>
            </details>

            {importPreview.columns.length > 0 && (
              <div>
                <p className="xl-preview-cap" style={{ margin: '0 0 7px' }}>
                  First {importPreview.rows.length} row{importPreview.rows.length === 1 ? '' : 's'}, as
                  {' '}{importPreview.rows.length === 1 ? 'it' : 'they'} will be imported:
                </p>
                <div className="xl-preview">
                  <table>
                    <thead>
                      <tr>
                        {importPreview.columns.map((column) => (
                          <th key={column.key} scope="col">{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((cells, rowIndex) => (
                        <tr key={`preview-${rowIndex}`}>
                          {cells.map((cell, cellIndex) => (
                            <td key={importPreview.columns[cellIndex].key}>{cell || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {historyFold}
          </>
        )}

        {/* ── Step 3: what was written ── */}
        {importStep === 3 && (
          <div className="xl-result">
            <div className="xl-tally">
              <span className="xl-tallybox">
                <b>{importSummary.imported}</b>
                <span>Imported</span>
              </span>
              <span className={`xl-tallybox${importSummary.invalid > 0 ? ' xl-tallybox--bad' : ''}`}>
                <b>{importSummary.invalid}</b>
                <span>Skipped</span>
              </span>
              <span className="xl-tallybox">
                <b>{importSummary.total}</b>
                <span>Rows in file</span>
              </span>
            </div>

            {importSummary.invalid > 0 && (
              <div className="xl-needs">
                <b>
                  {importSummary.invalid} row{importSummary.invalid === 1 ? ' was' : 's were'} skipped and
                  nothing was written for {importSummary.invalid === 1 ? 'it' : 'them'}.
                </b>
                {' '}The other {importSummary.imported} are in the queue. Fix these in the sheet and import it
                again — the {importSummary.imported} will be recognised as already present.
              </div>
            )}

            {importResultErrors.length > 0 && (
              <ul className="xl-rows">
                {importResultErrors.map((line, index) => (
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            )}

            {/* Rows that DID land, minus something — an assignee the sheet named
                that no portal user matches, hours with nobody to credit them to.
                Said plainly and separately from the skipped rows above, because
                silence here would read as "everything in the sheet arrived". */}
            {importResultWarnings.length > 0 && (
              <>
                <div className="xl-needs xl-needs--soft">
                  <b>
                    {importResultWarnings.length} row{importResultWarnings.length === 1 ? '' : 's'} imported
                    with a field left empty.
                  </b>
                  {' '}The tickets are in the queue — these values could not be placed, and nothing was
                  guessed.
                </div>
                <ul className="xl-rows">
                  {importResultWarnings.map((line, index) => (
                    <li key={`${line}-${index}`}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
