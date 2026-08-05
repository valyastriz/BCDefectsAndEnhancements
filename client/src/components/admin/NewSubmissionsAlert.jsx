/**
 * Blue banner showing how many new form submissions await review.
 * Hidden when count is 0.
 */
export function NewSubmissionsAlert({ count, onViewNewSubmissions }) {
  if (count <= 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      // The action never shrinks and never wraps its label, so on a phone the
      // three items cannot share one line. Wrapping drops the button to its own
      // line instead of pushing it past the banner's right edge.
      flexWrap: 'wrap',
      gap: 12,
      padding: '12px 18px',
      borderRadius: 8,
      background: 'var(--color-primary)',
      color: '#fff',
      fontWeight: 600,
      fontSize: 14,
    }}>
      <span style={{
        background: 'rgba(255,255,255,0.25)',
        borderRadius: '50%',
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        fontWeight: 800,
        flexShrink: 0,
      }}>{count}</span>
      <span style={{ flex: 1 }}>
        {count === 1
          ? '1 new form submission is awaiting review'
          : `${count} new form submissions are awaiting review`}
      </span>
      <button
        type="button"
        onClick={onViewNewSubmissions}
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.5)',
          borderRadius: 6,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          padding: '5px 14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        View New Submissions
      </button>
    </div>
  );
}
