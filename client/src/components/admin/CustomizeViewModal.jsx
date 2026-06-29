import { useState } from 'react';
import { Button, Card, Modal } from '../bite-size/BitsizeUI';
import {
  ADMIN_TABLE_COLUMNS,
  ADMIN_FILTER_FIELDS,
  DEFAULT_VISIBLE_COLUMN_KEYS,
  DEFAULT_VISIBLE_FILTER_KEYS,
} from '../../constants/adminConstants';

const COLUMN_BY_KEY = new Map(ADMIN_TABLE_COLUMNS.map((column) => [column.key, column]));

// Build the initial column draft: visible columns first (in saved order), then
// any hidden columns, so hidden ones can be re-enabled and reordered.
function buildInitialColumns(columns) {
  const visibleKeys = Array.isArray(columns) && columns.length > 0
    ? columns
    : DEFAULT_VISIBLE_COLUMN_KEYS;
  const visibleSet = new Set(visibleKeys);
  const ordered = [
    ...visibleKeys.map((key) => COLUMN_BY_KEY.get(key)).filter(Boolean),
    ...ADMIN_TABLE_COLUMNS.filter((column) => !visibleSet.has(column.key)),
  ];
  return ordered.map((column) => ({
    key: column.key,
    label: column.label,
    visible: visibleSet.has(column.key),
  }));
}

/**
 * "Customize View" editor — lets an admin choose which table columns show (and
 * reorder them) and which filters show. Edits a local draft; Save commits via
 * onSave, Reset to Default via onReset. Both close the modal from the parent.
 *
 * Mounted only while open (parent gates with `open &&`), so the lazy useState
 * initializers seed a fresh draft from the current saved view each time.
 */
export function CustomizeViewModal({ open, onClose, columns, filters, onSave, onReset }) {
  // draftColumns: [{ key, label, visible }] in display order.
  const [draftColumns, setDraftColumns] = useState(() => buildInitialColumns(columns));
  const [draftFilterSet, setDraftFilterSet] = useState(
    () => new Set(Array.isArray(filters) ? filters : DEFAULT_VISIBLE_FILTER_KEYS),
  );

  const visibleColumnCount = draftColumns.filter((column) => column.visible).length;

  function toggleColumn(key) {
    setDraftColumns((prev) => prev.map((column) => {
      if (column.key !== key) return column;
      // Never allow hiding the last visible column (blank table).
      if (column.visible && visibleColumnCount <= 1) return column;
      return { ...column, visible: !column.visible };
    }));
  }

  function moveColumn(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= draftColumns.length) return;
    setDraftColumns((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleFilter(key) {
    setDraftFilterSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSave() {
    onSave({
      columns: draftColumns.filter((column) => column.visible).map((column) => column.key),
      filters: ADMIN_FILTER_FIELDS.filter((field) => draftFilterSet.has(field.key)).map((field) => field.key),
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Customize View">
      <div className="stack" style={{ gap: 16 }}>
        <Card title={`Columns (${visibleColumnCount} of ${ADMIN_TABLE_COLUMNS.length} shown)`}>
          <p className="muted" style={{ marginTop: 0 }}>
            Check the columns to show and use the arrows to reorder them.
          </p>
          <div className="stack" style={{ gap: 6, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {draftColumns.map((column, index) => (
              <div
                key={column.key}
                className="toggle-row"
                style={{ justifyContent: 'space-between', gap: 8 }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={column.visible}
                    disabled={column.visible && visibleColumnCount <= 1}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                </label>
                <div className="bs-actions" style={{ flexWrap: 'nowrap', gap: 6, marginTop: 0 }}>
                  <Button kind="ghost" type="button" disabled={index === 0} onClick={() => moveColumn(index, -1)} aria-label={`Move ${column.label} up`}>↑</Button>
                  <Button kind="ghost" type="button" disabled={index === draftColumns.length - 1} onClick={() => moveColumn(index, 1)} aria-label={`Move ${column.label} down`}>↓</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title={`Filters (${draftFilterSet.size} of ${ADMIN_FILTER_FIELDS.length} shown)`}>
          <p className="muted" style={{ marginTop: 0 }}>
            Check the filters to show. Hiding a filter clears its current value.
          </p>
          <div className="stack" style={{ gap: 6, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
            {ADMIN_FILTER_FIELDS.map((field) => (
              <label key={field.key} className="toggle-row" style={{ cursor: 'pointer', justifyContent: 'flex-start', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={draftFilterSet.has(field.key)}
                  onChange={() => toggleFilter(field.key)}
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>
        </Card>

        <div className="bs-actions" style={{ justifyContent: 'space-between' }}>
          <Button type="button" kind="ghost" onClick={onReset}>
            Reset to Default
          </Button>
          <div className="bs-actions" style={{ marginTop: 0 }}>
            <Button type="button" kind="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={handleSave}>Save View</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
