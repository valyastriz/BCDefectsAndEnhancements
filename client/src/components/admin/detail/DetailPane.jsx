/**
 * One tab pane. Only the active pane is rendered — every input in the modal is
 * controlled by the `edit` object, so unmounting an inactive pane loses nothing.
 *
 * `tabIndex={0}` makes the pane itself focusable, which is what lets a keyboard
 * user scroll a long pane without tabbing through every control in it.
 */
export function DetailPane({ id, lockBody = false, children }) {
  return (
    <div
      className="dm-panel"
      role="tabpanel"
      id={`dm-panel-${id}`}
      aria-labelledby={`dm-tab-${id}`}
      tabIndex={0}
      inert={lockBody}
    >
      {children}
    </div>
  );
}

/** A labelled group of controls inside a pane. */
export function DetailGroup({ label, children }) {
  return (
    <div className="dm-group">
      <span className="dm-group-label">{label}</span>
      {children}
    </div>
  );
}

/**
 * A value the admin reads but cannot edit. Rendered as text under a rule rather
 * than in an input box, so it can never be mistaken for something typeable.
 */
export function DetailReadOnly({ label, value, mono = false, placeholder = 'Not set' }) {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    // dm-rofield closes each pair with a rule UNDERNEATH the value. A rule
    // between label and value instead reads as if it separates the value from
    // the label above it, which makes every value look like a heading.
    <div className="bs-field dm-rofield">
      <span>
        {label}
        <em className="dm-rotag">read-only</em>
      </span>
      <p className={`dm-ro${mono ? ' dm-mono' : ''}${isEmpty ? ' dm-ro--empty' : ''}`}>
        {isEmpty ? placeholder : value}
      </p>
    </div>
  );
}
