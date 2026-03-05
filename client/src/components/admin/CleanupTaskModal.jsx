import {
  Button,
  Card,
  Input,
  Modal,
  Notice,
  Select,
  Textarea,
} from '../bite-size/BitsizeUI';
import { formatMetaTypeLabel, formatCreatedViaLabel } from '../../utils/formatUtils';

/**
 * Modal for creating a new cleanup task.
 */
export function CleanupTaskModal({
  cleanupOpen,
  closeCleanupModal,
  cleanupError,
  cleanupWorking,
  cleanupForm,
  setCleanupForm,
  cleanupFiles,
  setCleanupFiles,
  cleanupPreviewIndex,
  setCleanupPreviewIndex,
  cleanupFileInputRef,
  cleanupRequiresEasyVistaFields,
  cleanupFilePreviews,
  createCleanupTask,
  // Meta options
  dynamicCleanupStatuses,
  dynamicCleanupTagTypes,
  dynamicApplications,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  runtimeCreatedViaOptions,
}) {
  return (
    <Modal
      open={cleanupOpen}
      onClose={closeCleanupModal}
      title="Add Cleanup Task"
    >
      <div className="stack">
        <p className="muted" style={{ marginTop: 0 }}>
          Cleanup tasks are internal by default. Tag as Defect or Enhancement only if it should be EasyVista-eligible.
        </p>

        <div className="bs-grid two">
          <Input label="Type" value="Clean Up" readOnly />
          <Select
            label="Status"
            value={cleanupForm.cleanup_status}
            onChange={(e) => setCleanupForm((prev) => ({ ...prev, cleanup_status: e.target.value }))}
          >
            {dynamicCleanupStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </Select>

          <Select
            label="Tag as (optional)"
            value={cleanupForm.cleanup_tag_type}
            onChange={(e) =>
              setCleanupForm((prev) => ({
                ...prev,
                cleanup_tag_type: e.target.value,
                submit_to_easyvista:
                  e.target.value === 'defect' || e.target.value === 'enhancement'
                    ? prev.submit_to_easyvista
                    : false,
                desired_completion_date:
                  e.target.value === 'enhancement' ? prev.desired_completion_date : '',
                impact_details: e.target.value === 'enhancement' ? prev.impact_details : '',
                enhancement_request_type:
                  e.target.value === 'enhancement' ? prev.enhancement_request_type : '',
                priority_level:
                  e.target.value === 'enhancement' ? (prev.priority_level || '3 - Medium') : '3 - Medium',
                date_time_of_error: e.target.value === 'defect' ? prev.date_time_of_error : '',
                date_of_error: e.target.value === 'defect' ? prev.date_of_error : '',
                time_of_error: e.target.value === 'defect' ? prev.time_of_error : '',
                screen_title: e.target.value === 'defect' ? prev.screen_title : '',
                policy_num: e.target.value === 'defect' ? prev.policy_num : '',
                account_num: e.target.value === 'defect' ? prev.account_num : '',
                transaction_num: e.target.value === 'defect' ? prev.transaction_num : '',
                steps_to_reproduce: e.target.value === 'defect' ? prev.steps_to_reproduce : '',
                what_happened_exact_details:
                  e.target.value === 'defect' ? prev.what_happened_exact_details : '',
                request: e.target.value === 'enhancement' ? prev.request : '',
              }))
            }
          >
            {dynamicCleanupTagTypes.map((option) => (
              <option key={option} value={option}>{formatMetaTypeLabel(option)}</option>
            ))}
          </Select>

          <Input
            label="Requester Name"
            value={cleanupForm.created_by}
            onChange={(e) => setCleanupForm((prev) => ({ ...prev, created_by: e.target.value }))}
          />

          <Select
            label="Created Via"
            value={cleanupForm.created_via}
            onChange={(e) => setCleanupForm((prev) => ({ ...prev, created_via: e.target.value }))}
          >
            {runtimeCreatedViaOptions.map((sourceOption) => (
              <option key={sourceOption} value={sourceOption}>{formatCreatedViaLabel(sourceOption)}</option>
            ))}
          </Select>

          <Select
            label="Application"
            value={cleanupForm.application_name}
            onChange={(e) => setCleanupForm((prev) => ({ ...prev, application_name: e.target.value }))}
          >
            {dynamicApplications.map((application) => (
              <option key={application} value={application}>{application}</option>
            ))}
          </Select>

          {cleanupForm.cleanup_tag_type === 'defect' && (
            <>
              <Input
                label="Date of Error"
                type="date"
                required={cleanupRequiresEasyVistaFields}
                value={cleanupForm.date_of_error}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, date_of_error: e.target.value }))}
              />

              <Input
                label="Time of Error (optional)"
                type="time"
                value={cleanupForm.time_of_error}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, time_of_error: e.target.value }))}
              />

              <Input
                label="Screen Title"
                required={cleanupRequiresEasyVistaFields}
                value={cleanupForm.screen_title}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, screen_title: e.target.value }))}
              />
              <Input
                label="Policy #"
                value={cleanupForm.policy_num}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, policy_num: e.target.value }))}
              />
              <Input
                label="Account #"
                value={cleanupForm.account_num}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, account_num: e.target.value }))}
              />
              <Input
                label="Transaction #"
                value={cleanupForm.transaction_num}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, transaction_num: e.target.value }))}
              />
            </>
          )}

          {cleanupForm.cleanup_tag_type === 'enhancement' && (
            <>
              <Input
                label="Desired Completion Date"
                type="date"
                required={cleanupRequiresEasyVistaFields}
                value={cleanupForm.desired_completion_date}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, desired_completion_date: e.target.value }))}
              />
              <Input label="Application Name" value="Billing Center" readOnly />
              <Select
                label="Request Type"
                value={cleanupForm.enhancement_request_type}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, enhancement_request_type: e.target.value }))}
              >
                <option value="">Select one</option>
                {dynamicEnhancementRequestTypes.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
              <Select
                label="Priority Level"
                value={cleanupForm.priority_level}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, priority_level: e.target.value }))}
              >
                {dynamicPriorityLevels.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </>
          )}
        </div>

        <Input
          label={cleanupForm.cleanup_tag_type === 'defect' ? 'Summary of Issue' : 'Summary'}
          required
          value={cleanupForm.summary_of_issue}
          onChange={(e) => setCleanupForm((prev) => ({ ...prev, summary_of_issue: e.target.value }))}
        />

        {cleanupForm.cleanup_tag_type === 'cleanup_only' && (
          <Textarea
            label="Description"
            required
            rows={4}
            value={cleanupForm.description}
            onChange={(e) => setCleanupForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        )}

        {cleanupForm.cleanup_tag_type && (
          <>
            <p className="section-label">Impact Tracking</p>
            <Textarea
              label="Impact Notes"
              rows={3}
              value={cleanupForm.impact_notes}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, impact_notes: e.target.value }))}
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
                value={cleanupForm.policy_premium_impact}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, policy_premium_impact: e.target.value }))}
              />
              <Input
                label="Direct Dollar Impact ($)"
                type="number"
                step="0.01"
                value={cleanupForm.direct_dollar_impact}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, direct_dollar_impact: e.target.value }))}
              />
              <Input
                label="Policies Affected Count"
                type="number"
                step="1"
                min="0"
                value={cleanupForm.policies_affected_count}
                onChange={(e) => setCleanupForm((prev) => ({ ...prev, policies_affected_count: e.target.value }))}
              />
            </div>
          </>
        )}

        {cleanupForm.cleanup_tag_type === 'defect' && (
          <>
            <Textarea
              label="Steps to Reproduce"
              rows={3}
              value={cleanupForm.steps_to_reproduce}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, steps_to_reproduce: e.target.value }))}
            />
            <Textarea
              label="What Happened? (Exact Details)"
              required={cleanupRequiresEasyVistaFields}
              rows={4}
              value={cleanupForm.what_happened_exact_details}
              onChange={(e) =>
                setCleanupForm((prev) => ({ ...prev, what_happened_exact_details: e.target.value }))
              }
            />
          </>
        )}

        {cleanupForm.cleanup_tag_type === 'enhancement' && (
          <>
            <Textarea
              label="Request Details"
              required={cleanupRequiresEasyVistaFields}
              rows={4}
              value={cleanupForm.request}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, request: e.target.value }))}
            />
            <Textarea
              label="Impact Details"
              required={cleanupRequiresEasyVistaFields}
              rows={4}
              value={cleanupForm.impact_details}
              onChange={(e) => setCleanupForm((prev) => ({ ...prev, impact_details: e.target.value }))}
            />
          </>
        )}

        {(cleanupForm.cleanup_tag_type === 'defect' || cleanupForm.cleanup_tag_type === 'enhancement') && (
          <label className="bs-field">
            <span>
              {cleanupForm.cleanup_tag_type === 'defect'
                ? (
                  cleanupRequiresEasyVistaFields
                    ? 'Screenshots (required for EasyVista Defect submission)'
                    : 'Screenshots (optional unless submitting to EasyVista)'
                )
                : 'Supporting files (optional)'}
            </span>
            <input
              ref={cleanupFileInputRef}
              type="file"
              accept={cleanupForm.cleanup_tag_type === 'enhancement' ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                setCleanupFiles((prev) => {
                  const merged = [...prev];
                  for (const nextFile of selected) {
                    const exists = merged.some(
                      (existing) =>
                        existing.name === nextFile.name
                        && existing.size === nextFile.size
                        && existing.lastModified === nextFile.lastModified,
                    );
                    if (!exists) merged.push(nextFile);
                  }
                  return merged.slice(0, 3);
                });
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              kind="secondary"
              style={{ width: 'auto', alignSelf: 'flex-start' }}
              onClick={() => cleanupFileInputRef.current?.click()}
            >
              Choose files
            </Button>
            <span className="muted" style={{ fontSize: '12px' }}>
              {cleanupFiles.length}/3 selected
            </span>
          </label>
        )}

        {cleanupFilePreviews.length > 0 && (
          <div className="thumb-grid">
            {cleanupFilePreviews.map((preview, index) => (
              <article key={`${preview.file.name}-${preview.file.size}-${index}`} className="thumb-item">
                <button
                  type="button"
                  className="thumb-open-btn"
                  onClick={() => setCleanupPreviewIndex(index)}
                >
                  <img src={preview.url} alt={preview.file.name} />
                </button>
                <div className="thumb-meta">
                  <span className="thumb-name">{preview.file.name}</span>
                  <Button
                    type="button"
                    kind="danger"
                    onClick={() => {
                      setCleanupFiles((prev) => prev.filter((_, i) => i !== index));
                      setCleanupPreviewIndex((current) => {
                        if (current === null) return current;
                        if (current === index) return null;
                        return current > index ? current - 1 : current;
                      });
                    }}
                    disabled={cleanupWorking}
                  >
                    Remove
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        {(cleanupForm.cleanup_tag_type === 'defect' || cleanupForm.cleanup_tag_type === 'enhancement') && (
          <>
            <label className="toggle-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(cleanupForm.submit_to_easyvista)}
                onChange={(e) =>
                  setCleanupForm((prev) => ({
                    ...prev,
                    submit_to_easyvista: e.target.checked,
                  }))
                }
              />
              <span>Submit to EasyVista after create</span>
            </label>
            <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>
              When checked, all required fields for the selected Defect/Enhancement form must be completed before submit.
            </p>
          </>
        )}

        {cleanupError && <Notice text={cleanupError} />}

        <div className="bs-actions">
          <Button type="button" onClick={createCleanupTask} disabled={cleanupWorking}>Save Changes</Button>
          <Button
            kind="ghost"
            type="button"
            onClick={closeCleanupModal}
            disabled={cleanupWorking}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
