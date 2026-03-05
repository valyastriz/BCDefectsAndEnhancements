import { Modal } from '../bite-size/BitsizeUI';
import { resolveAttachmentUrl } from '../../utils/formatUtils';

/**
 * Full-screen preview modal for a single attachment image.
 */
export function AttachmentPreviewModal({ previewAttachment, setPreviewAttachment }) {
  return (
    <Modal
      open={Boolean(previewAttachment)}
      onClose={() => setPreviewAttachment(null)}
      title={previewAttachment?.filename || 'Attachment Preview'}
    >
      {previewAttachment && (
        <img
          className="bs-preview-image"
          src={previewAttachment._isPendingUpload
            ? previewAttachment.preview_url
            : resolveAttachmentUrl(previewAttachment.file_path)}
          alt={previewAttachment.filename}
        />
      )}
    </Modal>
  );
}

/**
 * Full-screen preview modal for cleanup-task file attachments.
 */
export function CleanupPreviewModal({ cleanupPreviewIndex, cleanupFilePreviews, setCleanupPreviewIndex }) {
  const preview = cleanupPreviewIndex !== null ? cleanupFilePreviews[cleanupPreviewIndex] : null;

  return (
    <Modal
      open={cleanupPreviewIndex !== null && Boolean(preview)}
      onClose={() => setCleanupPreviewIndex(null)}
      title={preview?.file?.name || 'Attachment Preview'}
    >
      {preview && (
        <img
          className="bs-preview-image"
          src={preview.url}
          alt={preview.file.name}
        />
      )}
    </Modal>
  );
}
