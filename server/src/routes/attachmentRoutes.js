const express = require('express');
const path = require('path');
const fs = require('fs');
const dbApi = require('../../db');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { persistUploadedFiles, deleteSupabaseStoredFileByUrl } = require('../helpers/storage');
const { tempUpload } = require('../middleware/upload');
const { emitAdminNotification } = require('../socket');

const router = express.Router();

router.post(
  '/api/admin/submissions/:id/attachments',
  ensureAdmin,
  tempUpload.array('attachments', 10),
  async (req, res) => {
    return withDb(async (db) => {
      const dbModels = dbApi.getModels() || {};
      const Submission = dbModels.Submission;
      if (!Submission) {
        return res.status(500).json({ error: 'Submission model is not available' });
      }
      const existing = await Submission.findByPk(Number(req.params.id), { raw: true });
      if (!existing) {
        return res.status(404).json({ error: 'Submission not found' });
      }

      const created = await persistUploadedFiles(db, existing.id, req.files || [], 'admin');

      await Submission.update(
        { updated_at: new Date().toISOString() },
        { where: { id: Number(existing.id) } },
      );

      emitAdminNotification('attachment:added', {
        submission_id: existing.id,
        count: created.length,
      });

      return res.status(201).json(created);
    });
  },
);

router.delete('/api/admin/attachments/:id', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Attachment = dbModels.Attachment;
    const Submission = dbModels.Submission;
    if (!Attachment || !Submission) {
      return res.status(500).json({ error: 'Required models are not available' });
    }
    const attachment = await Attachment.findByPk(Number(req.params.id), { raw: true });
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const removedFromSupabase = await deleteSupabaseStoredFileByUrl(attachment.file_path);
    if (!removedFromSupabase) {
      const absolute = path.join(__dirname, '..', '..', attachment.file_path);
      if (fs.existsSync(absolute)) {
        fs.rmSync(absolute, { force: true });
      }
    }

    await Attachment.destroy({ where: { id: Number(req.params.id) } });

    await Submission.update(
      { updated_at: new Date().toISOString() },
      { where: { id: Number(attachment.submission_id) } },
    );

    emitAdminNotification('attachment:removed', {
      id: attachment.id,
      submission_id: attachment.submission_id,
    });

    return res.json({ ok: true });
  });
});

module.exports = router;
