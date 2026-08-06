import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Notice } from '../components/bite-size/BitsizeUI';
import { useAccessManagement, roleFor, scopeFor, GRANT_SCOPES } from '../hooks/useAccessManagement';
import { TRACKER_LABEL } from '../constants/tracker';

// The catalog, in the order the dropdown offers it. Weakest first, matching
// server/src/constants.js — "no access" is an option here rather than the
// absence of one, so every cell answers the same question the same way.
//
// `manager` is a rank above admin, per application, and it gates exactly one
// thing: seeing OTHER people's throughput numbers. The server has always
// accepted it; this page used to omit it, so the only way to hand it out was a
// direct database write.
const ROLE_OPTIONS = [
  { value: '', label: 'No access' },
  { value: 'viewer', label: 'View' },
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
];

const ROLE_LABEL = { viewer: 'View', admin: 'Admin', manager: 'Manager' };

const SCOPE_LABEL = new Map(GRANT_SCOPES.map((scope) => [scope.value, scope.label]));
/** Short enough for a badge beside the application name. */
const SCOPE_BADGE = { work: 'defects & enhancements', report: 'reports only', mixed: 'mixed' };

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

/**
 * Which request types a grant covers. Only shown once a role is chosen — there is
 * nothing to scope about no access.
 *
 * An analyst IS this control: an admin grant narrowed to report requests. There
 * is no fourth role, and before this existed the only way to make one was the
 * seed script.
 */
function ScopeSelect({ value, label, disabled, onChange }) {
  const isMixed = value === 'mixed';
  return (
    <select
      className={`access-scope${isMixed ? ' access-scope--mixed' : ''}`}
      value={isMixed ? 'mixed' : value}
      aria-label={label}
      disabled={disabled}
      title={isMixed
        ? 'This person holds different roles for different request types. Choosing a scope here replaces all of them.'
        : undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {/* Present only while it is the truth, and never selectable as a target:
          "mixed" describes what is stored, it is not a thing you can save. */}
      {isMixed && <option value="mixed" disabled>Mixed — pick one to replace</option>}
      {GRANT_SCOPES.map((scope) => (
        <option key={scope.value} value={scope.value}>{scope.label}</option>
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

  // One badge per application, not per grant row: an application admin holds two
  // rows (defect and enhancement) and rendering them as two badges reads as two
  // separate rights. The scope is stated on the badge instead, and only when it
  // is narrower than everything — an unqualified badge means every type.
  const byApplication = new Map();
  for (const grant of grants) {
    if (!byApplication.has(grant.applicationId)) byApplication.set(grant.applicationId, []);
    byApplication.get(grant.applicationId).push(grant);
  }

  return (
    <span className="access-sees">
      {[...byApplication.keys()].map((applicationId) => {
        const app = applications.find((candidate) => candidate.id === applicationId);
        if (!app) return null;
        const role = roleFor(user, applicationId);
        const scope = scopeFor(user, applicationId);
        const badge = SCOPE_BADGE[scope];
        return (
          <span
            key={applicationId}
            className={`bs-badge ${role === 'viewer' ? 'badge-redirected' : 'badge-approved'}`}
          >
            {app.name} · {ROLE_LABEL[role] || role}
            {badge ? <span className="access-sees-scope"> · {badge}</span> : null}
          </span>
        );
      })}
    </span>
  );
}

function BulkBar({ count, applications, onApply, onClear }) {
  const [role, setRole] = useState('admin');
  const [scope, setScope] = useState('all');
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
        <option value="manager">Manager</option>
      </select>

      <label htmlFor="bulk-scope">for</label>
      <select
        id="bulk-scope"
        className="bs-inline-select"
        value={scope}
        onChange={(event) => setScope(event.target.value)}
      >
        {GRANT_SCOPES.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
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
        onClick={() => onApply({ applicationIds: targetIds, role, action: 'grant', scope })}
      >
        Apply
      </Button>

      <span className="access-bulkbar-sep" />

      <Button
        kind="ghost"
        className="access-btn-danger"
        onClick={() => onApply({ applicationIds: targetIds, action: 'revoke', scope })}
      >
        Remove access
      </Button>
      <Button kind="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}

/**
 * Which EasyVista catalog each application raises its tickets in.
 *
 * Separate per application because the outgoing payload's field names are
 * repurposed from one specific catalog. An application without one still works
 * everywhere else — it has a queue, access, a board lane, and it demonstrates
 * end to end; only a REAL send is refused, and only once EasyVista is switched
 * on. That refusal is the point: the alternative is posting into another
 * application's catalog with nothing to show for it.
 */
function EasyVistaCatalogs({ applications, onSave }) {
  const [editingId, setEditingId] = useState(null);
  const [guid, setGuid] = useState('');
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);

  function startEditing(app) {
    setEditingId(app.id);
    setGuid(app.easyVista?.catalogGuid || '');
    setCode(app.easyVista?.catalogCode || '');
  }

  async function submit(app) {
    setWorking(true);
    const saved = await onSave(app.id, { catalogGuid: guid.trim(), catalogCode: code.trim() });
    setWorking(false);
    if (saved) setEditingId(null);
  }

  const unconfigured = applications.filter((app) => !app.easyVista?.configured);

  return (
    <Card
      title="EasyVista catalogs"
      subtitle="Each application raises its tickets in its own catalog. Without one, a real send is refused rather than posted into another application's."
      className="access-card"
    >
      {unconfigured.length > 0 && (
        <div className="access-strip">
          <span className="access-strip-mark" aria-hidden="true">!</span>
          <span>
            {unconfigured.map((app) => app.name).join(', ')}
            {unconfigured.length === 1 ? ' has' : ' have'} no catalog. Everything else works —
            tickets queue, triage and appear on the board — but a real send would be refused.
            While EasyVista is switched off, sends are simulated and unaffected.
          </span>
        </div>
      )}

      <ul className="access-adlist">
        {applications.map((app) => (
          <li key={app.id} className="access-adrow">
            <span className="access-person">
              <span className="access-person-name">{app.name}</span>
              <span className="access-person-meta">
                {app.easyVista?.configured
                  ? (app.easyVista.inherited
                    ? 'Using the environment catalog'
                    : `Catalog ${app.easyVista.catalogGuid || app.easyVista.catalogCode}`)
                  : 'No catalog — a real send would be refused'}
              </span>
            </span>
            <span className={`bs-badge ${app.easyVista?.configured ? 'badge-approved' : 'badge-duplicate'}`}>
              {app.easyVista?.configured ? 'Configured' : 'Not configured'}
            </span>
            <span className="access-bulkbar-sep" />
            {editingId === app.id ? (
              <span className="access-adform" style={{ padding: 0, border: 0 }}>
                <input
                  className="bs-inline-input"
                  value={guid}
                  placeholder="Catalog GUID"
                  aria-label={`${app.name} catalog GUID`}
                  onChange={(event) => setGuid(event.target.value)}
                />
                <input
                  className="bs-inline-input"
                  value={code}
                  placeholder="Catalog code"
                  aria-label={`${app.name} catalog code`}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button kind="secondary" disabled={working} onClick={() => submit(app)}>
                  {working ? 'Saving…' : 'Save'}
                </Button>
                <Button kind="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
              </span>
            ) : (
              <Button kind="ghost" onClick={() => startEditing(app)}>
                {app.easyVista?.configured ? 'Change' : 'Set catalog'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
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
                      ) : applications.map((app) => {
                        const role = roleFor(person, app.id);
                        const scope = scopeFor(person, app.id) || 'all';
                        return (
                          <td key={app.id} className="access-col-app" data-label={app.name}>
                            <div className="access-grant">
                              <RoleSelect
                                value={role}
                                label={`${person.username} — ${app.name}`}
                                disabled={busy}
                                onChange={(next) => access.changeGrant(person.id, app.id, next, scope)}
                              />
                              {/* Nothing to scope when there is no access. */}
                              {role && (
                                <ScopeSelect
                                  value={scope}
                                  label={`${person.username} — ${app.name} — request types`}
                                  disabled={busy}
                                  onChange={(next) => access.changeGrant(person.id, app.id, role, next)}
                                />
                              )}
                            </div>
                          </td>
                        );
                      })}

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
          {' '}<strong>Manager</strong> adds seeing other people&apos;s throughput numbers.
          {' '}The second dropdown is which request types the grant covers — an
          {' '}<strong>analyst</strong> is simply Admin narrowed to <em>Report requests only</em>,
          {' '}which is why there is no analyst role to pick.
          {unassignedTicketCount > 0 && (
            <> {unassignedTicketCount} ticket{unassignedTicketCount === 1 ? ' has' : 's have'} no
              application set and {unassignedTicketCount === 1 ? 'is' : 'are'} visible to super users only.</>
          )}
        </div>
      </Card>

      <EasyVistaCatalogs
        applications={applications}
        onSave={access.setApplicationEasyVista}
      />

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
