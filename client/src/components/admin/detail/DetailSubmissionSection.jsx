import { DetailGroup } from './DetailPane';
import { formatDateTime } from '../../../utils/formatUtils';

/**
 * Report — the form as it came in, read-only.
 *
 * This is a record, not a working copy, so it reads from `detail` rather than
 * the `edit` draft. The editable versions of these fields live on the EasyVista
 * Submission tab, which is the only reason to change them.
 *
 * TODO(snapshots): once `reported_snapshot` / `easyvista_snapshot` exist this
 * switches to showing the captured values, and the original stays reachable
 * after a submission. Until then it shows the current saved values and says so —
 * see `reportSource` below.
 */
function reportSource(detail) {
  if (detail.easyvista_ticket_id) {
    return {
      label: 'Submitted to EasyVista',
      note: `Raised as ${detail.easyvista_ticket_id}. Showing the current saved values —`
        + ' this ticket predates the capture of what was originally reported.',
    };
  }
  return {
    label: 'As reported',
    note: 'Not yet sent to EasyVista. Showing the current saved values.',
  };
}

/** One read-only value. Long-form text keeps its line breaks. */
function ReportValue({ label, value, block = false }) {
  const isEmpty = value === null || value === undefined || String(value).trim() === '';
  return (
    <div className="bs-field dm-rofield">
      <span>{label}</span>
      <p className={`dm-ro${block ? ' dm-ro--block' : ''}${isEmpty ? ' dm-ro--empty' : ''}`}>
        {isEmpty ? 'Not given' : value}
      </p>
    </div>
  );
}

export function DetailSubmissionSection({ detail, effectiveType }) {
  const isDefect = effectiveType === 'defect' || !effectiveType;
  const { label, note } = reportSource(detail);

  return (
    <>
      <div className="dm-ev-head">
        <h4>{label}</h4>
        <p>{note}</p>
      </div>

      {/* The short reference fields pair up on one row; Details runs full width
          beneath them, because it holds multi-paragraph prose that is unreadable
          squeezed into a third of the modal. */}
      <div className="dm-report-grid">
        <DetailGroup label="Record references">
          <ReportValue label="Policy #" value={detail.policy_num} />
          <ReportValue label="Account #" value={detail.account_num} />
          <ReportValue label="Transaction #" value={detail.transaction_num} />
        </DetailGroup>

        <DetailGroup label="Where it happened">
          <ReportValue label="Application" value={detail.application_name} />
          <ReportValue label="Screen Title" value={detail.screen_title} />
          {isDefect && (
            <ReportValue label="Date / Time of Error" value={formatDateTime(detail.date_time_of_error)} />
          )}
        </DetailGroup>

        <div className="dm-report-wide">
          <DetailGroup label="Details">
            <ReportValue label="Summary" value={detail.summary_of_issue} block />
            {isDefect && (
              <ReportValue
                label="Exact Details / What Happened"
                value={detail.what_happened_exact_details}
                block
              />
            )}
            {effectiveType === 'enhancement' && (
              <ReportValue label="Request Details" value={detail.request} block />
            )}
            {isDefect && (
              <ReportValue label="Steps to Reproduce" value={detail.steps_to_reproduce} block />
            )}
          </DetailGroup>
        </div>
      </div>
    </>
  );
}
