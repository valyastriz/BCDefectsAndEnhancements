'use client';

/**
 * STARTER STUB — orchestrates the guided walkthroughs: which one is running, the
 * current step, per-USER completion state (tracked on the SERVER so it follows
 * the user across machines — never localStorage), the one-time welcome prompt for
 * new accounts, role + feature gating, and deep-linking (?tour=<key>).
 *
 * Copy into your frontend (e.g. contexts/WalkthroughContext.jsx). Replace the
 * placeholder hooks (useAuth/useFeatures/getUserAppRole/isNewUserAccount) and the
 * api/walkthroughs calls with your project's equivalents.
 *
 * REQUIRED SERVER SIDE (this context is not done without it):
 *   GET /api/walkthroughs/state  -> { [key]: 'completed'|'skipped', welcome_seen?: true }
 *   PUT /api/walkthroughs/state  -> replaces the caller's state map
 * Backed by one JSON(B) map per user (a user column or user_walkthrough_states
 * table) created via the project's migration manager. Both endpoints are
 * authenticated and follow the project's routes/controllers layering.
 *
 * If your project has NO feature-flag system, delete the useFeatures import and
 * gate by role/permission checks instead — do not invent a flag framework.
 */
import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import useAuth from 'hooks/useAuth';
import { useFeatures } from 'contexts/FeaturesContext';
import { getUserAppRole } from 'utils/auth/roles';
import { isNewUserAccount } from 'utils/onboarding/firstRun';
import { WALKTHROUGHS, WELCOME_SEEN_KEY, getWalkthrough } from 'config/walkthroughs';
import { fetchWalkthroughState, saveWalkthroughState } from 'api/walkthroughs';

const WalkthroughContext = createContext({
  walkthroughs: [],
  statusMap: {},
  loading: true,
  active: null,
  stepIndex: 0,
  welcomeOpen: false,
  start: () => {},
  exit: () => {},
  next: () => {},
  back: () => {},
  finish: () => {},
  skip: () => {},
  dismissWelcome: () => {},
  startWelcomeTour: () => {}
});

// Tours explain screens only certain roles can reach — a tour pointing at a
// screen the user can't access would break. Restrict to those roles.
const TOUR_ROLES = ['platform_admin', 'company_owner', 'company_admin'];
const isTourAudience = (user) => TOUR_ROLES.includes(getUserAppRole(user));

export function WalkthroughProvider({ children }) {
  const { user, isLoggedIn } = useAuth();
  const { isEnabled, loading: featuresLoading } = useFeatures();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const featureOn = isEnabled('walkthroughs');

  const [statusMap, setStatusMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const loadedFor = useRef(null);
  const handledDeepLink = useRef(false);

  // Only tours whose feature is enabled.
  const walkthroughs = useMemo(() => WALKTHROUGHS.filter((w) => !w.featureKey || isEnabled(w.featureKey)), [isEnabled]);

  // Saves must not fail silently: a lost save resurrects the welcome prompt on the
  // next login. Retry once, then surface the failure and keep the state dirty so
  // the focus-refresh below can reconcile.
  const dirty = useRef(false);
  const persist = useCallback((nextState) => {
    setStatusMap(nextState);
    dirty.current = true;
    saveWalkthroughState(nextState)
      .catch(() => saveWalkthroughState(nextState))
      .then(() => { dirty.current = false; })
      .catch((error) => console.warn('walkthrough state save failed', error));
  }, []);

  // Two open tabs desync (finish a tour in one, the other would re-prompt):
  // refresh completion state when the window regains focus.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const onFocus = () => {
      if (dirty.current) return; // don't clobber an unsaved local change
      fetchWalkthroughState().then(setStatusMap).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isLoggedIn]);

  // Load per-user state once per login.
  useEffect(() => {
    if (!isLoggedIn || !isTourAudience(user)) {
      setLoading(false);
      return;
    }
    if (loadedFor.current === user?.id) return;
    loadedFor.current = user?.id;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const state = await fetchWalkthroughState();
        if (cancelled) return;
        setStatusMap(state);
        // Welcome only brand-new accounts that haven't seen it.
        if (featureOn && !state[WELCOME_SEEN_KEY] && isNewUserAccount(user)) {
          setWelcomeOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isLoggedIn, user, featureOn]);

  // Reset on logout so the next login re-fetches.
  useEffect(() => {
    if (!isLoggedIn) {
      loadedFor.current = null;
      handledDeepLink.current = false;
      setActiveKey(null);
      setWelcomeOpen(false);
    }
  }, [isLoggedIn]);

  const start = useCallback((key) => {
    if (!getWalkthrough(key)) return;
    setWelcomeOpen(false);
    setStepIndex(0);
    setActiveKey(key);
  }, []);

  const exit = useCallback(() => {
    setActiveKey(null);
    setStepIndex(0);
  }, []);

  // Deep link: ?tour=<key> auto-starts a tour (used by the AI assistant and
  // shareable links). The param is stripped afterward so a refresh doesn't loop.
  useEffect(() => {
    if (handledDeepLink.current || loading || !featureOn || !isTourAudience(user)) return;
    const tour = searchParams?.get('tour');
    if (!tour) return;
    handledDeepLink.current = true;
    if (getWalkthrough(tour)) start(tour);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('tour');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [searchParams, loading, featureOn, user, start, router, pathname]);

  const active = useMemo(() => (activeKey ? getWalkthrough(activeKey) : null), [activeKey]);

  const next = useCallback(() => {
    setStepIndex((i) => (active ? Math.min(i + 1, active.steps.length - 1) : i));
  }, [active]);

  const back = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  const markStatus = useCallback(
    (key, status) => persist({ ...statusMap, [WELCOME_SEEN_KEY]: true, [key]: status }),
    [persist, statusMap]
  );

  const finish = useCallback(() => { if (activeKey) markStatus(activeKey, 'completed'); exit(); }, [activeKey, markStatus, exit]);
  const skip = useCallback(() => { if (activeKey) markStatus(activeKey, 'skipped'); exit(); }, [activeKey, markStatus, exit]);
  const dismissWelcome = useCallback(() => { setWelcomeOpen(false); persist({ ...statusMap, [WELCOME_SEEN_KEY]: true }); }, [persist, statusMap]);
  const startWelcomeTour = useCallback(() => { persist({ ...statusMap, [WELCOME_SEEN_KEY]: true }); start('getting_started'); }, [persist, statusMap, start]);

  const value = useMemo(
    () => ({
      walkthroughs,
      statusMap,
      loading: loading || featuresLoading,
      active,
      stepIndex,
      welcomeOpen: welcomeOpen && featureOn && isTourAudience(user),
      start, exit, next, back, finish, skip, dismissWelcome, startWelcomeTour
    }),
    [walkthroughs, statusMap, loading, featuresLoading, active, stepIndex, welcomeOpen, featureOn, user, start, exit, next, back, finish, skip, dismissWelcome, startWelcomeTour]
  );

  // Don't mount tour machinery for the wrong roles or when the feature is off.
  if (!featureOn || !isTourAudience(user)) {
    return <WalkthroughContext.Provider value={{ ...value, walkthroughs: [], welcomeOpen: false }}>{children}</WalkthroughContext.Provider>;
  }

  return <WalkthroughContext.Provider value={value}>{children}</WalkthroughContext.Provider>;
}

WalkthroughProvider.propTypes = { children: PropTypes.node };

export function useWalkthrough() {
  return useContext(WalkthroughContext);
}
