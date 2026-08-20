import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

// Ticket ids this browser remembers filing, written by the submit form. This is
// the INTERIM answer to "which of these are mine" and it exists only because
// nobody signs in yet: the server has no identity to match a report against, so
// the browser is the only thing that knows. It is superseded the moment the
// server reports an authenticated viewer — see `ownership` below — and this whole
// branch is the one throwaway in the identity design.
const LOCAL_FILED_KEY = 'bc.my.filedTicketIds';

function readLocalFiledIds() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_FILED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((value) => Number(value)).filter(Number.isFinite))]
      : [];
  } catch {
    return [];
  }
}

/**
 * Remember that this browser filed a ticket. Called by the submit form on a
 * successful submission. Harmless once SSO lands — the server answer wins.
 */
export function rememberFiledTicket(id) {
  if (typeof window === 'undefined') return;
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return;
  try {
    const next = [...new Set([...readLocalFiledIds(), numeric])];
    window.localStorage.setItem(LOCAL_FILED_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked localStorage must never break submitting a ticket.
  }
}

const ANONYMOUS = {
  isAuthenticated: false,
  source: 'local',
  // Whether filing a ticket needs a signed-in person. Defaults to false so a
  // failed /api/viewer never locks the submit form: the server refuses an
  // unsigned submission on its own, and guessing "locked" here would take the
  // form offline over a transient fetch error.
  submitRequiresAuth: false,
  // Report requests always need a signed-in requester, because only that person
  // can ever see the result. Defaults TRUE — the opposite of submitRequiresAuth
  // above, and for the opposite reason: guessing "open" here would show a form
  // whose last click is guaranteed to 401.
  reportRequiresAuth: true,
  impersonating: false,
  user: null,
  isSuperUser: false,
  // What this caller may do per application:
  // { [applicationId]: 'viewer' | 'admin' | 'manager' }. The id lists below are
  // derived from it server-side; they are here so a consumer can ask the common
  // questions without walking the map — and so a failed /api/viewer answers every
  // one of them with "nothing" rather than with undefined.
  applicationRoles: {},
  adminApplicationIds: [],
  readableApplicationIds: [],
  // The manager rank, which gates exactly one thing: seeing other people's
  // throughput numbers.
  managerApplicationIds: [],
  canManageAnyApplication: false,
  // Which applications this person WORKS IN, per their Active Directory groups.
  // Not a grant — it prefills the submit form and scopes their own board.
  memberApplicationIds: [],
  canAdminAnyApplication: false,
  homeApplicationId: null,
  applications: [],
};

/**
 * The one place the app asks who the viewer is.
 *
 * No page reads the session, a cookie, or localStorage to decide what a person
 * may see — they all read this. When SSO is wired, `GET /api/viewer` starts
 * returning a real identity and every consumer follows with no change.
 *
 * Returns:
 *   loading            — first fetch in flight
 *   error              — the fetch failed; the envelope falls back to anonymous
 *   viewer             — the server envelope (never null; anonymous shape when
 *                        unauthenticated)
 *   ownership          — how "mine" can be answered right now:
 *                        'server'  the server marks rows with is_mine
 *                        'browser' only this browser's remembered ids
 *                        'none'    no identity and nothing remembered
 *   localFiledIds      — the remembered ids, for the 'browser' case
 *   isMine(item)       — the single ownership test, so no caller reinvents it
 *   reload()           — re-fetch, e.g. after impersonating
 */
export function useViewer() {
  const [viewer, setViewer] = useState(ANONYMOUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Read once per mount: the submit form writes it, and a board that is already
  // open does not need to react mid-session.
  const [localFiledIds] = useState(readLocalFiledIds);

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.getViewer();
      setViewer(data?.viewer ? { ...ANONYMOUS, ...data.viewer } : ANONYMOUS);
    } catch (loadError) {
      // Fail to anonymous rather than to a broken page: the board is still
      // readable without an identity, it just cannot personalise.
      setViewer(ANONYMOUS);
      setError(loadError?.message || 'Could not determine who you are signed in as.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const ownership = useMemo(() => {
    if (viewer.isAuthenticated) return 'server';
    return localFiledIds.length > 0 ? 'browser' : 'none';
  }, [viewer.isAuthenticated, localFiledIds.length]);

  // "I filed this." One ownership test for every surface. Server-side `is_mine`
  // wins whenever it is present, so the browser list can never contradict a real
  // identity.
  const isMine = useCallback((item) => {
    if (!item) return false;
    if (viewer.isAuthenticated) return Boolean(item.is_mine);
    return localFiledIds.includes(Number(item.id));
  }, [viewer.isAuthenticated, localFiledIds]);

  // "I said this happened to me too." A different relationship from filing, and
  // deliberately its own test: a row must be able to say which one it is rather
  // than telling somebody they filed a ticket they did not.
  //
  // Server-answered only. An anonymous visitor cannot record a recurrence at all
  // (the endpoint refuses without a session), so there is no browser-remembered
  // equivalent to fall back to.
  const iReportedTooo = useCallback((item) => Boolean(item?.i_reported_this_too), []);

  // What the board's All/Mine control means: everything I have a stake in.
  //
  // Filing is not the only stake. Somebody who reports an existing ticket
  // happening to them has contributed to it and needs to be able to follow it —
  // without this, their report lands and the ticket vanishes from their view,
  // which is the surest way to make them file the duplicate next time.
  const isMineOrReported = useCallback(
    (item) => isMine(item) || iReportedTooo(item),
    [isMine, iReportedTooo],
  );

  const localFiledIdSet = useMemo(() => new Set(localFiledIds), [localFiledIds]);

  return {
    loading,
    error,
    viewer,
    ownership,
    localFiledIds,
    localFiledIdSet,
    isMine,
    iReportedTooo,
    isMineOrReported,
    reload: load,
  };
}
