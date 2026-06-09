import { Card, Input, Select, Textarea } from '../../bite-size/BitsizeUI';

/**
 * Impact Analysis + Frequency grids, the Impact Notes <details>, and the
 * Enhancement Admin Fields block.
 */
export function DetailImpactSection({
  edit,
  setEdit,
  effectiveType,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  dynamicOccurrenceTimeframes,
}) {
  return (
    <>
      <p className="section-label">Impact Analysis</p>
      <div className="bs-grid three" style={{ gap: 12 }}>
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
      <div className="bs-grid three" style={{ gap: 12 }}>
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
                <Input label="Desired Completion Date" type="date" value={edit.desired_completion_date} onChange={(e) => setEdit((p) => ({ ...p, desired_completion_date: e.target.value }))} />
              </div>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
