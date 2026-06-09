import { Card, Input, Select, Textarea } from '../../bite-size/BitsizeUI';
import {
  formatDateOnly,
  isAutoEasyVistaReporter,
} from '../../../utils/formatUtils';

/**
 * Submission Details, the More Submission Details <details>, and the
 * "As Submitted To EasyVista" preview block.
 */
export function DetailSubmissionSection({
  detail,
  edit,
  setEdit,
  effectiveType,
  dynamicApplications,
}) {
  return (
    <>
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
    </>
  );
}
