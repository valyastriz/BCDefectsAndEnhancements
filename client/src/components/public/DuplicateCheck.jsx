import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { StatusBoardRow } from './StatusBoardRow';

// Below this the summary is not a searchable description — "invoice wrong"
// would come back with half the queue, so the check stays disabled until the
// rep has written something a similarity search can actually work with.
const MIN_QUERY_LENGTH = 12;

function SkeletonRow({ titleWidth, metaWidth }) {
  return (
    <div className="rs-skelrow">
      <span className="rs-skel" style={{ height: 13, width: titleWidth }} />
      <span className="rs-skel" style={{ height: 10, width: metaWidth }} />
    </div>
  );
}

/**
 * Pre-submit duplicate guard on the rep form.
 *
 * Deliberately not `AiSearchPanel`. That component is a search *tool* — it owns
 * a query box, a system scope and a time window, and lives on the admin queue
 * and the status board. Here there is nothing to configure: the query is the
 * one-line summary the rep has already typed, and the window is all time,
 * because a defect reported two years ago and since deployed is exactly the
 * answer this rep needs. Both go through the same `api.aiSearch`.
 *
 * Self-disabling: `/api/ai-search/status` reports `enabled: false` when no
 * provider key is configured, and the whole block renders nothing.
 */
export function DuplicateCheck({ query, requestType = '' }) {
  const [status, setStatus] = useState({ loading: true, enabled: false, summaryEnabled: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // The exact text that produced `result`, so editing the summary afterwards
  // offers a re-check instead of silently showing matches for the old wording.
  const [searchedQuery, setSearchedQuery] = useState('');
  const [open, setOpen] = useState(true);
  const reqIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    api.getAiSearchStatus()
      .then((res) => {
        if (!active) return;
        setStatus({
          loading: false,
          enabled: Boolean(res?.enabled),
          summaryEnabled: Boolean(res?.summaryEnabled),
        });
      })
      .catch(() => {
        if (active) setStatus({ loading: false, enabled: false, summaryEnabled: false });
      });
    return () => { active = false; };
  }, []);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;
  const isStale = Boolean(searchedQuery) && trimmed !== searchedQuery;

  async function runCheck() {
    if (tooShort || loading) return;
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;
    setLoading(true);
    setError('');
    setOpen(true);
    setSearchedQuery(trimmed);

    try {
      const res = await api.aiSearch({
        query: trimmed,
        applicationName: '',
        reportedWithinDays: null,
        resolvedWithinDays: null,
        // What is being filed decides what can be a duplicate of it. A report
        // request is only ever a duplicate of another report request; a defect and
        // an enhancement stay eligible for each other, because which of the two a
        // sentence describes is a triage decision. The server does the narrowing.
        requestType,
      });
      if (reqIdRef.current !== reqId) return; // a newer check superseded this one
      if (res && res.enabled === false) {
        setStatus((prev) => ({ ...prev, enabled: false }));
        setResult(null);
      } else {
        setResult(res);
      }
    } catch (checkError) {
      if (reqIdRef.current !== reqId) return;
      setResult(null);
      setError(checkError?.message || 'The duplicate check could not run.');
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }

  if (status.loading || !status.enabled) return null;

  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const keywordMatches = Array.isArray(result?.keywordMatches) ? result.keywordMatches : [];
  const total = matches.length + keywordMatches.length;
  const summary = result?.summary;
  const showSummary = status.summaryEnabled && summary?.answer_summary;
  const hasHits = Boolean(result) && total > 0;
  const isClear = Boolean(result) && total === 0 && !isStale;

  let tone = '';
  if (error) tone = ' rs-dupe--error';
  else if (hasHits) tone = ' rs-dupe--hits';
  else if (isClear) tone = ' rs-dupe--clear';

  // What the search was allowed to look at, stated wherever it is narrower than
  // "the queue". A check that quietly searched one kind of ticket and found
  // nothing would read as "nothing like this anywhere", which is a different and
  // stronger claim than the one it can make.
  const isReportRequest = String(requestType || '').trim().toLowerCase() === 'report';
  const scopeNoun = isReportRequest ? 'report requests' : 'defects and enhancements';

  let title = 'Already reported?';
  let subtitle = tooShort
    ? `Write your one-line summary above and we will check it against existing ${scopeNoun}.`
    : `Check your line against existing ${scopeNoun} before you file.`;

  if (loading) {
    title = 'Checking the queue…';
    subtitle = `Comparing your summary against ${scopeNoun} already reported.`;
  } else if (error) {
    title = 'The duplicate check could not run';
    subtitle = `${error} You can still submit — this check is optional.`;
  } else if (isStale) {
    title = 'Your summary changed';
    subtitle = hasHits
      ? 'These matches are for what you wrote before. Re-check to search the new wording.'
      : 'The last check was for what you wrote before. Re-check to search the new wording.';
  } else if (hasHits) {
    title = total === 1
      ? `1 similar ${isReportRequest ? 'report request' : 'ticket'} found`
      : `${total} similar ${isReportRequest ? 'report requests' : 'tickets'} found`;
    subtitle = 'Review these before you file. A duplicate slows the original one down.';
  } else if (isClear) {
    title = `Nothing like this in the ${isReportRequest ? 'report queue' : 'queue'}`;
    subtitle = `Looks new — carry on and file it. Only existing ${scopeNoun} were searched.`;
  }

  const showButton = !loading && (!result || isStale || isClear);
  const buttonLabel = isStale ? 'Re-check' : result ? 'Check again' : 'Check for duplicates';

  return (
    <div className={`rs-dupe${tone}`}>
      <div className="rs-dupe-top">
        <span className="rs-dupe-glyph" aria-hidden="true">{isClear ? '✓' : error ? '!' : '✦'}</span>
        <span className="rs-dupe-txt">
          <b>{title}</b>
          <span>{subtitle}</span>
        </span>
        {showButton && (
          <button type="button" className="rs-dupe-act" onClick={runCheck} disabled={tooShort}>
            {buttonLabel}
          </button>
        )}
        {loading && (
          <button type="button" className="rs-dupe-act" disabled>Checking…</button>
        )}
        {hasHits && !loading && (
          <button
            type="button"
            className="rs-dupe-link"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? 'Hide' : `Show ${total} ticket${total === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {loading && (
        <div className="rs-dupe-list" aria-hidden="true">
          <SkeletonRow titleWidth="58%" metaWidth="34%" />
          <SkeletonRow titleWidth="71%" metaWidth="29%" />
          <SkeletonRow titleWidth="46%" metaWidth="38%" />
        </div>
      )}

      {hasHits && open && !loading && (
        <>
          {/* Labelled by what it is — a description of the nearest ticket —
              rather than as a summary, which reads as a ruling on whether the
              thing has already been reported. The requester decides that. */}
          {showSummary && (
            <div className="rs-dupe-sum">
              <b>The closest one</b>
              {summary.answer_summary}
            </div>
          )}

          {matches.length > 0 && (
            <div className="rs-dupe-list">
              <div className="sb-panel">
                <div className="sb-rows">
                  {matches.map((item) => <StatusBoardRow key={item.id} item={item} />)}
                </div>
              </div>
            </div>
          )}

          {keywordMatches.length > 0 && (
            // The rule only divides this from something above it. With no AI
            // summary and no ranked matches — which is what comes back before
            // a new ticket has been embedded — it would be a stray line.
            <div className={showSummary || matches.length > 0 ? 'rs-dupe-group' : undefined}>
              <p className="rs-dupe-grouplabel">
                Keyword matches
                <span className="rs-hint">
                  Tickets whose number, policy, account, reporter or text literally contains
                  what you typed — not ranked by the AI.
                </span>
              </p>
              <div className="rs-dupe-list">
                <div className="sb-panel">
                  <div className="sb-rows">
                    {keywordMatches.map((item) => <StatusBoardRow key={item.id} item={item} />)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="rs-hint">
            None of these match what you saw? Carry on below — a second report with fresh
            detail is more use to the team than none.
          </p>
        </>
      )}
    </div>
  );
}
