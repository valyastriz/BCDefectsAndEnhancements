import { useId, useState } from 'react';
import { TRACKER_LABEL } from '../../constants/tracker';

// The four stops every ticket travels, in order. Status became POSITION on this
// board: a reporter reads "where is this" off the track rather than decoding a
// single badge word. Approved is the only stop without a status of its own name
// on arrival — a ticket can jump straight to Submitted — so a later stop being
// reached implies the earlier ones were too (see `reachedIndex`).
//
// The row shows this as four pips plus the name of the stop it is on; the
// dated track itself lives in the expansion, which is what let the row come
// down from a ~190px card to a single line.
const TRACK = [
  { key: 'reported', label: 'Reported', at: (item) => item.created_at },
  { key: 'approved', label: 'Approved', at: (item) => item.approved_status_at },
  { key: 'submitted', label: `With ${TRACKER_LABEL}`, at: (item) => item.submitted_status_at },
  { key: 'deployed', label: 'Deployed', at: (item) => item.deployed_status_at },
];

// Statuses that end a ticket somewhere other than Deployed. The track would be
// a lie for these — nothing further is coming — so they get an outcome pill on
// the row and a one-line explanation in the expansion. Anything not listed here
// is somewhere on the pipeline.
const OUTCOMES = {
  Duplicate: {
    glyph: '⇄',
    tone: 'duplicate',
    label: 'Duplicate',
    title: 'Closed as a duplicate',
    body: 'Folded into an earlier report of the same issue',
    at: (item) => item.duplicate_status_at,
  },
  Rejected: {
    glyph: '×',
    tone: 'rejected',
    label: 'Not taken forward',
    title: 'Closed without a change',
    body: 'Reviewed and not taken forward',
    at: (item) => item.latest_status_changed_at,
  },
  Redirected: {
    glyph: '→',
    tone: 'redirected',
    label: 'Handed over',
    title: 'Handed to another team',
    body: 'Moved to the queue that owns it',
    at: (item) => item.latest_status_changed_at,
  },
  Retired: {
    glyph: '⌀',
    tone: 'retired',
    label: 'Retired',
    title: 'Retired',
    body: 'Closed out and no longer tracked',
    at: (item) => item.retired_status_at,
  },
};

// Statuses that are neither on the pipeline nor an ending — the ticket is
// parked. Grouped here so the row says so instead of drawing a track that has
// stopped moving.
const HOLDING = {
  'Backlog - Monitoring Impact': 'Monitoring impact',
  'Future Consideration': 'Future consideration',
  'Deferred – Not in Current Scope': 'Deferred',
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
 * aiSearchService.buildCard so a reporter can match an AI result to a row
 * without expanding it.
 */
function ticketRef(item) {
  return item.easyvista_ticket_id ? String(item.easyvista_ticket_id) : `#${item.id}`;
}

// Where each live status sits on the track. This, not the timestamps, decides
// how far along a ticket is.
const STATUS_STAGE = { New: 0, Approved: 1, Submitted: 2, Deployed: 3 };
const STAGE_MODIFIER = ['new', 'approved', 'submitted', 'deployed'];

/**
 * How far along the track this ticket actually is.
 *
 * Driven by the CURRENT status, deliberately. Timestamps alone would overstate
 * it: a redirect resets a ticket to New for the receiving team while the
 * Approved timestamp from the sending team stays in its history, so a
 * "furthest timestamp wins" reading showed a freshly handed-over ticket as
 * already approved — the previous team's progress claimed as the new team's.
 *
 * Falls back to the timestamps only for a status that is not on the pipeline at
 * all, which in practice renders an outcome pill instead of a track.
 */
function reachedIndex(item) {
  const byStatus = STATUS_STAGE[item.status];
  if (byStatus !== undefined) return byStatus;

  let reached = 0; // Reported is true by definition — the ticket exists.
  for (let index = 1; index < TRACK.length; index += 1) {
    if (TRACK[index].at(item)) reached = index;
  }
  return reached;
}

function applicationModifier(name) {
  return `sb-app--${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none'}`;
}

/** Four pips and the name of the stop the ticket is on. */
function StageCell({ reached }) {
  const pips = [];
  for (let index = 0; index < TRACK.length; index += 1) {
    if (index > 0) {
      pips.push(<b key={`bar-${TRACK[index].key}`} className={index <= reached ? 'on' : undefined} />);
    }
    const state = index < reached ? 'on' : (index === reached ? 'on now' : '');
    pips.push(<i key={TRACK[index].key} className={state || undefined} />);
  }

  return (
    <span className={`sb-stage sb-stage--${STAGE_MODIFIER[reached]}`}>
      <span className="sb-pips" aria-hidden="true">{pips}</span>
      <span className="sb-stage-lbl">{TRACK[reached].label}</span>
    </span>
  );
}

/**
 * One ticket on the public status board: a single scannable line that expands
 * in place.
 *
 * `isMine` is passed in rather than read here: ownership has two sources (the
 * server's is_mine for a signed-in reporter, this browser's remembered ids
 * otherwise) and useViewer.isMine is the single place that decides between them.
 */
export function StatusBoardRow({ item, isMine = false }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  const status = String(item.status || 'New');
  const outcome = OUTCOMES[status];
  const holdingLabel = HOLDING[status];
  const reached = reachedIndex(item);
  const description = String(item.what_happened_exact_details || item.request || '').trim();
  const updated = timeAgo(item.latest_status_changed_at || item.updated_at);
  const reporter = isMine ? 'you' : (item.created_by || 'someone');

  const references = [
    ['Ticket', `#${item.id}`],
    ['Incident', item.easyvista_ticket_id],
    ['Policy', item.policy_num],
    ['Account', item.account_num],
    ['Jira card', item.jira_number],
  ].filter(([, value]) => Boolean(value));

  const routings = Array.isArray(item.routings) ? item.routings : [];

  return (
    <div
      className={`sb-item sb-item--${status.toLowerCase().replace(/\s+/g, '-')}${isMine ? ' is-mine' : ''}${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="sb-row"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="c-ref">
          <span className="sb-ref">{ticketRef(item)}</span>
        </span>
        <span className="c-type">
          <span className={`sb-type sb-type--${String(item.type || '').toLowerCase()}`}>
            {item.type === 'enhancement' ? 'Enhancement' : 'Defect'}
          </span>
        </span>
        <span className="c-sum">
          <span className="sb-sum">{item.summary_of_issue || 'Untitled report'}</span>
        </span>
        <span className="c-stage">
          {outcome && <span className={`sb-out sb-out--${outcome.tone}`}><b aria-hidden="true">{outcome.glyph}</b>{outcome.label}</span>}
          {!outcome && holdingLabel && <span className="sb-out sb-out--holding"><b aria-hidden="true">◷</b>{holdingLabel}</span>}
          {!outcome && !holdingLabel && <StageCell reached={reached} />}
        </span>
        <span className="c-who">
          <span className={`sb-who${isMine ? ' sb-who--you' : ''}`}>{reporter}</span>
        </span>
        <span className="c-app">
          {item.application_name && (
            <span className={`sb-app ${applicationModifier(item.application_name)}`}>
              {item.application_name}
            </span>
          )}
        </span>
        <span className="c-when">
          {updated && <span className="sb-when">{updated}</span>}
        </span>
        <span className="c-exp" aria-hidden="true">▾</span>
      </button>

      {/* Rendered only while open: fifty collapsed expansions in the DOM is
          fifty tracks and descriptions nobody asked for. */}
      {open && (
        <div className="sb-more" id={detailsId}>
          <div className="sb-more-grid">
            <div className="sb-block">
              <span className="sb-block-label">
                {item.type === 'enhancement' ? 'What was requested' : 'What was reported'}
              </span>
              {description
                ? <p className="sb-prose">{description}</p>
                : <p className="sb-prose sb-prose--empty">No description was given.</p>}
              <p className="sb-meta">
                Reported by <b>{reporter}</b>
                {fullDate(item.created_at) && (
                  <>
                    {' '}
                    <span className="sb-sep">·</span>
                    {' '}
                    {fullDate(item.created_at)}
                  </>
                )}
                {item.application_name && (
                  <>
                    {' '}
                    <span className="sb-sep">·</span>
                    {' '}
                    {item.application_name}
                  </>
                )}
              </p>

              {/* The hand-off trail, newest first. Only present on a ticket that
                  has actually moved, and it carries no note — that stays between
                  admins (server/src/services/redirectService.js:
                  mapPublicRouting). */}
              {routings.length > 0 && (
                <div className="sb-block sb-block--trail">
                  <span className="sb-block-label">Moved between teams</span>
                  <ol className="sb-tl">
                    {[...routings].reverse().map((move, index) => (
                      <li key={move.id} className={index === 0 ? 'is-latest' : undefined}>
                        <span className="sb-tl-dot" aria-hidden="true" />
                        <span className="sb-tl-txt">
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

            <div className="sb-block">
              <span className="sb-block-label">Where it stands</span>
              {outcome || holdingLabel ? (
                <p className="sb-prose">
                  <b>{outcome ? outcome.title : `On hold — ${holdingLabel}`}</b>
                  {' — '}
                  {outcome ? outcome.body : 'Kept on the board while the team decides what happens next'}
                  {outcome && fullDate(outcome.at(item)) && (
                    <>
                      {' '}
                      <span className="sb-sep">·</span>
                      {' '}
                      {fullDate(outcome.at(item))}
                    </>
                  )}
                </p>
              ) : (
                <ol
                  className={`sb-track sb-stage--${STAGE_MODIFIER[reached]}`}
                  aria-label={`Stage ${reached + 1} of ${TRACK.length} — ${TRACK[reached].label}`}
                >
                  {TRACK.map((stop, index) => {
                    const done = index <= reached;
                    return (
                      <li
                        key={stop.key}
                        className={`sb-stop${done ? ' is-done' : ''}${index === reached ? ' is-now' : ''}`}
                        aria-current={index === reached ? 'step' : undefined}
                      >
                        <span className="sb-stop-rail"><span className="sb-stop-dot" /></span>
                        <span className="sb-stop-lbl">{stop.label}</span>
                        {/* A date only under a stop actually reached. A
                            redirected ticket still carries the sending team's
                            Approved timestamp, and printing it under an
                            unreached stop would read as though the new team had
                            already done the work. */}
                        <span className="sb-stop-date">{(done && shortDate(stop.at(item))) || '—'}</span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {references.length > 0 && (
                <>
                  <span className="sb-block-label sb-block-label--spaced">Reference numbers</span>
                  <div className="sb-refs">
                    {references.map(([label, value]) => (
                      <span className="sb-refitem" key={label}>
                        <span>{label}</span>
                        <b>{value}</b>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
