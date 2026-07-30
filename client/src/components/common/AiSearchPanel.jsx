import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { Card, Input, Select, Button, Badge, Notice } from '../bite-size/BitsizeUI';

// Time-frame options: one control encodes both the dimension (reported vs
// resolved) and the window in days, so the user can ask "reported in the last
// 90 days?" or "resolved in the last 30 days?".
const WHEN_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: 'reported:30', label: 'Reported: last 30 days' },
  { value: 'reported:90', label: 'Reported: last 90 days' },
  { value: 'reported:365', label: 'Reported: last 12 months' },
  { value: 'reported:730', label: 'Reported: last 24 months' },
  { value: 'resolved:30', label: 'Resolved/closed: last 30 days' },
  { value: 'resolved:90', label: 'Resolved/closed: last 90 days' },
  { value: 'resolved:365', label: 'Resolved/closed: last 12 months' },
  { value: 'resolved:730', label: 'Resolved/closed: last 24 months' },
];

// The "Any time" option — no reported/resolved window filter is sent.
const ALL_TIME_WHEN = '';

function parseWhen(value) {
  const [dimension, days] = String(value || '').split(':');
  const n = Number(days);
  if (!dimension || !Number.isFinite(n) || n <= 0) return { reportedWithinDays: null, resolvedWithinDays: null };
  return dimension === 'resolved'
    ? { reportedWithinDays: null, resolvedWithinDays: n }
    : { reportedWithinDays: n, resolvedWithinDays: null };
}

const controlsRow = {
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'flex-end',
};

// Low-key inline "widen the search" affordance styled as a link.
const linkButton = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  color: 'var(--blue-600)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

/**
 * Reusable AI semantic search panel.
 * Props:
 *   scope: 'admin' | 'public'
 *   applications: string[]            (optional application scope options)
 *   defaultApplication: string        ('all' or an application name)
 *   title, subtitle, placeholder
 *   renderResults: (matches) => JSX   (surface-specific result list)
 */
export function AiSearchPanel({
  scope = 'admin',
  applications = [],
  defaultApplication = 'all',
  title = 'AI Ticket Search',
  subtitle = 'Describe an issue in plain language to see if it has been reported before, and what happened to it.',
  placeholder = 'e.g. customer was double-charged on a renewal invoice',
  renderResults,
  // Opt-in per surface: the admin queue starts collapsed so the ticket table
  // stays above the fold, while the public/rep surfaces (where searching IS the
  // task) keep the panel open as before.
  collapsible = false,
  entryHint = '',
}) {
  const isPublic = scope === 'public';
  const statusFn = isPublic ? api.getAiSearchStatus : api.getAdminAiSearchStatus;
  const searchFn = isPublic ? api.aiSearch : api.adminAiSearch;

  const [status, setStatus] = useState({ loading: true, enabled: false, summaryEnabled: false });
  const [query, setQuery] = useState('');
  const [appName, setAppName] = useState(defaultApplication || 'all');
  const [when, setWhen] = useState('reported:730');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  // Collapses the summary + results area so the page below (e.g. the submission
  // form) stays reachable; a new search always re-expands.
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  // Whole-panel collapse (distinct from `resultsCollapsed`, which only folds the
  // summary + results). Starts closed only where the caller opted in.
  const [panelOpen, setPanelOpen] = useState(!collapsible);
  const reqIdRef = useRef(0);

  useEffect(() => { setAppName(defaultApplication || 'all'); }, [defaultApplication]);

  useEffect(() => {
    let active = true;
    statusFn()
      .then((res) => {
        if (!active) return;
        setStatus({ loading: false, enabled: Boolean(res?.enabled), summaryEnabled: Boolean(res?.summaryEnabled) });
      })
      .catch(() => { if (active) setStatus({ loading: false, enabled: false, summaryEnabled: false }); });
    return () => { active = false; };
  }, [statusFn]);

  const appOptions = useMemo(() => {
    const opts = [{ value: 'all', label: 'All systems' }];
    for (const name of applications) opts.push({ value: name, label: name });
    return opts;
  }, [applications]);

  // `whenValue` is passed explicitly (not read from state) so callers like the
  // "Search all time" widen action can set state AND search in one tick without
  // racing React's async state update.
  async function runSearch(whenValue) {
    const q = query.trim();
    if (!q || loading) return;
    const { reportedWithinDays, resolvedWithinDays } = parseWhen(whenValue);
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;
    setLoading(true);
    setError('');
    setHasSearched(true);
    setResultsCollapsed(false); // a new search always re-expands the results

    try {
      const res = await searchFn({
        query: q,
        applicationName: appName === 'all' ? '' : appName,
        reportedWithinDays,
        resolvedWithinDays,
      });
      if (reqIdRef.current !== reqId) return; // a newer search superseded this one
      if (res && res.enabled === false) {
        setStatus((s) => ({ ...s, enabled: false }));
        setResult(null);
      } else {
        setResult(res);
      }
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      setError(err?.message || 'Search failed. Please try again.');
      setResult(null);
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  }

  function onSubmit(event) {
    event?.preventDefault?.();
    runSearch(when);
  }

  // Re-run the same query without a time-frame filter (the "Any time" option).
  function searchAllTime() {
    setWhen(ALL_TIME_WHEN); // keep the select in sync with the widened search
    runSearch(ALL_TIME_WHEN);
  }

  // Hide entirely when the feature isn't configured (graceful degradation).
  if (status.loading || !status.enabled) return null;

  // Collapsed entry point: one line that opens the real panel. Only reachable
  // when the caller opted into `collapsible`.
  if (!panelOpen) {
    return (
      <button
        type="button"
        className="ai-entry-strip"
        aria-expanded={false}
        onClick={() => setPanelOpen(true)}
      >
        <span aria-hidden="true">✦</span>
        <span className="ai-entry-text">
          <b>{title}</b>{entryHint ? <span> — {entryHint}</span> : null}
        </span>
        <span className="ai-entry-go">Open ▾</span>
      </button>
    );
  }

  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const summary = result?.summary;
  const showSummary = status.summaryEnabled && summary && summary.answer_summary;
  // Candidates dropped solely by the time-window filter (absent → 0).
  const windowExcludedRaw = Number(result?.windowExcluded);
  const windowExcluded = Number.isFinite(windowExcludedRaw) && windowExcludedRaw > 0 ? windowExcludedRaw : 0;

  return (
    <Card
      title={title}
      subtitle={subtitle}
      className="ai-search-panel"
      actions={collapsible
        ? (
          <Button type="button" kind="ghost" onClick={() => setPanelOpen(false)}>
            Hide AI search
          </Button>
        )
        : null}
    >
      <form onSubmit={onSubmit}>
        <div style={controlsRow}>
          <div style={{ flex: '3 1 260px' }}>
            <Input
              label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              maxLength={500}
            />
          </div>
          {applications.length > 0 && (
            <div style={{ flex: '1 1 160px' }}>
              <Select label="System" value={appName} onChange={(e) => setAppName(e.target.value)}>
                {appOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          )}
          <div style={{ flex: '1 1 180px' }}>
            <Select label="Time frame" value={when} onChange={(e) => setWhen(e.target.value)}>
              {WHEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <Button type="submit" disabled={loading || !query.trim()}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </div>
      </form>

      {error && <Notice text={error} kind="error" />}
      {!status.summaryEnabled && (
        <Notice
          text="AI summary is unavailable (no Claude key configured) — showing similarity matches only."
          kind="info"
        />
      )}

      {loading && <p className="muted" style={{ marginTop: 12 }}>Searching tickets…</p>}

      {!loading && !error && hasSearched && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => setResultsCollapsed((v) => !v)}
            aria-expanded={!resultsCollapsed}
            style={linkButton}
          >
            {resultsCollapsed
              ? `Show results${matches.length > 0 ? ` (${matches.length})` : ''}`
              : 'Hide results'}
          </button>
        </div>
      )}

      {!loading && !resultsCollapsed && showSummary && (
        <div
          className="ai-summary"
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 8,
            // Same token pattern as .lock-banner (index.css) so the block follows the theme.
            background: 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))',
            border: '1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <strong>AI summary</strong>
            {summary.reported_in_window && <Badge tone="success">Reported in window</Badge>}
            {summary.resolved_in_window && <Badge tone="info">Resolved in window</Badge>}
          </div>
          <p style={{ margin: 0 }}>{summary.answer_summary}</p>
          {matches.length > 0 && (
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
              {matches.length === 1
                ? 'The ticket it refers to is shown below.'
                : `This and the other matching tickets (${matches.length}) are shown below for review.`}
            </p>
          )}
        </div>
      )}

      {!loading && !error && !resultsCollapsed && hasSearched && (
        <div style={{ marginTop: 14 }}>
          {matches.length === 0
            ? (windowExcluded > 0
              ? (
                <>
                  <Notice
                    kind="info"
                    text={`No strong matches in the selected time frame — ${windowExcluded} older ticket${windowExcluded === 1 ? ' was' : 's were'} outside it.`}
                  />
                  <div style={{ marginTop: 8 }}>
                    <Button type="button" kind="secondary" onClick={searchAllTime}>Search all time</Button>
                  </div>
                </>
              )
              : <p className="muted">No similar tickets found. This looks like it may not have been reported yet.</p>)
            : (
              <>
                <p className="muted" style={{ marginBottom: 8, fontSize: 13 }}>
                  {matches.length} matching ticket{matches.length === 1 ? '' : 's'} (ranked by relevance)
                </p>
                {renderResults ? renderResults(matches) : null}
                {windowExcluded > 0 && (
                  <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                    {windowExcluded} older ticket{windowExcluded === 1 ? ' was' : 's were'} outside the selected time frame.{' '}
                    <button type="button" onClick={searchAllTime} style={linkButton}>Search all time</button>
                  </p>
                )}
              </>
            )}
        </div>
      )}
    </Card>
  );
}
