import { Badge } from '../bite-size/BitsizeUI';

function submittedDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

function statusDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

// The identifier the AI search cites for a ticket: the EasyVista incident
// number when one exists, otherwise the internal reference id (#id). Kept in
// sync with the server's `ref` in aiSearchService.buildCard so a rep can match
// an AI result to its card in the collapsed list without expanding it.
function ticketRef(item) {
  return item.easyvista_ticket_id ? String(item.easyvista_ticket_id) : `#${item.id}`;
}

function descriptionForItem(item) {
  const name = String(item.created_by || 'Requester').trim();
  const defectDescription = String(item.what_happened_exact_details || '').trim();
  const enhancementDescription = String(item.request || '').trim();
  const body = defectDescription || enhancementDescription;
  if (!body) return '-';
  return `${name} submitted the following: ${body}`;
}

/**
 * A single item card on the public status board.
 */
export function PublicItemCard({ item }) {
  return (
    <article className="public-item">
      <div className="public-top" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            className="public-ref"
            title="Incident number — matches the reference the AI search cites"
            style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontWeight: 700, fontSize: 13, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}
          >
            {ticketRef(item)}
          </span>
          <h4 style={{ margin: 0 }}>{item.summary_of_issue || '-'}</h4>
          <span className="muted" style={{ fontSize: 12 }}>
            Reported: {submittedDate(item.created_at)}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            Latest update: {submittedDate(item.latest_status_changed_at || item.updated_at)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Badge value={item.type} />
          <Badge value={item.status} />
          {(item.is_retired || item.status === 'Retired') && <Badge value="Retired" />}
        </div>
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Show details</summary>
        <div style={{ marginTop: 10 }}><strong>#{item.id}</strong></div>
        <div className="public-meta">
          <div className="pub-cols">
            <div className="pub-col">
              <div className="pub-field">
                <span className="pub-label">Reported</span>
                <span>{submittedDate(item.created_at)}</span>
              </div>
              <div className="pub-field">
                <span className="pub-label">Policy / Account</span>
                <span>{item.policy_num || '-'} / {item.account_num || '-'}</span>
              </div>
              <div className="pub-field">
                <span className="pub-label">Latest Status</span>
                <span>
                  {item.status === 'New'
                    ? 'Reported'
                    : item.status === 'Submitted'
                      ? 'Submitted to EV'
                      : (item.latest_status_value || item.status)
                  } on {submittedDate(item.latest_status_changed_at)}
                </span>
              </div>
              {item.status === 'Duplicate' && (
                <div className="pub-field">
                  <span className="pub-label">Marked Duplicate</span>
                  <span>{statusDate(item.duplicate_status_at || item.latest_status_changed_at)}</span>
                </div>
              )}
              {(item.is_retired || item.status === 'Retired') && !!item.retired_status_at && (
                <div className="pub-field">
                  <span className="pub-label">Retired</span>
                  <span>{statusDate(item.retired_status_at)}</span>
                </div>
              )}
            </div>
            <div className="pub-col">
              <div className="pub-field">
                <span className="pub-label">Requester</span>
                <span>{item.created_by || '-'}</span>
              </div>
              <div className="pub-field">
                <span className="pub-label">Application</span>
                <span>{item.application_name || '-'}</span>
              </div>
              <div className="pub-field">
                <span className="pub-label">EV Ticket</span>
                <span>{item.easyvista_ticket_id || '-'}</span>
              </div>
              <div className="pub-field">
                <span className="pub-label">JIRA Card #</span>
                <span>{item.jira_number || '-'}</span>
              </div>
            </div>
          </div>
          <div className="pub-field pub-field-full">
            <span className="pub-label">Description</span>
            <span>{descriptionForItem(item)}</span>
          </div>
        </div>
      </details>
    </article>
  );
}
