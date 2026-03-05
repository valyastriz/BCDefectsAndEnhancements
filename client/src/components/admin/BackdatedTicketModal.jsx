import { Button, Input, Modal, Notice, Select, Textarea } from '../bite-size/BitsizeUI';
import { formatCreatedViaLabel } from '../../utils/formatUtils';

/**
 * Modal for creating a backdated (historical) ticket.
 */
export function BackdatedTicketModal({
  backdatedOpen,
  closeBackdatedModal,
  backdatedError,
  backdatedWorking,
  backdatedForm,
  setBackdatedForm,
  createBackdatedTicket,
  // Meta options
  dynamicStatuses,
  dynamicApplications,
  runtimeCreatedViaOptions,
}) {
  return (
    <Modal
      open={backdatedOpen}
      onClose={closeBackdatedModal}
      title="Add Backdated Ticket"
    >
      <div className="stack">
        <p className="muted" style={{ marginTop: 0 }}>
          Creates a historical ticket directly in Admin. This does not submit to EasyVista API.
        </p>

        <div className="bs-grid two">
          <Select
            label="Type"
            value={backdatedForm.type}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="defect">Defect</option>
            <option value="enhancement">Enhancement</option>
          </Select>

          <Select
            label="Current Status"
            value={backdatedForm.status}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, status: e.target.value }))}
          >
            {dynamicStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </Select>

          <Input
            label="Requester Name"
            required
            value={backdatedForm.created_by}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_by: e.target.value }))}
          />

          <Select
            label="Created Via"
            value={backdatedForm.created_via}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_via: e.target.value }))}
          >
            {runtimeCreatedViaOptions.map((sourceOption) => (
              <option key={sourceOption} value={sourceOption}>{formatCreatedViaLabel(sourceOption)}</option>
            ))}
          </Select>

          <Input
            label="Requester Email"
            value={backdatedForm.created_by_email}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, created_by_email: e.target.value }))}
          />

          <Select
            label="Application"
            value={backdatedForm.application_name}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, application_name: e.target.value }))}
          >
            {dynamicApplications.map((application) => (
              <option key={application} value={application}>{application}</option>
            ))}
          </Select>

          <Input
            label="Reported Date / Time"
            type="datetime-local"
            value={backdatedForm.reported_at}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, reported_at: e.target.value }))}
          />

          {backdatedForm.type === 'enhancement' && (
            <Input
              label="Desired Completion Date"
              type="date"
              value={backdatedForm.desired_completion_date}
              onChange={(e) => setBackdatedForm((prev) => ({ ...prev, desired_completion_date: e.target.value }))}
            />
          )}

          <Input
            label="JIRA Number"
            placeholder="JIRA-123"
            value={backdatedForm.jira_number}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, jira_number: e.target.value }))}
          />

          <Input
            label="Release #"
            placeholder="v1.0.0"
            value={backdatedForm.release_number}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, release_number: e.target.value }))}
          />
        </div>

        <Input
          label="Summary of Issue"
          required
          value={backdatedForm.summary_of_issue}
          onChange={(e) => setBackdatedForm((prev) => ({ ...prev, summary_of_issue: e.target.value }))}
        />

        <Input
          label="Screen Title"
          value={backdatedForm.screen_title}
          onChange={(e) => setBackdatedForm((prev) => ({ ...prev, screen_title: e.target.value }))}
        />

        <Textarea
          label="Request Details"
          rows={3}
          value={backdatedForm.request}
          onChange={(e) => setBackdatedForm((prev) => ({ ...prev, request: e.target.value }))}
        />

        <p className="section-label">Impact Tracking</p>
        <Textarea
          label="Impact Notes"
          rows={3}
          value={backdatedForm.impact_notes}
          onChange={(e) => setBackdatedForm((prev) => ({ ...prev, impact_notes: e.target.value }))}
        />
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
            value={backdatedForm.policy_premium_impact}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, policy_premium_impact: e.target.value }))}
          />
          <Input
            label="Direct Dollar Impact ($)"
            type="number"
            step="0.01"
            value={backdatedForm.direct_dollar_impact}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, direct_dollar_impact: e.target.value }))}
          />
          <Input
            label="Policies Affected Count"
            type="number"
            step="1"
            min="0"
            value={backdatedForm.policies_affected_count}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, policies_affected_count: e.target.value }))}
          />
        </div>

        <div className="bs-grid two">
          <Input
            label="EasyVista Ticket ID"
            placeholder="EV-123456"
            value={backdatedForm.easyvista_ticket_id}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, easyvista_ticket_id: e.target.value }))}
          />
          <Input
            label="Submitted to EV By"
            placeholder="Defaults to Unknown"
            value={backdatedForm.easyvista_submitted_by}
            onChange={(e) => setBackdatedForm((prev) => ({ ...prev, easyvista_submitted_by: e.target.value }))}
          />
          <Input
            label="Submitted Date"
            type="datetime-local"
            value={backdatedForm.status_dates.Submitted}
            onChange={(e) =>
              setBackdatedForm((prev) => ({
                ...prev,
                status_dates: { ...prev.status_dates, Submitted: e.target.value },
              }))
            }
          />
          <Input
            label="Deployed Date"
            type="datetime-local"
            value={backdatedForm.status_dates.Deployed}
            onChange={(e) =>
              setBackdatedForm((prev) => ({
                ...prev,
                status_dates: { ...prev.status_dates, Deployed: e.target.value },
              }))
            }
          />
        </div>

        <p className="section-label">Optional status dates (historical timeline)</p>
        <div className="bs-grid two">
          {['Approved', 'Rejected', 'Duplicate', 'Retired'].map((statusKey) => (
            <Input
              key={statusKey}
              label={`${statusKey} Date`}
              type="datetime-local"
              value={backdatedForm.status_dates[statusKey]}
              onChange={(e) =>
                setBackdatedForm((prev) => ({
                  ...prev,
                  status_dates: { ...prev.status_dates, [statusKey]: e.target.value },
                }))
              }
            />
          ))}
        </div>

        {backdatedError && <Notice text={backdatedError} />}

        <div className="bs-actions">
          <Button type="button" onClick={createBackdatedTicket} disabled={backdatedWorking}>Create Backdated Ticket</Button>
          <Button
            kind="ghost"
            type="button"
            onClick={closeBackdatedModal}
            disabled={backdatedWorking}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
