const express = require('express');
const path = require('path');
const fs = require('fs');
const dbApi = require('../../db');
const { ensureAdmin, attachViewer } = require('../auth');
const { canMutateApplication } = require('../services/viewerService');
const { withDb } = require('../helpers/db');
const { persistUploadedFiles, deleteSupabaseStoredFileByUrl } = require('../helpers/storage');
const { getSubmissionTypeNameById } = require('../helpers/lookups');
const { imageUpload } = require('../middleware/upload');
const { emitAdminNotification } = require('../socket');

const router = express.Router();

router.post(
  '/api/admin/submissions/:id/attachments',
  ensureAdmin,
  attachViewer,
  imageUpload.array('attachments', 10),
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
      // Adding evidence to a ticket is editing it, so it follows the same
      // current-ownership rule as the edit form — including its type scope.
      if (!canMutateApplication(
        req.viewer,
        existing.application_id,
        await getSubmissionTypeNameById(existing.type_id),
      )) {
        return res.status(403).json({ error: 'You do not administer this application' });
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

router.delete('/api/admin/attachments/:id', ensureAdmin, attachViewer, async (req, res) => {
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
    // Authorised against the ticket the attachment hangs off, not the attachment
    // id — the file itself carries no application of its own. A missing parent
    // is refused rather than treated as unowned.
    const parent = await Submission.findByPk(Number(attachment.submission_id), { raw: true });
    if (!canMutateApplication(
      req.viewer,
      parent?.application_id,
      await getSubmissionTypeNameById(parent?.type_id),
    )) {
      return res.status(403).json({ error: 'You do not administer this application' });
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
