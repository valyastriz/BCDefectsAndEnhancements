const path = require('path');
const multer = require('multer');
const { tempUploadDir } = require('../config');

// Shared limits for all uploads
const sharedLimits = {
  fileSize: 10 * 1024 * 1024,
  files: 10,
};

// Generic temp upload — used for trusted, separately-validated files (e.g. admin Excel import).
const tempUpload = multer({
  dest: tempUploadDir,
  limits: sharedLimits,
});

// Image-only upload — used for user/admin attachment & screenshot endpoints so that arbitrary
// (e.g. HTML/SVG) content cannot be stored and later served same-origin from /uploads.
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif',
]);

function imageFileFilter(_req, file, cb) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const isImageMime = String(file.mimetype || '').toLowerCase().startsWith('image/');
  if (ALLOWED_IMAGE_EXTENSIONS.has(extension) && isImageMime) {
    return cb(null, true);
  }
  const error = new Error('Only image files are allowed (png, jpg, jpeg, gif, webp, bmp, heic).');
  error.status = 400;
  return cb(error);
}

const imageUpload = multer({
  dest: tempUploadDir,
  limits: sharedLimits,
  fileFilter: imageFileFilter,
});

// ── Approval evidence ────────────────────────────────────────────────────────
// A report request's go-ahead is usually an email or a signed PDF, not a
// screenshot, so this filter accepts documents as well as images.
//
// It exists SEPARATELY from imageFileFilter, and the difference is not the file
// types — it is where the files go. Everything imageFileFilter accepts is served
// from /uploads by express.static with NO AUTHENTICATION (src/index.js), which
// is defensible for screenshots because they are public-board content anyway. An
// approval email is not. Anything accepted here is stored with
// `attachments.purpose = 'approval'` and is readable only through
// GET /api/admin/attachments/:id/file, which re-checks the caller's grant.
//
// The deny-list is the point of the allow-list. `.svg`, `.html`, `.xhtml` and
// `.xml` can carry script that executes with the origin's privileges if it is
// ever served inline, so they are refused outright rather than relied on to be
// downloaded — the same reasoning that made uploads image-only in the first
// place. Everything below either renders in a sandboxed viewer (PDF, images) or
// cannot render in a browser at all (Office, Outlook, text).
const APPROVAL_EXTENSIONS = new Map([
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.msg', ['application/vnd.ms-outlook', 'application/octet-stream']],
  ['.eml', ['message/rfc822', 'application/octet-stream']],
  ['.txt', ['text/plain']],
  ['.csv', ['text/csv', 'application/csv', 'text/plain']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.gif', ['image/gif']],
  ['.webp', ['image/webp']],
  ['.bmp', ['image/bmp']],
  ['.heic', ['image/heic', 'image/heif']],
  ['.heif', ['image/heif', 'image/heic']],
]);

const APPROVAL_HELP = 'Attach a PDF, Word or Excel file, an Outlook message, or an image.';

function approvalFileFilter(_req, file, cb) {
  const name = String(file.originalname || '');
  const extension = path.extname(name).toLowerCase();
  const mimetype = String(file.mimetype || '').toLowerCase().split(';')[0].trim();

  // A double extension is how a denied type gets past a naive check —
  // `approval.pdf.svg` has extname '.svg' and is refused, but `approval.svg.pdf`
  // would pass on extension alone. The mime type has to agree, and the browser
  // reports the real one.
  const allowedMimes = APPROVAL_EXTENSIONS.get(extension);
  if (allowedMimes && allowedMimes.includes(mimetype)) {
    return cb(null, true);
  }

  const error = new Error(
    allowedMimes
      ? `${name} does not look like a ${extension.slice(1).toUpperCase()} file. ${APPROVAL_HELP}`
      : `${name || 'That file'} is not a file type we accept. ${APPROVAL_HELP}`,
  );
  error.status = 400;
  return cb(error);
}

const approvalUpload = multer({
  dest: tempUploadDir,
  limits: sharedLimits,
  fileFilter: approvalFileFilter,
});

module.exports = {
  tempUpload,
  imageUpload,
  approvalUpload,
  approvalFileFilter,
  APPROVAL_EXTENSIONS,
};
