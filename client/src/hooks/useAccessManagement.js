import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

const EMPTY = {
  applications: [],
  users: [],
  adGroups: [],
  roles: ['viewer', 'admin'],
  unassignedTicketCount: 0,
};

// How long a row keeps its "Saved" marker. Long enough to notice on a row you
// were not looking at, short enough that the table isn't permanently decorated.
const SAVED_MS = 2600;

/** The role this person holds in one application, or '' for none. */
export function roleFor(user, applicationId) {
  const found = (user?.grants || []).find((grant) => Number(grant.applicationId) === Number(applicationId));
  return found ? found.role : '';
}

/**
 * Everything the Access page needs, and the only place it talks to the server.
 *
 * The server owns the truth: each mutation applies the response rather than
 * guessing, so a refused change (the last super user, an application that went
 * inactive between load and click) leaves the table showing what is actually
 * stored instead of what was clicked.
 */
export function useAccessManagement() {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // userId → true while a change for that row is in flight, and userId → true
  // briefly after it lands. Separate so a fast save still shows confirmation.
  const [savingIds, setSavingIds] = useState({});
  const [savedIds, setSavedIds] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      setError('');
      const payload = await api.getAccess();
      setData({ ...EMPTY, ...payload });
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the access list.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const markSaved = useCallback((userId) => {
    setSavedIds((prev) => ({ ...prev, [userId]: true }));
    window.setTimeout(() => {
      setSavedIds((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }, SAVED_MS);
  }, []);

  // Wraps every per-row mutation: one busy flag, one error surface, one place
  // that clears the previous notice so two actions never stack messages.
  const runForUser = useCallback(async (userId, action) => {
    setSavingIds((prev) => ({ ...prev, [userId]: true }));
    setError('');
    setNotice('');
    try {
      await action();
      markSaved(userId);
      return true;
    } catch (actionError) {
      setError(actionError?.message || 'That change could not be saved.');
      return false;
    } finally {
      setSavingIds((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }, [markSaved]);

  /** Set (or clear, with role '') one person's role in one application. */
  const changeRole = useCallback(async (userId, applicationId, role) => {
    const user = data.users.find((candidate) => candidate.id === userId);
    if (!user) return;

    const others = (user.grants || []).filter((grant) => Number(grant.applicationId) !== Number(applicationId));
    const next = role ? [...others, { applicationId: Number(applicationId), role }] : others;

    await runForUser(userId, async () => {
      const saved = await api.setUserGrants(userId, next);
      setData((prev) => ({
        ...prev,
        users: prev.users.map((candidate) => (
          candidate.id === userId ? { ...candidate, grants: saved.grants || [] } : candidate
        )),
      }));
    });
  }, [data.users, runForUser]);

  const toggleSuperUser = useCallback(async (userId, isSuperUser) => {
    await runForUser(userId, async () => {
      const saved = await api.setUserSuperUser(userId, isSuperUser);
      setData((prev) => ({
        ...prev,
        users: prev.users.map((candidate) => (
          candidate.id === userId ? { ...candidate, isSuperUser: Boolean(saved.isSuperUser) } : candidate
        )),
      }));
    });
  }, [runForUser]);

  /**
   * One change across every selected person and application.
   *
   * Re-reads afterwards rather than patching locally: a bulk change touches many
   * rows at once, and re-reading is both simpler and the only way to be sure the
   * table matches what was actually written.
   */
  const applyBulk = useCallback(async ({ applicationIds, role, action }) => {
    if (selectedIds.length === 0) return;
    setError('');
    setNotice('');
    try {
      const result = await api.bulkSetAccess({
        userIds: selectedIds,
        applicationIds,
        role,
        action,
      });
      await load({ quiet: true });
      const people = `${result.userIds.length} account${result.userIds.length === 1 ? '' : 's'}`;
      const apps = `${result.applicationIds.length} application${result.applicationIds.length === 1 ? '' : 's'}`;
      setNotice(action === 'grant'
        ? `Granted ${result.role} on ${apps} to ${people}.`
        : `Removed access to ${apps} from ${people}.`);
      setSelectedIds([]);
    } catch (bulkError) {
      setError(bulkError?.message || 'That change could not be applied.');
    }
  }, [load, selectedIds]);

  const addGroup = useCallback(async ({ applicationId, groupName }) => {
    setError('');
    setNotice('');
    try {
      await api.addAdGroupMapping({ applicationId, groupName });
      await load({ quiet: true });
      setNotice(`${groupName} now defaults to that application.`);
      return true;
    } catch (addError) {
      setError(addError?.message || 'That group could not be mapped.');
      return false;
    }
  }, [load]);

  const removeGroup = useCallback(async (id) => {
    setError('');
    setNotice('');
    try {
      await api.removeAdGroupMapping(id);
      await load({ quiet: true });
      return true;
    } catch (removeError) {
      setError(removeError?.message || 'That mapping could not be removed.');
      return false;
    }
  }, [load]);

  const toggleSelected = useCallback((userId) => {
    setSelectedIds((prev) => (
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    ));
  }, []);

  // Selecting "all" means every account the bulk bar can actually act on. A
  // super user's access does not come from grants, so including them would let
  // the bar report changes it did not make.
  const selectableIds = useMemo(
    () => data.users.filter((user) => !user.isSuperUser).map((user) => user.id),
    [data.users],
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.length === selectableIds.length ? [] : selectableIds));
  }, [selectableIds]);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  // Someone who is not a super user and holds nothing sees an empty queue. This
  // is the page's headline number, so it is derived in one place.
  const blindUsers = useMemo(
    () => data.users.filter((user) => !user.isSuperUser && (user.grants || []).length === 0),
    [data.users],
  );

  const superUserCount = useMemo(
    () => data.users.filter((user) => user.isSuperUser).length,
    [data.users],
  );

  return {
    ...data,
    loading,
    error,
    notice,
    setNotice,
    savingIds,
    savedIds,
    selectedIds,
    selectableIds,
    blindUsers,
    superUserCount,
    reload: load,
    changeRole,
    toggleSuperUser,
    applyBulk,
    addGroup,
    removeGroup,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
  };
}
