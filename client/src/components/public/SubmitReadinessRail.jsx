/**
 * "Before you submit" rail.
 *
 * The old form only told a rep what was missing *after* they pressed Submit.
 * This ticks requirements off as they type, keeps the screenshot nudge next to
 * the button that needs it, and owns the primary action. On narrow screens the
 * page hides this copy of the button and shows the sticky bar instead.
 */
import { TRACKER_LABEL, TRACKER_LABEL_THE } from '../../constants/tracker';

/**
 * What happens after Submit — and it is not the same story for every type.
 *
 * A report request is worked by an analyst in the portal and never handed
 * downstream, so the Service Desk steps would be a promise the portal does not
 * keep. Steps 2 and 3 change; step 1 is true of everything.
 */
function nextSteps(type) {
  if (type === 'report') {
    return [
      ['Reported', 'Your request appears on the Status Board straight away with a reference number.'],
      ['Picked up', 'A reporting analyst on the team takes it and sizes the work.'],
      ['Delivered', 'You’ll see it marked complete on the board, with the date it was finished.'],
    ];
  }
  return [
    ['Reported', 'Your ticket appears on the Status Board straight away with a reference number.'],
    ['Triaged', 'The triage team reviews it and either approves it, links it to an existing ticket, or explains why not.'],
    [`Submitted to ${TRACKER_LABEL}`, `Approved items go to ${TRACKER_LABEL_THE} and get a ticket number you can track.`],
  ];
}

export function SubmitReadinessRail({
  requiredFields,
  values,
  showErrors,
  isDefect,
  type = 'defect',
  fileCount,
  saving,
}) {
  const outstanding = requiredFields.filter((field) => !String(values[field.key] ?? '').trim());

  return (
    <aside className="rs-rail">
      <div className="rs-railcard">
        <p className="rs-grouplabel">Before you submit</p>

        <ul className="rs-check">
          {requiredFields.map((field) => {
            const done = Boolean(String(values[field.key] ?? '').trim());
            const state = done ? 'on' : showErrors ? 'bad' : '';
            return (
              <li key={field.key} className={state}>
                <span className="rs-check-box" aria-hidden="true">✓</span>
                {field.label}
                <span className="rs-sr">{done ? ' — filled in' : ' — still needed'}</span>
              </li>
            );
          })}
        </ul>

        {(isDefect || fileCount > 0) && (
          <div className={`rs-nudge${fileCount > 0 ? ' rs-nudge--ok' : ''}`}>
            <span className="rs-nudge-glyph" aria-hidden="true">{fileCount > 0 ? '✓' : '📷'}</span>
            <b>
              {fileCount > 0
                ? `${fileCount} screenshot${fileCount === 1 ? '' : 's'} attached`
                : 'No screenshot yet'}
            </b>
            <span>
              {fileCount > 0
                ? 'That is the single biggest thing you can do to get this reproduced.'
                : 'Defects with a screenshot are far more likely to be reproduced and fixed.'}
            </span>
          </div>
        )}

        <button type="submit" className="rs-submit" disabled={saving}>
          {saving && <span className="rs-spin" aria-hidden="true" />}
          {saving ? 'Submitting…' : 'Submit request'}
        </button>
        <p className="rs-railnote">
          {outstanding.length === 0
            ? 'Everything required is filled in.'
            : 'You can press Submit with fields empty — we will point them out first.'}
        </p>
      </div>

      <div className="rs-railcard">
        <p className="rs-grouplabel">What happens next</p>
        <ol className="rs-steps">
          {nextSteps(type).map(([title, detail]) => (
            <li key={title}>
              <b>{title}</b>
              <span>{detail}</span>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
