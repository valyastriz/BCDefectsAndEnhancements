const multer = require('multer');
const { tempUploadDir } = require('../config');

const tempUpload = multer({
  dest: tempUploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

module.exports = {
  tempUpload,
};
