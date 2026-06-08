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

module.exports = {
  tempUpload,
  imageUpload,
};
