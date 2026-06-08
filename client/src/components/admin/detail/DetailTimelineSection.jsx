import { Card } from '../../bite-size/BitsizeUI';
import {
  formatDateTime,
  formatTimelineStatus,
} from '../../../utils/formatUtils';

/**
 * Status Timeline card.
 */
export function DetailTimelineSection({
  detail,
  dynamicCoreStatusSet,
  dynamicCleanupStatusSet,
}) {
  return (
    <>
      <p className="section-label">Status Timeline</p>
      <Card className="inner">
        {!detail.status_events || detail.status_events.length === 0 ? (
          <p className="muted">No status history found.</p>
        ) : (
          <div className="bs-form" style={{ gap: 10 }}>
            <div style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
              <p style={{ margin: 0 }}>
                <strong>{formatTimelineStatus(detail.status_events[0].status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}</strong> on {formatDateTime(detail.status_events[0].changed_at)}
              </p>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Updated by: {detail.status_events[0].changed_by || 'Unknown'}
              </p>
            </div>
            {detail.status_events.length > 1 && (
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                  Show previous statuses ({detail.status_events.length - 1})
                </summary>
                <div className="bs-form" style={{ gap: 8, marginTop: 10 }}>
                  {detail.status_events.slice(1).map((event) => (
                    <div key={event.id} style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                      <p style={{ margin: 0 }}>
                        <strong>{formatTimelineStatus(event.status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}</strong> on {formatDateTime(event.changed_at)}
                      </p>
                      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                        Updated by: {event.changed_by || 'Unknown'}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
