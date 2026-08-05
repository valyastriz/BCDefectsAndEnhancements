import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Notice } from '../components/bite-size/BitsizeUI';
import { useAccessManagement, roleFor } from '../hooks/useAccessManagement';
import { TRACKER_LABEL } from '../constants/tracker';

// The catalog, in the order the dropdown offers it. Weakest first, matching
// server/src/constants.js — "no access" is an option here rather than the
// absence of one, so every cell answers the same question the same way.
const ROLE_OPTIONS = [
  { value: '', label: 'No access' },
  { value: 'viewer', label: 'View' },
  { value: 'admin', label: 'Admin' },
];

const ROLE_LABEL = { viewer: 'View', admin: 'Admin' };

function RoleSelect({ value, label, disabled, onChange }) {
  // The tint carries the state at a glance: a wall of untinted dropdowns all
  // reads alike, and finding who is missing access would mean reading each one.
  const tone = value || 'none';
  return (
    <select
      className={`access-role access-role--${tone}`}
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {ROLE_OPTIONS.map((option) => (
        <option key={option.value || 'none'} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

function SuperUserSwitch({ checked, disabled, title, label, onChange }) {
  return (
    <label className="access-switch" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="access-track" aria-hidden="true" />
    </label>
  );
}

/** What this person can see, as the page's one-glance summary of a row. */
function SeesCell({ user, applications, unassignedTicketCount }) {
  if (user.isSuperUser) {
    const total = applications.reduce((sum, app) => sum + app.ticketCount, 0) + unassignedTicketCount;
    return <span className="bs-badge badge-submitted">All {total}</span>;
  }

  const grants = user.grants || [];
  if (grants.length === 0) {
    return <span className="bs-badge badge-duplicate">Nothing</span>;
  }

  return (
    <span className="access-sees">
      {grants.map((grant) => {
        const app = applications.find((candidate) => candidate.id === grant.applicationId);
        if (!app) return null;
        return (
          <span
            key={grant.applicationId}
            className={`bs-badge ${grant.role === 'viewer' ? 'badge-redirected' : 'badge-approved'}`}
          >
            {app.name} · {ROLE_LABEL[grant.role] || grant.role}
          </span>
        );
      })}
    </span>
  );
}

function BulkBar({ count, applications, onApply, onClear }) {
  const [role, setRole] = useState('admin');
  // '' means every application — the common case when onboarding someone.
  const [applicationId, setApplicationId] = useState('');

  const targetIds = applicationId === ''
    ? applications.map((app) => app.id)
    : [Number(applicationId)];

  return (
    <div className="access-bulkbar">
      <span className="access-bulkbar-count">
        {count} account{count === 1 ? '' : 's'} selected
      </span>

      <label htmlFor="bulk-role">Grant</label>
      <select
        id="bulk-role"
        className="bs-inline-select"
        value={role}
        onChange={(event) => setRole(event.target.value)}
      >
        <option value="viewer">View</option>
        <option value="admin">Admin</option>
      </select>

      <label htmlFor="bulk-app">on</label>
      <select
        id="bulk-app"
        className="bs-inline-select"
        value={applicationId}
        onChange={(event) => setApplicationId(event.target.value)}
      >
        <option value="">All applications</option>
        {applications.map((app) => (
          <option key={app.id} value={app.id}>{app.name}</option>
        ))}
      </select>

      <Button
        kind="primary"
        onClick={() => onApply({ applicationIds: targetIds, role, action: 'grant' })}
      >
        Apply
      </Button>

      <span className="access-bulkbar-sep" />

      <Button
        kind="ghost"
        className="access-btn-danger"
        onClick={() => onApply({ applicationIds: targetIds, action: 'revoke' })}
      >
        Remove access
      </Button>
      <Button kind="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}

function DirectoryGroups({ applications, adGroups, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [working, setWorking] = useState(false);

  const canSubmit = String(groupName).trim() !== '' && applicationId !== '' && !working;

  async function submit() {
    setWorking(true);
    const added = await onAdd({ applicationId: Number(applicationId), groupName: groupName.trim() });
    setWorking(false);
    if (added) {
      setGroupName('');
      setApplicationId('');
      setOpen(false);
    }
  }

  const form = (
    <div className="access-adform">
      <input
        className="bs-inline-input"
        value={groupName}
        placeholder="GG-GW-BillingCenter-Users"
        aria-label="Directory group name"
        onChange={(event) => setGroupName(event.target.value)}
      />
      <select
        className="bs-inline-select"
        value={applicationId}
        aria-label="Application"
        onChange={(event) => setApplicationId(event.target.value)}
      >
        <option value="">Choose an application</option>
        {applications.map((app) => (
          <option key={app.id} value={app.id}>{app.name}</option>
        ))}
      </select>
      <Button kind="secondary" disabled={!canSubmit} onClick={submit}>
        {working ? 'Adding…' : 'Add'}
      </Button>
      <Button kind="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );

  return (
    <Card
      title="Directory groups"
      subtitle="A group decides which application someone's submit form and board default to. It grants no triage rights."
      actions={!open && <Button kind="ghost" onClick={() => setOpen(true)}>Map a group</Button>}
      className="access-card"
    >
      {open && form}

      {adGroups.length === 0 ? (
        <div className="access-state">
          <h3>No groups mapped yet</h3>
          <p>
            Nothing is mapped, and sign-in doesn&apos;t carry directory groups yet — so today
            everyone falls back to the first application. Mapping becomes live when SSO does.
          </p>
          {!open && <Button kind="primary" onClick={() => setOpen(true)}>Map a group</Button>}
        </div>
      ) : (
        <ul className="access-adlist">
          {adGroups.map((mapping) => {
            const app = applications.find((candidate) => candidate.id === mapping.applicationId);
            return (
              <li key={mapping.id} className="access-adrow">
                <code className="access-adgroup">{mapping.groupName}</code>
                <span className="access-adarrow" aria-hidden="true">→</span>
                <span>{app ? app.name : `Application ${mapping.applicationId}`}</span>
                <span className="access-bulkbar-sep" />
                <Button kind="ghost" onClick={() => onRemove(mapping.id)}>Remove</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function LoadingRows({ applicationCount }) {
  return (
    <tbody>
      {[0, 1, 2].map((row) => (
        <tr key={row}>
          <td className="access-col-pick"><span className="access-skel" style={{ width: 18, height: 18 }} /></td>
          <td><span className="access-skel" style={{ width: row === 1 ? 120 : 170 }} /></td>
          <td><span className="access-skel" style={{ width: 38, height: 22, borderRadius: 999 }} /></td>
          {Array.from({ length: applicationCount || 2 }, (_, index) => (
            <td key={index} className="access-col-app">
              <span className="access-skel" style={{ width: 132, height: 28 }} />
            </td>
          ))}
          <td><span className="access-skel" style={{ width: 110 }} /></td>
        </tr>
      ))}
    </tbody>
  );
}

export function AdminAccessPage({ user }) {
  const navigate = useNavigate();
  const access = useAccessManagement();
  const {
    applications,
    users,
    adGroups,
    unassignedTicketCount,
    loading,
    error,
    notice,
    savingIds,
    savedIds,
    selectedIds,
    selectableIds,
    blindUsers,
    superUserCount,
  } = access;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;

  const header = (
    <div className="bs-header">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h2>Access</h2>
        <p>
          Triage rights are granted here, one application at a time. An account with
          nothing granted sees an empty queue — never everyone&apos;s.
        </p>
      </div>
      <div className="bs-actions">
        <Button kind="ghost" onClick={() => navigate('/admin')}>Back to Admin Queue</Button>
      </div>
    </div>
  );

  if (error && users.length === 0 && !loading) {
    return (
      <div className="bs-page access-page">
        {header}
        <Card className="access-card">
          <div className="access-state access-state--error">
            <h3>Access list didn&apos;t load</h3>
            <p>{error} Nothing has been changed — every grant is as it was.</p>
            <Button kind="primary" onClick={() => access.reload()}>Try again</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="bs-page access-page">
      {header}

      {error && <Notice text={error} />}
      {notice && <Notice text={notice} kind="success" />}

      <div className="access-tiles">
        <div className="access-tile">
          <span className="access-tile-num">{loading ? '—' : applications.length}</span>
          <span className="access-tile-lbl">Applications</span>
        </div>
        <div className="access-tile">
          <span className="access-tile-num">{loading ? '—' : users.length}</span>
          <span className="access-tile-lbl">Accounts</span>
        </div>
        <div className={`access-tile${blindUsers.length > 0 ? ' access-tile--attention' : ''}`}>
          <span className="access-tile-num">{loading ? '—' : blindUsers.length}</span>
          <span className="access-tile-lbl">See no tickets at all</span>
        </div>
      </div>

      <Card className="access-card">
        {blindUsers.length > 0 && (
          <div className="access-strip">
            <span className="access-strip-mark" aria-hidden="true">!</span>
            <span>
              {blindUsers.map((person, index) => (
                <span key={person.id}>
                  {index > 0 && ', '}
                  <strong>{person.username}</strong>
                </span>
              ))}
              {' '}
              hold{blindUsers.length === 1 ? 's' : ''} nothing, so their queue is empty.
              Give them a role below to put tickets in front of them.
            </span>
          </div>
        )}

        {selectedIds.length > 0 && (
          <BulkBar
            count={selectedIds.length}
            applications={applications}
            onApply={access.applyBulk}
            onClear={access.clearSelection}
          />
        )}

        <div className="access-cardhead">
          <div>
            <h3>Who can triage what</h3>
            <p>Changes save as you make them and take effect on that person&apos;s next request.</p>
          </div>
        </div>

        <div className="table-wrap access-tablewrap">
          <table className="access-table">
            <thead>
              <tr>
                <th scope="col" className="access-col-pick">
                  <input
                    type="checkbox"
                    className="access-check"
                    checked={allSelected}
                    aria-label="Select all accounts"
                    disabled={loading || selectableIds.length === 0}
                    onChange={access.toggleSelectAll}
                  />
                </th>
                <th scope="col">Account</th>
                <th scope="col" className="access-col-super">Super user</th>
                {applications.map((app) => (
                  <th key={app.id} scope="col" className="access-col-app">
                    {app.name}
                    <span className="access-appcount">
                      {app.ticketCount} ticket{app.ticketCount === 1 ? '' : 's'}
                    </span>
                  </th>
                ))}
                <th scope="col" className="access-col-sees">Sees</th>
              </tr>
            </thead>

            {loading ? <LoadingRows applicationCount={applications.length} /> : (
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={applications.length + 4}>
                      <div className="access-state">
                        <h3>No accounts yet</h3>
                        <p>Accounts appear here the first time someone signs in.</p>
                      </div>
                    </td>
                  </tr>
                )}

                {users.map((person) => {
                  const busy = Boolean(savingIds[person.id]);
                  // The portal must never lose its last super user: without one,
                  // nobody can reach this page and every queue stays empty.
                  const isLastSuperUser = person.isSuperUser && superUserCount <= 1;

                  return (
                    <tr key={person.id} className={selectedSet.has(person.id) ? 'access-row--picked' : ''}>
                      <td className="access-col-pick" data-label="Select">
                        <input
                          type="checkbox"
                          className="access-check"
                          checked={selectedSet.has(person.id)}
                          aria-label={`Select ${person.username}`}
                          disabled={person.isSuperUser}
                          onChange={() => access.toggleSelected(person.id)}
                        />
                      </td>

                      <td>
                        <span className="access-person">
                          <span className="access-person-name">{person.username}</span>
                          <span className="access-person-meta">
                            {person.displayName !== person.username ? person.displayName : 'No display name set'}
                          </span>
                        </span>
                      </td>

                      <td className="access-col-super" data-label="Super user">
                        <SuperUserSwitch
                          checked={person.isSuperUser}
                          disabled={busy || isLastSuperUser}
                          title={isLastSuperUser
                            ? 'Cannot be removed — this is the last super user'
                            : undefined}
                          label={`Super user — ${person.username}`}
                          onChange={(next) => access.toggleSuperUser(person.id, next)}
                        />
                      </td>

                      {person.isSuperUser ? (
                        <td className="access-col-app" colSpan={applications.length}>
                          <span className="access-allnote">
                            Admin of every application, including tickets with none set
                          </span>
                        </td>
                      ) : applications.map((app) => (
                        <td key={app.id} className="access-col-app" data-label={app.name}>
                          <RoleSelect
                            value={roleFor(person, app.id)}
                            label={`${person.username} — ${app.name}`}
                            disabled={busy}
                            onChange={(role) => access.changeRole(person.id, app.id, role)}
                          />
                        </td>
                      ))}

                      <td className="access-col-sees" data-label="Sees">
                        <SeesCell
                          user={person}
                          applications={applications}
                          unassignedTicketCount={unassignedTicketCount}
                        />
                        {savedIds[person.id] && <span className="access-saved">Saved</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>

        <div className="access-cardfoot">
          <strong>View</strong> reads the queue and exports. <strong>Admin</strong> adds editing,
          status, attachments, redirect, {TRACKER_LABEL} hand-off and public visibility.
          {unassignedTicketCount > 0 && (
            <> {unassignedTicketCount} ticket{unassignedTicketCount === 1 ? ' has' : 's have'} no
              application set and {unassignedTicketCount === 1 ? 'is' : 'are'} visible to super users only.</>
          )}
        </div>
      </Card>

      <DirectoryGroups
        applications={applications}
        adGroups={adGroups}
        onAdd={access.addGroup}
        onRemove={access.removeGroup}
      />

      <p className="muted access-signedin">Signed in as <strong>{user?.username}</strong></p>
    </div>
  );
}
