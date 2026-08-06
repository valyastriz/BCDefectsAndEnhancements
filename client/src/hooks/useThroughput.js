import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useViewer } from './useViewer';

/**
 * The three timeframes, and the window each one means.
 *
 * Held here rather than as dates in component state so the page cannot ask the
 * server for a window it did not offer, and so "this month" still means this
 * month when the page is left open across midnight — every load recomputes.
 */
export const THROUGHPUT_RANGES = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'Last 3 months' },
  { key: 'year', label: 'This year' },
];

/** YYYY-MM-DD in the reader's own timezone — the endpoint takes days, not instants. */
function day(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** The window a range key covers, ending today. */
export function windowFor(rangeKey, now = new Date()) {
  const to = day(now);
  if (rangeKey === 'year') return { from: `${now.getFullYear()}-01-01`, to };
  // Last 3 months means this month and the two before it, whole — not 90 days,
  // because the chart underneath is grouped by month and a part-month bar reads
  // as a quiet month rather than a clipped one.
  const monthsBack = rangeKey === 'quarter' ? 2 : 0;
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return { from: day(start), to };
}

const EMPTY = {
  delivered: 0,
  total_hours: 0,
  analysts: [],
  by_month: [],
  hours_by_month: [],
  median_days: null,
  scope: 'self',
  built_at: '',
};

/**
 * Everything the throughput page reads, and the only place it asks for it.
 *
 * The two things worth knowing about this hook:
 *
 * 1. **The server decides which view.** `scope` comes back on the response
 *    ('team' or 'self') and the page renders the composition it names. The
 *    browser never filters people out of a team answer — a non-manager's
 *    response does not contain a colleague at all.
 * 2. **"All applications" is offered only to someone who manages every
 *    application they can read.** That is the same rule the endpoint applies
 *    when it decides between the two views, so the picker can never ask a
 *    question the answer will contradict.
 *
 * Deliberately not live-updating, unlike every other surface in the portal: a
 * dashboard that reshuffles while it is being read is worse than one that is a
 * minute old. It states when it was built and offers a refresh.
 */
export function useThroughput() {
  const { viewer, loading: viewerLoading } = useViewer();
  const [range, setRange] = useState('quarter');
  // '' is "all applications"; anything else is an application id as a string.
  const [applicationId, setApplicationId] = useState(null);
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Only the newest request may write to state. Changing timeframe twice quickly
  // otherwise leaves whichever response happens to land last on screen.
  const requestRef = useRef(0);

  const readableIds = useMemo(
    () => (viewer.readableApplicationIds || []).map(Number),
    [viewer.readableApplicationIds],
  );
  const managerIds = useMemo(
    () => (viewer.managerApplicationIds || []).map(Number),
    [viewer.managerApplicationIds],
  );

  /** May this person be offered "All applications"? See the note above. */
  const canScopeToAll = readableIds.length > 0 && readableIds.every((id) => managerIds.includes(id));

  /** The applications this person may pick between, in the portal's own order. */
  const applications = useMemo(
    () => (viewer.applications || []).filter((application) => readableIds.includes(Number(application.id))),
    [viewer.applications, readableIds],
  );

  // The first selection, once the viewer envelope has arrived. Their home
  // application when they can read it — the same default the board and the
  // submit form use — so the page opens on the queue they work in.
  useEffect(() => {
    if (viewerLoading || applicationId !== null) return;
    const home = Number(viewer.homeApplicationId) || null;
    if (home && readableIds.includes(home)) {
      setApplicationId(String(home));
    } else if (canScopeToAll) {
      setApplicationId('');
    } else {
      setApplicationId(applications.length > 0 ? String(applications[0].id) : '');
    }
  }, [viewerLoading, applicationId, viewer.homeApplicationId, readableIds, canScopeToAll, applications]);

  const load = useCallback(async () => {
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setLoading(true);
    setError('');
    try {
      const { from, to } = windowFor(range);
      const payload = await api.getThroughput({ from, to, applicationId: applicationId || '' });
      if (requestRef.current !== ticket) return;
      // The three series are normalised here, once, so every consumer can index
      // them without a fallback of its own.
      setData({
        ...EMPTY,
        ...payload,
        analysts: Array.isArray(payload?.analysts) ? payload.analysts : [],
        by_month: Array.isArray(payload?.by_month) ? payload.by_month : [],
        hours_by_month: Array.isArray(payload?.hours_by_month) ? payload.hours_by_month : [],
      });
    } catch (loadError) {
      if (requestRef.current !== ticket) return;
      setError(loadError?.message || 'Could not load the throughput numbers.');
    } finally {
      if (requestRef.current === ticket) setLoading(false);
    }
  }, [range, applicationId]);

  useEffect(() => {
    // Waits for the first selection so the page makes one request, not one for
    // "all" followed by one for the application it settles on.
    if (viewerLoading || applicationId === null) return;
    Promise.resolve().then(load);
  }, [viewerLoading, applicationId, load]);

  return {
    range,
    setRange,
    applicationId: applicationId ?? '',
    setApplicationId,
    applications,
    canScopeToAll,
    data,
    // The page's own name is in the response, so a heading can never disagree
    // with the numbers under it.
    isTeamView: data.scope === 'team',
    loading: loading || viewerLoading,
    error,
    reload: load,
  };
}
