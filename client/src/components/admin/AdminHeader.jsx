import { useEffect, useRef, useState } from 'react';

/**
 * Dropdown menu wrapper: a trigger button plus a popover of actions.
 *
 * Closes on outside click (mousedown, matching MultiSelectDropdown) and on
 * Escape, and returns focus to the trigger so keyboard users don't lose their
 * place. Menu items close the menu before running their action.
 */
function Menu({ trigger, triggerClassName = '', label, children }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="admin-menu" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        onClick={() => setOpen((prev) => !prev)}
      >
        {trigger}
      </button>
      {open && (
        <div className="admin-menu-list" role="menu">
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, disabled = false, children }) {
  return (
    <button type="button" role="menuitem" className="admin-menu-item" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Admin page header.
 *
 * One primary action that opens the one dialog for adding a ticket — new or
 * historical, defect, enhancement or cleanup. It was a two-item menu while those
 * were two dialogs; a menu whose only job is to reveal a single item is a click
 * that buys nothing, and the type now lives inside the dialog where a fourth one
 * can join it. The spreadsheet round-trip sits under "Data"; metadata and sign-out
 * under the signed-in user.
 */
export function AdminHeader({
  user,
  importFileInputRef,
  importWorking,
  exportWorking,
  onOpenImport,
  onOpenExport,
  onOpenAddTicket,
  onNavigateMetadata,
  onNavigateThroughput,
  onNavigateAccess,
  // Only a portal super user can manage access, so the entry point is hidden
  // rather than shown-and-refused. The route and every endpoint behind it check
  // again server-side — this is signposting, not the control.
  canManageAccess = false,
  // Both default FALSE: an unknown viewer is not a super user, so a menu that
  // renders before the envelope arrives offers nothing it should not.
  canManageMetadata = false,
  onLogout,
  onImportFileChange,
  activeCount = null,
}) {
  const username = user?.username || '';
  const initials = username.slice(0, 2).toUpperCase() || '??';
  const busy = importWorking || exportWorking;

  return (
    <div className="admin-header-row">
      <div className="page-header admin-page-header" style={{ marginBottom: 0 }}>
        <h2>Admin Queue</h2>
        <p>
          {activeCount === null
            ? <>Signed in as <strong>{username}</strong></>
            : <>{activeCount} active ticket{activeCount === 1 ? '' : 's'}</>}
        </p>
      </div>

      <div className="bs-actions admin-header-actions">
        <input
          ref={importFileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0] || null;
            onImportFileChange(file);
          }}
        />

        <button type="button" className="bs-btn bs-btn-primary" onClick={onOpenAddTicket}>
          Add a ticket…
        </button>

        <Menu
          label="Data import and export"
          triggerClassName="bs-btn bs-btn-ghost"
          trigger={<>{busy ? 'Working…' : 'Data'} <span aria-hidden="true">▾</span></>}
        >
          {({ close }) => (
            <>
              <MenuItem disabled={importWorking} onClick={() => { close(); onOpenImport(); }}>
                {importWorking ? 'Importing…' : 'Import Excel (.xlsx)'}
              </MenuItem>
              <MenuItem disabled={exportWorking} onClick={() => { close(); onOpenExport(); }}>
                {exportWorking ? 'Exporting…' : 'Export Excel (.xlsx)'}
              </MenuItem>
            </>
          )}
        </Menu>

        <Menu
          label={`Account menu for ${username}`}
          triggerClassName="admin-who"
          trigger={(
            <>
              <span className="admin-who-avatar" aria-hidden="true">{initials}</span>
              <span>{username}</span>
              <span aria-hidden="true">▾</span>
            </>
          )}
        >
          {({ close }) => (
            <>
              {/* Super users only, same flag as Manage access below. A lookup
                  edited here is renamed or withdrawn on every ticket holding it,
                  in every application — it is not scoped by the per-application
                  grants the rest of the admin side is. Hidden rather than shown
                  and refused: an entry that only ever leads to a 403 is a door
                  with a wall behind it. */}
              {canManageMetadata && (
                <MenuItem onClick={() => { close(); onNavigateMetadata(); }}>Manage metadata</MenuItem>
              )}
              {/* Not gated: every admin may open it, and the server decides
                  whether they see the team's numbers or only their own. */}
              <MenuItem onClick={() => { close(); onNavigateThroughput(); }}>Reporting throughput</MenuItem>
              {canManageAccess && (
                <MenuItem onClick={() => { close(); onNavigateAccess(); }}>Manage access</MenuItem>
              )}
              <div className="admin-menu-sep" role="separator" />
              <MenuItem onClick={() => { close(); onLogout(); }}>Sign out</MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

// Kept exported for reuse by other admin surfaces that need the same popover.
export { Menu as AdminMenu, MenuItem as AdminMenuItem };
