import { Badge } from '../../bite-size/BitsizeUI';
import { resolveAttachmentUrl } from '../../../utils/formatUtils';
import { TRACKER_LABEL } from '../../../constants/tracker';

/**
 * Files — evidence for the ticket.
 *
 * The per-file action is a quiet text button rather than a red danger button:
 * five attachments used to mean five red buttons competing with the one real
 * destructive action in the footer. The grid caps its own height so a ticket
 * with many files cannot stretch the pane.
 */
export function DetailAttachmentsSection({
  effectiveType,
  visibleAttachments,
  locked,
  setPreviewAttachment,
  uploadAttachment,
  deleteAttachment,
}) {
  const isEnhancement = effectiveType === 'enhancement';

  return (
    <>
      <label className="bs-field">
        <span>{isEnhancement ? 'Supporting Documentation (images / documents)' : 'Add Screenshots'}</span>
        {/* Only the mutating controls switch off while another admin holds the
            ticket — the thumbnails stay openable, which is what the lock alert
            has always promised. */}
        <input
          type="file"
          accept={isEnhancement ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
          multiple
          disabled={locked}
          onChange={uploadAttachment}
        />
      </label>

      {visibleAttachments.length === 0 ? (
        <div className="queue-state queue-state--inset">
          <span className="queue-state-icon" aria-hidden="true">⋯</span>
          <h4>No attachments yet</h4>
          <p>
            Nothing has been uploaded for this ticket. Add a file above and it will travel
            with the {TRACKER_LABEL} hand-off when you save.
          </p>
        </div>
      ) : (
        <div className="dm-thumbs-scroll">
          <div className="thumb-grid">
            {visibleAttachments.map((att) => (
              <figure
                key={att.id}
                className={`dm-thumb${att._isMarkedForRemoval ? ' dm-thumb--removing' : ''}`}
              >
                {att._isPendingUpload ? (
                  att.mime_type?.startsWith('image/') && att.preview_url ? (
                    <button
                      type="button"
                      className="dm-thumb-btn"
                      onClick={() => setPreviewAttachment(att)}
                      aria-label={`Open ${att.filename}`}
                    >
                      <img src={att.preview_url} alt={att.filename} />
                    </button>
                  ) : (
                    <span className="file-link">{att.filename}</span>
                  )
                ) : att.mime_type?.startsWith('image/') ? (
                  <button
                    type="button"
                    className="dm-thumb-btn"
                    onClick={() => setPreviewAttachment(att)}
                    aria-label={`Open ${att.filename}`}
                  >
                    <img src={resolveAttachmentUrl(att.file_path)} alt={att.filename} />
                  </button>
                ) : (
                  <a
                    href={resolveAttachmentUrl(att.file_path)}
                    target="_blank"
                    rel="noreferrer"
                    className="file-link"
                  >
                    {att.filename}
                  </a>
                )}
                <figcaption>
                  <span className="dm-thumb-name" title={att.filename}>{att.filename}</span>
                  {att._isPendingUpload ? (
                    <Badge tone="warning">Pending upload</Badge>
                  ) : att._isMarkedForRemoval ? (
                    <Badge tone="danger">Pending removal</Badge>
                  ) : null}
                  <button
                    type="button"
                    className={`dm-thumb-act${att._isMarkedForRemoval ? ' dm-thumb-act--undo' : ''}`}
                    disabled={locked}
                    onClick={() => deleteAttachment(att)}
                  >
                    {att._isPendingUpload
                      ? 'Remove pending'
                      : att._isMarkedForRemoval
                        ? 'Undo Remove'
                        : 'Remove'}
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
