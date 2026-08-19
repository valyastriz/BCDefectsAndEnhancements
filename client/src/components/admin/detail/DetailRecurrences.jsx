import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Button, Notice } from '../../bite-size/BitsizeUI';

/**
 * Who has reported this happening to them, and who is still stuck.
 *
 * ADMIN ONLY, and that is enforced at the endpoint rather than here — the rows
 * carry reporter names, free-text notes and policy numbers, none of which are on
 * the public allow-list. The public surfaces get the count and nothing else.
 *
 * Reloads on `refreshToken` so a live `submission:recurrence` event refreshes an
 * open pane rather than leaving a stale list under a moving count.
 */
function fmt(value, withTime = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function money(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function DetailRecurrences({ submissionId, detail, canEdit = false, refreshToken = 0, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    if (!submissionId) return;
    api.getRecurrences(submissionId)
      .then((res) => { setRows(Array.isArray(res) ? res : []); setError(''); })
      .catch((err) => setError(err?.message || 'Could not load who has reported this.'));
  }, [submissionId]);

  useEffect(() => { load(); }, [load, refreshToken]);

  async function act(fn, id) {
    setBusyId(id);
    try {
      await fn();
      load();
      onChanged?.();
    } catch (err) {
      setError(err?.message || 'That did not save.');
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <Notice kind="error" text={error} />;
  if (rows === null) {
    return (
      <div className="dr-skel" aria-hidden="true">
        <span className="rs-skel" style={{ height: 12, width: '47%' }} />
        <span className="rs-skel" style={{ height: 10, width: '83%' }} />
        <span className="rs-skel" style={{ height: 12, width: '39%' }} />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="muted">Nobody else has reported this one yet.</p>;
  }

  const people = new Set(rows.map((r) => r.reported_by_user_id || r.reported_by_name)).size;
  const first = rows[rows.length - 1]?.occurred_at;
  const last = rows[0]?.occurred_at;
  const blocked = rows.filter((r) => r.workaround_requested && !r.workaround_provided_at);

  // The admin's own frequency estimate sits beside the reporters' count rather
  // than being overwritten by it — one is a judgement, the other is evidence,
  // and the estimate is still the analyst's to make.
  const estimate = detail?.occurrence_count && detail?.occurrence_timeframe
    ? `${detail.occurrence_count} per ${detail.occurrence_timeframe_count > 1 ? `${detail.occurrence_timeframe_count} ` : ''}${detail.occurrence_timeframe}${detail.occurrence_timeframe_count > 1 ? 's' : ''}`
    : null;

  return (
    <div className="dr-wrap">
      <p className="dr-head">
        <b>{rows.length} {rows.length === 1 ? 'report' : 'reports'}</b>
        {` from ${people} ${people === 1 ? 'person' : 'people'} · first ${fmt(first)} · most recent ${fmt(last)}`}
      </p>

      {estimate && (
        <p className="dr-estimate">
          Your estimate on the Impact tab is <b>{estimate}</b>. This list is what reporters
          actually said — evidence beside your judgement, not a replacement for it.
        </p>
      )}

      {blocked.length > 0 && (
        <Notice
          kind="error"
          text={`${blocked.length} ${blocked.length === 1 ? 'person is' : 'people are'} blocked on this and still waiting: ${blocked.map((r) => r.reported_by_name).join(', ')}.`}
        />
      )}

      <ul className="dr-log">
        {rows.map((row) => (
          <li key={row.id} className={row.workaround_requested && !row.workaround_provided_at ? 'is-blocked' : undefined}>
            <span className="dr-when">{fmt(row.occurred_at, true)}</span>
            <span className="dr-body">
              <span className="dr-who">
                {row.reported_by_name}
                {row.depth === 2 && <em className="dr-tag" title="Reported after this was closed without a fix">challenge</em>}
                {row.depth === 3 && <em className="dr-tag dr-tag--bad" title="Reported after the fix shipped">after the fix</em>}
              </span>
              {row.note && <span className="dr-note">{row.note}</span>}
              {row.steps_to_reproduce && (
                <span className="dr-block"><b>Steps</b>{row.steps_to_reproduce}</span>
              )}
              {row.expected_behaviour && (
                <span className="dr-block"><b>Expected</b>{row.expected_behaviour}</span>
              )}
              {(row.frequency_count || row.policies_affected_count || row.direct_dollar_impact || row.workaround_cost) && (
                <span className="dr-figs">
                  {row.frequency_count ? `${row.frequency_count} per ${row.frequency_timeframe || 'period'}` : null}
                  {row.policies_affected_count ? ` · ${row.policies_affected_count} policies` : null}
                  {money(row.direct_dollar_impact) ? ` · ${money(row.direct_dollar_impact)}` : null}
                  {row.workaround_cost ? ` · ${row.workaround_cost} to work around` : null}
                </span>
              )}
              {row.workaround_requested && (
                <span className={`dr-blocked${row.workaround_provided_at ? ' is-done' : ''}`}>
                  <b>{row.workaround_provided_at ? 'Workaround given' : 'Needs a workaround'}</b>
                  {row.workaround_blocked_on ? ` — ${row.workaround_blocked_on}` : ''}
                  {row.workaround_provided_at ? ` (${fmt(row.workaround_provided_at)}${row.workaround_provided_by ? ` by ${row.workaround_provided_by}` : ''})` : ''}
                </span>
              )}
            </span>
            <span className="dr-ids">
              {[row.policy_num, row.account_num, row.transaction_num].filter(Boolean).join(' · ') || '—'}
              {canEdit && (
                <span className="dr-acts">
                  {row.workaround_requested && !row.workaround_provided_at && (
                    <Button
                      kind="ghost"
                      disabled={busyId === row.id}
                      onClick={() => act(() => api.setRecurrenceWorkaroundHandled(row.id, true), row.id)}
                    >
                      Mark handled
                    </Button>
                  )}
                  <Button
                    kind="ghost"
                    disabled={busyId === row.id}
                    onClick={() => act(() => api.retractRecurrence(row.id), row.id)}
                    title="Strike this report — the row is kept, the count drops"
                  >
                    Strike
                  </Button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
