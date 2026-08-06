import { Button, Modal, Notice } from '../bite-size/BitsizeUI';
import { ScreenshotDropZone } from '../public/ScreenshotDropZone';
import { formatCreatedViaLabel } from '../../utils/formatUtils';
import { addTicketStatusStops } from '../../utils/formDefaults';
import { TRACKER_LABEL, TRACKER_LABEL_THE } from '../../constants/tracker';
import { SUBMISSION_TYPE_REPORT, statusesForRequestType } from '../../constants/statusConstants';
import { USAGE_FREQUENCIES } from '../../constants/reportConstants';

// What each mode actually does, said once, above the form. The two are different
// acts — one files a ticket, the other records one that already happened — and an
// admin who picks the wrong one finds out at the bottom of the dialog otherwise.
const MODE_NOTES = {
  new: (
    <>
      Files it exactly as a reporter would: it lands at status <b>New</b>, appears on the
      Status Board under the usual visibility rules, and is ready to be triaged and sent to{' '}
      {TRACKER_LABEL_THE}. Recorded as <b>Admin Manual</b>.
    </>
  ),
  hist: (
    <>
      Records a ticket that already happened — its real reported date, the status it ended up
      at, and the {TRACKER_LABEL} number it was raised under. <b>Nothing is sent anywhere.</b>{' '}
      Recorded as <b>Backdated Button</b>.
    </>
  ),
};

const MODE_FOOTNOTES = {
  new: 'Goes to the queue at status New.',
  hist: `Written straight to the queue at the status you chose. Not sent to ${TRACKER_LABEL_THE}.`,
};

const TAG_NOTES = {
  cleanup_only: `Internal only — it stays in this portal, never goes to ${TRACKER_LABEL_THE}, and is not counted as a defect or an enhancement.`,
  defect: `Counts as a defect, so it can be handed to ${TRACKER_LABEL_THE} and asks for what a defect needs.`,
  enhancement: `Counts as an enhancement, so it can be handed to ${TRACKER_LABEL_THE} and asks for what an enhancement needs.`,
};

const MODE_SEGMENTS = [
  { value: 'new', label: 'New ticket' },
  { value: 'hist', label: 'Historical ticket' },
];

const TYPE_SEGMENTS = [
  { value: 'defect', label: 'Defect' },
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'cleanup', label: 'Cleanup' },
  // The fourth segment §2c was built to expect. It is a stored TYPE, not a tag,
  // so it is the only one of the four that changes what `type` the payload sends.
  { value: SUBMISSION_TYPE_REPORT, label: 'Report request' },
];

// A report request's own two shapes, the same choice the submit form opens with.
const REPORT_SEGMENTS = [
  { value: 'new', label: 'Something new' },
  { value: 'change', label: 'A change to one they already use' },
];

const TAG_SEGMENTS = [
  { value: 'cleanup_only', label: 'Internal only' },
  { value: 'defect', label: 'Defect' },
  { value: 'enhancement', label: 'Enhancement' },
];

/** A pill group. `aria-pressed` carries the state, so it needs no extra live region. */
function Segmented({ label, value, options, onPick, disabled }) {
  return (
    <div className="at-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One labelled control. `required` prints the asterisk, `optional` prints the word
 * — the artifact marks both rather than leaving the reader to infer one from the
 * absence of the other.
 */
function Field({ label, required = false, optional = false, hint, className = '', children }) {
  return (
    <label className={`at-f${className ? ` ${className}` : ''}`}>
      <span className="at-f-lbl">
        {label}
        {required && <em className="at-req" aria-hidden="true">*</em>}
        {optional && <span className="at-opt">optional</span>}
      </span>
      {children}
      {hint && <span className="at-hint">{hint}</span>}
    </label>
  );
}

/**
 * Add a ticket — one dialog for both a ticket being filed now and one that already
 * happened, across defect, enhancement and cleanup.
 *
 * Field visibility is CSS, driven by three data attributes on the body
 * (`data-mode`, `data-type`, `data-branch`), rather than a conditional per field:
 * a cleanup task tagged as a defect wants the defect branch's fields, so the rules
 * key off the computed branch instead of the type. See the `at-` block in
 * index.css. Fields belonging to the wrong mode are absent, not disabled — a
 * greyed-out "Deployed Date" still costs a line to scroll past.
 */
export function AddTicketModal({
  addTicketOpen,
  closeAddTicketModal,
  addTicketError,
  addTicketWorking,
  addTicketForm,
  setAddTicketForm,
  addTicketFiles,
  setAddTicketFiles,
  addTicketFileUrls,
  addTicketPreviewUrl,
  setAddTicketPreviewUrl,
  addTicketBranch,
  addTicketReportBranch,
  requiresHandoffFields,
  setAddTicketMode,
  setAddTicketType,
  setAddTicketTag,
  setAddTicketReportBranch,
  createAddTicket,
  // Meta options
  dynamicStatuses,
  dynamicCleanupStatuses,
  dynamicApplications,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  runtimeCreatedViaOptions,
}) {
  const { mode, type } = addTicketForm;
  const isCleanup = type === 'cleanup';
  const isReport = type === SUBMISSION_TYPE_REPORT;
  const branch = addTicketBranch;
  const reportBranch = addTicketReportBranch;
  const set = (key) => (event) => setAddTicketForm((prev) => ({ ...prev, [key]: event.target.value }));
  const setStop = (stop) => (event) => setAddTicketForm((prev) => ({
    ...prev,
    status_dates: { ...prev.status_dates, [stop]: event.target.value },
  }));

  const noun = isCleanup ? 'cleanup task' : (isReport ? 'report request' : 'ticket');
  const submitLabel = mode === 'new' ? `Add ${noun}` : `Add historical ${noun}`;
  const footNote = isCleanup && branch === 'none'
    ? 'Recorded as internal cleanup work. Never handed off.'
    : MODE_FOOTNOTES[mode];

  return (
    <Modal
      open={addTicketOpen}
      onClose={closeAddTicketModal}
      title="Add a ticket"
      className="at-modal"
      footer={(
        <div className="at-foot">
          <Button type="button" onClick={createAddTicket} disabled={addTicketWorking}>
            {addTicketWorking ? 'Adding…' : submitLabel}
          </Button>
          <Button type="button" kind="ghost" onClick={closeAddTicketModal} disabled={addTicketWorking}>
            Cancel
          </Button>
          <span className="at-foot-note">{footNote}</span>
        </div>
      )}
    >
      <div
        className="at-body"
        data-mode={mode}
        data-type={type}
        data-branch={branch}
        data-report={reportBranch}
      >
        <div className="at-modes">
          <Segmented
            label="What kind of ticket"
            value={mode}
            options={MODE_SEGMENTS}
            onPick={setAddTicketMode}
            disabled={addTicketWorking}
          />
          <p className="at-modenote">{MODE_NOTES[mode]}</p>
        </div>

        {addTicketError && <Notice text={addTicketError} />}

        <div className="at-sec">
          <p className="at-sec-lbl">The request</p>

          <div className="at-grouprow">
            <span className="at-f-lbl" style={{ margin: 0 }}>Type</span>
            <Segmented
              label="Defect, enhancement, cleanup or report request"
              value={type}
              options={TYPE_SEGMENTS}
              onPick={setAddTicketType}
              disabled={addTicketWorking}
            />
          </div>

          <div className="at-tagrow at-only-clean">
            <span>Tag it as</span>
            <Segmented
              label="What the cleanup task counts as"
              value={addTicketForm.cleanup_tag_type}
              options={TAG_SEGMENTS}
              onPick={setAddTicketTag}
              disabled={addTicketWorking}
            />
            <p className="at-tagnote">{TAG_NOTES[addTicketForm.cleanup_tag_type] || TAG_NOTES.cleanup_only}</p>
          </div>

          <Field label="Cleanup status" required className="at-only-clean">
            <select value={addTicketForm.cleanup_status} onChange={set('cleanup_status')}>
              <option value="">Select one</option>
              {dynamicCleanupStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </Field>

          <Field label="Summarize it in one line" required>
            <input
              type="text"
              placeholder="e.g. Renewal invoice shows the prior term’s installment amount"
              value={addTicketForm.summary_of_issue}
              onChange={set('summary_of_issue')}
            />
          </Field>

          <Field
            label="Description"
            required
            className="at-only-internal"
            hint="Internal-only cleanup is never handed off, so this is the whole record of it."
          >
            <textarea
              placeholder="What needs cleaning up, and why."
              value={addTicketForm.description}
              onChange={set('description')}
            />
          </Field>

          <div className="at-row at-row--2">
            <Field label="Reported by" required>
              <input
                type="text"
                placeholder="First and last name"
                value={addTicketForm.created_by}
                onChange={set('created_by')}
              />
            </Field>
            <Field label="Their email" optional>
              <input
                type="email"
                placeholder="name@grangeinsurance.com"
                value={addTicketForm.created_by_email}
                onChange={set('created_by_email')}
              />
            </Field>
          </div>

          <div className="at-row at-row--2">
            <Field label="Application" required>
              <select value={addTicketForm.application_name} onChange={set('application_name')}>
                <option value="">Select one</option>
                {dynamicApplications.map((application) => (
                  <option key={application} value={application}>{application}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Current status"
              required
              className="at-only-hist"
              hint="A new ticket always starts at New."
            >
              {/* Scoped to the chosen type: a historical report request ended at
                  one of its own nine words, never at Submitted or Deployed. */}
              <select value={addTicketForm.status} onChange={set('status')}>
                {statusesForRequestType(type, dynamicStatuses).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="at-row at-row--2 at-only-hist">
            <Field label="Reported date & time" required hint="When it was originally reported, not now.">
              <input
                type="datetime-local"
                value={addTicketForm.reported_at}
                onChange={set('reported_at')}
              />
            </Field>
            <Field label="Created via" optional>
              <select value={addTicketForm.created_via} onChange={set('created_via')}>
                {runtimeCreatedViaOptions.map((source) => (
                  <option key={source} value={source}>{formatCreatedViaLabel(source)}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="at-sec at-only-def">
          <p className="at-sec-lbl">Where it happened</p>
          <div className="at-row">
            <Field label="Screen title" required>
              <input
                type="text"
                placeholder="e.g. Invoice Details"
                value={addTicketForm.screen_title}
                onChange={set('screen_title')}
              />
            </Field>
            <Field label="Date it happened" required>
              <input type="date" value={addTicketForm.date_of_error} onChange={set('date_of_error')} />
            </Field>
            <Field label="Time" optional>
              <input type="time" value={addTicketForm.time_of_error} onChange={set('time_of_error')} />
            </Field>
          </div>
          <div className="at-row">
            <Field label="Policy number" optional>
              <input
                type="text"
                placeholder="e.g. 40-123456"
                value={addTicketForm.policy_num}
                onChange={set('policy_num')}
              />
            </Field>
            <Field label="Account number" optional>
              <input
                type="text"
                placeholder="e.g. 8004521"
                value={addTicketForm.account_num}
                onChange={set('account_num')}
              />
            </Field>
            <Field label="Transaction number" optional>
              <input
                type="text"
                placeholder="e.g. 90211884"
                value={addTicketForm.transaction_num}
                onChange={set('transaction_num')}
              />
            </Field>
          </div>
        </div>

        <div className="at-sec at-only-def">
          <p className="at-sec-lbl">What happened</p>
          <Field label="Exactly what they saw" required>
            <textarea
              placeholder="What was expected, what appeared instead, and any error message word-for-word."
              value={addTicketForm.what_happened_exact_details}
              onChange={set('what_happened_exact_details')}
            />
          </Field>
          <Field label="Steps to reproduce" optional>
            <textarea
              placeholder={'1. Open the account\n2. Click Invoices\n3. …'}
              value={addTicketForm.steps_to_reproduce}
              onChange={set('steps_to_reproduce')}
            />
          </Field>
        </div>

        <div className="at-sec at-only-enh">
          <p className="at-sec-lbl">What they are asking for</p>
          <Field label="Request details" required>
            <textarea
              placeholder="What should change, and why it matters."
              value={addTicketForm.request}
              onChange={set('request')}
            />
          </Field>
          {/* Not in the mockup, and it has to be: the hand-off is refused without
              it for an enhancement (server/src/services/submissionService.js:1508),
              so a dialog that never asks would offer a Send that always fails.
              Required only when the hand-off is actually ticked. */}
          <Field
            label="Impact details"
            required={requiresHandoffFields}
            optional={!requiresHandoffFields}
            hint={requiresHandoffFields
              ? `Required because this is being sent to ${TRACKER_LABEL_THE}.`
              : undefined}
          >
            <textarea
              placeholder="Who it affects and what it costs them today."
              value={addTicketForm.impact_details}
              onChange={set('impact_details')}
            />
          </Field>
          <div className="at-row at-row--2">
            <Field label="Request type" required>
              <select value={addTicketForm.enhancement_request_type} onChange={set('enhancement_request_type')}>
                <option value="">Select one</option>
                {dynamicEnhancementRequestTypes.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </Field>
            <Field label="Desired completion date" optional>
              <input
                type="date"
                value={addTicketForm.desired_completion_date}
                onChange={set('desired_completion_date')}
              />
            </Field>
          </div>
          <Field label="Priority" optional>
            <select value={addTicketForm.priority_level} onChange={set('priority_level')}>
              <option value="">Select one</option>
              {dynamicPriorityLevels.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* ── The report-request branch ─────────────────────────────────────
            Mirrors the submit form's own report card, field for field and in the
            same order, so an admin typing one up on somebody's behalf is filling
            in the form the requester would have. Its two sub-branches gate on
            `data-report`, the way the cleanup tag gates on `data-branch`. */}
        <div className="at-sec at-only-report">
          <p className="at-sec-lbl">What they need</p>

          <div className="at-tagrow">
            <span>Is this</span>
            <Segmented
              label="Something new, or a change to a report they already use"
              value={reportBranch}
              options={REPORT_SEGMENTS}
              onPick={setAddTicketReportBranch}
              disabled={addTicketWorking}
            />
          </div>

          {/* Identity first on a change: you cannot usefully describe what should
              happen to a report before saying which one it is. */}
          <Field
            label="Which report is it?"
            required
            className="at-report-change"
            hint="A link to it, or where they open it from — a share drive, a menu item."
          >
            <input
              type="text"
              placeholder="https://… or where they open it from"
              value={addTicketForm.existing_report_link}
              onChange={set('existing_report_link')}
            />
          </Field>

          <Field label="Describe what they need" required>
            <textarea
              placeholder="What it should show, who will read it, and what decision it helps them make."
              value={addTicketForm.what_happened_exact_details}
              onChange={set('what_happened_exact_details')}
            />
          </Field>

          <Field label="What data does it need?" optional>
            <textarea
              placeholder="Fields, systems, date ranges — anything known about what it has to pull from."
              value={addTicketForm.needed_data}
              onChange={set('needed_data')}
            />
          </Field>

          <div className="at-report-new">
            <Field
              label="Measures, and where they come from"
              required
              hint="The numbers it should calculate, and where each one comes from today."
            >
              <textarea
                placeholder={'e.g. Unapplied cash total — from the nightly billing extract'}
                value={addTicketForm.measures_and_sources}
                onChange={set('measures_and_sources')}
              />
            </Field>
            <Field label="Who owns the questions about it?" optional hint="Blank means the requester.">
              <input
                type="text"
                placeholder="Name and email"
                value={addTicketForm.primary_contact}
                onChange={set('primary_contact')}
              />
            </Field>
          </div>

          <div className="at-report-change">
            <Field label="What’s not working, missing, or needed to change?" optional>
              <textarea
                placeholder="What it gives them today, and where that falls short."
                value={addTicketForm.request}
                onChange={set('request')}
              />
            </Field>
            <Field label="What should change?" required>
              <textarea
                placeholder="A new column, a different filter, a number that reads wrong."
                value={addTicketForm.changes_requested}
                onChange={set('changes_requested')}
              />
            </Field>
          </div>

          <div className="at-row at-row--2">
            <Field label="How often will it be used?" optional>
              <select value={addTicketForm.report_usage_frequency} onChange={set('report_usage_frequency')}>
                <option value="">Not stated</option>
                {USAGE_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>{frequency}</option>
                ))}
              </select>
            </Field>
            <Field label="Which department is it for?" optional>
              <input
                type="text"
                placeholder="e.g. Claims Operations"
                value={addTicketForm.department}
                onChange={set('department')}
              />
            </Field>
          </div>

          <Field label="When do they need it by?" optional>
            <input
              type="date"
              value={addTicketForm.desired_completion_date}
              onChange={set('desired_completion_date')}
            />
          </Field>
        </div>

        <div className="at-sec at-only-hist">
          <p className="at-sec-lbl">
            Where it already went <span className="at-sec-tag">historical only</span>
          </p>
          <div className="at-row at-row--2">
            <Field label={`${TRACKER_LABEL} ticket`} optional>
              <input
                type="text"
                placeholder="EV-51067"
                value={addTicketForm.easyvista_ticket_id}
                onChange={set('easyvista_ticket_id')}
              />
            </Field>
            <Field label={`Submitted to ${TRACKER_LABEL} by`} optional>
              <input
                type="text"
                placeholder="Defaults to Unknown"
                value={addTicketForm.easyvista_submitted_by}
                onChange={set('easyvista_submitted_by')}
              />
            </Field>
          </div>
          <div className="at-row at-row--2">
            <Field label="JIRA number" optional>
              <input
                type="text"
                placeholder="JIRA-123"
                value={addTicketForm.jira_number}
                onChange={set('jira_number')}
              />
            </Field>
            <Field label="Release number" optional>
              <input
                type="text"
                placeholder="v1.0.0"
                value={addTicketForm.release_number}
                onChange={set('release_number')}
              />
            </Field>
          </div>
        </div>

        <details className="at-fold at-only-hist">
          <summary>
            Status timeline <span>the dates it reached each status</span>
          </summary>
          <div className="at-fold-body">
            <p className="at-hint" style={{ margin: 0 }}>
              Only fill in the stops it actually reached. Anything left blank is simply not recorded.
            </p>
            <div className="at-row at-row--2">
              {addTicketStatusStops(type).map((stop) => (
                <Field key={stop} label={stop} optional>
                  <input
                    type="datetime-local"
                    value={addTicketForm.status_dates[stop] || ''}
                    onChange={setStop(stop)}
                  />
                </Field>
              ))}
            </div>
          </div>
        </details>

        <label className="at-flag at-only-clean at-only-tagged">
          <input
            type="checkbox"
            checked={Boolean(addTicketForm.submit_to_easyvista)}
            onChange={(event) => setAddTicketForm((prev) => ({
              ...prev,
              submit_to_easyvista: event.target.checked,
            }))}
          />
          <span>
            <b>Send it to {TRACKER_LABEL_THE} once it’s created</b>
            <span>
              A tagged cleanup task can be handed off like any other ticket. Tick this and every
              field {TRACKER_LABEL_THE} requires for{' '}
              {branch === 'enhancement' ? 'an enhancement' : 'a defect'} becomes mandatory before
              you can save.
            </span>
          </span>
        </label>

        {/* Not in the mockup, and it has to be: the cleanup dialog this replaced
            could attach screenshots, and losing that would make an admin file the
            ticket and then reopen it to add the evidence. The rep form's own drop
            zone is reused rather than rebuilt — drag, browse and paste, images
            only, matching what the upload endpoint actually accepts
            (server/src/middleware/upload.js). The old dialog offered it for
            tagged cleanups only and advertised PDFs and spreadsheets the server
            would have refused; this offers it for every type and tells the truth
            about what it takes. */}
        <div className="at-sec">
          <p className="at-sec-lbl">
            Screenshots
            <span className="at-sec-tag">
              {branch === 'defect' ? 'strongly encouraged' : 'optional'}
            </span>
          </p>
          <ScreenshotDropZone
            files={addTicketFiles}
            fileUrls={addTicketFileUrls}
            onFilesChange={setAddTicketFiles}
            onPreview={setAddTicketPreviewUrl}
          />
        </div>

        {/* Dollar impact and policies affected are defect/enhancement figures.
            A report request is sized by level of effort and hours, which the
            analyst records on its Delivery pane — so the fold is absent rather
            than offering fields nobody would fill in. */}
        <details className="at-fold at-not-report">
          <summary>
            Impact <span>figures the triage team would otherwise add later</span>
          </summary>
          <div className="at-fold-body">
            <Field label="Impact notes" optional>
              <textarea rows={3} value={addTicketForm.impact_notes} onChange={set('impact_notes')} />
            </Field>
            <div className="at-row">
              <Field label="Policy premium impact ($)" optional>
                <input
                  type="number"
                  step="0.01"
                  value={addTicketForm.policy_premium_impact}
                  onChange={set('policy_premium_impact')}
                />
              </Field>
              <Field label="Direct dollar impact ($)" optional>
                <input
                  type="number"
                  step="0.01"
                  value={addTicketForm.direct_dollar_impact}
                  onChange={set('direct_dollar_impact')}
                />
              </Field>
              <Field label="Policies affected" optional>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={addTicketForm.policies_affected_count}
                  onChange={set('policies_affected_count')}
                />
              </Field>
            </div>
          </div>
        </details>
      </div>

      {/* Stacked over this dialog. Escape closes the topmost modal only, so it
          does not take the half-filled ticket with it (BitsizeUI's
          openModalStack). */}
      <Modal
        open={Boolean(addTicketPreviewUrl)}
        onClose={() => setAddTicketPreviewUrl(null)}
        title="Image Preview"
      >
        {addTicketPreviewUrl && (
          <img className="bs-preview-image" src={addTicketPreviewUrl} alt="Preview" />
        )}
      </Modal>
    </Modal>
  );
}
