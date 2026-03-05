import { Button } from '../bite-size/BitsizeUI';

/**
 * Admin page header with action buttons (import, export, backdated, cleanup, metadata, sign out).
 */
export function AdminHeader({
  user,
  importFileInputRef,
  importWorking,
  exportWorking,
  onOpenImport,
  onOpenExport,
  onOpenBackdated,
  onOpenCleanup,
  onNavigateMetadata,
  onLogout,
  onImportFileChange,
}) {
  return (
    <div className="admin-header-row">
      <div className="page-header admin-page-header" style={{ marginBottom: 0 }}>
        <h2>Admin Queue</h2>
        <p>Signed in as <strong>{user.username}</strong></p>
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
        <Button
          kind="secondary"
          disabled={importWorking}
          onClick={onOpenImport}
        >
          {importWorking ? 'Importing…' : 'Import Excel (.xlsx)'}
        </Button>
        <Button
          kind="secondary"
          disabled={exportWorking}
          onClick={onOpenExport}
        >
          {exportWorking ? 'Exporting…' : 'Export Excel (.xlsx)'}
        </Button>
        <Button kind="secondary" onClick={onOpenBackdated}>
          Add Backdated Ticket
        </Button>
        <Button kind="secondary" onClick={onOpenCleanup}>
          Add Cleanup Task
        </Button>
        <Button kind="secondary" onClick={onNavigateMetadata}>Manage Metadata</Button>
        <Button kind="ghost" onClick={onLogout}>Sign Out</Button>
      </div>
    </div>
  );
}
