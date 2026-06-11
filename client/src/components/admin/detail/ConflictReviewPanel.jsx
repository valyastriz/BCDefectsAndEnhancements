import { useState } from 'react';
import { Button } from '../../bite-size/BitsizeUI';

// Human labels for the editable fields shown in a conflict diff. Anything not
// listed falls back to a humanized key, so new fields still render sensibly.
const FIELD_LABELS = {
  summary_of_issue: 'Summary',
  status: 'Defect/Enhancement Status',
  type: 'Type',
  is_cleanup: 'Cleanup',
  cleanup_status: 'Cleanup Status',
  cleanup_tag_type: 'Cleanup Tag Type',
  application_name: 'Application',
  policy_num: 'Policy #',
  account_num: 'Account #',
  transaction_num: 'Transaction #',
  screen_title: 'Screen Title',
  steps_to_reproduce: 'Steps to Reproduce',
  what_happened_exact_details: 'Exact Details / What Happened',
  request: 'Request Details',
  date_time_of_error: 'Date / Time of Error',
  desired_completion_date: 'Desired Completion Date',
  reviewer: 'Reviewer',
  decision_notes: 'Decision Notes',
  impact_details: 'Impact Details',
  impact_notes: 'Impact Notes',
  policy_premium_impact: 'Policy Premium Impact ($)',
  direct_dollar_impact: 'Direct Dollar Impact ($)',
  policies_affected_count: 'Policies Affected',
  occurrence_count: '# of Occurrences',
  occurrence_timeframe_count: 'Per How Many',
  occurrence_timeframe: 'Time Frame',
  enhancement_request_type: 'Request Type',
  priority_level: 'Priority Level',
  jira_number: 'JIRA Number',
  release_number: 'Release #',
  release_notes: 'Release Notes',
  logged_defect: 'In JIRA',
  duplicate_of: 'Duplicate Of',
  is_retired: 'Retired',
  is_public: 'Public',
};

function humanize(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined || value === '') return '(empty)';
  return String(value);
}

const norm = (value) => (value === null || value === undefined ? '' : String(value));
const differs = (a, b) => norm(a) !== norm(b);

/**
 * Field-by-field resolver shown when another admin saved while this modal was
 * open. Lists only fields where the user's draft differs from the now-current
 * server version, classifies each (your change / their change / both), and lets
 * the user take the current value or keep theirs.
 */
export function ConflictReviewPanel({ base, mine, current, onUseCurrent }) {
  const [resolved, setResolved] = useState({});

  if (!mine || !current) return null;

  const fields = Object.keys(mine).filter(
    (key) => differs(mine[key], current[key]) && !resolved[key],
  );

  if (fields.length === 0) {
    return (
      <div className="conflict-panel">
        <div className="conflict-panel-head">All overlapping changes reviewed — save to keep your version.</div>
      </div>
    );
  }

  return (
    <div className="conflict-panel">
      <div className="conflict-panel-head">
        Resolve the {fields.length} field{fields.length === 1 ? '' : 's'} that changed while you were editing:
      </div>
      {fields.map((key) => {
        const youChanged = base ? differs(mine[key], base[key]) : true;
        const theyChanged = base ? differs(current[key], base[key]) : true;
        const tag = youChanged && theyChanged ? 'Both changed' : youChanged ? 'Your change' : 'Their change';
        return (
          <div className="conflict-row" key={key}>
            <div className="conflict-field">
              {FIELD_LABELS[key] || humanize(key)}
              <span className="conflict-tag">{tag}</span>
            </div>
            <div className="conflict-value"><span className="conflict-value-lbl">Current:</span> {displayValue(current[key])}</div>
            <div className="conflict-value"><span className="conflict-value-lbl">Yours:</span> {displayValue(mine[key])}</div>
            <div className="conflict-actions">
              <Button
                kind="ghost"
                type="button"
                onClick={() => { onUseCurrent(key, current[key]); setResolved((r) => ({ ...r, [key]: true })); }}
              >
                Use current
              </Button>
              <Button
                kind="ghost"
                type="button"
                onClick={() => setResolved((r) => ({ ...r, [key]: true }))}
              >
                Keep mine
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
