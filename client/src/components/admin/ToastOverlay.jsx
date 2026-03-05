/**
 * Fixed-position toast overlay that shows new-submission notifications.
 */
export function ToastOverlay({ submissionToasts, setSubmissionToasts }) {
  if (!submissionToasts.length) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      pointerEvents: 'none',
    }}>
      {submissionToasts.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: 'auto',
            background: 'var(--color-primary)',
            color: '#fff',
            borderRadius: 10,
            padding: '14px 18px',
            minWidth: 280,
            maxWidth: 360,
            boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>&#128202;</span> New Submission
          </div>
          <div style={{ fontSize: 13, opacity: 0.95, lineHeight: 1.4 }}>{t.heading}</div>
          {(t.from || t.type) && (
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {[t.from && `From: ${t.from}`, t.type && `Type: ${t.type}`].filter(Boolean).join(' · ')}
            </div>
          )}
          <button
            onClick={() => setSubmissionToasts((prev) => prev.filter((x) => x.id !== t.id))}
            style={{
              alignSelf: 'flex-end',
              marginTop: 4,
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              fontSize: 11,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >Dismiss</button>
        </div>
      ))}
    </div>
  );
}
