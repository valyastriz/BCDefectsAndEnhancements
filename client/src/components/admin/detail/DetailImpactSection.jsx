import { Input, Select, Textarea } from '../../bite-size/BitsizeUI';
import { DetailGroup } from './DetailPane';
import { formatCurrency } from '../../../utils/formatUtils';
import { EASYVISTA_REQUIREMENT_FIELD } from '../../../constants/detailModalConstants';
import { SUBMISSION_TYPE_REPORT } from '../../../constants/statusConstants';

/** Renders the same "N per Timeframe" phrasing the queue table uses. */
function frequencyReadsAs(edit) {
  const count = Number(edit.occurrence_count);
  const per = Number(edit.occurrence_timeframe_count);
  if (!count || !edit.occurrence_timeframe) return '';
  const plural = per > 1;
  return `${count} per ${plural ? `${per} ` : ''}${edit.occurrence_timeframe}${plural ? 's' : ''}`;
}

/** Money hint under a dollar input, so the raw number reads as currency. */
function currencyHint(value) {
  const text = String(value ?? '').trim();
  if (!text || Number.isNaN(Number(text))) return null;
  return <span className="bs-field-hint">{formatCurrency(text)}</span>;
}

/**
 * Step 2 — one judgement, one section.
 *
 * This was previously split across a section label, an inline "Frequency"
 * heading, a collapsed Impact Notes block and a separate enhancement card — four
 * boundaries for a single decision. The duplicate JIRA Number that lived in the
 * enhancement card is gone; the one in Triage is the only one.
 */
export function DetailImpactSection({
  edit,
  setEdit,
  effectiveType,
  missingRequirements,
  dynamicEnhancementRequestTypes,
  dynamicPriorityLevels,
  dynamicOccurrenceTimeframes,
}) {
  const isEnhancement = effectiveType === 'enhancement';
  // A report request's impact is a sentence, not a figure. Policy premium, direct
  // dollars, policies affected and an occurrence rate are all defect/enhancement
  // measures — a dashboard that does not exist yet affects no policies and recurs
  // no number of times per month — so the tab keeps only the notes. Its SIZE lives
  // on the Delivery pane instead: level of effort and hours logged.
  const isReport = effectiveType === SUBMISSION_TYPE_REPORT;
  const readsAs = frequencyReadsAs(edit);
  const missingFields = new Set(
    (missingRequirements || []).map((label) => EASYVISTA_REQUIREMENT_FIELD[label]),
  );
  const requiredTag = (field) => (
    missingFields.has(field) ? <em className="dm-rotag dm-rotag--req">required</em> : null
  );

  if (isReport) {
    return (
      <Textarea
        label="Impact notes"
        rows={5}
        value={edit.impact_notes}
        placeholder="What this report is worth to the people asking for it — time saved, a decision it unblocks, a manual pull it replaces."
        onChange={(e) => setEdit((p) => ({ ...p, impact_notes: e.target.value }))}
      />
    );
  }

  return (
    <>
      <div className="dm-groups">
        <DetailGroup label="Dollar impact">
          <Input
            label="Policy Premium Impact"
            type="number"
            step="0.01"
            value={edit.policy_premium_impact}
            onChange={(e) => setEdit((p) => ({ ...p, policy_premium_impact: e.target.value }))}
          />
          {currencyHint(edit.policy_premium_impact)}
          <Input
            label="Direct Dollar Impact"
            type="number"
            step="0.01"
            value={edit.direct_dollar_impact}
            onChange={(e) => setEdit((p) => ({ ...p, direct_dollar_impact: e.target.value }))}
          />
          {currencyHint(edit.direct_dollar_impact)}
          <Input
            label="Policies Affected"
            type="number"
            step="1"
            min="0"
            value={edit.policies_affected_count}
            onChange={(e) => setEdit((p) => ({ ...p, policies_affected_count: e.target.value }))}
          />
        </DetailGroup>

        <DetailGroup label="Frequency">
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
          {readsAs && (
            <div className="bs-field">
              <span>Reads as<em className="dm-rotag">derived</em></span>
              <p className="dm-derived">{readsAs}</p>
            </div>
          )}
        </DetailGroup>

        {isEnhancement && (
          <DetailGroup label="Priority">
            <Select
              label="Request Type"
              required
              value={edit.enhancement_request_type}
              onChange={(e) => setEdit((p) => ({ ...p, enhancement_request_type: e.target.value }))}
            >
              <option value="">Select one</option>
              {dynamicEnhancementRequestTypes.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
            {requiredTag('enhancement_request_type')}
            <Select
              label="Priority Level"
              value={edit.priority_level}
              onChange={(e) => setEdit((p) => ({ ...p, priority_level: e.target.value }))}
            >
              {dynamicPriorityLevels.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
            <Input
              label="Desired Completion Date"
              type="date"
              value={edit.desired_completion_date}
              onChange={(e) => setEdit((p) => ({ ...p, desired_completion_date: e.target.value }))}
            />
            {requiredTag('desired_completion_date')}
          </DetailGroup>
        )}
      </div>

      {isEnhancement && (
        <>
          <Textarea
            label="Impact Details"
            required
            rows={4}
            value={edit.impact_details}
            onChange={(e) => setEdit((p) => ({ ...p, impact_details: e.target.value }))}
          />
          {requiredTag('impact_details')}
        </>
      )}

      <Textarea
        label="Impact Notes"
        rows={3}
        value={edit.impact_notes}
        placeholder="Anything the dollar figures do not capture."
        onChange={(e) => setEdit((p) => ({ ...p, impact_notes: e.target.value }))}
      />
    </>
  );
}
