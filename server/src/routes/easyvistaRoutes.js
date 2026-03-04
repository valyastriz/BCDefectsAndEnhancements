const express = require('express');
const dbApi = require('../../db');
const { ensureAdmin } = require('../auth');
const { withDb } = require('../helpers/db');
const { toBooleanSql, toIsoOrNow, isBlank, normalizeCleanupTagType } = require('../helpers/utils');
const {
  resolveSubmissionLookupIds,
  collectMissingLookupIds,
  formatMissingLookupError,
  getLookupIdByName,
  getDefectEnhancementStatuses,
  getSubmissionTypes,
  getCleanupStatuses,
  getCleanupTagTypes,
  getEnhancementRequestTypes,
} = require('../helpers/lookups');
const { mapSubmission } = require('../helpers/mappers');
const { getSubmissionByIdWithLookups, logStatusChange } = require('../services/submissionService');
const { emitAdminNotification } = require('../socket');
const { SUBMISSION_TO_CLEANUP_STATUS } = require('../constants');
const { submitToEasyVista } = require('../easyvista');

const router = express.Router();

router.post('/api/admin/submissions/:id/submit-easyvista', ensureAdmin, async (req, res) => {
  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    const Attachment = dbModels.Attachment;
    if (!Submission || !Attachment) {
      return res.status(500).json({ error: 'Required models are not available' });
    }
    const rawSubmission = await getSubmissionByIdWithLookups(db, Number(req.params.id));
    if (!rawSubmission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    const submission = mapSubmission(rawSubmission);

    const isResubmissionRequest = !isBlank(submission.easyvista_ticket_id);
    const draftPayload =
      req.body && typeof req.body.draft === 'object' && req.body.draft !== null ? req.body.draft : null;

    const source = {
      ...submission,
    };

    if (isResubmissionRequest && draftPayload) {
      const allowedStatuses = await getDefectEnhancementStatuses(db, { includeRetired: false });
      const allowedSubmissionTypes = await getSubmissionTypes(db);
      const allowedCleanupStatuses = await getCleanupStatuses(db);
      const allowedCleanupTagTypes = await getCleanupTagTypes(db);
      const hasCleanupTagType = Object.prototype.hasOwnProperty.call(draftPayload, 'cleanup_tag_type');
      const incomingCleanupTagType = normalizeCleanupTagType(draftPayload.cleanup_tag_type, allowedCleanupTagTypes);
      const existingCleanupTagType = normalizeCleanupTagType(submission.cleanup_tag_type, allowedCleanupTagTypes);
      const isCleanup =
        typeof draftPayload.is_cleanup === 'boolean'
          ? draftPayload.is_cleanup
          : Boolean(submission.is_cleanup);
      const requestedCleanupStatus = String(draftPayload.cleanup_status || '').trim();
      const nextCleanupStatus = isCleanup
        ? (allowedCleanupStatuses.includes(requestedCleanupStatus)
            ? requestedCleanupStatus
            : (submission.cleanup_status || SUBMISSION_TO_CLEANUP_STATUS[submission.status] || 'Not Started'))
        : null;
      const nextCleanupTagType = isCleanup
        ? (hasCleanupTagType ? incomingCleanupTagType : existingCleanupTagType)
        : null;
      const requestedType = String(draftPayload.type || '').trim().toLowerCase();
      const nextType = isCleanup
        ? (nextCleanupTagType === 'enhancement' ? 'enhancement' : 'defect')
        : (allowedSubmissionTypes.includes(requestedType) ? requestedType : submission.type);
      const requestedStatus = String(draftPayload.status || '').trim();
      const nextStatus = allowedStatuses.includes(requestedStatus) ? requestedStatus : submission.status;

      const policyPremiumImpact = isBlank(draftPayload.policy_premium_impact)
        ? null
        : Number(draftPayload.policy_premium_impact);
      const directDollarImpact = isBlank(draftPayload.direct_dollar_impact)
        ? null
        : Number(draftPayload.direct_dollar_impact);
      const policiesAffectedCount = isBlank(draftPayload.policies_affected_count)
        ? null
        : Number(draftPayload.policies_affected_count);

      source.type = nextType;
      source.status = nextStatus;
      source.is_cleanup = isCleanup;
      source.cleanup_status = nextCleanupStatus;
      source.cleanup_tag_type = nextCleanupTagType;
      source.application_name = draftPayload.application_name ?? submission.application_name;
      source.policy_num = draftPayload.policy_num ?? submission.policy_num;
      source.account_num = draftPayload.account_num ?? submission.account_num;
      source.transaction_num = draftPayload.transaction_num ?? submission.transaction_num;
      source.screen_title = draftPayload.screen_title ?? submission.screen_title;
      source.summary_of_issue = draftPayload.summary_of_issue ?? submission.summary_of_issue;
      source.steps_to_reproduce = draftPayload.steps_to_reproduce ?? submission.steps_to_reproduce;
      source.what_happened_exact_details =
        draftPayload.what_happened_exact_details ?? submission.what_happened_exact_details;
      source.request = draftPayload.request ?? submission.request;
      source.date_time_of_error = draftPayload.date_time_of_error
        ? toIsoOrNow(draftPayload.date_time_of_error)
        : (draftPayload.date_time_of_error === null ? null : submission.date_time_of_error);
      source.reviewer = draftPayload.reviewer ?? submission.reviewer;
      source.decision_notes = draftPayload.decision_notes ?? submission.decision_notes;
      source.fingerprint = draftPayload.fingerprint ?? submission.fingerprint;
      source.desired_completion_date = draftPayload.desired_completion_date === ''
        ? null
        : draftPayload.desired_completion_date
          ? toIsoOrNow(draftPayload.desired_completion_date)
          : submission.desired_completion_date;
      source.impact_details = draftPayload.impact_details ?? submission.impact_details;
      source.impact_notes = draftPayload.impact_notes ?? submission.impact_notes;
      source.policy_premium_impact = Number.isFinite(policyPremiumImpact)
        ? policyPremiumImpact
        : submission.policy_premium_impact;
      source.direct_dollar_impact = Number.isFinite(directDollarImpact)
        ? directDollarImpact
        : submission.direct_dollar_impact;
      source.policies_affected_count = Number.isFinite(policiesAffectedCount)
        ? Math.trunc(policiesAffectedCount)
        : submission.policies_affected_count;
      source.logged_defect =
        typeof draftPayload.logged_defect === 'boolean'
          ? draftPayload.logged_defect
          : Boolean(submission.logged_defect);
      source.enhancement_request_type = Object.prototype.hasOwnProperty.call(
        draftPayload,
        'enhancement_request_type',
      )
        ? (isBlank(draftPayload.enhancement_request_type)
            ? null
            : draftPayload.enhancement_request_type)
        : submission.enhancement_request_type;
      source.priority_level = draftPayload.priority_level ?? submission.priority_level;
      source.jira_number = draftPayload.jira_number ?? submission.jira_number;
      source.release_number = draftPayload.release_number ?? submission.release_number;
      source.release_notes = draftPayload.release_notes ?? submission.release_notes;
      source.duplicate_reference = draftPayload.duplicate_of ?? submission.duplicate_reference;
      source.is_public =
        typeof draftPayload.is_public === 'boolean'
          ? draftPayload.is_public
          : Boolean(submission.is_public);
      source.is_retired =
        typeof draftPayload.is_retired === 'boolean'
          ? draftPayload.is_retired
          : Boolean(submission.is_retired);

      if (source.type === 'enhancement' && isBlank(source.priority_level)) {
        source.priority_level = '3 - Medium';
      }
    }

    if (source.is_cleanup && source.cleanup_tag_type === 'cleanup_only') {
      return res.status(400).json({
        error: 'Cleanup Only tasks cannot be submitted to EasyVista. Tag as Defect or Enhancement first.',
      });
    }

    const effectiveType = source.cleanup_tag_type === 'enhancement' ? 'enhancement' : 'defect';

    const missing = [];
    if (effectiveType === 'enhancement') {
      if (isBlank(source.impact_details)) {
        missing.push('Impact Details');
      }
      const allowedEnhancementRequestTypes = await getEnhancementRequestTypes(db);
      if (
        isBlank(source.enhancement_request_type) ||
        !allowedEnhancementRequestTypes.includes(source.enhancement_request_type)
      ) {
        missing.push('Request Type');
      }
    }

    if (effectiveType === 'defect') {
      if (isBlank(source.summary_of_issue)) {
        missing.push('Summary of Issue');
      }
      if (isBlank(source.screen_title)) {
        missing.push('Screen Title');
      }
      if (isBlank(source.what_happened_exact_details)) {
        missing.push('Description');
      }
    }

    if (missing.length > 0) {
      const typeLabel = effectiveType === 'enhancement' ? 'Enhancement' : 'Defect';
      return res.status(400).json({
        error: `${typeLabel} cannot be submitted. Missing required fields: ${missing.join(', ')}`,
      });
    }

    const result = await submitToEasyVista({ ...source, type: effectiveType });

    const updatedAt = new Date().toISOString();
    const easyVistaReporter = req.session?.user?.username || 'Unknown';
    const easyVistaSubmittedBy = `Automatic (System API by ${easyVistaReporter})`;

    // ── First-time submission ──────────────────────────────────────────────
    if (!isResubmissionRequest) {
      const submittedStatusId = await getLookupIdByName(db, 'defect_enhancement_statuses', 'Submitted');
      await Submission.update({
        easyvista_ticket_id: result.ticketId,
        ...(submittedStatusId ? { status_id: submittedStatusId } : {}),
        updated_at: updatedAt,
        easyvista_submitted_by: easyVistaSubmittedBy,
      }, {
        where: { id: Number(submission.id) },
      });

      if (submission.status !== 'Submitted') {
        await logStatusChange(db, submission.id, 'Submitted', easyVistaSubmittedBy, updatedAt);
      }

      const updated = await getSubmissionByIdWithLookups(db, submission.id);
      emitAdminNotification('submission:submitted-easyvista', mapSubmission(updated));

      return res.json({
        ticketId: result.ticketId,
        source: result.source,
        resubmission: false,
        submission: mapSubmission(updated),
      });
    }

    // ── Resubmission (creates a new submission) ──────────────────────────
    const resubmissionInsertColumns = [
      'created_at', 'updated_at', 'created_via_id', 'created_by', 'created_by_email', 'type_id', 'application_id',
      'policy_num', 'account_num', 'transaction_num', 'screen_title', 'summary_of_issue',
      'steps_to_reproduce', 'what_happened_exact_details', 'request', 'date_time_of_error',
      'status_id', 'reviewer', 'decision_notes', 'fingerprint', 'duplicate_reference', 'duplicate_of',
      'easyvista_ticket_id', 'desired_completion_date', 'impact_details', 'impact_notes',
      'policy_premium_impact', 'direct_dollar_impact', 'policies_affected_count', 'logged_defect',
      'enhancement_request_type_id', 'priority_level_id', 'jira_number', 'release_number', 'release_notes',
      'is_cleanup', 'cleanup_status_id', 'cleanup_tag_type_id', 'easyvista_submitted_by',
      'is_resubmission', 'resubmission_of_submission_id', 'resubmission_of_easyvista_ticket_id',
      'has_resubmission', 'latest_resubmission_submission_id', 'latest_resubmission_easyvista_ticket_id',
      'is_public', 'is_retired',
    ];
    const resubmissionInsertValues = [
      updatedAt,
      updatedAt,
      null,
      source.created_by,
      source.created_by_email,
      null,
      null,
      source.policy_num,
      source.account_num,
      source.transaction_num,
      source.screen_title,
      source.summary_of_issue,
      source.steps_to_reproduce,
      source.what_happened_exact_details,
      source.request,
      source.date_time_of_error,
      null,
      source.reviewer,
      source.decision_notes,
      source.fingerprint,
      source.duplicate_reference,
      source.duplicate_of,
      result.ticketId,
      source.desired_completion_date,
      source.impact_details,
      source.impact_notes,
      source.policy_premium_impact,
      source.direct_dollar_impact,
      source.policies_affected_count,
      toBooleanSql(source.logged_defect),
      null,
      null,
      source.jira_number,
      source.release_number,
      source.release_notes,
      toBooleanSql(source.is_cleanup),
      null,
      null,
      easyVistaSubmittedBy,
      1,
      submission.id,
      submission.easyvista_ticket_id,
      0,
      null,
      null,
      toBooleanSql(source.is_public),
      toBooleanSql(source.is_retired),
    ];
    const payload = resubmissionInsertColumns.reduce((acc, column, index) => {
      acc[column] = resubmissionInsertValues[index];
      return acc;
    }, {});
    const createdSubmission = await Submission.create(payload);
    const resubmissionId = Number(createdSubmission.id);

    const createdLookupIds = await resolveSubmissionLookupIds(db, {
      created_via: 'admin_easyvista_resubmission',
      type: effectiveType,
      application_name: source.application_name,
      status: 'Submitted',
      cleanup_status: source.cleanup_status,
      cleanup_tag_type: source.cleanup_tag_type,
      enhancement_request_type: source.enhancement_request_type,
      priority_level: source.priority_level,
    });
    const missingLookupFields = collectMissingLookupIds(createdLookupIds, [
      { idKey: 'created_via_id', label: 'Created Via', required: true },
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      {
        idKey: 'cleanup_status_id',
        label: 'Cleanup Status',
        required: Boolean(source.is_cleanup) && !isBlank(source.cleanup_status),
      },
      {
        idKey: 'cleanup_tag_type_id',
        label: 'Cleanup Tag Type',
        required: Boolean(source.is_cleanup) && !isBlank(source.cleanup_tag_type),
      },
      {
        idKey: 'enhancement_request_type_id',
        label: 'Enhancement Request Type',
        required: !isBlank(source.enhancement_request_type),
      },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: effectiveType === 'enhancement' && !isBlank(source.priority_level),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }

    await Submission.update({
      created_via_id: createdLookupIds.created_via_id,
      type_id: createdLookupIds.type_id,
      application_id: createdLookupIds.application_id,
      status_id: createdLookupIds.status_id,
      cleanup_status_id: createdLookupIds.cleanup_status_id,
      cleanup_tag_type_id: createdLookupIds.cleanup_tag_type_id,
      enhancement_request_type_id: createdLookupIds.enhancement_request_type_id,
      priority_level_id: createdLookupIds.priority_level_id,
    }, {
      where: { id: Number(resubmissionId) },
    });

    const existingAttachments = await Attachment.findAll({
      where: { submission_id: Number(submission.id) },
      attributes: ['filename', 'mime_type', 'file_path', 'uploaded_by_role'],
      raw: true,
    });
    for (const attachment of existingAttachments) {
      await Attachment.create({
        submission_id: resubmissionId,
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        file_path: attachment.file_path,
        uploaded_at: updatedAt,
        uploaded_by_role: attachment.uploaded_by_role,
      });
    }

    await Submission.update({
      has_resubmission: 1,
      latest_resubmission_submission_id: resubmissionId,
      latest_resubmission_easyvista_ticket_id: result.ticketId,
      updated_at: updatedAt,
    }, {
      where: { id: Number(submission.id) },
    });

    await logStatusChange(
      db,
      submission.id,
      `Resubmission: From (EasyVista ${submission.easyvista_ticket_id}) to (EasyVista ${result.ticketId}) as Submission #${resubmissionId}`,
      easyVistaSubmittedBy,
      updatedAt,
    );
    await logStatusChange(
      db,
      resubmissionId,
      `Resubmission: From (EasyVista ${submission.easyvista_ticket_id}) to (EasyVista ${result.ticketId}), Origin Submission #${submission.id}`,
      easyVistaSubmittedBy,
      updatedAt,
    );
    await logStatusChange(db, resubmissionId, 'Submitted', easyVistaSubmittedBy, updatedAt);

    const newSubmission = await getSubmissionByIdWithLookups(db, resubmissionId);
    const updatedOriginal = await getSubmissionByIdWithLookups(db, submission.id);

    emitAdminNotification('submission:resubmitted-easyvista', {
      original_submission: mapSubmission(updatedOriginal),
      resubmission: mapSubmission(newSubmission),
    });

    return res.json({
      ticketId: result.ticketId,
      source: result.source,
      resubmission: true,
      originalSubmissionId: submission.id,
      submission: mapSubmission(newSubmission),
    });
  });
});

module.exports = router;
