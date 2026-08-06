import { DetailGroup } from './DetailPane';
import { formatDateOnly, formatDateTime } from '../../../utils/formatUtils';
import { TRACKER_LABEL, TRACKER_LABEL_THE } from '../../../constants/tracker';
import { SUBMISSION_TYPE_REPORT } from '../../../constants/statusConstants';

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
      label: `Submitted to ${TRACKER_LABEL}`,
      note: `Raised as ${detail.easyvista_ticket_id}. Showing the current saved values —`
        + ' this ticket predates the capture of what was originally reported.',
    };
  }
  return {
    label: 'As reported',
    note: `Not yet sent to ${TRACKER_LABEL_THE}. Showing the current saved values.`,
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
  const isReportRequest = effectiveType === SUBMISSION_TYPE_REPORT;
  const { label, note } = reportSource(detail);

  // ── A report request, as it was asked for ────────────────────────────────
  // Its own tab layout, because the defect one asks questions it has no answers
  // to — a policy number, a screen, the time it happened — and answers none of
  // the questions an analyst actually opens it for. Until this, the requester's
  // eight fields were stored, exported and imported but shown NOWHERE in the
  // modal: the analyst could read the summary and nothing else.
  //
  // Read-only, like the rest of this tab: it is the record of what was asked.
  // What the analyst decides about it lives on Delivery.
  if (isReportRequest) {
    const isNew = detail.is_new_dashboard !== false;
    return (
      <>
        <div className="dm-ev-head">
          <h4>As requested</h4>
          <p>
            {isNew
              ? 'A new report or dashboard. Showing the request as it was filed.'
              : 'A change to a report they already use. Showing the request as it was filed.'}
          </p>
        </div>

        <div className="dm-report-grid">
          <DetailGroup label="What it is for">
            <ReportValue label="Application" value={detail.application_name} />
            <ReportValue label="Department" value={detail.department} />
            <ReportValue
              label="How often it will be used"
              value={detail.report_usage_frequency}
            />
            <ReportValue
              label="Wanted by"
              value={detail.desired_completion_date ? formatDateOnly(detail.desired_completion_date) : ''}
            />
          </DetailGroup>

          <DetailGroup label={isNew ? 'Who to ask' : 'Which report'}>
            {isNew ? (
              <ReportValue label="Primary contact" value={detail.primary_contact} />
            ) : (
              <ReportValue label="The report they use today" value={detail.existing_report_link} block />
            )}
            <ReportValue label="Requested by" value={detail.created_by} />
          </DetailGroup>

          <div className="dm-report-wide">
            <DetailGroup label="What they need">
              <ReportValue label="Summary" value={detail.summary_of_issue} block />
              <ReportValue
                label="Described in their words"
                value={detail.what_happened_exact_details}
                block
              />
              <ReportValue label="Data it needs" value={detail.needed_data} block />
              {isNew ? (
                <ReportValue
                  label="Measures, and where they come from"
                  value={detail.measures_and_sources}
                  block
                />
              ) : (
                <>
                  <ReportValue
                    label="What is not working, missing, or needs to change"
                    value={detail.request}
                    block
                  />
                  <ReportValue label="What should change" value={detail.changes_requested} block />
                </>
              )}
            </DetailGroup>
          </div>
        </div>
      </>
    );
  }

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
