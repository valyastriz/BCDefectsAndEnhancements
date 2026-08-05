import { Input, Textarea } from '../../bite-size/BitsizeUI';
import { DetailGroup, DetailReadOnly } from './DetailPane';
import { TRACKER_LABEL } from '../../../constants/tracker';
import {
  formatCreatedViaLabel,
  isAutoEasyVistaReporter,
} from '../../../utils/formatUtils';

/**
 * Provenance, external identifiers and release metadata — the second block of
 * the History & reference tab. Consulted occasionally, edited almost never.
 *
 * The "As Submitted To EasyVista" payload used to live here as a hand-written
 * copy of the server's description format. It now lives on the EasyVista tab,
 * built by the server, so there is only one copy of that format in the codebase.
 */
export function DetailReferenceSection({ detail, edit, setEdit }) {
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
        <DetailReadOnly label="EasyVista Ticket" value={detail.easyvista_ticket_id} mono />
        <Input
          label="Duplicate Reference"
          value={edit.duplicate_of}
          placeholder={`${TRACKER_LABEL} / JIRA / ID`}
          onChange={(e) => setEdit((p) => ({ ...p, duplicate_of: e.target.value }))}
        />
        <p className="bs-field-hint">A {TRACKER_LABEL} ID, a JIRA key, or a submission ID.</p>
      </DetailGroup>

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
    </div>
  );
}
