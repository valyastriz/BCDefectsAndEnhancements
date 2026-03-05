import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Notice,
  Select,
  Textarea,
} from '../bite-size/BitsizeUI';
import { STATUS_TO_CLEANUP } from '../../constants/adminConstants';
import {
  formatMetaTypeLabel,
  formatCreatedViaLabel,
  formatDateTime,
  formatDateOnly,
  formatTimelineStatus,
  resolveAttachmentUrl,
  isAutoEasyVistaReporter,
} from '../../utils/formatUtils';

/**
 * Main detail / edit modal for an individual admin submission.
 */
export function DetailModal({
  // Detail modal hook state
  openId,
  setOpenId,
  detail,
  edit,
  setEdit,
  detailError,
  setDetailError,
  working,
  modalTitle,
  modalTopNotice,
  setModalTopNotice,
  modalBottomNotice,
  setModalBottomNotice,
  setPreviewAttachment,
  easyVistaConfirmation,
  showEasyVistaRequirements,
  setShowEasyVistaRequirements,
  showHeaderSaveTooltip,
  setShowHeaderSaveTooltip,
  showFooterSaveTooltip,
  setShowFooterSaveTooltip,
  effectiveType,
  easyVistaMissingRequirements,
  hasPendingChanges,
  visibleAttachments,
  saveDisabledReason,
  saveEdits,
  retireCurrentItem,
  unretireCurrentItem,
  uploadAttachment,
  deleteAttachment,
  submitEasyVista,
  clearPendingAttachmentDrafts,
  // Meta options
  dynamicCleanupStatuses,
  dynamicCleanupTagTypes,
  dynamicApplications,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  dynamicOccurrenceTimeframes,
  runtimeStatusOptions,
  dynamicCoreStatusSet,
  dynamicCleanupStatusSet,
}) {
  const cleanupOnlyStatus = '⛏ Cleanup Only';
  const statusToCleanup = STATUS_TO_CLEANUP;

  return (
    <Modal
      open={Boolean(openId && detail && edit)}
      onClose={() => {
        clearPendingAttachmentDrafts();
        setOpenId(null);
        setModalTopNotice('');
        setModalBottomNotice('');
        setDetailError('');
        setShowEasyVistaRequirements(false);
      }}
      title={modalTitle}
      headerActions={(
        <span
          style={{ position: 'relative', display: 'inline-block' }}
          onMouseEnter={() => setShowHeaderSaveTooltip(true)}
          onMouseLeave={() => setShowHeaderSaveTooltip(false)}
        >
          <Button
            onClick={() => saveEdits('header')}
            disabled={working || !hasPendingChanges}
          >
            Save Changes
          </Button>
          {(working || !hasPendingChanges) && showHeaderSaveTooltip && (
            <span
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--slate-900)',
                color: 'white',
                fontSize: 12,
                lineHeight: 1.2,
                padding: '6px 8px',
                borderRadius: 6,
                whiteSpace: 'nowrap',
                zIndex: 30,
              }}
            >
              {saveDisabledReason}
            </span>
          )}
        </span>
      )}
    >
      {detail && edit && (
        <div className="stack">
          {modalTopNotice && <Notice text={modalTopNotice} kind="success" />}
          {detailError && <Notice text={detailError} />}
          {edit.is_retired && <Notice text="This item is retired." kind="info" />}
          {detail.has_resubmission && detail.latest_resubmission_easyvista_ticket_id && (
            <Notice
              text={`This item has been resubmitted. Latest EasyVista ticket: ${detail.latest_resubmission_easyvista_ticket_id}${detail.latest_resubmission_submission_id ? ` (Submission #${detail.latest_resubmission_submission_id})` : ''}.`}
              kind="info"
            />
          )}
          {detail.is_resubmission && detail.resubmission_of_easyvista_ticket_id && (
            <Notice
              text={`This card is a resubmission of EasyVista ticket ${detail.resubmission_of_easyvista_ticket_id}${detail.resubmission_of_submission_id ? ` (Original Submission #${detail.resubmission_of_submission_id})` : ''}.`}
              kind="info"
            />
          )}

          {/* ── Triage ── */}
          <p className="section-label">Triage</p>
          <div className="bs-grid two">
            <label className="toggle-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(edit.is_cleanup)}
                onChange={(e) =>
                  setEdit((p) => ({
                    ...p,
                    is_cleanup: e.target.checked,
                    cleanup_status: e.target.checked
                      ? (p.cleanup_status || statusToCleanup[p.status] || 'New')
                      : p.cleanup_status,
                    cleanup_tag_type: e.target.checked
                      ? (
                          p.cleanup_tag_type
                          || (p.type === 'enhancement' ? 'enhancement' : 'defect')
                        )
                      : '',
                  }))
                }
              />
              <span>Clean Up Task</span>
            </label>

            <Select
              label="Type"
              value={edit.is_cleanup ? (edit.cleanup_tag_type || 'cleanup_only') : edit.type}
              onChange={(e) =>
                setEdit((p) => {
                  if (p.is_cleanup) {
                    const nextCleanupTagType = e.target.value;
                    return {
                      ...p,
                      cleanup_tag_type: nextCleanupTagType,
                      type: nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect',
                    };
                  }
                  return { ...p, type: e.target.value };
                })
              }
            >
              {dynamicCleanupTagTypes.map((option) => {
                if (!edit.is_cleanup && option === 'cleanup_only') {
                  return null;
                }
                return <option key={option} value={option}>{formatMetaTypeLabel(option)}</option>;
              })}
            </Select>

            <Select
              label="Defect/Enhancement Status"
              value={edit.is_cleanup && edit.cleanup_tag_type === 'cleanup_only' ? cleanupOnlyStatus : edit.status}
              disabled={edit.is_retired}
              onChange={(e) =>
                setEdit((p) => ({
                  ...p,
                  is_cleanup: e.target.value === cleanupOnlyStatus ? true : p.is_cleanup,
                  cleanup_status:
                    e.target.value === cleanupOnlyStatus
                      ? (p.cleanup_status || statusToCleanup[p.status] || 'Not Started')
                      : p.cleanup_status,
                  status: e.target.value === cleanupOnlyStatus ? 'New' : e.target.value,
                  cleanup_tag_type:
                    e.target.value === cleanupOnlyStatus
                      ? 'cleanup_only'
                      : (
                          p.cleanup_tag_type === 'cleanup_only'
                            ? (p.type === 'enhancement' ? 'enhancement' : 'defect')
                            : p.cleanup_tag_type
                        ),
                  type: e.target.value === cleanupOnlyStatus ? 'defect' : p.type,
                }))
              }
            >
              {runtimeStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select
              label="Cleanup Status"
              value={edit.cleanup_status || 'New'}
              onChange={(e) => setEdit((p) => ({ ...p, cleanup_status: e.target.value }))}
              disabled={!edit.is_cleanup}
            >
              {dynamicCleanupStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Reviewer" value={edit.reviewer} onChange={(e) => setEdit((p) => ({ ...p, reviewer: e.target.value }))} />
            <Input label="Duplicate Reference (EasyVista / JIRA / ID)" value={edit.duplicate_of} onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))} />
            <Input
              label="Submitted to EV By"
              value={edit.easyvista_submitted_by}
              readOnly={isAutoEasyVistaReporter(edit.easyvista_submitted_by)}
              onChange={(e) => setEdit((p) => ({ ...p, easyvista_submitted_by: e.target.value }))}
              placeholder="Unknown"
            />
            <Input
              label="Created Via"
              value={formatCreatedViaLabel(edit.created_via || detail.created_via || '')}
              readOnly
              placeholder="—"
            />
            <Input label="JIRA Number" value={edit.jira_number} onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))} placeholder="JIRA-123" />
            <Input label="EasyVista Ticket" value={detail.easyvista_ticket_id || ''} readOnly placeholder="—" />
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Triage/Release Info</summary>
            <div className="bs-form" style={{ marginTop: 12 }}>
              <Textarea label="Decision Notes" rows={2} value={edit.decision_notes} onChange={(e) => setEdit((p) => ({ ...p, decision_notes: e.target.value }))} />
              <Input label="Release #" placeholder="e.g. v1.2.0" value={edit.release_number} onChange={(e) => setEdit((p) => ({ ...p, release_number: e.target.value }))} />
              <Textarea label="Release Notes" rows={3} value={edit.release_notes} onChange={(e) => setEdit((p) => ({ ...p, release_notes: e.target.value }))} />
            </div>
          </details>

          {/* ── Submission details ── */}
          <p className="section-label">Submission Details</p>
          <Input label="Summary" value={edit.summary_of_issue} onChange={(e) => setEdit((p) => ({ ...p, summary_of_issue: e.target.value }))} />
          <div className="bs-grid two">
            <Input label="Reported Date" value={formatDateOnly(detail.created_at)} readOnly />
            <Input label="Requester Name" value={detail.created_by || ''} readOnly />
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>More Submission Details</summary>
            <div className="bs-form" style={{ marginTop: 12 }}>
              {(effectiveType === 'defect' || !effectiveType) && (
                <Input label="Date / Time of Error" type="datetime-local" value={edit.date_time_of_error} onChange={(e) => setEdit((p) => ({ ...p, date_time_of_error: e.target.value }))} />
              )}
              {effectiveType === 'enhancement' && (
                <Input label="Desired Completion Date" type="date" value={edit.desired_completion_date} onChange={(e) => setEdit((p) => ({ ...p, desired_completion_date: e.target.value }))} />
              )}
              {(effectiveType === 'defect' || !effectiveType) && (
                <Textarea label="Exact Details / What Happened" rows={3} value={edit.what_happened_exact_details} onChange={(e) => setEdit((p) => ({ ...p, what_happened_exact_details: e.target.value }))} />
              )}
              {effectiveType === 'enhancement' && (
                <Textarea label="Request Details" rows={3} value={edit.request} onChange={(e) => setEdit((p) => ({ ...p, request: e.target.value }))} />
              )}
              {(effectiveType === 'defect' || !effectiveType) && (
                <Textarea label="Steps to Reproduce" rows={3} value={edit.steps_to_reproduce} onChange={(e) => setEdit((p) => ({ ...p, steps_to_reproduce: e.target.value }))} />
              )}
              <div className="bs-grid two">
                <Select
                  label="Application"
                  value={edit.application_name || 'Billing Center'}
                  onChange={(e) => setEdit((p) => ({ ...p, application_name: e.target.value }))}
                >
                  {dynamicApplications.map((application) => (
                    <option key={application} value={application}>{application}</option>
                  ))}
                </Select>
                <Input label="Policy #" value={edit.policy_num} onChange={(e) => setEdit((p) => ({ ...p, policy_num: e.target.value }))} />
                <Input label="Account #" value={edit.account_num} onChange={(e) => setEdit((p) => ({ ...p, account_num: e.target.value }))} />
                <Input label="Transaction #" value={edit.transaction_num} onChange={(e) => setEdit((p) => ({ ...p, transaction_num: e.target.value }))} />
                <Input label="Fingerprint" value={edit.fingerprint} onChange={(e) => setEdit((p) => ({ ...p, fingerprint: e.target.value }))} />
              </div>
              <Input label="Screen Title" value={edit.screen_title} onChange={(e) => setEdit((p) => ({ ...p, screen_title: e.target.value }))} />
            </div>
          </details>

          {/* ── Description As Submitted To EasyVista ── */}
          {detail.easyvista_ticket_id && isAutoEasyVistaReporter(detail.easyvista_submitted_by) && (() => {
            const evDesc = [
              `Type: ${detail.type || ''}`,
              `Application: ${detail.application_name || ''}`,
              `Created By: ${detail.created_by || ''} (${detail.created_by_email || ''})`,
              `Policy #: ${detail.policy_num || 'N/A'}`,
              `Account #: ${detail.account_num || 'N/A'}`,
              `Transaction #: ${detail.transaction_num || 'N/A'}`,
              `Screen Title: ${detail.screen_title || ''}`,
              `Date/Time of Error: ${detail.date_time_of_error || ''}`,
              `Desired Completion Date: ${detail.desired_completion_date || 'N/A'}`,
              `Enhancement Request Type: ${detail.enhancement_request_type || 'N/A'}`,
              `Priority Level: ${detail.priority_level || 'N/A'}`,
              `JIRA Number: ${detail.jira_number || 'N/A'}`,
              '',
              'Summary:',
              detail.summary_of_issue || '',
              '',
              'Steps to Reproduce:',
              detail.steps_to_reproduce || '',
              '',
              'What Happened (Exact Details):',
              `${detail.created_by || 'Requester'} submitted the following:`,
              detail.what_happened_exact_details || '',
              '',
              'Request:',
              detail.request || '',
              '',
              'Impact Details:',
              detail.impact_details || 'N/A',
            ].join('\n');
            return (
              <details>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-primary)' }}>
                  As Submitted To EasyVista
                </summary>
                <Card className="inner" style={{ marginTop: 10 }}>
                  <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text)', background: 'var(--color-surface)', padding: 12, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                    {evDesc}
                  </pre>
                </Card>
              </details>
            );
          })()}

          <p className="section-label">Status Timeline</p>
          <Card className="inner">
            {!detail.status_events || detail.status_events.length === 0 ? (
              <p className="muted">No status history found.</p>
            ) : (
              <div className="bs-form" style={{ gap: 10 }}>
                <div style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{formatTimelineStatus(detail.status_events[0].status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}</strong> on {formatDateTime(detail.status_events[0].changed_at)}
                  </p>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Updated by: {detail.status_events[0].changed_by || 'Unknown'}
                  </p>
                </div>
                {detail.status_events.length > 1 && (
                  <details>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                      Show previous statuses ({detail.status_events.length - 1})
                    </summary>
                    <div className="bs-form" style={{ gap: 8, marginTop: 10 }}>
                      {detail.status_events.slice(1).map((event) => (
                        <div key={event.id} style={{ borderBottom: '1px solid var(--slate-200)', paddingBottom: 8 }}>
                          <p style={{ margin: 0 }}>
                            <strong>{formatTimelineStatus(event.status, dynamicCoreStatusSet, dynamicCleanupStatusSet)}</strong> on {formatDateTime(event.changed_at)}
                          </p>
                          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                            Updated by: {event.changed_by || 'Unknown'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </Card>

          <p className="section-label">Impact Analysis</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <Input
              label="Policy Premium Impact ($)"
              type="number"
              step="0.01"
              value={edit.policy_premium_impact}
              onChange={(e) => setEdit((p) => ({ ...p, policy_premium_impact: e.target.value }))}
            />
            <Input
              label="Direct Dollar Impact ($)"
              type="number"
              step="0.01"
              value={edit.direct_dollar_impact}
              onChange={(e) => setEdit((p) => ({ ...p, direct_dollar_impact: e.target.value }))}
            />
            <Input
              label="Policies Affected Count"
              type="number"
              step="1"
              min="0"
              value={edit.policies_affected_count}
              onChange={(e) => setEdit((p) => ({ ...p, policies_affected_count: e.target.value }))}
            />
          </div>

          <p style={{ fontWeight: 600, margin: '14px 0 6px' }}>Frequency</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 12,
            }}
          >
            <Input
              label="# of Occurrences"
              type="number"
              step="1"
              min="0"
              value={edit.occurrence_count}
              onChange={(e) => setEdit((p) => ({ ...p, occurrence_count: e.target.value }))}
            />
            <Input
              label="Per How Many"
              type="number"
              step="1"
              min="1"
              value={edit.occurrence_timeframe_count}
              onChange={(e) => setEdit((p) => ({ ...p, occurrence_timeframe_count: e.target.value }))}
            />
            <Select
              label="Time Frame"
              value={edit.occurrence_timeframe}
              onChange={(e) => setEdit((p) => ({ ...p, occurrence_timeframe: e.target.value }))}
            >
              <option value="">Select</option>
              {dynamicOccurrenceTimeframes.map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </Select>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Impact Notes</summary>
            <div className="bs-form" style={{ marginTop: 12 }}>
              <Textarea
                label="Impact Notes"
                rows={3}
                value={edit.impact_notes}
                onChange={(e) => setEdit((p) => ({ ...p, impact_notes: e.target.value }))}
              />
            </div>
          </details>

          {/* ── Enhancement admin ── */}
          {effectiveType === 'enhancement' && (
            <>
              <p className="section-label">Enhancement — Admin Fields</p>
              <Card className="inner">
                <div className="bs-form">
                  <Textarea label="Impact Details" required rows={4} value={edit.impact_details} onChange={(e) => setEdit((p) => ({ ...p, impact_details: e.target.value }))} />
                  <div className="bs-grid two">
                    <Select label="Request Type" required value={edit.enhancement_request_type} onChange={(e) => setEdit((p) => ({ ...p, enhancement_request_type: e.target.value }))}>
                      <option value="">Select one</option>
                      {dynamicEnhancementRequestTypes.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                    <Select label="Priority Level" value={edit.priority_level} onChange={(e) => setEdit((p) => ({ ...p, priority_level: e.target.value }))}>
                      {dynamicPriorityLevels.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                    <Input label="JIRA Number" value={edit.jira_number} onChange={(e) => setEdit((p) => ({ ...p, jira_number: e.target.value }))} />
                    <Select label="In JIRA" value={edit.logged_defect ? 'yes' : 'no'} onChange={(e) => setEdit((p) => ({ ...p, logged_defect: e.target.value === 'yes' }))}>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
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
          </div>

          {/* ── Attachments ── */}
          <p className="section-label">Attachments</p>
          <Card className="inner">
            <div className="bs-form">
              <label className="bs-field">
                <span>{effectiveType === 'enhancement' ? 'Supporting Documentation (images / documents)' : 'Add Screenshots'}</span>
                <input
                  type="file"
                  accept={effectiveType === 'enhancement' ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
                  multiple
                  onChange={uploadAttachment}
                />
              </label>
              {visibleAttachments.length > 0 && (
                <div className="thumb-grid">
                  {visibleAttachments.map((att) => (
                    <article key={att.id} className="thumb-item">
                      {att._isPendingUpload ? (
                        att.mime_type?.startsWith('image/') && att.preview_url ? (
                          <button
                            type="button"
                            className="thumb-open-btn"
                            onClick={() => setPreviewAttachment(att)}
                          >
                            <img src={att.preview_url} alt={att.filename} />
                          </button>
                        ) : (
                          <span className="file-link">{att.filename}</span>
                        )
                      ) : att.mime_type?.startsWith('image/') ? (
                        <button type="button" className="thumb-open-btn" onClick={() => setPreviewAttachment(att)}>
                          <img src={resolveAttachmentUrl(att.file_path)} alt={att.filename} />
                        </button>
                      ) : (
                        <a href={resolveAttachmentUrl(att.file_path)} target="_blank" rel="noreferrer" className="file-link">{att.filename}</a>
                      )}
                      <div className="thumb-meta">
                        <span className="thumb-name">{att.filename}</span>
                        {att._isPendingUpload ? (
                          <Badge tone="warning">Pending upload</Badge>
                        ) : att._isMarkedForRemoval ? (
                          <Badge tone="danger">Pending removal</Badge>
                        ) : null}
                        <Button
                          kind="danger"
                          onClick={() => deleteAttachment(att)}
                        >
                          {att._isPendingUpload
                            ? 'Discard'
                            : att._isMarkedForRemoval
                              ? 'Undo Remove'
                              : 'Remove'}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {showEasyVistaRequirements && easyVistaMissingRequirements.length > 0 && (
            <Notice text={`Complete before EasyVista submission: ${easyVistaMissingRequirements.join(', ')}`} />
          )}

          {/* ── Actions ── */}
          <div className="bs-actions">
            <span
              style={{ position: 'relative', display: 'inline-block' }}
              onMouseEnter={() => setShowFooterSaveTooltip(true)}
              onMouseLeave={() => setShowFooterSaveTooltip(false)}
            >
              <Button
                onClick={() => saveEdits('footer')}
                disabled={working || !hasPendingChanges}
              >
                Save Changes
              </Button>
              {(working || !hasPendingChanges) && showFooterSaveTooltip && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 6px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--slate-900)',
                    color: 'white',
                    fontSize: 12,
                    lineHeight: 1.2,
                    padding: '6px 8px',
                    borderRadius: 6,
                    whiteSpace: 'nowrap',
                    zIndex: 30,
                  }}
                >
                  {saveDisabledReason}
                </span>
              )}
            </span>
            {edit.is_retired ? (
              <Button
                kind="secondary"
                onClick={unretireCurrentItem}
                disabled={working}
              >
                Unretire Item
              </Button>
            ) : (
              <Button
                kind="danger"
                onClick={retireCurrentItem}
                disabled={working}
              >
                Retire Item
              </Button>
            )}
            <Button
              kind="secondary"
              onClick={submitEasyVista}
              disabled={working}
            >
              {detail.easyvista_ticket_id ? 'Re-submit to EasyVista' : 'Submit to EasyVista'}
            </Button>
          </div>
          {!working && !hasPendingChanges && (
            <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>
              No unsaved changes.
            </p>
          )}
          {modalBottomNotice && <Notice text={modalBottomNotice} kind="success" />}
          {easyVistaConfirmation && <Notice text={easyVistaConfirmation} kind="success" />}
          {detail.easyvista_ticket_id && (
            <p className="muted" style={{ fontSize: 13 }}>EasyVista ticket: <strong>{detail.easyvista_ticket_id}</strong></p>
          )}
        </div>
      )}
    </Modal>
  );
}
