import { Badge, Button, Card } from '../../bite-size/BitsizeUI';
import { resolveAttachmentUrl } from '../../../utils/formatUtils';

/**
 * Public-visibility toggle plus the Attachments card.
 */
export function DetailAttachmentsSection({
  edit,
  setEdit,
  effectiveType,
  visibleAttachments,
  setPreviewAttachment,
  uploadAttachment,
  deleteAttachment,
}) {
  return (
    <>
      {/* ── Visibility toggle ── */}
      <div className="bs-actions" style={{ alignItems: 'center' }}>
        <label className="toggle-row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={edit.is_public}
            onChange={(e) => setEdit((p) => ({ ...p, is_public: e.target.checked }))}
          />
          <span>Visible on Public Status Board</span>
        </label>
      </div>

      {/* ── Attachments ── */}
      <p className="section-label">Attachments</p>
      <Card className="inner">
        <div className="bs-form">
          <label className="bs-field">
            <span>{effectiveType === 'enhancement' ? 'Supporting Documentation (images / documents)' : 'Add Screenshots'}</span>
            <input
              type="file"
              accept={effectiveType === 'enhancement' ? 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt' : 'image/*'}
              multiple
              onChange={uploadAttachment}
            />
          </label>
          {visibleAttachments.length > 0 && (
            <div className="thumb-grid">
              {visibleAttachments.map((att) => (
                <article key={att.id} className="thumb-item">
                  {att._isPendingUpload ? (
                    att.mime_type?.startsWith('image/') && att.preview_url ? (
                      <button
                        type="button"
                        className="thumb-open-btn"
                        onClick={() => setPreviewAttachment(att)}
                      >
                        <img src={att.preview_url} alt={att.filename} />
                      </button>
                    ) : (
                      <span className="file-link">{att.filename}</span>
                    )
                  ) : att.mime_type?.startsWith('image/') ? (
                    <button type="button" className="thumb-open-btn" onClick={() => setPreviewAttachment(att)}>
                      <img src={resolveAttachmentUrl(att.file_path)} alt={att.filename} />
                    </button>
                  ) : (
                    <a href={resolveAttachmentUrl(att.file_path)} target="_blank" rel="noreferrer" className="file-link">{att.filename}</a>
                  )}
                  <div className="thumb-meta">
                    <span className="thumb-name">{att.filename}</span>
                    {att._isPendingUpload ? (
                      <Badge tone="warning">Pending upload</Badge>
                    ) : att._isMarkedForRemoval ? (
                      <Badge tone="danger">Pending removal</Badge>
                    ) : null}
                    <Button
                      kind="danger"
                      onClick={() => deleteAttachment(att)}
                    >
                      {att._isPendingUpload
                        ? 'Discard'
                        : att._isMarkedForRemoval
                          ? 'Undo Remove'
                          : 'Remove'}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
