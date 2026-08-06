import { useState } from 'react';
import { Input, Textarea } from '../../bite-size/BitsizeUI';
import { DetailGroup, DetailReadOnly } from './DetailPane';
import { TRACKER_LABEL } from '../../../constants/tracker';
import { SUBMISSION_TYPE_REPORT } from '../../../constants/statusConstants';
import {
  formatCreatedViaLabel,
  isAutoEasyVistaReporter,
} from '../../../utils/formatUtils';

/**
 * The downstream ticket number — read-only until deliberately unlocked.
 *
 * IT HAS TO BE EDITABLE. An application that is not wired up to this portal has
 * no catalog, so a real send is refused; the admin raises the ticket by hand on
 * the Service Desk site and there was then nowhere to put the number it came
 * back with. The ticket carried the work and not the reference to it.
 *
 * IT ALSO HAS TO BE HARD TO CHANGE BY ACCIDENT. For every ticket the portal DID
 * send, this number is the server's own record of the hand-off, and a stray
 * keystroke in a field sitting open on a busy tab would break the link to the
 * real ticket silently — nothing downstream would notice, and nobody would know
 * which number used to be there. So: read-only by default, one deliberate click
 * to open, and the original stays on screen while editing so a mistake is
 * visible and revertible without a reload.
 */
function LockedTicketNumber({ label, value, original, onChange }) {
  const [unlocked, setUnlocked] = useState(false);
  const changed = String(value ?? '') !== String(original ?? '');

  if (!unlocked) {
    return (
      <div className="dm-locked">
        <DetailReadOnly label={label} value={value} mono />
        <button
          type="button"
          className="dm-act dm-act--quiet dm-locked-btn"
          onClick={() => setUnlocked(true)}
        >
          Unlock to edit
        </button>
      </div>
    );
  }

  return (
    <div className="dm-locked dm-locked--open">
      <Input
        label={label}
        value={value ?? ''}
        autoFocus
        className="dm-mono"
        placeholder="The number the Service Desk gave it"
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="dm-locked-foot">
        {changed ? (
          <>
            <span className="dm-locked-was">{original ? `Was ${original}` : 'Was empty'}</span>
            <button
              type="button"
              className="dm-act dm-act--quiet"
              onClick={() => onChange(original ?? '')}
            >
              Undo
            </button>
          </>
        ) : (
          <span className="dm-locked-was">Unlocked — this is the link to the real ticket.</span>
        )}
        <button
          type="button"
          className="dm-act dm-act--quiet"
          onClick={() => setUnlocked(false)}
        >
          Lock
        </button>
      </div>
    </div>
  );
}

/**
 * Provenance, external identifiers and release metadata — the second block of
 * the History & reference tab. Consulted occasionally, edited almost never.
 *
 * The "As Submitted To EasyVista" payload used to live here as a hand-written
 * copy of the server's description format. It now lives on the EasyVista tab,
 * built by the server, so there is only one copy of that format in the codebase.
 */
export function DetailReferenceSection({ detail, edit, setEdit }) {
  const isReport = String(edit.type || '').trim().toLowerCase() === SUBMISSION_TYPE_REPORT;
  return (
    <div className="dm-groups">
      <DetailGroup label="Provenance">
        <DetailReadOnly
          label="Created Via"
          value={formatCreatedViaLabel(edit.created_via || detail.created_via || '')}
        />
        {isAutoEasyVistaReporter(edit.easyvista_submitted_by) ? (
          <DetailReadOnly label="Submitted to EV By" value={edit.easyvista_submitted_by} />
        ) : (
          <Input
            label={`Submitted to ${TRACKER_LABEL} By`}
            value={edit.easyvista_submitted_by}
            placeholder="Unknown"
            onChange={(e) => setEdit((p) => ({ ...p, easyvista_submitted_by: e.target.value }))}
          />
        )}
        <DetailReadOnly label="Requester" value={detail.created_by} />
        <DetailReadOnly label="Fingerprint" value={edit.fingerprint} mono />
      </DetailGroup>

      <DetailGroup label="External IDs">
        <LockedTicketNumber
          label={`${TRACKER_LABEL} Ticket`}
          value={edit.easyvista_ticket_id}
          original={detail.easyvista_ticket_id}
          onChange={(next) => setEdit((p) => ({ ...p, easyvista_ticket_id: next }))}
        />
        <Input
          label="Duplicate Reference"
          value={edit.duplicate_of}
          placeholder={`${TRACKER_LABEL} / JIRA / ID`}
          onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))}
        />
        <p className="bs-field-hint">A {TRACKER_LABEL} ID, a JIRA key, or a submission ID.</p>
      </DetailGroup>

      {/* NOT ON A REPORT REQUEST. Nothing ships: it is built in the portal and
          handed to the person who asked, so there is no release to number and no
          release to note. The equivalent question — what was actually delivered —
          is answered by Delivery notes on the Delivery tab. The columns stay and
          keep whatever they hold; only the control goes. */}
      {!isReport && (
        <DetailGroup label="Release">
          <Input
            label="Release #"
            placeholder="e.g. v1.2.0"
            value={edit.release_number}
            onChange={(e) => setEdit((p) => ({ ...p, release_number: e.target.value }))}
          />
          <Textarea
            label="Release Notes"
            rows={3}
            value={edit.release_notes}
            placeholder="What shipped, and when."
            onChange={(e) => setEdit((p) => ({ ...p, release_notes: e.target.value }))}
          />
        </DetailGroup>
      )}
    </div>
  );
}
