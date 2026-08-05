import { Button, Modal, Notice } from '../bite-size/BitsizeUI';

/**
 * Export to Excel.
 *
 * Leads with how many tickets the queue's filters match — the fact the old dialog
 * never stated, so "exports the filtered items" was a promise the admin had to
 * take on trust. Every export field is offered, grouped, with presets to start
 * from, and the button states the shape of the file it will produce.
 */
export function ExportModal({
  exportModalOpen,
  closeExportModal,
  exportWorking,
  exportError,
  exportFieldGroups,
  exportPresets,
  selectedExportFieldKeys,
  selectedExportFieldSet,
  exportMatchingRowCount,
  toggleExportField,
  toggleExportGroup,
  applyExportPreset,
  exportFilteredSubmissions,
}) {
  const columnCount = selectedExportFieldKeys.length;
  const rowCount = Number(exportMatchingRowCount || 0);
  const noRows = rowCount === 0;
  const noColumns = columnCount === 0;
  const loading = exportFieldGroups.length === 0 && !exportError;

  const buttonLabel = noColumns
    ? 'Choose at least one column'
    : `Download ${rowCount} row${rowCount === 1 ? '' : 's'} × ${columnCount} column${columnCount === 1 ? '' : 's'}`;

  const footNote = noRows
    ? 'Nothing matches the queue’s filters, so there is nothing to download.'
    : (noColumns ? 'A spreadsheet with no columns would be an empty file.' : '');

  return (
    <Modal
      open={exportModalOpen}
      onClose={closeExportModal}
      title="Export to Excel"
      className="xl-modal"
      footer={(
        <div className="at-foot">
          <Button
            type="button"
            onClick={exportFilteredSubmissions}
            disabled={exportWorking || noColumns || noRows || loading}
          >
            {exportWorking ? 'Preparing the file…' : buttonLabel}
          </Button>
          <Button type="button" kind="ghost" onClick={closeExportModal} disabled={exportWorking}>
            Cancel
          </Button>
          <span className="at-foot-note">{footNote}</span>
        </div>
      )}
    >
      <div className="xl-body">
        <div className="xl-count">
          <b>{rowCount}</b>
          <span>
            {rowCount === 1 ? 'ticket matches' : 'tickets match'} your current filters and will be
            exported. Change the filters on the queue to export a different set.
          </span>
        </div>

        {exportError && <Notice text={exportError} />}

        {loading && !exportError && (
          <div className="xl-groups">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="xl-group" aria-hidden="true">
                <div className="xl-group-head"><span className="sk-bar" style={{ width: 120 }} /></div>
                <div className="xl-group-body">
                  {[0, 1, 2, 3].map((line) => (
                    <span key={line} className="sk-bar" style={{ width: `${60 + line * 8}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && (
          <>
            <div className="xl-presets">
              <span className="xl-presets-lbl">Start from</span>
              {exportPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="xl-preset"
                  disabled={exportWorking}
                  onClick={() => applyExportPreset(preset.key)}
                >
                  {preset.label} ({preset.keys.length})
                </button>
              ))}
              <button
                type="button"
                className="xl-preset"
                disabled={exportWorking || noColumns}
                onClick={() => applyExportPreset('none')}
              >
                Clear
              </button>
            </div>

            <div className="xl-groups">
              {exportFieldGroups.map((group) => (
                <div key={group.key} className="xl-group">
                  <div className="xl-group-head">
                    <b>{group.label}</b>
                    <span className="xl-group-n">{group.selectedCount} of {group.fields.length}</span>
                    <button
                      type="button"
                      className="xl-group-all"
                      disabled={exportWorking}
                      onClick={() => toggleExportGroup(group.key)}
                    >
                      {group.selectedCount === group.fields.length ? 'None' : 'All'}
                    </button>
                  </div>
                  <div className="xl-group-body">
                    {group.fields.map((field) => (
                      <label key={field.key} className="xl-ck">
                        <input
                          type="checkbox"
                          checked={selectedExportFieldSet.has(String(field.key))}
                          disabled={exportWorking}
                          onChange={() => toggleExportField(field.key)}
                        />
                        <span>{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
