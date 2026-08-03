import { Badge } from '../bite-size/BitsizeUI';

// The four stops every ticket travels, in order. Status became POSITION on this
// board: a reporter reads "where is this" off the track rather than decoding a
// single badge word. Approved is the only stop without a status of its own name
// on arrival — a ticket can jump straight to Submitted — so a later stop being
// reached implies the earlier ones were too (see `reachedIndex`).
const TRACK = [
  { key: 'reported', label: 'Reported', at: (item) => item.created_at },
  { key: 'approved', label: 'Approved', at: (item) => item.approved_status_at },
  { key: 'submitted', label: 'In EasyVista', at: (item) => item.submitted_status_at },
  { key: 'deployed', label: 'Deployed', at: (item) => item.deployed_status_at },
];

// Statuses that end a ticket somewhere other than Deployed. The track would be
// a lie for these — nothing further is coming — so they get a one-line outcome
// instead. Anything not listed here is somewhere on the pipeline.
const OUTCOMES = {
  Duplicate: {
    glyph: '⇄',
    title: 'Closed as a duplicate',
    body: 'Folded into an earlier report of the same issue',
    at: (item) => item.duplicate_status_at,
  },
  Rejected: {
    glyph: '×',
    title: 'Closed without a change',
    body: 'Reviewed and not taken forward',
    at: (item) => item.latest_status_changed_at,
  },
  Redirected: {
    glyph: '→',
    title: 'Handed to another team',
    body: 'Moved to the queue that owns it',
    at: (item) => item.latest_status_changed_at,
  },
  Retired: {
    glyph: '⌀',
    title: 'Retired',
    body: 'Closed out and no longer tracked',
    at: (item) => item.retired_status_at,
  },
};

function shortDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function fullDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(value) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * The identifier the AI search cites: the EasyVista incident number when there
 * is one, otherwise the internal #id. Kept in step with the server's `ref` in
 * aiSearchService.buildCard so a reporter can match an AI result to a card
 * without expanding it.
 */
function ticketRef(item) {
  return item.easyvista_ticket_id ? String(item.easyvista_ticket_id) : `#${item.id}`;
}

/** How far along the track this ticket has actually got. -1 for none. */
function reachedIndex(item) {
  let reached = 0; // Reported is true by definition — it exists.
  for (let index = 1; index < TRACK.length; index += 1) {
    if (TRACK[index].at(item)) reached = index;
  }
  // A ticket sitting in Approved with no timestamp (imported, or approved before
  // history was kept) still reads as approved from its live status.
  if (reached === 0 && item.status === 'Approved') reached = 1;
  return reached;
}

function applicationModifier(name) {
  return `pb-app--${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none'}`;
}

/**
 * One ticket on the public status board.
 *
 * `isMine` is passed in rather than read here: ownership has two sources (the
 * server's is_mine for a signed-in reporter, this browser's remembered ids
 * otherwise) and useViewer.isMine is the single place that decides between them.
 */
export function PublicItemCard({ item, isMine = false }) {
  const status = String(item.status || 'New');
  const outcome = OUTCOMES[status];
  const reached = reachedIndex(item);
  const description = String(item.what_happened_exact_details || item.request || '').trim();
  const updated = timeAgo(item.latest_status_changed_at || item.updated_at);

  const references = [
    ['Ticket', `#${item.id}`],
    ['Incident', item.easyvista_ticket_id],
    ['Policy', item.policy_num],
    ['Account', item.account_num],
    ['Jira card', item.jira_number],
  ].filter(([, value]) => Boolean(value));

  return (
    <article
      className={`pb-item pb-item--${status.toLowerCase().replace(/\s+/g, '-')}${isMine ? ' pb-item--own' : ''}`}
    >
      <div className="pb-item-top">
        <span className="pb-ref">{ticketRef(item)}</span>
        {isMine && <span className="pb-yours">Yours</span>}
        {item.application_name && (
          <span className={`pb-apptag ${applicationModifier(item.application_name)}`}>
            {item.application_name}
          </span>
        )}
        <Badge value={item.type} />
        <Badge value={status} />
        {updated && <span className="pb-when">Updated {updated}</span>}
      </div>

      <h3 className="pb-sum">{item.summary_of_issue || 'Untitled report'}</h3>

      {outcome ? (
        <div className="pb-outcome">
          <span className="pb-outcome-glyph" aria-hidden="true">{outcome.glyph}</span>
          <b>{outcome.title}</b>
          <span>
            {outcome.body}
            {fullDate(outcome.at(item)) && (
              <>
                {' '}
                <span className="pb-sep">·</span>
                {' '}
                {fullDate(outcome.at(item))}
              </>
            )}
          </span>
        </div>
      ) : (
        <ol className="pb-track" aria-label={`Stage ${reached + 1} of ${TRACK.length} — ${TRACK[reached].label}`}>
          {TRACK.map((stop, index) => {
            const done = index <= reached;
            return (
              <li
                key={stop.key}
                className={`pb-stop${done ? ' is-done' : ''}${index === reached ? ' is-now' : ''}`}
                aria-current={index === reached ? 'step' : undefined}
              >
                <span className="pb-stop-rail"><span className="pb-stop-dot" /></span>
                <span className="pb-stop-lbl">{stop.label}</span>
                <span className="pb-stop-date">{shortDate(stop.at(item)) || '—'}</span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="pb-meta">
        Reported by <b>{isMine ? 'you' : (item.created_by || 'someone')}</b>
        {fullDate(item.created_at) && (
          <>
            {' '}
            <span className="pb-sep">·</span>
            {' '}
            {fullDate(item.created_at)}
          </>
        )}
        {item.application_name && (
          <>
            {' '}
            <span className="pb-sep">·</span>
            {' '}
            {item.application_name}
          </>
        )}
      </p>

      <details className="pb-more">
        <summary>
          <span className="pb-more-show">Show details</span>
          <span className="pb-more-hide">Hide details</span>
          <span className="pb-caret" aria-hidden="true" />
        </summary>
        <div className="pb-more-body">
          {description && (
            <div className="pb-block">
              <span className="pb-block-label">
                {item.type === 'enhancement' ? 'What was requested' : 'What was reported'}
              </span>
              <p className="pb-prose">{description}</p>
            </div>
          )}

          {references.length > 0 && (
            <div className="pb-block">
              <span className="pb-block-label">Reference numbers</span>
              <div className="pb-refs">
                {references.map(([label, value]) => (
                  <span className="pb-refitem" key={label}>
                    <span>{label}</span>
                    <b>{value}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* The hand-off trail. Only present on a ticket that has actually
              moved, and it carries no note — that stays between admins
              (server/src/services/redirectService.js: mapPublicRouting). */}
          {Array.isArray(item.routings) && item.routings.length > 0 && (
            <div className="pb-block">
              <span className="pb-block-label">Moved between teams</span>
              <ol className="pb-tl">
                {[...item.routings].reverse().map((move) => (
                  <li key={move.id}>
                    <span className="pb-tl-dot" aria-hidden="true" />
                    <span className="pb-tl-txt">
                      <b>
                        {move.from_application_name
                          ? `${move.from_application_name} → ${move.to_application_name}`
                          : `Filed under ${move.to_application_name}`}
                      </b>
                      <span>{fullDate(move.routed_at)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
