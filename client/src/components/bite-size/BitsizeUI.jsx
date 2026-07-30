import { useEffect, useMemo, useRef, useState } from 'react';

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`bs-card ${className}`.trim()}>
      {(title || subtitle || actions) && (
        <header className="bs-card-header">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="bs-actions">{actions}</div>}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}

function FieldLabel({ label, required }) {
  return (
    <span>
      {label}
      {required && <em className="bs-required"> *</em>}
    </span>
  );
}

export function Input({ label, required, ...props }) {
  return (
    <label className="bs-field">
      <FieldLabel label={label} required={required} />
      <input required={required} {...props} />
    </label>
  );
}

export function Select({ label, children, required, ...props }) {
  return (
    <label className="bs-field">
      <FieldLabel label={label} required={required} />
      <div className="bs-select-wrap">
        <select required={required} {...props}>
          {children}
        </select>
        <span className="bs-dropdown-caret" aria-hidden="true" />
      </div>
    </label>
  );
}

export function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  placeholder = 'Select options',
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const onDocClick = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const allSelected = selectedValues.length === options.length;

  const summary = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;
    if (allSelected) return 'All selected';
    if (selectedValues.length === 1) return selectedValues[0];
    return `${selectedValues.length} selected`;
  }, [allSelected, placeholder, selectedValues]);

  function toggleValue(value) {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((current) => current !== value));
      return;
    }
    onChange([...selectedValues, value]);
  }

  return (
    <label className="bs-field">
      <FieldLabel label={label} />
      <div className="bs-multiselect" ref={wrapperRef}>
        <button
          type="button"
          className="bs-multiselect-trigger"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          <span>{summary}</span>
          <span className="bs-dropdown-caret" aria-hidden="true" />
        </button>
        {open && (
          <div className="bs-multiselect-menu" role="listbox" aria-multiselectable="true">
            <button
              type="button"
              className="bs-multiselect-action"
              onClick={() => onChange(allSelected ? [] : [...options])}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            {options.map((option) => (
              <label key={option} className="bs-multiselect-option">
                <input
                  type="checkbox"
                  checked={selectedSet.has(option)}
                  onChange={() => toggleValue(option)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

export function Textarea({ label, required, ...props }) {
  return (
    <label className="bs-field">
      <FieldLabel label={label} required={required} />
      <textarea required={required} {...props} />
    </label>
  );
}

export function Button({ kind = 'primary', className = '', ...props }) {
  return <button className={`bs-btn bs-btn-${kind} ${className}`.trim()} {...props} />;
}

/* Maps status/type values to CSS modifier classes */
const BADGE_CLASS_MAP = {
  new:         'badge-new',
  approved:    'badge-approved',
  rejected:    'badge-rejected',
  duplicate:   'badge-duplicate',
  submitted:   'badge-submitted',
  deployed:    'badge-deployed',
  defect:      'badge-defect',
  enhancement: 'badge-enhancement',
  // The remaining defect/enhancement statuses (server/src/constants.js) — without
  // these they fell through to an unstyled grey badge.
  redirected:                      'badge-redirected',
  'backlog - monitoring impact':   'badge-holding',
  'future consideration':          'badge-holding',
  'deferred – not in current scope': 'badge-holding',
  retired:                         'badge-retired',
  'cleanup only':                  'badge-cleanup-only',
};

/* Maps a semantic tone to an existing styled badge class */
const BADGE_TONE_MAP = {
  warning: 'badge-duplicate',
  danger:  'badge-rejected',
  success: 'badge-approved',
  info:    'badge-submitted',
};

export function Badge({ value, tone, children }) {
  const content = children ?? value;
  const toneClass = tone ? BADGE_TONE_MAP[tone] ?? '' : '';
  const valueClass = !toneClass && typeof content === 'string'
    ? BADGE_CLASS_MAP[content.toLowerCase()] ?? ''
    : '';
  const modifier = toneClass || valueClass;
  return <span className={`bs-badge ${modifier}`.trim()}>{content}</span>;
}

// Stack of currently-open modals so Escape only closes the topmost one — e.g.
// an attachment preview over the detail modal must not close both at once.
const openModalStack = [];

export function Modal({ open, onClose, title, headerActions, children }) {
  // Mirror onClose into a ref so the stack effect depends only on `open` —
  // stack order must follow open order, not re-render order.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && openModalStack[openModalStack.length - 1] === onKey) {
        onCloseRef.current();
      }
    };
    openModalStack.push(onKey);
    window.addEventListener('keydown', onKey);
    return () => {
      const index = openModalStack.indexOf(onKey);
      if (index !== -1) openModalStack.splice(index, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="bs-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="bs-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="bs-modal-head">
          <h3>{title}</h3>
          <div className="bs-modal-head-actions">
            {headerActions}
            <button type="button" className="bs-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </header>
        <div className="bs-modal-body">{children}</div>
      </div>
    </div>
  );
}

/** kind: 'error' | 'success' | 'info' (default: 'error') */
export function Notice({ text, kind = 'error' }) {
  if (!text) return null;
  const cls = kind === 'success' ? 'bs-success' : kind === 'info' ? 'bs-info-banner' : 'bs-notice';
  return <p className={cls}>{text}</p>;
}
