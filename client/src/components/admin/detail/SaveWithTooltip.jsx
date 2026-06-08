import { Button } from '../../bite-size/BitsizeUI';

/**
 * Save button wrapped in a hover tooltip that explains why saving is disabled.
 * Shared by the modal header and footer.
 */
export function SaveWithTooltip({
  show,
  setShow,
  working,
  hasPendingChanges,
  saveDisabledReason,
  onSave,
}) {
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Button
        onClick={onSave}
        disabled={working || !hasPendingChanges}
      >
        Save Changes
      </Button>
      {(working || !hasPendingChanges) && show && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--slate-900)',
            color: 'white',
            fontSize: 12,
            lineHeight: 1.2,
            padding: '6px 8px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
            zIndex: 30,
          }}
        >
          {saveDisabledReason}
        </span>
      )}
    </span>
  );
}
