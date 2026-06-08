import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Input,
  Notice,
} from '../components/bite-size/BitsizeUI';
import { ADMIN_META_CATEGORIES } from '../constants/adminConstants';
import { isProtectedRetiredStatusMetaItem } from '../utils/metaUtils';
import { useMetaManagement } from '../hooks/useMetaManagement';

function isReadOnlyCategory(categoryKey) {
  return String(categoryKey || '') === 'submissionSources';
}

// Reorder excludes the protected "Retired" status row. Stable module-level predicate.
function includeInReorder(item, categoryKey) {
  return !isProtectedRetiredStatusMetaItem(categoryKey, item);
}

export function AdminMetadataPage({ user }) {
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');

  const {
    setAdminMetaOptions,
    adminMetaLoading,
    adminMetaSaving,
    adminMetaError,
    selectedMetaCategory,
    setSelectedMetaCategory,
    newMetaName,
    setNewMetaName,
    metaDraftNames,
    setMetaDraftNames,
    activeMetaCategoryConfig,
    activeMetaItems,
    loadAdminMeta,
    saveMetaItem,
    addMetaItem,
    moveMetaItem,
  } = useMetaManagement({
    onNotice: setNotice,
    resetNoticeBeforeAction: true,
    // Reorder against the visible rows (excludes the protected "Retired" status entry).
    filterReorderItem: includeInReorder,
  });

  const visibleMetaItems = useMemo(
    () => activeMetaItems.filter((item) => !isProtectedRetiredStatusMetaItem(activeMetaCategoryConfig.key, item)),
    [activeMetaItems, activeMetaCategoryConfig],
  );

  const isCurrentCategoryReadOnly = useMemo(
    () => isReadOnlyCategory(activeMetaCategoryConfig.key),
    [activeMetaCategoryConfig],
  );

  return (
    <div className="bs-page" style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div className="bs-header">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h2>Admin Metadata</h2>
          <p>Signed in as <strong>{user.username}</strong></p>
        </div>
        <div className="bs-actions">
          <Button kind="ghost" onClick={() => navigate('/admin')}>Back to Admin Queue</Button>
        </div>
      </div>

      {adminMetaError && <Notice text={adminMetaError} />}
      {notice && <Notice text={notice} kind="success" />}

      <Card style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
          <div
            style={{
              borderRight: '1px solid var(--color-border)',
              paddingRight: 16,
              position: 'sticky',
              top: 16,
              alignSelf: 'start',
              zIndex: 3,
              background: 'var(--color-surface)',
              maxHeight: 'calc(100vh - 80px)',
              overflowY: 'auto',
            }}
          >
            <p className="section-label" style={{ marginTop: 0 }}>Metadata Panels</p>
            <div className="bs-form" style={{ gap: 8 }}>
              {ADMIN_META_CATEGORIES.map((category) => {
                const isActive = selectedMetaCategory === category.key;
                return (
                  <Button
                    key={category.key}
                    kind={isActive ? 'secondary' : 'ghost'}
                    onClick={() => setSelectedMetaCategory(category.key)}
                    style={{ width: '100%', justifyContent: 'flex-start', position: 'relative', zIndex: 4 }}
                  >
                    {category.label}
                  </Button>
                );
              })}
              <Button kind="ghost" style={{ position: 'relative', zIndex: 4 }} onClick={loadAdminMeta} disabled={adminMetaLoading || adminMetaSaving}>
                {adminMetaLoading ? 'Refreshing…' : 'Refresh Options'}
              </Button>
            </div>
          </div>

          <div style={{ minWidth: 0, position: 'relative', zIndex: 1, overflow: 'hidden' }}>
            <p className="section-label" style={{ marginTop: 0 }}>{activeMetaCategoryConfig.label}</p>

            <div className="bs-actions" style={{ marginTop: 10, alignItems: 'end' }}>
              <Input
                label="Add Value"
                value={newMetaName}
                placeholder="New option name"
                disabled={isCurrentCategoryReadOnly}
                onChange={(e) => setNewMetaName(e.target.value)}
              />
              <Button
                kind="secondary"
                disabled={isCurrentCategoryReadOnly || adminMetaSaving || !String(newMetaName || '').trim()}
                onClick={addMetaItem}
              >
                Add
              </Button>
            </div>

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table style={{ tableLayout: 'auto', width: '100%', minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: '10%' }}>Order</th>
                    <th>Name</th>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Enabled</th>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Disabled</th>
                    <th style={{ width: '1%', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMetaItems.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '16px 10px' }}
                      >
                        No metadata values found.
                      </td>
                    </tr>
                  )}
                  {visibleMetaItems.map((item, index) => {
                    const isProtectedRetiredItem = isProtectedRetiredStatusMetaItem(activeMetaCategoryConfig.key, item);
                    const isReadOnlyItem = isCurrentCategoryReadOnly || isProtectedRetiredItem;
                    return (
                      <tr key={item.id}>
                        <td>{index + 1}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <input
                            className="bs-inline-input"
                            value={metaDraftNames[item.id] ?? item.name ?? ''}
                            disabled={isReadOnlyItem}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            onChange={(e) => setMetaDraftNames((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(item.isActive)}
                            disabled={isReadOnlyItem}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setAdminMetaOptions((prev) => ({
                                ...prev,
                                [activeMetaCategoryConfig.optionsKey]: (prev[activeMetaCategoryConfig.optionsKey] || []).map((row) => (
                                  row.id === item.id ? { ...row, isActive: checked } : row
                                )),
                              }));
                            }}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <input
                            type="checkbox"
                            checked={!item.isActive}
                            disabled={isReadOnlyItem}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setAdminMetaOptions((prev) => ({
                                ...prev,
                                [activeMetaCategoryConfig.optionsKey]: (prev[activeMetaCategoryConfig.optionsKey] || []).map((row) => (
                                  row.id === item.id ? { ...row, isActive: !checked } : row
                                )),
                              }));
                            }}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div className="bs-actions" style={{ flexWrap: 'nowrap', gap: 6 }}>
                            <Button kind="ghost" disabled={adminMetaSaving || isReadOnlyItem || index === 0} onClick={() => moveMetaItem(item.id, 'up')}>↑</Button>
                            <Button kind="ghost" disabled={adminMetaSaving || isReadOnlyItem || index === visibleMetaItems.length - 1} onClick={() => moveMetaItem(item.id, 'down')}>↓</Button>
                            <Button kind="secondary" disabled={adminMetaSaving || isReadOnlyItem} onClick={() => saveMetaItem(item)}>Save</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {isCurrentCategoryReadOnly && (
              <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Submission Sources are visible for reference but are system-managed and cannot be edited here.
              </p>
            )}
            {activeMetaCategoryConfig.key === 'statuses' && (
              <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Note: disabled statuses remain available in the Status filter so admins can still find old records and move them to an enabled status.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
