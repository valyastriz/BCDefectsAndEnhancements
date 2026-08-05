/**
 * The status board's non-data surfaces.
 *
 * The skeleton is shaped like the real rows at the real row height, so nothing
 * jumps when the data lands, and it is hidden from assistive tech — there is
 * nothing here to read.
 */
export function StatusBoardSkeleton({ rows = 8 }) {
  const widths = ['58%', '71%', '44%', '66%', '52%', '63%', '48%', '69%'];
  return (
    <div className="sb-panel" aria-busy="true">
      <div className="sb-band">
        <span className="sb-band-title">Loading tickets…</span>
      </div>
      <div className="sb-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="sb-item" key={index}>
            <div className="sb-row sb-row--sk">
              <span className="c-ref"><span className="sk-bar" style={{ width: 64 }} /></span>
              <span className="c-type"><span className="sk-bar" style={{ width: 52 }} /></span>
              <span className="c-sum"><span className="sk-bar" style={{ width: widths[index % widths.length] }} /></span>
              <span className="c-stage"><span className="sk-bar" style={{ width: 120 }} /></span>
              <span className="c-who"><span className="sk-bar" style={{ width: 62 }} /></span>
              <span className="c-app"><span className="sk-bar" style={{ width: 76 }} /></span>
              <span className="c-when"><span className="sk-bar" style={{ width: 50 }} /></span>
              <span className="c-exp" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatusBoardState({ tone = '', icon, title, children, actions }) {
  return (
    <div className="sb-panel">
      <div className={`sb-state${tone ? ` sb-state--${tone}` : ''}`}>
        <span className="sb-state-icon" aria-hidden="true">{icon}</span>
        <h4>{title}</h4>
        <p>{children}</p>
        {actions && <div className="sb-state-acts">{actions}</div>}
      </div>
    </div>
  );
}
