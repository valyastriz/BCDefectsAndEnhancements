import { useRef } from 'react';

/**
 * The detail modal's tab strip.
 *
 * Follows the tablist pattern: one tab stop for the whole strip (roving
 * tabindex), arrow keys move between tabs, Home/End jump to the ends. Below a
 * narrow modal width the strip is swapped for a labelled select carrying the
 * same badges as text — CSS decides which is visible, so both are always in the
 * DOM and always in step.
 *
 * `tabs` entries: { key, label, count, warn, dirty }.
 */
export function DetailTabs({ tabs, active, onSelect }) {
  const stripRef = useRef(null);

  const move = (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
      onSelect(target.key);
      stripRef.current?.querySelector(`[data-tab="${target.key}"]`)?.focus();
      return;
    }
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.key === active);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onSelect(next.key);
    stripRef.current?.querySelector(`[data-tab="${next.key}"]`)?.focus();
  };

  const badgeText = (tab) => {
    if (tab.warn) return ' ⚠';
    if (tab.count) return ` · ${tab.count}`;
    if (tab.dirty) return ' •';
    return '';
  };

  return (
    <>
      <div
        className="dm-tabs"
        role="tablist"
        aria-label="Submission sections"
        ref={stripRef}
        onKeyDown={move}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            data-tab={tab.key}
            id={`dm-tab-${tab.key}`}
            aria-selected={tab.key === active}
            aria-controls={`dm-panel-${tab.key}`}
            tabIndex={tab.key === active ? 0 : -1}
            className="dm-tab"
            onClick={() => onSelect(tab.key)}
          >
            {tab.label}
            {tab.warn && (
              <span className="dm-tab-warn" aria-label="needs attention">!</span>
            )}
            {!tab.warn && tab.count > 0 && (
              <span className="dm-tab-count">{tab.count}</span>
            )}
            {!tab.warn && !tab.count && tab.dirty && (
              <span className="dm-tab-dot" aria-label="unsaved changes" />
            )}
          </button>
        ))}
      </div>

      <div className="dm-tabselect">
        <label className="bs-field">
          <span>Section</span>
          <select value={active} onChange={(e) => onSelect(e.target.value)}>
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {`${tab.label}${badgeText(tab)}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
