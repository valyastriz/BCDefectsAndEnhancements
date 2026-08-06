const express = require('express');
const dbApi = require('../../db');
const { withDb } = require('../helpers/db');
const { isBlank, toIsoOrNow, defectDateTimeIso, parseBooleanFlag } = require('../helpers/utils');
const { SUBMISSION_TYPE_REPORT, REPORT_USAGE_FREQUENCIES } = require('../constants');

/** '' and whitespace are "not given", which is null in the database, not ''. */
const blankToNull = (value) => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};
const {
  resolveSubmissionLookupIds,
  collectMissingLookupIds,
  formatMissingLookupError,
  getSubmissionTypes,
} = require('../helpers/lookups');
const { mapSubmission, mapPublicSubmission } = require('../helpers/mappers');
const { persistUploadedFiles } = require('../helpers/storage');
const { getSubmissionByIdWithLookups, logStatusChange } = require('../services/submissionService');
const { resolveReporter } = require('../services/reporterService');
const { SUBMIT_REQUIRES_AUTH } = require('../config');
const { scheduleEmbeddingRefresh } = require('../services/embeddingIndexService');
const { emitAdminNotification, emitPublicUpdate, publicAudienceFor } = require('../socket');
const { imageUpload } = require('../middleware/upload');

const router = express.Router();

router.post('/api/submissions', imageUpload.array('attachments', 3), async (req, res) => {
  // `created_by` / `created_by_email` are deliberately NOT read here: the
  // reporter is resolved from the session below, and destructuring them would
  // invite someone to use them by accident.
  const {
    type,
    application_name,
    policy_num,
    account_num,
    transaction_num,
    screen_title,
    summary_of_issue,
    steps_to_reproduce,
    what_happened_exact_details,
    request,
    date_time_of_error,
    date_of_error,
    time_of_error,
    desired_completion_date,
    needs_workaround,
    // Report requests. Title is `summary_of_issue`, Description is
    // `what_happened_exact_details` and "what's not working" is `request`, so
    // those three arrive above rather than here.
    is_new_dashboard,
    needed_data,
    measures_and_sources,
    primary_contact,
    existing_report_link,
    changes_requested,
    report_usage_frequency,
    department,
  } = req.body;

  const allowedSubmissionTypes = await withDb(async (db) => getSubmissionTypes(db));
  const normalizedType = String(type || '').trim().toLowerCase();
  if (!allowedSubmissionTypes.includes(normalizedType)) {
    return res.status(400).json({ error: 'Invalid submission type' });
  }

  // Who this is from is the server's decision, not the form's — see
  // services/reporterService.js. A signed-in reporter's own name is used and the
  // submitted one discarded, so nobody can file under someone else's name.
  await dbApi.init();
  // A REPORT REQUEST ALWAYS NEEDS A SIGNED-IN REQUESTER, whatever
  // SUBMIT_REQUIRES_AUTH says for the other types. It is only ever visible to the
  // person who filed it (publicRoutes), and an anonymous one would belong to
  // nobody: unfindable by its own requester and hidden from everybody else, which
  // is a request that may as well not have been filed. Enforced here, at the only
  // door, rather than in the form that asks.
  const isReportRequest = normalizedType === SUBMISSION_TYPE_REPORT;
  const reporter = await resolveReporter(dbApi.getModels() || {}, req, req.body, {
    requireAuthenticated: SUBMIT_REQUIRES_AUTH || isReportRequest,
    authRequiredMessage: isReportRequest
      ? 'Sign in to request a report — a report request is only visible to the person who filed it.'
      : 'Sign in to submit a report',
  });
  if (reporter.error) {
    return res.status(reporter.status || 400).json({
      error: reporter.error,
      // Lets the form tell a lapsed session apart from a missing field: the two
      // need different words and different next steps.
      ...(reporter.sessionExpired ? { sessionExpired: true } : {}),
      // And both of those apart from "this type needs an account", which is not a
      // failure to recover from — it is a different way in.
      ...(reporter.authRequired ? { authRequired: true } : {}),
    });
  }

  let normalized = {
    created_by: reporter.createdBy,
    created_by_email: reporter.createdByEmail,
    type: normalizedType,
    application_name: String(application_name || '').trim() || 'Billing Center',
    policy_num: policy_num || null,
    account_num: account_num || null,
    transaction_num: transaction_num || null,
    screen_title: String(screen_title || '').trim(),
    summary_of_issue: String(summary_of_issue || '').trim(),
    steps_to_reproduce: String(steps_to_reproduce || '').trim(),
    what_happened_exact_details: String(what_happened_exact_details || '').trim(),
    request: String(request || '').trim(),
    date_time_of_error: toIsoOrNow(date_time_of_error),
    desired_completion_date: desired_completion_date || null,
  };

  if (normalizedType === 'defect') {
    const defectDateTime = defectDateTimeIso({ date_time_of_error, date_of_error, time_of_error });
    if (!defectDateTime) {
      return res.status(400).json({ error: 'Date of error is required' });
    }

    if (isBlank(summary_of_issue) || isBlank(screen_title) || isBlank(what_happened_exact_details)) {
      return res.status(400).json({
        error:
          'Summary of Issue, Screen Title, and What Happened (Exact Details) are required for defects',
      });
    }

    normalized = {
      ...normalized,
      application_name: normalized.application_name || 'Billing Center',
      steps_to_reproduce: normalized.steps_to_reproduce || '-',
      request: normalized.request || '-',
      date_time_of_error: defectDateTime,
      desired_completion_date: null,
    };
  }

  // ── Report requests ─────────────────────────────────────────────────────
  // Five of the submission columns are NOT NULL and mean nothing for a report
  // request, so they are filled with '-' exactly as the enhancement branch below
  // does. Required is deliberately minimal — summary, description, and the one
  // field the chosen branch cannot do without — because the confirmed field list
  // is a sample: somebody blocked by a required question they cannot answer types
  // anything to get past it, and then the field is worse than absent.
  if (normalizedType === SUBMISSION_TYPE_REPORT) {
    const wantsNew = parseBooleanFlag(is_new_dashboard);
    const branchField = wantsNew ? measures_and_sources : changes_requested;
    const branchLabel = wantsNew
      ? 'Measures and where they come from'
      : 'What should change';

    if (isBlank(summary_of_issue) || isBlank(what_happened_exact_details) || isBlank(branchField)) {
      return res.status(400).json({
        error: `Summary, Description and ${branchLabel} are required for report requests`,
      });
    }
    // WHICH APPLICATION'S DATA — asked, never defaulted. It decides which
    // analysts ever see the request, and a blank used to fall through to the
    // portal's first application: somebody in Claims asking for a report over
    // billing data had it filed into whichever queue the fallback named. The name
    // itself is still checked against the real application list further down, by
    // the same lookup every other type goes through.
    if (isBlank(application_name)) {
      return res.status(400).json({ error: 'Choose which application the data comes from' });
    }
    // A change request has to say WHICH report: an analyst cannot change one they
    // cannot find. The field takes any answer, because plenty of reports have no
    // link — a share drive path or "the menu I open it from" is a valid answer.
    if (!wantsNew && isBlank(existing_report_link)) {
      return res.status(400).json({ error: 'Say which report this is about' });
    }
    if (!isBlank(report_usage_frequency)
      && !REPORT_USAGE_FREQUENCIES.includes(String(report_usage_frequency).trim())) {
      return res.status(400).json({ error: 'That is not one of the usage frequencies' });
    }

    normalized = {
      ...normalized,
      screen_title: '-',
      steps_to_reproduce: '-',
      // `request` carries "what's not working", which is only asked of a change.
      request: wantsNew ? '-' : (normalized.request || '-'),
      date_time_of_error: toIsoOrNow(date_time_of_error),
      desired_completion_date: desired_completion_date ? toIsoOrNow(desired_completion_date) : null,
      is_new_dashboard: wantsNew ? 1 : 0,
      needed_data: blankToNull(needed_data),
      // Only the chosen branch's fields are stored. Sending both — which a
      // hand-rolled request can do — must not leave the other branch's answer
      // sitting on the row contradicting the one that was asked for.
      measures_and_sources: wantsNew ? blankToNull(measures_and_sources) : null,
      primary_contact: wantsNew ? blankToNull(primary_contact) : null,
      existing_report_link: wantsNew ? null : blankToNull(existing_report_link),
      changes_requested: wantsNew ? null : blankToNull(changes_requested),
      report_usage_frequency: blankToNull(report_usage_frequency),
      department: blankToNull(department),
    };
  }

  if (normalizedType === 'enhancement') {
    if (isBlank(summary_of_issue) || isBlank(request)) {
      return res.status(400).json({
        error:
          'Summary and Request Details are required for enhancements',
      });
    }

    normalized = {
      ...normalized,
      // NOT hardcoded to one application any more. This pinned every enhancement
      // to Billing Center regardless of who filed it or what the payload said —
      // the same fault the report branch had, one type over. The submit form
      // derives the application from the viewer and sends it; the shared fallback
      // above still covers a payload that names none.
      policy_num: null,
      account_num: null,
      transaction_num: null,
      screen_title: '-',
      steps_to_reproduce: '-',
      what_happened_exact_details: '-',
      date_time_of_error: toIsoOrNow(date_time_of_error),
      desired_completion_date: desired_completion_date ? toIsoOrNow(desired_completion_date) : null,
      priority_level: '3 - Medium',
    };
  }

  return withDb(async (db) => {
    const dbModels = dbApi.getModels() || {};
    const Submission = dbModels.Submission;
    if (!Submission) {
      return res.status(500).json({ error: 'Submission model is not available' });
    }
    const now = new Date().toISOString();
    const lookupIds = await resolveSubmissionLookupIds(db, {
      created_via: 'rep_form',
      type: normalized.type,
      application_name: normalized.application_name,
      status: 'New',
      cleanup_status: null,
      cleanup_tag_type: null,
      enhancement_request_type: null,
      priority_level: normalized.priority_level || null,
    });
    const missingLookupFields = collectMissingLookupIds(lookupIds, [
      { idKey: 'created_via_id', label: 'Created Via', required: true },
      { idKey: 'type_id', label: 'Type', required: true },
      { idKey: 'application_id', label: 'Application', required: true },
      { idKey: 'status_id', label: 'Status', required: true },
      {
        idKey: 'priority_level_id',
        label: 'Priority Level',
        required: normalized.type === 'enhancement' && !isBlank(normalized.priority_level),
      },
    ]);
    if (missingLookupFields.length > 0) {
      return res.status(400).json({ error: formatMissingLookupError(missingLookupFields) });
    }
    const createPayload = {
      created_at: now,
      updated_at: now,
      created_via_id: lookupIds.created_via_id,
      created_by: normalized.created_by,
      created_by_email: normalized.created_by_email,
      // Null for an anonymous filer. Once set, this — not the typed name — is
      // what answers "is this one mine" and drives the home-application prefill.
      reporter_user_id: reporter.reporterUserId,
      type_id: lookupIds.type_id,
      application_id: lookupIds.application_id,
      policy_num: normalized.policy_num,
      account_num: normalized.account_num,
      transaction_num: normalized.transaction_num,
      screen_title: normalized.screen_title,
      summary_of_issue: normalized.summary_of_issue,
      steps_to_reproduce: normalized.steps_to_reproduce,
      what_happened_exact_details: normalized.what_happened_exact_details,
      request: normalized.request,
      date_time_of_error: normalized.date_time_of_error,
      status_id: lookupIds.status_id,
      reviewer: null,
      decision_notes: null,
      fingerprint: null,
      duplicate_of: null,
      easyvista_ticket_id: null,
      desired_completion_date: normalized.desired_completion_date,
      impact_details: null,
      enhancement_request_type_id: null,
      priority_level_id: lookupIds.priority_level_id,
      jira_number: null,
      // Rep-submitted defects/enhancements are public by default so they show on
      // the public status board and in public AI search; an admin can switch an
      // individual ticket to private. (Rep submissions are never cleanup tasks.)
      is_public: 1,
      // The rep is blocked and needs a way to keep working. Defect-only: an
      // enhancement is by definition not stopping anyone today, and the form
      // only offers the box on a defect — so a value sent with an enhancement is
      // dropped here rather than trusted.
      needs_workaround: normalized.type === 'defect' && parseBooleanFlag(needs_workaround) ? 1 : 0,
      // Report-request fields, null for every other type by construction: they
      // are only ever set inside the report branch above, so a defect payload
      // carrying them writes nothing.
      is_new_dashboard: normalized.is_new_dashboard ?? null,
      needed_data: normalized.needed_data ?? null,
      measures_and_sources: normalized.measures_and_sources ?? null,
      primary_contact: normalized.primary_contact ?? null,
      existing_report_link: normalized.existing_report_link ?? null,
      changes_requested: normalized.changes_requested ?? null,
      report_usage_frequency: normalized.report_usage_frequency ?? null,
      department: normalized.department ?? null,
    };

    const createdSubmission = await Submission.create(createPayload);
    const submissionId = Number(createdSubmission.id);

    await persistUploadedFiles(db, submissionId, req.files || [], 'rep');
    await logStatusChange(db, submissionId, 'New', normalized.created_by || 'rep', now);
    // On the record from the start, so the history shows when the rep asked and
    // — once an admin marks it handled — how long they waited.
    if (createPayload.needs_workaround) {
      await logStatusChange(
        db,
        submissionId,
        'Workaround: Requested by reporter',
        normalized.created_by || 'rep',
        now,
      );
    }

    const created = await getSubmissionByIdWithLookups(db, submissionId);
    emitAdminNotification('submission:new', mapSubmission(created));
    if (created.is_public) {
      // Rep submissions are public by default, so the public status board should
      // live-update. Only allow-listed fields go to the unauthenticated watchers.
      emitPublicUpdate(mapPublicSubmission(created), publicAudienceFor(created));
    }
    scheduleEmbeddingRefresh(submissionId);

    return res.status(201).json({
      id: submissionId,
      message: 'Submission created',
    });
  });
});

module.exports = router;
