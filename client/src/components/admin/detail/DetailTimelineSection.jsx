import {
  formatDateTime,
  formatTimelineStatus,
} from '../../../utils/formatUtils';

/**
 * The status trail, as the first block of the History & reference tab.
 *
 * One list with its own scroll boundary, newest first. Previously the latest
 * event was always expanded and older ones sat behind a second nested
 * disclosure, so a long-lived ticket buried everything below it.
 */
export function DetailTimelineSection({
  detail,
  dynamicCoreStatusSet,
  dynamicCleanupStatusSet,
}) {
  const events = detail.status_events || [];

  if (events.length === 0) {
    return (
      <div className="queue-state queue-state--inset">
        <span className="queue-state-icon" aria-hidden="true">✦</span>
        <h4>No status history found.</h4>
        <p>
          This ticket has not changed status since it was created. Set a status in Triage
          and the change will be recorded here.
        </p>
      </div>
    );
  }

  return (
    <div className="dm-timeline-scroll">
      <ol className="dm-timeline">
        {events.map((event, index) => (
          <li key={event.id} className={`dm-event${index === 0 ? ' dm-event--latest' : ''}`}>
            <span className="dm-event-dot" aria-hidden="true" />
            <p className="dm-event-title">
              {formatTimelineStatus(event.status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}
            </p>
            <p className="dm-event-meta">
              {formatDateTime(event.changed_at)} · {event.changed_by || 'Unknown'}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
