import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  MultiSelectDropdown,
  Notice,
  Select,
  Textarea,
} from '../components/bite-size/BitsizeUI';

const statuses = ['New', 'Approved', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired'];
const enhancementRequestTypes = [
  'Build-PPM Funded Project',
  'Build-Small Enhancement',
  'Build-Small Project (Not PPM Funded)',
  'Run-Compliance/Regulatory/Rate Revision',
  'Run-Other Operational Work',
];
const enhancementPriorityLevels = ['1 - Urgent', '2 - High', '3 - Medium', '4 - Low'];

function defaultFilters() {
  return {
    statuses: statuses.filter((status) => status !== 'Retired'),
    type: '',
    search: '',
    requester: '',
    submittedBy: '',
    sort: 'updated_desc',
  };
}

function editableFromDetail(detail) {
  if (!detail) return null;
  return {
    type: detail.type || 'defect',
    application_name: detail.application_name || '',
    policy_num: detail.policy_num || '',
    account_num: detail.account_num || '',
    transaction_num: detail.transaction_num || '',
    screen_title: detail.screen_title || '',
    summary_of_issue: detail.summary_of_issue || '',
    steps_to_reproduce: detail.steps_to_reproduce || '',
    what_happened_exact_details: detail.what_happened_exact_details || '',
    request: detail.request || '',
    date_time_of_error: detail.date_time_of_error ? detail.date_time_of_error.slice(0, 16) : '',
    desired_completion_date: detail.desired_completion_date
      ? detail.desired_completion_date.slice(0, 10)
      : '',
    status: detail.status || 'New',
    reviewer: detail.reviewer || '',
    decision_notes: detail.decision_notes || '',
    fingerprint: detail.fingerprint || '',
    impact_details: detail.impact_details || '',
    enhancement_request_type: detail.enhancement_request_type || '',
    priority_level: detail.priority_level || '3 - Medium',
    jira_number: detail.jira_number || '',
    duplicate_of: detail.duplicate_of || '',
    is_public: Boolean(detail.is_public),
  };
}

export function AdminDashboardPage({ user, onLogout }) {
  const [filters, setFilters] = useState(defaultFilters());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [edit, setEdit] = useState(null);
  const [working, setWorking] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [easyVistaConfirmation, setEasyVistaConfirmation] = useState('');

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.listAdminSubmissions(filters);
      setRows(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const openDetail = useCallback(async (id, preserveEdit = false) => {
    try {
      setError('');
      if (!preserveEdit) {
        setEasyVistaConfirmation('');
      }
      const data = await api.getAdminSubmissionDetail(id);
      setDetail(data);
      if (!preserveEdit) {
        setEdit(editableFromDetail(data));
      }
      setOpenId(id);
    } catch (detailError) {
      setError(detailError.message);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    const socket = getSocket();
    const onNotification = (payload) => {
      const message = payload?.event ? `Live update: ${payload.event}` : 'Live update received';
      setNotice(message);
      loadRows();
      if (openId) {
        openDetail(openId, true);
      }
    };

    socket.on('admin:notification', onNotification);
    return () => {
      socket.off('admin:notification', onNotification);
    };
  }, [loadRows, openId, openDetail]);

  const modalTitle = useMemo(() => {
    if (!detail) return 'Submission Details';
    return `Submission #${detail.id}`;
  }, [detail]);

  const enhancementMissingRequirements = useMemo(() => {
    if (!detail || !edit || edit.type !== 'enhancement') {
      return [];
    }

    const missing = [];
    if (!String(edit.impact_details || '').trim()) {
      missing.push('Impact Details');
    }
    if (!String(edit.enhancement_request_type || '').trim()) {
      missing.push('Request Type');
    }

    return missing;
  }, [detail, edit]);

  async function updateStatusQuick(submissionId, status) {
    try {
      setError('');
      await api.updateAdminSubmission(submissionId, { status });
      await loadRows();
      if (openId === submissionId) {
        await openDetail(submissionId);
      }
      if (status === 'Retired') {
        setNotice('Status updated to Retired. Item is hidden by default filters.');
      } else {
        setNotice('Status updated.');
      }
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function updatePublicQuick(submissionId, isPublic) {
    try {
      setError('');
      await api.updateAdminSubmission(submissionId, { is_public: isPublic });
      await loadRows();
      if (openId === submissionId) {
        await openDetail(submissionId, true);
        setEdit((prev) => (prev ? { ...prev, is_public: isPublic } : prev));
      }
      setNotice(`Public visibility updated to ${isPublic ? 'Yes' : 'No'}.`);
    } catch (updateError) {
      setError(updateError.message);
    }
  }

  async function saveEdits() {
    if (!openId || !edit) return;
    try {
      setWorking(true);
      await api.updateAdminSubmission(openId, {
        ...edit,
        duplicate_of: edit.duplicate_of === '' ? null : Number(edit.duplicate_of),
        date_time_of_error: edit.date_time_of_error || null,
        desired_completion_date: edit.desired_completion_date || null,
      });
      await openDetail(openId);
      await loadRows();
      setNotice('Saved successfully.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setWorking(false);
    }
  }

  async function uploadAttachment(event) {
    if (!openId) return;
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const formData = new FormData();
    files.forEach((file) => formData.append('attachments', file));

    try {
      setWorking(true);
      await api.uploadAdminAttachment(openId, formData);
      await openDetail(openId, true);
      await loadRows();
      setNotice('Attachment uploaded.');
      event.target.value = '';
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setWorking(false);
    }
  }

  async function deleteAttachment(attachmentId) {
    try {
      setWorking(true);
      await api.deleteAdminAttachment(attachmentId);
      await openDetail(openId, true);
      await loadRows();
      setNotice('Attachment removed.');
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setWorking(false);
    }
  }

  async function submitEasyVista() {
    if (!openId || !edit) return;
    try {
      setWorking(true);
      setError('');
      setEasyVistaConfirmation('');

      const saved = await api.updateAdminSubmission(openId, {
        ...edit,
        duplicate_of: edit.duplicate_of === '' ? null : Number(edit.duplicate_of),
        date_time_of_error: edit.date_time_of_error || null,
        desired_completion_date: edit.desired_completion_date || null,
      });

      if (saved?.type === 'enhancement') {
        const missing = [];
        if (!String(saved.impact_details || '').trim()) {
          missing.push('Impact Details');
        }
        if (!String(saved.enhancement_request_type || '').trim()) {
          missing.push('Request Type');
        }
        if (missing.length > 0) {
          throw new Error(`Enhancement cannot be submitted. Missing required fields: ${missing.join(', ')}`);
        }
      }

      const result = await api.submitToEasyVista(openId);

      if (result?.submission) {
        setDetail(result.submission);
        setEdit(editableFromDetail(result.submission));
      } else {
        await openDetail(openId);
      }

      await loadRows();
      setEasyVistaConfirmation(`Successfully submitted to EasyVista. Ticket: ${result?.ticketId || 'created'}`);
      setNotice(`Submitted to EasyVista. Ticket: ${result?.ticketId || 'created'}`);
    } catch (submitError) {
      setEasyVistaConfirmation('');
      setError(submitError.message);
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    await api.logout();
    onLogout();
  }

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return counts;
  }, [rows]);

  function formatDateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  return (
    <div className="stack">
      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h2>Admin Queue</h2>
          <p>Signed in as <strong>{user.username}</strong></p>
        </div>
        <Button kind="ghost" onClick={logout}>Sign Out</Button>
      </div>

      {/* ── Stat tiles ── */}
      {rows.length > 0 && (
        <div className="stat-row">
          <div className="stat-tile"><div className="stat-num">{rows.length}</div><div className="stat-lbl">Total</div></div>
          {['New', 'Approved', 'Submitted', 'Deployed'].map((s) => (
            <div className="stat-tile" key={s}>
              <div className="stat-num">{statusCounts[s] || 0}</div>
              <div className="stat-lbl">{s}</div>
            </div>
          ))}
        </div>
      )}

      {error && <Notice text={error} />}
      {notice && <Notice text={notice} kind="success" />}

      <Card>
        {/* ── Filters ── */}
        <div className="filters-bar">
          <MultiSelectDropdown
            label="Status"
            options={statuses}
            selectedValues={filters.statuses}
            onChange={(nextStatuses) => setFilters((prev) => ({ ...prev, statuses: nextStatuses }))}
            placeholder="Select statuses"
          />
          <Select
            label="Type"
            value={filters.type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="">All types</option>
            <option value="defect">Defect</option>
            <option value="enhancement">Enhancement</option>
          </Select>
          <Input
            label="Search"
            placeholder="ID, policy, account, or keyword…"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
          <Input
            label="Requester"
            placeholder="Filter by requester name"
            value={filters.requester}
            onChange={(e) => setFilters((prev) => ({ ...prev, requester: e.target.value }))}
          />
          <Input
            label="Submitted by (EasyVista)"
            placeholder="Filter by admin username"
            value={filters.submittedBy}
            onChange={(e) => setFilters((prev) => ({ ...prev, submittedBy: e.target.value }))}
          />
          <Select
            label="Sort"
            value={filters.sort}
            onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value }))}
          >
            <option value="updated_desc">Recently Updated (Newest)</option>
            <option value="updated_asc">Recently Updated (Oldest)</option>
            <option value="created_desc">Created (Newest)</option>
            <option value="created_asc">Created (Oldest)</option>
            <option value="requester_asc">Requester (A→Z)</option>
            <option value="requester_desc">Requester (Z→A)</option>
            <option value="submitted_by_asc">EasyVista Submitter (A→Z)</option>
            <option value="submitted_by_desc">EasyVista Submitter (Z→A)</option>
          </Select>
          <Button
            kind="ghost"
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                statuses: statuses.filter((value) => value !== 'Retired'),
              }))
            }
          >
            Hide Retired
          </Button>
          <Button
            kind="ghost"
            type="button"
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                statuses: [...statuses],
              }))
            }
          >
            Show All Statuses
          </Button>
        </div>

        {loading && <p className="muted">Loading…</p>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}>ID</th>
                <th style={{ width: 110 }}>Type</th>
                <th style={{ width: 180 }}>Requester</th>
                <th>Summary</th>
                <th style={{ width: 170 }}>Status</th>
                <th style={{ width: 72 }}>Public</th>
                <th style={{ width: 110 }}>EasyVista</th>
                <th style={{ width: 190 }}>Submitted to EV by</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '28px 12px' }}>No submissions match the current filters.</td></tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} onClick={() => openDetail(row.id)} className="clickable">
                  <td><span className="muted">#{row.id}</span></td>
                  <td><Badge value={row.type} /></td>
                  <td>{row.created_by || '—'}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.summary_of_issue}</td>
                  <td>
                    <select
                      className="bs-inline-select"
                      aria-label={`Update status for #${row.id}`}
                      value={row.status}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); updateStatusQuick(row.id, e.target.value); }}
                    >
                      {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      className="bs-inline-select"
                      aria-label={`Update public visibility for #${row.id}`}
                      value={row.is_public ? 'yes' : 'no'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        updatePublicQuick(row.id, e.target.value === 'yes');
                      }}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </td>
                  <td className="muted">{row.easyvista_ticket_id || '—'}</td>
                  <td>{row.easyvista_submitted_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={Boolean(openId && detail && edit)} onClose={() => setOpenId(null)} title={modalTitle}>
        {detail && edit && (
          <div className="stack">

            {/* ── Triage ── */}
            <p className="section-label">Triage</p>
            <div className="bs-grid two">
              <Select label="Type" value={edit.type} onChange={(e) => setEdit((p) => ({ ...p, type: e.target.value }))}>
                <option value="defect">Defect</option>
                <option value="enhancement">Enhancement</option>
              </Select>
              <Select label="Status" value={edit.status} onChange={(e) => setEdit((p) => ({ ...p, status: e.target.value }))}>
                {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Input label="Reviewer" value={edit.reviewer} onChange={(e) => setEdit((p) => ({ ...p, reviewer: e.target.value }))} />
              <Input label="Duplicate Of (ID)" type="number" value={edit.duplicate_of} onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))} />
            </div>
            <Textarea label="Decision Notes" rows={2} value={edit.decision_notes} onChange={(e) => setEdit((p) => ({ ...p, decision_notes: e.target.value }))} />

            <p className="section-label">Status Timeline</p>
            <Card className="inner">
              {!detail.status_events || detail.status_events.length === 0 ? (
                <p className="muted">No status history found.</p>
              ) : (
                <div className="bs-form" style={{ gap: 8 }}>
                  {detail.status_events.map((event) => (
                    <div key={event.id} style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                      <p style={{ margin: 0 }}>
                        <strong>{event.status}</strong> on {formatDateTime(event.changed_at)}
                      </p>
                      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                        Updated by: {event.changed_by || 'Unknown'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* ── Submission details ── */}
            <p className="section-label">Submission Details</p>
            <div className="bs-grid two">
              <Input label="Application" value={edit.application_name} onChange={(e) => setEdit((p) => ({ ...p, application_name: e.target.value }))} />
              {edit.type === 'defect' && (
                <Input label="Date / Time of Error" type="datetime-local" value={edit.date_time_of_error} onChange={(e) => setEdit((p) => ({ ...p, date_time_of_error: e.target.value }))} />
              )}
              {edit.type === 'enhancement' && (
                <Input label="Desired Completion Date" type="date" value={edit.desired_completion_date} onChange={(e) => setEdit((p) => ({ ...p, desired_completion_date: e.target.value }))} />
              )}
              <Input label="Policy #" value={edit.policy_num} onChange={(e) => setEdit((p) => ({ ...p, policy_num: e.target.value }))} />
              <Input label="Account #" value={edit.account_num} onChange={(e) => setEdit((p) => ({ ...p, account_num: e.target.value }))} />
              <Input label="Transaction #" value={edit.transaction_num} onChange={(e) => setEdit((p) => ({ ...p, transaction_num: e.target.value }))} />
              <Input label="Fingerprint" value={edit.fingerprint} onChange={(e) => setEdit((p) => ({ ...p, fingerprint: e.target.value }))} />
            </div>
            <Input label="Screen Title" value={edit.screen_title} onChange={(e) => setEdit((p) => ({ ...p, screen_title: e.target.value }))} />
            <Input label="Summary" value={edit.summary_of_issue} onChange={(e) => setEdit((p) => ({ ...p, summary_of_issue: e.target.value }))} />
            <Textarea label="Steps to Reproduce" rows={3} value={edit.steps_to_reproduce} onChange={(e) => setEdit((p) => ({ ...p, steps_to_reproduce: e.target.value }))} />
            <Textarea label="Exact Details / What Happened" rows={3} value={edit.what_happened_exact_details} onChange={(e) => setEdit((p) => ({ ...p, what_happened_exact_details: e.target.value }))} />
            <Textarea label="Request Details" rows={3} value={edit.request} onChange={(e) => setEdit((p) => ({ ...p, request: e.target.value }))} />

            {/* ── Enhancement admin ── */}
            {edit.type === 'enhancement' && (
              <>
                <p className="section-label">Enhancement — Admin Fields</p>
                <Card className="inner">
                  <div className="bs-form">
                    <Textarea label="Impact Details" required rows={4} value={edit.impact_details} onChange={(e) => setEdit((p) => ({ ...p, impact_details: e.target.value }))} />
                    <div className="bs-grid two">
                      <Select label="Request Type" required value={edit.enhancement_request_type} onChange={(e) => setEdit((p) => ({ ...p, enhancement_request_type: e.target.value }))}>
                        <option value="">Select one</option>
                        {enhancementRequestTypes.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Select label="Priority Level" value={edit.priority_level} onChange={(e) => setEdit((p) => ({ ...p, priority_level: e.target.value }))}>
                        {enhancementPriorityLevels.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Input label="Jira Number" value={edit.jira_number} onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))} />
                    </div>
                  </div>
                </Card>
              </>
            )}

            {/* ── Visibility toggle ── */}
            <div className="bs-actions" style={{ alignItems: 'center' }}>
              <label className="toggle-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={edit.is_public}
                  onChange={(e) => setEdit((p) => ({ ...p, is_public: e.target.checked }))}
                />
                <span>Visible on Public Status Board</span>
              </label>
              <Button
                kind="ghost"
                onClick={() => updatePublicQuick(openId, Boolean(edit.is_public))}
                disabled={working}
              >
                Update Visibility
              </Button>
            </div>

            {/* ── Attachments ── */}
            <p className="section-label">Attachments</p>
            <Card className="inner">
              <div className="bs-form">
                <label className="bs-field">
                  <span>{edit.type === 'enhancement' ? 'Supporting Documentation (images / documents)' : 'Add Screenshots'}</span>
                  <input
                    type="file"
                    accept={edit.type === 'enhancement' ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
                    multiple
                    onChange={uploadAttachment}
                  />
                </label>
                {detail.attachments?.length > 0 && (
                  <div className="thumb-grid">
                    {detail.attachments.map((att) => (
                      <article key={att.id} className="thumb-item">
                        {att.mime_type?.startsWith('image/') ? (
                          <button type="button" className="thumb-open-btn" onClick={() => setPreviewAttachment(att)}>
                            <img src={`/${att.file_path}`} alt={att.filename} />
                          </button>
                        ) : (
                          <a href={`/${att.file_path}`} target="_blank" rel="noreferrer" className="file-link">{att.filename}</a>
                        )}
                        <div className="thumb-meta">
                          <span className="thumb-name">{att.filename}</span>
                          <Button kind="danger" onClick={() => deleteAttachment(att.id)}>Remove</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* ── Actions ── */}
            <div className="bs-actions">
              <Button onClick={saveEdits} disabled={working}>Save Changes</Button>
              <Button
                kind="secondary"
                onClick={submitEasyVista}
                disabled={working || enhancementMissingRequirements.length > 0}
              >
                {detail.easyvista_ticket_id ? 'Re-submit to EasyVista' : 'Submit to EasyVista'}
              </Button>
            </div>
            {enhancementMissingRequirements.length > 0 && (
              <Notice text={`Complete before EasyVista submission: ${enhancementMissingRequirements.join(', ')}`} />
            )}
            {easyVistaConfirmation && <Notice text={easyVistaConfirmation} kind="success" />}
            {error && <Notice text={error} />}
            {detail.easyvista_ticket_id && (
              <p className="muted" style={{ fontSize: 13 }}>EasyVista ticket: <strong>{detail.easyvista_ticket_id}</strong></p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(previewAttachment)}
        onClose={() => setPreviewAttachment(null)}
        title={previewAttachment?.filename || 'Attachment Preview'}
      >
        {previewAttachment && (
          <img
            className="bs-preview-image"
            src={`/${previewAttachment.file_path}`}
            alt={previewAttachment.filename}
          />
        )}
      </Modal>
    </div>
  );
}
