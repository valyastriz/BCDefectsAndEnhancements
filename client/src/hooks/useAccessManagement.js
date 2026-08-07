import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

const EMPTY = {
  applications: [],
  users: [],
  adGroups: [],
  roles: ['viewer', 'admin'],
  // Replaced by the server's list on load. A grant narrowed to one of these is
  // what an "analyst" is — there is no separate analyst role.
  requestTypes: [],
  unassignedTicketCount: 0,
};

// The scopes a cell can express, and the request types each one writes. A grant
// row is (application, role, requestType) where '' means every type, so a scope
// is just a set of those rows sharing one role.
//
// Deliberately three named shapes rather than a free multi-select: these are the
// three that exist in practice (an application admin, a report analyst, and
// somebody who is both), and they are the ones seedTeamAccounts.js creates.
export const GRANT_SCOPES = [
  { value: 'all', label: 'Every type', requestTypes: [''] },
  { value: 'work', label: 'Defects & enhancements', requestTypes: ['defect', 'enhancement'] },
  { value: 'report', label: 'Report requests only', requestTypes: ['report'] },
];

const SCOPE_BY_VALUE = new Map(GRANT_SCOPES.map((scope) => [scope.value, scope]));
const scopeKey = (requestTypes) => [...requestTypes].sort().join('|');
const SCOPE_BY_TYPES = new Map(GRANT_SCOPES.map((scope) => [scopeKey(scope.requestTypes), scope.value]));

// How long a row keeps its "Saved" marker. Long enough to notice on a row you
// were not looking at, short enough that the table isn't permanently decorated.
const SAVED_MS = 2600;

/** Every grant this person holds in one application, across all type scopes. */
function grantsFor(user, applicationId) {
  return (user?.grants || []).filter((grant) => Number(grant.applicationId) === Number(applicationId));
}

/** The role this person holds in one application, or '' for none. */
export function roleFor(user, applicationId) {
  const found = grantsFor(user, applicationId);
  if (found.length === 0) return '';
  // Strongest wins, matching how the server collapses a person's rights when it
  // asks "may they work in this application at all".
  return found.reduce((best, grant) => (ROLE_RANK[grant.role] > ROLE_RANK[best] ? grant.role : best), found[0].role);
}

const ROLE_RANK = { viewer: 0, admin: 1, manager: 2 };

/**
 * Which named scope this person's grants in one application add up to.
 *
 * Returns the scope value, or 'mixed' for a combination the three named shapes
 * cannot express (different roles per type, or a set of types that is none of
 * them). 'mixed' is reported rather than rounded off: a cell that silently
 * displayed the nearest shape would rewrite the real grant on the next save.
 */
export function scopeFor(user, applicationId) {
  const found = grantsFor(user, applicationId);
  if (found.length === 0) return '';
  const roles = new Set(found.map((grant) => grant.role));
  if (roles.size > 1) return 'mixed';
  return SCOPE_BY_TYPES.get(scopeKey(found.map((grant) => grant.requestType || ''))) || 'mixed';
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

  /**
   * Set (or clear, with role '') one person's grant in one application.
   *
   * Sends the person's WHOLE grant set, as the endpoint expects — so the other
   * applications must be carried through untouched, type scopes and all. An
   * earlier version of this pair dropped `requestType` on the way out, and the
   * server defaulted it to "every type": editing anyone's row quietly promoted
   * every report-only analyst grant they held into a full one.
   */
  const changeGrant = useCallback(async (userId, applicationId, role, scopeValue) => {
    const user = data.users.find((candidate) => candidate.id === userId);
    if (!user) return;

    const others = (user.grants || []).filter((grant) => Number(grant.applicationId) !== Number(applicationId));
    const scope = SCOPE_BY_VALUE.get(scopeValue) || SCOPE_BY_VALUE.get('all');
    const next = role
      ? [...others, ...scope.requestTypes.map((requestType) => ({
        applicationId: Number(applicationId),
        role,
        requestType,
      }))]
      : others;

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
  const applyBulk = useCallback(async ({ applicationIds, role, action, scope }) => {
    if (selectedIds.length === 0) return;
    setError('');
    setNotice('');
    try {
      // One request type per bulk action, so "every type" and "reports only" stay
      // distinguishable in the confirmation as well as in the write. The two-row
      // 'work' scope is sent as two actions for the same reason a cell writes two
      // rows: defect and enhancement are separate grants.
      const requestTypes = (SCOPE_BY_VALUE.get(scope) || SCOPE_BY_VALUE.get('all')).requestTypes;
      let result = null;
      for (const requestType of requestTypes) {
        result = await api.bulkSetAccess({
          userIds: selectedIds,
          applicationIds,
          role,
          action,
          requestType,
        });
      }
      await load({ quiet: true });
      const people = `${result.userIds.length} account${result.userIds.length === 1 ? '' : 's'}`;
      const apps = `${result.applicationIds.length} application${result.applicationIds.length === 1 ? '' : 's'}`;
      const scopeLabel = (SCOPE_BY_VALUE.get(scope) || SCOPE_BY_VALUE.get('all')).label.toLowerCase();
      setNotice(action === 'grant'
        ? `Granted ${result.role} on ${apps} to ${people}, for ${scopeLabel}.`
        : `Removed access to ${apps} from ${people}, for ${scopeLabel}.`);
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
    changeGrant,
    toggleSuperUser,
    applyBulk,
    addGroup,
    removeGroup,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
  };
}
