#!/usr/bin/env node
/**
 * Seed the three things the demonstration set could not show.
 *
 *   node scripts/seedUnwiredWork.js            # dry run
 *   node scripts/seedUnwiredWork.js --apply    # write
 *
 * WHY THIS EXISTS. `seedRealisticSubmissions.js` built 39 requests to make every
 * surface draw something real, and it predates three features. Each one is now
 * documented in the user manual with **no picture**, because nothing on screen
 * shows it:
 *
 *   1. **A defect or an enhancement in `Other`.** Its two `Other` tickets are both
 *      report requests, and a report request has no Service Desk button at all — so
 *      the greyed-out hand-off and its "raise it by hand, then come back with the
 *      number" note were unphotographable. In the owner's words, `Other` is exactly
 *      for this: *"a way to still track issues even if for a defect or enhancement
 *      the admin has to manually submit to the service desk and then manually enter
 *      the ticket number."*
 *   2. **An analyst-created reports-only application.** There were none, so the
 *      feature was invisible and the picker never had one to hide from a defect.
 *   3. **A soft association** — an `Other` ticket also appearing in a real queue.
 *
 * WHAT IT ADDS. One application and four submissions:
 *
 *   Other · defect · Approved       softly assigned to Billing Center — shows the
 *                                   greyed-out Send, its note, AND the picker with
 *                                   a value chosen
 *   Other · enhancement · Submitted with a HAND-TYPED incident number — the manual
 *                                   flow completed, which is the whole point of the
 *                                   affordance
 *   Marketing Analytics · report ×2 one filed through the form, one recorded by the
 *                                   analyst, so both creation paths are shown
 *
 * WHAT IT DELIBERATELY DOES NOT DO. **Nothing here is Delivered and no hours are
 * logged against any of it.** That is the modelling rule the reseed established and
 * `verify-throughput-page.mjs` depends on: work happens after a request is routed
 * OUT of `Other`, so its per-card empty state stays checkable. The new
 * reports-only queue is empty for the same reason — a queue nobody has finished
 * anything in yet is the honest picture of a brand-new one, and it gives that check
 * a second structurally-empty target.
 *
 * The application is created the way the endpoint creates one: `reports_only = 1`,
 * and **granted in the same transaction** to everybody who works report requests,
 * derived with `resolveReportWorkers` — the service's own function, not a copy. An
 * application is a queue, and one with no grants is visible to nobody but a super
 * user.
 *
 * Idempotent by refusal: it checks for its own summaries first and stops rather
 * than seeding a second identical set.
 */
require('dotenv').config();
const dbApi = require('../db');
const { resolveReportWorkers } = require('../src/services/reportApplicationService');
const { SUBMISSION_TYPE_REPORT } = require('../src/constants');

const APPLY = process.argv.includes('--apply');

const OTHER = 'Other';
const BILLING = 'Billing Center';
const NEW_APPLICATION = 'Marketing Analytics';

const iso = (days, hour = 10, minute = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
};

// ── The four requests ────────────────────────────────────────────────────────
const SUBMISSIONS = [
  {
    key: 'other-defect',
    application: OTHER,
    type: 'defect',
    status: 'Approved',
    createdVia: 'rep_form',
    reporter: 'bc_rep',
    isPublic: true,
    // The soft association. `bc_app_admin` administers both Billing Center and
    // Other for defects, which is what the server requires — you can only show a
    // ticket in a queue you work in.
    workingApplication: BILLING,
    summary_of_issue: 'Commission statement PDF drops the agency code on multi-page runs',
    screen_title: 'Commission Statements → Download',
    what_happened_exact_details:
      'Page 1 carries the agency code in the header. From page 2 onward the header is blank, so a '
      + 'statement split across pages cannot be filed against the right agency without opening it.',
    steps_to_reproduce:
      '1. Open Commission Statements for a producer with more than 40 lines\n'
      + '2. Download the PDF\n'
      + '3. Scroll to page 2 — the agency code is gone',
    reviewer: 'Billing Center App Admin',
    decision_notes:
      'Confirmed against three producers. The statement generator is not one of our applications — '
      + 'raised on the Service Desk by hand while we work out who owns it.',
    createdAt: iso(9, 8, 40),
    events: [
      { status: 'New', at: iso(9, 8, 40) },
      { status: 'Approved', at: iso(6, 13, 15), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'other-enhancement',
    application: OTHER,
    type: 'enhancement',
    status: 'Submitted',
    createdVia: 'rep_form',
    reporter: 'pc_rep',
    isPublic: true,
    // The manual flow COMPLETED — raised by hand, the number typed back in, the
    // status set. This is the state the greyed-out button's note tells you to reach,
    // and without one on screen the instruction has no worked example.
    easyvista_ticket_id: 'EV-64180',
    easyvista_submitted_by: 'Policy Center App Admin',
    summary_of_issue: 'Producer portal should show the renewal quote before the invoice is cut',
    request:
      'Producers ring us the week before renewal to ask what the quote is, because the portal only '
      + 'shows the invoice once it exists. Showing the quote a week earlier would take that call away.',
    impact_details:
      'Roughly fifteen calls a week across the team, each three to four minutes, all of them asking '
      + 'the same question.',
    enhancementRequestType: 'Build-Small Enhancement',
    priorityLevel: '3 - Medium',
    reviewer: 'Policy Center App Admin',
    decision_notes:
      'The producer portal is a vendor product, so the portal cannot raise this itself. Submitted on '
      + 'the Service Desk by hand and the incident number entered here.',
    createdAt: iso(21, 9, 5),
    events: [
      { status: 'New', at: iso(21, 9, 5) },
      { status: 'Approved', at: iso(17, 11, 30), by: 'pc_app_admin' },
      { status: 'Submitted', at: iso(15, 15, 45), by: 'pc_app_admin' },
    ],
  },
  {
    key: 'marketing-new',
    application: NEW_APPLICATION,
    type: SUBMISSION_TYPE_REPORT,
    status: 'New',
    createdVia: 'rep_form',
    reporter: 'bc_rep',
    isPublic: true,
    isNewDashboard: true,
    summary_of_issue: 'Campaign response by channel, monthly',
    what_happened_exact_details:
      'Which channels the quotes we actually bind came from, month by month, so the team can stop '
      + 'buying the ones that never convert.',
    needed_data: 'Campaign source on the quote record, bind date, and written premium.',
    measures_and_sources:
      'Quotes started — from the campaign platform export\n'
      + 'Quotes bound — from the policy system\n'
      + 'Bind rate — bound ÷ started, per channel',
    primary_contact: 'Bailey Rep',
    reportUsageFrequency: 'Monthly',
    department: 'Marketing',
    createdAt: iso(5, 14, 20),
    events: [{ status: 'New', at: iso(5, 14, 20) }],
  },
  {
    key: 'marketing-change',
    application: NEW_APPLICATION,
    type: SUBMISSION_TYPE_REPORT,
    status: 'In progress',
    // Recorded by the analyst rather than filed through the form, so both creation
    // paths for a reports-only application are on screen.
    createdVia: 'admin_manual',
    createdBy: 'Dana Whitfield',
    createdByEmail: '-',
    isPublic: true,
    isNewDashboard: false,
    assignedTo: 'bc_report_analyst',
    levelOfEffort: 'M — up to a week',
    summary_of_issue: 'Add unsubscribe rate to the email engagement dashboard',
    request:
      'The dashboard shows opens and clicks but not unsubscribes, so a campaign that performed well '
      + 'on paper and cost us the list reads as a success.',
    changes_requested:
      'Add unsubscribes as a count and as a rate, on the same axis as clicks, and a filter for '
      + 'campaign type.',
    existing_report_link: 'Marketing shared drive → Engagement → Email engagement (weekly)',
    needed_data: 'Unsubscribe events, joined to the campaign id already on the dashboard.',
    reportUsageFrequency: 'Weekly',
    department: 'Marketing',
    createdAt: iso(12, 10, 10),
    events: [
      { status: 'New', at: iso(12, 10, 10) },
      { status: 'In progress', at: iso(8, 9, 25), by: 'bc_report_analyst' },
    ],
    assignments: [{ to: 'bc_report_analyst', by: 'admin', at: iso(8, 9, 25) }],
  },
];

async function mapByName(model, { lower = false } = {}) {
  const rows = await model.findAll({ attributes: ['id', 'name'], raw: true });
  return new Map(rows.map((row) => [lower ? String(row.name).toLowerCase() : String(row.name), Number(row.id)]));
}

function need(map, key, what) {
  const id = map.get(key);
  if (!id) throw new Error(`${what} "${key}" does not exist. Run npm run migrate first.`);
  return id;
}

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const {
    Submission, SubmissionStatusEvent, SubmissionType, Application,
    DefectEnhancementStatus, EnhancementRequestType, PriorityLevel,
    SubmissionSource, LevelOfEffort, RequestAssignment, UserApplicationRole, User,
  } = models;
  if (!Submission) throw new Error('Submission model is not initialized');

  const sequelize = Submission.sequelize;
  // The dialect first, every time: `dotenv` resolves `server/.env` from the CWD, so
  // running this from the repo root silently targets the local sql.js file and then
  // reports a confident wrong count. Read this line before believing the rest.
  const before = Number(await Submission.count());
  console.log(`${sequelize.getDialect()} · ${before} submissions, `
    + `${Number(await Application.count())} applications\n`);

  const summaries = SUBMISSIONS.map((entry) => entry.summary_of_issue);
  const already = await Submission.findAll({
    where: { summary_of_issue: summaries },
    attributes: ['id', 'summary_of_issue'],
    raw: true,
  });
  const existingApplication = (await Application.findAll({ attributes: ['id', 'name'], raw: true }))
    .find((row) => String(row.name).trim().toLowerCase() === NEW_APPLICATION.toLowerCase());

  const types = await mapByName(SubmissionType, { lower: true });
  const statuses = await mapByName(DefectEnhancementStatus);
  const enhancementTypes = await mapByName(EnhancementRequestType);
  const priorities = await mapByName(PriorityLevel);
  const sources = await mapByName(SubmissionSource, { lower: true });
  const effortLevels = await mapByName(LevelOfEffort);

  const userRows = await User.findAll({
    attributes: ['id', 'username', 'display_name', 'email'],
    raw: true,
  });
  const usersByName = new Map(userRows.map((row) => [row.username, row]));
  const userId = (username) => {
    const row = usersByName.get(username);
    if (!row) throw new Error(`Account "${username}" does not exist. Run npm run seed:team-accounts first.`);
    return Number(row.id);
  };

  const workers = await resolveReportWorkers(models);

  console.log('WHAT WILL BE SEEDED');
  console.log(`  1 application    ${NEW_APPLICATION} — reports-only, granted to `
    + `${workers.size} report worker(s)`);
  for (const entry of SUBMISSIONS) {
    const soft = entry.workingApplication ? `  → also shown in ${entry.workingApplication}` : '';
    const raised = entry.easyvista_ticket_id ? `  (raised by hand as ${entry.easyvista_ticket_id})` : '';
    console.log(`  ${entry.application.padEnd(20)} ${entry.type.padEnd(12)} ${entry.status.padEnd(12)}`
      + ` ${entry.summary_of_issue.slice(0, 46)}${soft}${raised}`);
  }
  console.log('\n  Nothing is Delivered and no hours are logged, on purpose — that is the');
  console.log('  modelling rule verify-throughput-page.mjs depends on, and it leaves the new');
  console.log('  queue structurally empty, which is the honest picture of a brand-new one.');

  if (already.length > 0 || existingApplication) {
    console.error('\nREFUSED: this set is already seeded.');
    for (const row of already) console.error(`  #${row.id} — ${row.summary_of_issue}`);
    if (existingApplication) console.error(`  application "${existingApplication.name}" (id ${existingApplication.id})`);
    console.error('Seeding again would produce a second indistinguishable copy.');
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Nothing was written.');
    console.log('To write:  node scripts/seedUnwiredWork.js --apply');
    return;
  }

  let applicationId = null;
  const created = [];
  await sequelize.transaction(async (transaction) => {
    // The application first — its requests need its id. Same shape as
    // reportApplicationService: reports-only, and granted in the SAME transaction,
    // because an application is a queue and one with no grants is visible to nobody.
    const highest = await Application.max('sort_order');
    const application = await Application.create({
      name: NEW_APPLICATION,
      sort_order: Number.isFinite(Number(highest)) ? Number(highest) + 1 : 1,
      is_active: 1,
      reports_only: 1,
    }, { transaction });
    applicationId = Number(application.id);
    const grantedAt = new Date().toISOString();
    for (const [user, role] of workers) {
      await UserApplicationRole.create({
        user_id: user,
        application_id: applicationId,
        role,
        request_type: SUBMISSION_TYPE_REPORT,
        granted_at: grantedAt,
        granted_by: 'seed:unwired-work',
      }, { transaction });
    }

    // The existing applications, plus the one just created — added by hand rather
    // than re-queried, because a `findAll` without this transaction cannot see a row
    // the transaction has not committed yet, and one WITH it would be a second
    // full scan to learn one id we are already holding.
    const applications = await mapByName(Application);
    applications.set(NEW_APPLICATION, applicationId);

    for (const entry of SUBMISSIONS) {
      const reporterRow = entry.reporter ? usersByName.get(entry.reporter) : null;
      if (entry.reporter && !reporterRow) {
        throw new Error(`Account "${entry.reporter}" does not exist. Run npm run seed:team-accounts first.`);
      }
      const lastEvent = entry.events[entry.events.length - 1];

      const row = await Submission.create({
        created_at: entry.createdAt,
        updated_at: lastEvent.at,
        status_update_at: lastEvent.at,
        created_via_id: need(sources, entry.createdVia, 'Submission source'),
        // A signed-in filer's name and email come from their users row, never from
        // the payload — writing anything else would produce a ticket the app itself
        // could not have created.
        created_by: reporterRow
          ? String(reporterRow.display_name || reporterRow.username)
          : entry.createdBy,
        created_by_email: reporterRow
          ? (String(reporterRow.email || '').trim() || '-')
          : (entry.createdByEmail || '-'),
        reporter_user_id: reporterRow ? Number(reporterRow.id) : null,
        type_id: need(types, entry.type, 'Submission type'),
        application_id: need(applications, entry.application, 'Application'),
        // The soft association. Only ever set on a ticket in `Other`.
        working_application_id: entry.workingApplication
          ? need(applications, entry.workingApplication, 'Application')
          : null,
        // Five NOT NULL columns that mean nothing to some of these types; the
        // submit route fills them with '-' and so does this.
        screen_title: entry.screen_title ?? '-',
        summary_of_issue: entry.summary_of_issue,
        steps_to_reproduce: entry.steps_to_reproduce ?? '-',
        what_happened_exact_details: entry.what_happened_exact_details ?? '-',
        request: entry.request ?? '-',
        date_time_of_error: entry.createdAt,
        status_id: need(statuses, entry.status, 'Status'),
        reviewer: entry.reviewer || null,
        decision_notes: entry.decision_notes || null,
        easyvista_ticket_id: entry.easyvista_ticket_id || null,
        easyvista_submitted_by: entry.easyvista_submitted_by || null,
        impact_details: entry.impact_details || null,
        enhancement_request_type_id: entry.enhancementRequestType
          ? need(enhancementTypes, entry.enhancementRequestType, 'Enhancement request type')
          : null,
        priority_level_id: entry.priorityLevel
          ? need(priorities, entry.priorityLevel, 'Priority level')
          : null,
        logged_defect: 0,
        needs_workaround: 0,
        workaround_provided: 0,
        is_cleanup: 0,
        is_retired: 0,
        is_public: entry.isPublic ? 1 : 0,
        // Tri-state on purpose: null means "not a report request", which is a
        // different answer from "a change to an existing one".
        is_new_dashboard: entry.type === SUBMISSION_TYPE_REPORT ? (entry.isNewDashboard ? 1 : 0) : null,
        needed_data: entry.needed_data || null,
        measures_and_sources: entry.measures_and_sources || null,
        primary_contact: entry.primary_contact || null,
        existing_report_link: entry.existing_report_link || null,
        changes_requested: entry.changes_requested || null,
        report_usage_frequency: entry.reportUsageFrequency || null,
        department: entry.department || null,
        assigned_to: entry.assignedTo ? userId(entry.assignedTo) : null,
        level_of_effort_id: entry.levelOfEffort
          ? need(effortLevels, entry.levelOfEffort, 'Level of effort')
          : null,
        // Never delivered, never any hours — see the header.
        completed_at: null,
        approved_at: null,
        approved_by_name: null,
      }, { transaction });

      for (const event of entry.events) {
        await SubmissionStatusEvent.create({
          submission_id: Number(row.id),
          status: event.status,
          changed_at: event.at,
          changed_by: event.by || null,
        }, { transaction });
      }
      for (const item of entry.assignments || []) {
        await RequestAssignment.create({
          submission_id: Number(row.id),
          assigned_to: item.to ? userId(item.to) : null,
          assigned_by: item.by ? userId(item.by) : null,
          assigned_at: item.at,
        }, { transaction });
      }
      created.push({ id: Number(row.id), entry });
    }
  });

  // Read it back rather than trust the transaction: this is the shared database,
  // and "4 rows created" is not the same claim as "the rows say what I wanted".
  const after = Number(await Submission.count());
  console.log(`\n${after} submissions after (was ${before}, seeded ${created.length})`);
  console.log(`Application "${NEW_APPLICATION}" is id ${applicationId}, granted to ${workers.size}.\n`);
  for (const { id, entry } of created) {
    const check = await Submission.findByPk(id, {
      attributes: ['id', 'application_id', 'working_application_id', 'easyvista_ticket_id'],
      raw: true,
    });
    console.log(`  #${id}  ${entry.summary_of_issue.slice(0, 50)}`);
    console.log(`        application=${check.application_id}`
      + ` working=${check.working_application_id ?? '—'}`
      + ` incident=${check.easyvista_ticket_id ?? '—'}`);
  }
  if (after !== before + created.length) {
    console.error('\nThe count does not match what was seeded. Check the table.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
