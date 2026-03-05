import { Button, Card, Input, Modal, Notice, Select } from '../bite-size/BitsizeUI';

/**
 * Modal for exporting filtered submissions to Excel.
 */
export function ExportModal({
  exportModalOpen,
  closeExportModal,
  exportWorking,
  exportError,
  selectedExportFieldKeys,
  exportFieldSearch,
  setExportFieldSearch,
  visibleExportFields,
  selectedExportFieldSet,
  selectAllVisibleExportFields,
  clearVisibleExportFields,
  toggleExportField,
  exportFilteredSubmissions,
}) {
  return (
    <Modal
      open={exportModalOpen}
      onClose={closeExportModal}
      title="Export to Excel"
    >
      <div className="stack">
        <p className="muted" style={{ marginTop: 0 }}>
          Exports currently filtered admin items. Choose which fields to include in the spreadsheet.
        </p>

        <Input
          label="Search fields"
          placeholder="Filter by field name"
          value={exportFieldSearch}
          onChange={(event) => setExportFieldSearch(event.target.value)}
        />

        <div className="bs-actions" style={{ marginTop: 0 }}>
          <Button type="button" kind="ghost" onClick={selectAllVisibleExportFields} disabled={exportWorking || visibleExportFields.length === 0}>
            Select Visible
          </Button>
          <Button type="button" kind="ghost" onClick={clearVisibleExportFields} disabled={exportWorking || visibleExportFields.length === 0}>
            Clear Visible
          </Button>
        </div>

        {exportError && <Notice text={exportError} />}

        <Card title={`Fields (${selectedExportFieldKeys.length} selected)`}>
          <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {visibleExportFields.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No fields match the current search.</p>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {visibleExportFields.map((field) => {
                  const fieldKey = String(field?.key || '').trim();
                  const checked = selectedExportFieldSet.has(fieldKey);
                  return (
                    <label key={fieldKey} className="toggle-row" style={{ cursor: exportWorking ? 'default' : 'pointer', justifyContent: 'flex-start', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExportField(fieldKey)}
                        disabled={exportWorking}
                      />
                      <span>{field.label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <div className="bs-actions">
          <Button type="button" onClick={exportFilteredSubmissions} disabled={exportWorking || selectedExportFieldKeys.length === 0}>
            {exportWorking ? 'Exporting…' : 'Download Excel'}
          </Button>
          <Button type="button" kind="ghost" onClick={closeExportModal} disabled={exportWorking}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
