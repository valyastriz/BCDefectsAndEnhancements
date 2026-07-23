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
  { value: 'resolved:30', label: 'Resolved/closed: last 30 days' },
  { value: 'resolved:90', label: 'Resolved/closed: last 90 days' },
  { value: 'resolved:365', label: 'Resolved/closed: last 12 months' },
];

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
}) {
  const isPublic = scope === 'public';
  const statusFn = isPublic ? api.getAiSearchStatus : api.getAdminAiSearchStatus;
  const searchFn = isPublic ? api.aiSearch : api.adminAiSearch;

  const [status, setStatus] = useState({ loading: true, enabled: false, summaryEnabled: false });
  const [query, setQuery] = useState('');
  const [appName, setAppName] = useState(defaultApplication || 'all');
  const [when, setWhen] = useState('reported:365');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
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

  async function onSubmit(event) {
    event?.preventDefault?.();
    const q = query.trim();
    if (!q || loading) return;
    const { reportedWithinDays, resolvedWithinDays } = parseWhen(when);
    const reqId = reqIdRef.current + 1;
    reqIdRef.current = reqId;
    setLoading(true);
    setError('');
    setHasSearched(true);
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

  // Hide entirely when the feature isn't configured (graceful degradation).
  if (status.loading || !status.enabled) return null;

  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const summary = result?.summary;
  const showSummary = status.summaryEnabled && summary && summary.answer_summary;

  return (
    <Card title={title} subtitle={subtitle} className="ai-search-panel">
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

      {!loading && showSummary && (
        <div className="ai-summary" style={{ marginTop: 14, padding: 14, borderRadius: 8, background: 'var(--bs-info-bg, #eef4ff)', border: '1px solid var(--bs-info-border, #cfe0ff)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <strong>AI summary</strong>
            {summary.reported_in_window && <Badge tone="success">Reported in window</Badge>}
            {summary.resolved_in_window && <Badge tone="info">Resolved in window</Badge>}
          </div>
          <p style={{ margin: 0 }}>{summary.answer_summary}</p>
        </div>
      )}

      {!loading && hasSearched && (
        <div style={{ marginTop: 14 }}>
          {matches.length === 0
            ? <p className="muted">No similar tickets found. This looks like it may not have been reported yet.</p>
            : (
              <>
                <p className="muted" style={{ marginBottom: 8, fontSize: 13 }}>
                  {matches.length} matching ticket{matches.length === 1 ? '' : 's'} (ranked by relevance)
                </p>
                {renderResults ? renderResults(matches) : null}
              </>
            )}
        </div>
      )}
    </Card>
  );
}
