/**
 * Red banner counting reps waiting on a workaround.
 *
 * The sibling of NewSubmissionsAlert, and deliberately louder: a new submission
 * is work arriving, this is someone stuck on a real case until an admin
 * answers. Hidden when the count is 0, which is the normal state.
 */
export function WorkaroundRequestsAlert({ count, onViewWorkaroundRequests }) {
  if (count <= 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 18px',
      borderRadius: 8,
      background: 'var(--color-danger)',
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
          ? '1 reporter is waiting on a workaround to finish their case'
          : `${count} reporters are waiting on a workaround to finish their cases`}
      </span>
      <button
        type="button"
        onClick={onViewWorkaroundRequests}
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
        View Workaround Requests
      </button>
    </div>
  );
}
