import { statusVariant } from '../submissionColumns';
import { CLEANUP_ONLY_STATUS } from '../../../constants/adminConstants';
import {
  formatDateOnly,
  formatMetaTypeLabel,
  formatTimeAgo,
} from '../../../utils/formatUtils';

/**
 * Who this ticket is, above everything else.
 *
 * The queue table shows type, status, cleanup and retired as badges; opening a
 * row used to trade all of that for prose sentences scattered through the body.
 * This band carries the row's identity into the modal, and is the single place
 * the EasyVista and JIRA ids appear.
 *
 * Badges read from `edit`, not `detail`, so they track the dropdowns live.
 */
export function DetailIdentityBand({
  detail,
  edit,
  effectiveType,
  collapsed = false,
  canCollapse = false,
  onToggle,
  alertCount = 0,
}) {
  // A Cleanup Only task has no defect/enhancement type yet — that is exactly why
  // EasyVista makes you pick one. Showing a "Defect" badge (its underlying
  // `type` column) alongside a "choose a type" prompt reads as a contradiction,
  // so the type badge is withheld until there is a real answer.
  const isCleanupOnly = Boolean(edit.is_cleanup)
    && (edit.cleanup_tag_type === 'cleanup_only' || !edit.cleanup_tag_type);
  const status = isCleanupOnly ? CLEANUP_ONLY_STATUS : edit.status;

  const meta = [
    { text: edit.application_name || detail.application_name },
    { text: detail.created_by ? `Reported ${formatDateOnly(detail.created_at)} by ${detail.created_by}` : '' },
    { text: detail.easyvista_ticket_id, mono: true },
    { text: edit.jira_number, mono: true },
    { text: detail.updated_at ? `Updated ${formatTimeAgo(detail.updated_at)}` : '' },
  ].filter((part) => part.text);

  const toggle = canCollapse && (
    <button
      type="button"
      className="dm-id-toggle"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      {collapsed ? 'Show details' : 'Hide details'}
      <span className="dm-caret" aria-hidden="true" />
    </button>
  );

  // Collapsed: one line. Enough to know which ticket this is and that something
  // needs attention, without eating the space the tabs need.
  if (collapsed) {
    return (
      <div className="dm-identity dm-identity--compact">
        {!isCleanupOnly && (
          <span className={`bs-badge badge-${effectiveType === 'enhancement' ? 'enhancement' : 'defect'}`}>
            {formatMetaTypeLabel(effectiveType || 'defect')}
          </span>
        )}
        <span className={`bs-badge badge-${statusVariant(status)}`}>{status}</span>
        <span className="dm-id-oneline" title={edit.summary_of_issue}>
          {edit.summary_of_issue || 'No summary given'}
        </span>
        {alertCount > 0 && (
          <span className="dm-id-alertcount">
            {alertCount === 1 ? '1 alert' : `${alertCount} alerts`}
          </span>
        )}
        {toggle}
      </div>
    );
  }

  return (
    <div className="dm-identity">
      {toggle}
      <div className="dm-id-badges">
        {!isCleanupOnly && (
          <span className={`bs-badge badge-${effectiveType === 'enhancement' ? 'enhancement' : 'defect'}`}>
            {formatMetaTypeLabel(effectiveType || 'defect')}
          </span>
        )}
        <span className={`bs-badge badge-${statusVariant(status)}`}>{status}</span>
        {edit.is_cleanup && !isCleanupOnly && <span className="bs-badge badge-cleanup-only">Clean Up</span>}
        {edit.is_retired && <span className="bs-badge badge-retired">Retired</span>}
        {edit.is_public && <span className="bs-badge dm-badge-flag">Public</span>}
        {detail.has_resubmission && <span className="bs-badge badge-holding">Resubmitted</span>}
        {detail.is_resubmission && <span className="bs-badge badge-holding">Resubmit of</span>}
      </div>

      <p className="dm-id-summary">{edit.summary_of_issue || 'No summary given'}</p>

      <p className="dm-id-meta">
        {meta.map((part, index) => (
          <span key={`${index}-${part.text}`}>
            {index > 0 && <span className="dm-sep" aria-hidden="true">· </span>}
            <span className={part.mono ? 'dm-mono' : undefined}>{part.text}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
