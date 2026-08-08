import { useId, useState } from 'react';
import { Button, Notice } from '../bite-size/BitsizeUI';
import { api } from '../../lib/api';
import { SUBMISSION_TYPE_REPORT } from '../../constants/statusConstants';

// The read-only seat. The literal, the way the rest of the client spells it
// (hooks/useAccessManagement.js, pages/AdminAccessPage.jsx) — there is no shared
// role constant on this side to import.
const ROLE_VIEWER = 'viewer';

// Mirrors NAME_MAX_LENGTH in server/src/services/reportApplicationService.js. Kept
// here so the input stops at the same place the server would refuse, rather than
// letting somebody type 200 characters and learn about the limit from an error.
const NAME_MAX_LENGTH = 60;

/**
 * May this viewer add one? Holding a report grant anywhere is the bar.
 *
 * A CLIENT MIRROR of `canCreateReportApplication`
 * (server/src/services/reportApplicationService.js), which is the control — this
 * only decides whether to offer the affordance. Read from `applicationTypeRoles`,
 * the envelope's per-type detail, and NOT from `applicationRoles`, which collapses
 * to the strongest role held across every type and so cannot tell a reporting
 * analyst apart from a defect admin. `''` is an all-types grant, which covers
 * report requests; a viewer seat reads a queue and creates nothing.
 *
 * Offered rather than shown-and-refused because the two dialogs this sits in are
 * open to every admin, and a defect admin clicking it would get a 403 for a
 * feature that was never theirs.
 *
 * Deliberately NOT exported: the control below is the only thing that asks, and
 * exporting a non-component from a component file breaks Fast Refresh for the
 * whole file (`react-refresh/only-export-components`). Both call sites let the
 * control decide by rendering nothing.
 */
function canAddReportApplication(viewer) {
  if (!viewer) return false;
  if (viewer.isSuperUser) return true;
  const byApplication = viewer.applicationTypeRoles || {};
  return Object.values(byApplication).some((perType) => (
    Object.entries(perType || {}).some(([type, role]) => {
      const normalizedType = String(type || '').trim().toLowerCase();
      if (String(role || '').trim().toLowerCase() === ROLE_VIEWER) return false;
      return normalizedType === '' || normalizedType === SUBMISSION_TYPE_REPORT;
    })
  ));
}

/**
 * "It isn't in the list" — a reporting analyst adding an application by typing it in.
 *
 * ONE control, used by both places an analyst hits that wall: the Add-a-ticket
 * dialog's report branch (recording a request for a system the portal does not
 * track) and the Redirect dialog (realising an `Other` request is really Marketing
 * Analytics'). Built once because the two differ only in what they do with the
 * answer — one picks by name, the other by id — and `onCreated` receives both.
 *
 * WHAT IT CREATES is always **reports-only** (`applications.reports_only = 1`): an
 * application that takes report requests and nothing else. Creating it also grants
 * it to everybody who works report requests, in the same transaction — an
 * application is a queue, and a new one with no grants is visible to nobody but a
 * super user. Both of those are the server's doing; see
 * `server/src/services/reportApplicationService.js`.
 *
 * COLLAPSED BY DEFAULT. Typing a new application is the rare case — the list is
 * the answer almost every time — so this is a disclosure rather than a second
 * always-open input competing with the picker above it.
 *
 * `onCreated` is AWAITED before the success note replaces the input, because the
 * caller uses it to re-read the application list. Selecting a value whose `<option>`
 * does not exist yet leaves the picker blank, which reads as "it didn't work".
 */
export function AddApplicationControl({
  viewer,
  onCreated,
  disabled = false,
  // The report branch of the Add-a-ticket dialog and the Redirect dialog ask the
  // same question with different words around them.
  hint = 'It becomes an application report requests can be filed against. Only report requests.',
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(null);
  // Both dialogs can be mounted at once, so a hardcoded id would be a duplicate
  // in the document the moment the second one opens — and a label pointing at two
  // inputs points at neither.
  const inputId = useId();

  if (!canAddReportApplication(viewer)) return null;

  function collapse() {
    setExpanded(false);
    setName('');
    setError('');
  }

  async function create() {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (!trimmed || working) return;
    setWorking(true);
    setError('');
    try {
      const result = await api.createAdminApplication(trimmed);
      // Awaited: the caller re-reads the application list here, and the value is
      // selected only once the option it names actually exists.
      if (onCreated) await onCreated({ id: result?.id, name: result?.name || trimmed });
      setAdded(result || { name: trimmed });
      setExpanded(false);
      setName('');
    } catch (createError) {
      // The server's own words, kept verbatim: it distinguishes a name already in
      // the list from one that exists but is switched OFF, and only a super user
      // can switch that one back on. Rewriting either into "already exists" would
      // send the analyst looking for a row they cannot see. What was typed stays
      // in the box, the way a refused rename does on the Metadata page.
      setError(createError?.message || 'Could not add the application.');
    } finally {
      setWorking(false);
    }
  }

  if (added) {
    return (
      <div className="aac">
        <p className="aac-added">
          <b>{added.name}</b> added, and shared with
          {' '}
          {Number.isFinite(Number(added.grantedTo)) && Number(added.grantedTo) > 0
            ? `the ${added.grantedTo} ${Number(added.grantedTo) === 1 ? 'person' : 'people'} who work report requests`
            : 'everybody who works report requests'}
          . It takes report requests only.
        </p>
        <button type="button" className="aac-toggle" onClick={() => { setAdded(null); setExpanded(true); }}>
          Add another
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="aac">
        <button
          type="button"
          className="aac-toggle"
          disabled={disabled}
          onClick={() => setExpanded(true)}
        >
          <span aria-hidden="true">+</span> The application isn’t listed
        </button>
      </div>
    );
  }

  return (
    <div className="aac aac--open">
      <label className="aac-lbl" htmlFor={inputId}>Name the application</label>
      <div className="aac-row">
        <input
          id={inputId}
          type="text"
          autoFocus
          maxLength={NAME_MAX_LENGTH}
          placeholder="e.g. Marketing Analytics"
          value={name}
          disabled={disabled || working}
          onChange={(event) => { setName(event.target.value); setError(''); }}
          // Enter adds it. Neither dialog is a <form>, so nothing else would
          // happen — and Escape belongs to the modal, which is why it is left
          // alone rather than bound to collapse: taking the half-filled ticket
          // down would be worse than one extra click.
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              create();
            }
          }}
        />
        <Button
          type="button"
          kind="secondary"
          disabled={disabled || working || !name.trim()}
          onClick={create}
        >
          {working ? 'Adding…' : 'Add'}
        </Button>
        <Button type="button" kind="ghost" disabled={working} onClick={collapse}>
          Cancel
        </Button>
      </div>
      <p className="aac-hint">{hint}</p>
      {/* aria-live so the refusal is announced: the input keeps focus, so a
          screen reader would otherwise never reach the text below it. */}
      <div role="status" aria-live="polite">
        <Notice text={error} />
      </div>
    </div>
  );
}
