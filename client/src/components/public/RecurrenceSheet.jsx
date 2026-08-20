import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Modal, Button, Notice } from '../bite-size/BitsizeUI';
import {
  DEPTH_ALREADY_FIXED,
  DEPTH_CHALLENGE,
  DEPTH_REGRESSION,
  SHEET_COPY,
  askBlockFor,
  FREQUENCY_TIMEFRAMES,
} from '../../constants/recurrenceConstants';

/**
 * "It happened to me too" — one sheet, three depths.
 *
 * The depth is the SERVER's answer (GET .../recurrence-context) and it depends
 * on when the reporter says it happened, so the context is re-fetched when that
 * date changes rather than resolved once on open. That is what makes the
 * pre-release guard work: change the date to before the deploy and the sheet
 * turns into "this was already fixed" while it is still open.
 *
 * `harvested` is whatever the caller already knows — on the submit form that is
 * the policy number and date the reporter typed two fields ago. Re-asking for
 * it would be the portal not paying attention.
 */
function fmtDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A datetime-local value from anything the form might hold. */
function toLocalInput(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function RecurrenceSheet({ submissionId, ticketRef, harvested = {}, onClose, onDone }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    occurred_at: toLocalInput(harvested.occurred_at) || toLocalInput(new Date().toISOString()),
    policy_num: harvested.policy_num || '',
    account_num: harvested.account_num || '',
    transaction_num: harvested.transaction_num || '',
    note: '',
    steps_to_reproduce: '',
    expected_behaviour: '',
    workaround_cost: '',
    frequency_count: '',
    frequency_timeframe: 'Week',
    policies_affected_count: '',
    direct_dollar_impact: '',
    workaround_requested: false,
    workaround_blocked_on: '',
  }));
  const reqIdRef = useRef(0);

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  // Re-resolve the depth whenever the date moves. A stale answer here is the
  // difference between "add your report" and "file a regression".
  useEffect(() => {
    let active = true;
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;
    setLoading(true);
    const iso = form.occurred_at ? new Date(form.occurred_at).toISOString() : null;
    api.getRecurrenceContext(submissionId, { occurredAt: iso })
      .then((res) => {
        if (!active || reqIdRef.current !== reqId) return;
        setContext(res);
        setError('');
      })
      .catch((err) => {
        if (!active || reqIdRef.current !== reqId) return;
        setError(err?.message || 'Could not work out what to ask you.');
      })
      .finally(() => { if (active && reqIdRef.current === reqId) setLoading(false); });
    return () => { active = false; };
  }, [submissionId, form.occurred_at]);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.reportRecurrence(submissionId, {
        occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : null,
        policy_num: form.policy_num,
        account_num: form.account_num,
        transaction_num: form.transaction_num,
        note: form.note,
        steps_to_reproduce: form.steps_to_reproduce,
        expected_behaviour: form.expected_behaviour,
        workaround_cost: form.workaround_cost,
        frequency_count: form.frequency_count,
        policies_affected_count: form.policies_affected_count,
        direct_dollar_impact: form.direct_dollar_impact,
        workaround_requested: form.workaround_requested,
        workaround_blocked_on: form.workaround_blocked_on,
      });
      // 409 — they are describing something from before the fix. Not an error
      // they made; re-render as the guard rather than as a failure.
      if (res && res.depth === DEPTH_ALREADY_FIXED) {
        setContext((prev) => ({ ...prev, depth: DEPTH_ALREADY_FIXED, reason: 'predates-release', released_at: res.released_at }));
        return;
      }
      onDone?.(res);
    } catch (err) {
      setError(err?.message || 'Your report did not send.');
    } finally {
      setSaving(false);
    }
  }

  const depth = context?.depth;
  const copy = SHEET_COPY[depth] || SHEET_COPY[1];
  const askBlock = depth === DEPTH_CHALLENGE ? askBlockFor(context?.ask) : null;
  const askFields = new Set(askBlock?.fields || []);
  const refs = context?.reference_fields || { policy: true, account: true, transaction: false };
  const releasedOn = fmtDate(context?.released_at);
  const canReport = context?.can_report !== false;

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      footer={(
        <>
          <Button kind="ghost" onClick={onClose}>{depth === DEPTH_ALREADY_FIXED ? 'Close' : 'Cancel'}</Button>
          {depth !== DEPTH_ALREADY_FIXED && (
            <Button onClick={submit} disabled={saving || loading || !canReport}>
              {saving ? 'Sending…' : copy.submit}
            </Button>
          )}
        </>
      )}
    >
      {loading && !context && <p className="muted">Working out what to ask you…</p>}

      {!canReport && (
        <Notice kind="info" text="Sign in to report that this happened to you." />
      )}

      {error && <Notice kind="error" text={`${error} Nothing was lost — try again, or file a full report instead.`} />}

      {context && (
        <div className="rc-sheet">
          <p className="rc-which">
            <b>{ticketRef}</b>
            {context.summary_of_issue ? ` — ${context.summary_of_issue}` : ''}
          </p>

          {/* ── Why this sheet is asking what it asks ───────────────────── */}
          {depth === DEPTH_ALREADY_FIXED && (
            <div className="rc-ctx rc-ctx--ok">
              <b>This was fixed on {releasedOn} — after the date you gave.</b>
              <span>
                You reported it happening on {fmtDate(form.occurred_at)}, which is the version before
                the fix. Try it again: if you still see it, change the date above and we will treat it
                as the fix not holding.
              </span>
            </div>
          )}

          {depth === DEPTH_REGRESSION && (
            <div className="rc-ctx rc-ctx--bad">
              <b>Deployed on {releasedOn}. You are reporting {fmtDate(form.occurred_at)}.</b>
              <span>
                That is after the fix shipped, so this needs raising again as its own ticket — tagged
                to {ticketRef}, so the team sees the fix did not hold. We will carry over what that
                ticket already says; you tell us what is different.
              </span>
            </div>
          )}

          {depth === DEPTH_CHALLENGE && askBlock && (
            <div className="rc-ctx rc-ctx--warn">
              <b>
                {context.rejection_reason
                  ? `Closed as “${context.rejection_reason}”.`
                  : 'This one was closed without a fix.'}
              </b>
              <span>{askBlock.why}</span>
            </div>
          )}

          {depth === 1 && (
            <div className="rc-ctx rc-ctx--info">
              <b>This one is already being worked on.</b>
              {/* Says what the portal DOES, not what the team will decide.
                  Nothing here re-prioritises a ticket — the count is evidence an
                  admin can sort and filter on, and promising a queue position we
                  do not control would be a promise to break. */}
              <span>
                We will not open a second ticket — your report is recorded against it, so the
                team can see how many people this is affecting and who is hit.
              </span>
            </div>
          )}

          {context.redirected_from && (
            <Notice
              kind="info"
              text={`#${context.redirected_from} was folded into #${context.submission_id} as a duplicate — your report is being added to the one the team is actually working.`}
            />
          )}

          {context.your_last_report_at && (
            <Notice
              kind="info"
              text={`You already reported this on ${fmtDate(context.your_last_report_at)}. If it has happened again since, carry on — a second hit is real data.`}
            />
          )}

          {/* ── When, and which case ────────────────────────────────────── */}
          <div className="rc-row">
            <label className="rc-fld">
              <span>When did it happen?</span>
              <input
                type="datetime-local"
                value={form.occurred_at}
                onChange={(e) => update('occurred_at', e.target.value)}
              />
            </label>
            {refs.policy && (
              <label className="rc-fld">
                <span>Policy number{depth === DEPTH_CHALLENGE ? '' : ' (optional)'}</span>
                <input
                  type="text"
                  placeholder="e.g. 40-123456"
                  value={form.policy_num}
                  onChange={(e) => update('policy_num', e.target.value)}
                />
              </label>
            )}
            {refs.account && (
              <label className="rc-fld">
                <span>Account number{depth === DEPTH_CHALLENGE ? '' : ' (optional)'}</span>
                <input
                  type="text"
                  placeholder="e.g. 8004521"
                  value={form.account_num}
                  onChange={(e) => update('account_num', e.target.value)}
                />
              </label>
            )}
            {refs.transaction && (
              <label className="rc-fld">
                <span>Transaction number (optional)</span>
                <input
                  type="text"
                  value={form.transaction_num}
                  onChange={(e) => update('transaction_num', e.target.value)}
                />
              </label>
            )}
          </div>

          {depth !== DEPTH_ALREADY_FIXED && (
            <label className="rc-fld">
              <span>Anything different about your one? (optional)</span>
              <textarea
                rows={2}
                value={form.note}
                onChange={(e) => update('note', e.target.value)}
                placeholder="One or two lines is plenty."
              />
            </label>
          )}

          {/* ── The depth-2 block, chosen from why it was closed ─────────── */}
          {askFields.has('steps_to_reproduce') && (
            <label className="rc-fld">
              <span>What did you do, step by step?</span>
              <textarea
                rows={4}
                value={form.steps_to_reproduce}
                onChange={(e) => update('steps_to_reproduce', e.target.value)}
                placeholder={'1. Open the policy…\n2. …'}
              />
            </label>
          )}

          {askFields.has('expected_behaviour') && (
            <label className="rc-fld">
              <span>What did you expect to happen instead?</span>
              <textarea
                rows={2}
                value={form.expected_behaviour}
                onChange={(e) => update('expected_behaviour', e.target.value)}
              />
            </label>
          )}

          {askFields.has('frequency') && (
            <div className="rc-row">
              <label className="rc-fld rc-fld--narrow">
                <span>How often?</span>
                <input
                  type="number"
                  min="0"
                  value={form.frequency_count}
                  onChange={(e) => update('frequency_count', e.target.value)}
                />
              </label>
              <label className="rc-fld rc-fld--narrow">
                <span>Per</span>
                <select
                  value={form.frequency_timeframe}
                  onChange={(e) => update('frequency_timeframe', e.target.value)}
                >
                  {FREQUENCY_TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
          )}

          {askFields.has('policies_affected_count') && (
            <div className="rc-row">
              <label className="rc-fld rc-fld--narrow">
                <span>Policies affected (estimate)</span>
                <input
                  type="number"
                  min="0"
                  value={form.policies_affected_count}
                  onChange={(e) => update('policies_affected_count', e.target.value)}
                />
              </label>
              {askFields.has('direct_dollar_impact') && (
                <label className="rc-fld rc-fld--narrow">
                  <span>Money involved (optional)</span>
                  <input
                    type="text"
                    placeholder="e.g. 3180.00"
                    value={form.direct_dollar_impact}
                    onChange={(e) => update('direct_dollar_impact', e.target.value)}
                  />
                </label>
              )}
            </div>
          )}

          {askFields.has('workaround_cost') && (
            <label className="rc-fld">
              <span>How long does it take you to work around, each time?</span>
              <input
                type="text"
                placeholder="e.g. 20 minutes"
                value={form.workaround_cost}
                onChange={(e) => update('workaround_cost', e.target.value)}
              />
            </label>
          )}

          {/* ── Blocked: orthogonal to depth, on every sheet ─────────────── */}
          {depth !== DEPTH_ALREADY_FIXED && (
            <div className={`rc-blocked${form.workaround_requested ? ' is-on' : ''}`}>
              <label className="rc-check">
                <input
                  type="checkbox"
                  checked={form.workaround_requested}
                  onChange={(e) => update('workaround_requested', e.target.checked)}
                />
                <span>
                  <b>This is stopping my work — I need a workaround</b>
                  <em>Ask for a way through today, ahead of the fix itself.</em>
                </span>
              </label>
              {form.workaround_requested && (
                <>
                  <label className="rc-fld">
                    <span>What are you stuck on?</span>
                    <textarea
                      rows={2}
                      value={form.workaround_blocked_on}
                      onChange={(e) => update('workaround_blocked_on', e.target.value)}
                      placeholder="What you cannot finish, and by when."
                    />
                  </label>
                  <p className="rc-blocked-note">
                    Sends an alert to the {context.application_name || 'application'} admins now,
                    separately from the ticket queue.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
