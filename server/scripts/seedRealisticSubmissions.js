#!/usr/bin/env node
/**
 * The documentation data set: tickets worth screenshotting.
 *
 *   node scripts/seedRealisticSubmissions.js            # dry run — the whole plan
 *   node scripts/seedRealisticSubmissions.js --apply    # write
 *
 * WHY THIS EXISTS AND `src/seedSampleData.js` DOES NOT DO IT. That script is the
 * local-development bootstrap: five rows, all Billing Center, all written through
 * the LEGACY TEXT COLUMNS (`type`, `status`, `application_name`) that no longer
 * exist on the hosted schema. It also refuses to run against a non-empty table,
 * which is right for a bootstrap and useless for a reseed. This script writes the
 * FK columns the portal actually reads, and it exists because the screenshots in
 * the user manual were going to show a board where every summary read "Testing".
 *
 * WHAT IT IS TRYING TO BE. Not "some rows" — a portal that has plainly been in
 * use for a few months, in which every surface of the app has something real to
 * draw:
 *
 *   - All FOUR kinds of work: defects, enhancements, cleanup tasks (a flag on a
 *     defect or an enhancement, never a type of its own) and report requests.
 *   - All THREE applications, including `Other` — the queue a report request
 *     lands in when nobody yet knows whose data it is about.
 *   - Both branches of a report request: a brand-new dashboard, and a change to
 *     one that exists.
 *   - Every status in the table, including the three that belong to report
 *     requests alone (In progress · Delivered · On hold), so the queue's status
 *     filter and the public board's two tracks both have rows.
 *   - Hours logged by more than one analyst, across three months, so the
 *     throughput page's charts are not empty at its default "Last 3 months".
 *   - Approvals — a name AND a date, because either alone is half-typed and
 *     `is_approved` deliberately requires both.
 *   - Some public, some not; some retired; a duplicate pointing at its original;
 *     a ticket handed between two queues with the ledger row that proves it.
 *
 * WHAT IT DOES NOT SEED, and why:
 *   - ATTACHMENTS. A file needs bytes somewhere. Locally that is `server/uploads`,
 *     which the deployed instance cannot read, and on the deployed instance it is
 *     a Supabase Storage bucket this box has no credentials for. A row pointing at
 *     a file that is not there is worse than an empty Files tab, so the Files tab
 *     is empty and the manual says so.
 *   - USERS AND GRANTS. The eight working accounts are `seedTeamAccounts.js`'s to
 *     define, including their display names — which are deliberately descriptive
 *     ("Billing Center Report Analyst") rather than personal. Two scripts writing
 *     the same rows is how they come to disagree. Requester names on anonymously
 *     filed tickets are free text on the ticket itself, which is why THOSE read
 *     like people.
 *
 * IT REFUSES A NON-EMPTY TABLE unless `--allow-existing`. Running it twice would
 * otherwise double every ticket, and the second set would be indistinguishable
 * from the first. Purge first: `node scripts/purgeSubmissions.js`.
 */
require('dotenv').config();
const dbApi = require('../db');
const { calculateOccurrenceRate } = require('../src/helpers/utils');

const APPLY = process.argv.includes('--apply');
const ALLOW_EXISTING = process.argv.includes('--allow-existing');

// ── Time ─────────────────────────────────────────────────────────────────────
// Relative to the run, not absolute, so a reseed months from now still produces a
// board that looks current rather than one that looks abandoned. The throughput
// page's default window is "Last 3 months", so the deliveries below are spread
// across this month and the two before it on purpose.
function daysAgo(days, hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}
/** The DAY an hours entry belongs to. `worked_on` is a date, not a moment. */
function dayAgo(days) {
  return daysAgo(days).slice(0, 10);
}

const BILLING = 'Billing Center';
const POLICY = 'Policy Center';
const OTHER = 'Other';

// The accounts, by username. Assignees and reporters are ids in the database, and
// naming them here rather than numbering them means this file survives the
// accounts being reseeded in a different order.
const BC_ANALYST = 'bc_report_analyst';
const PC_ANALYST = 'pc_report_analyst';
const BC_OWNER = 'bc_owner_analyst';
const PC_OWNER = 'pc_owner_analyst';
const BC_REP = 'bc_rep';
const PC_REP = 'pc_rep';

/**
 * The data set.
 *
 * `events` are the status history, in the words the app itself writes: a status
 * change is logged as `Defect/Enhancement Status: <name>` for EVERY type (the
 * public board strips that prefix back off — see normalizeEventStatus), the
 * first entry is a bare `New`, and a cleanup carries `Cleanup Status: <name>`.
 * Getting those strings wrong does not fail anything loudly; it just quietly
 * empties the dates under the public board's track.
 */
const SUBMISSIONS = [
  // ══ Billing Center · defects ═══════════════════════════════════════════════
  {
    key: 'bc-invoice-zero-balance',
    type: 'defect',
    application: BILLING,
    status: 'Submitted',
    createdBy: 'Dana Whitfield',
    createdByEmail: 'dana.whitfield@example.invalid',
    createdAt: daysAgo(34, 9, 12),
    updatedAt: daysAgo(21, 14, 5),
    screen_title: 'Account Summary → Billing',
    summary_of_issue: 'Direct bill invoice shows a zero balance while a payment is still pending',
    steps_to_reproduce: '1. Open a direct bill account with an unapplied payment.\n2. Take a payment that does not cover the invoice.\n3. Reopen the Billing tab.',
    what_happened_exact_details: 'The invoice header reads $0.00 due while the Unapplied Funds panel still holds the payment. Refreshing does not correct it; reopening the account from search does.',
    request: 'Show the real balance due until the payment has been applied.',
    dateTimeOfError: daysAgo(35, 15, 40),
    policy_num: 'BC-4471902',
    account_num: '7734-1180',
    transaction_num: 'TX-88214',
    reviewer: 'bc_app_admin',
    decision_notes: 'Reproduced on 26.2.4. Raised with the Service Desk as a billing display defect.',
    easyvista_ticket_id: 'SD-118204',
    easyvista_submitted_by: 'bc_app_admin',
    impact_notes: 'Service reps quote the wrong balance to the insured while the payment is in suspense.',
    direct_dollar_impact: 0,
    policies_affected_count: 240,
    occurrence: { count: 18, timeframeCount: 1, timeframe: 'Month' },
    needs_workaround: true,
    workaround_provided: true,
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(34, 9, 12) },
      { status: 'Workaround requested by requester', at: daysAgo(34, 9, 12) },
      { status: 'Workaround provided', at: daysAgo(32, 11, 30), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(30, 16, 0), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Submitted', at: daysAgo(21, 14, 5), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'bc-writeoff-limit',
    type: 'defect',
    application: BILLING,
    status: 'Approved',
    createdBy: 'Marcus Delaney',
    createdByEmail: 'marcus.delaney@example.invalid',
    createdAt: daysAgo(12, 11, 3),
    updatedAt: daysAgo(6, 9, 45),
    screen_title: 'Account → Write-off',
    summary_of_issue: 'Write-off screen rejects amounts over $1,000 without saying why',
    steps_to_reproduce: '1. Open any account with a balance over $1,000.\n2. Choose Write-off.\n3. Enter 1500 and submit.',
    what_happened_exact_details: 'The page returns to the top with no message and nothing is written. Under $1,000 saves normally, so the limit is real but unstated.',
    request: 'Either raise the threshold or tell the user what the limit is and who can approve above it.',
    dateTimeOfError: daysAgo(12, 10, 50),
    account_num: '5510-9924',
    reviewer: 'bc_app_admin',
    decision_notes: 'Accepted. The limit is a configured authority level; the missing message is the defect.',
    impact_notes: 'Every write-off above the threshold becomes a phone call to the billing supervisor.',
    direct_dollar_impact: 4200,
    policies_affected_count: 36,
    occurrence: { count: 9, timeframeCount: 1, timeframe: 'Week' },
    needs_workaround: true,
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(12, 11, 3) },
      { status: 'Workaround requested by requester', at: daysAgo(12, 11, 3) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(6, 9, 45), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'bc-delinquency-notice',
    type: 'defect',
    application: BILLING,
    status: 'Deployed',
    createdBy: 'Priya Raghunathan',
    createdByEmail: 'priya.raghunathan@example.invalid',
    createdAt: daysAgo(78, 8, 30),
    updatedAt: daysAgo(19, 17, 10),
    screen_title: 'Delinquency Process',
    summary_of_issue: 'Delinquency re-issues a cancellation notice after the policy has been reinstated',
    steps_to_reproduce: '1. Let an account reach delinquency.\n2. Take payment in full and reinstate.\n3. Wait for the overnight batch.',
    what_happened_exact_details: 'The overnight run sends a second cancellation notice to insureds who had already paid. Twenty-two went out before it was caught.',
    request: 'Stop the notice when the delinquency has been cured before the batch runs.',
    dateTimeOfError: daysAgo(79, 3, 0),
    policy_num: 'BC-4390118',
    reviewer: 'bc_app_admin',
    decision_notes: 'Fixed in 26.3.1. Confirmed against the reinstatement path in staging.',
    easyvista_ticket_id: 'SD-117440',
    easyvista_submitted_by: 'bc_app_admin',
    jira_number: 'BILL-2214',
    release_number: '26.3.1',
    release_notes: 'Delinquency batch now re-reads the cure state before issuing notices.',
    impact_notes: 'Twenty-two insureds received a cancellation notice for a policy that was current.',
    direct_dollar_impact: 18500,
    policies_affected_count: 22,
    occurrence: { count: 3, timeframeCount: 1, timeframe: 'Month' },
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(78, 8, 30) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(76, 10, 0), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Submitted', at: daysAgo(74, 11, 15), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Deployed', at: daysAgo(19, 17, 10), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'bc-payment-allocation',
    type: 'defect',
    application: BILLING,
    status: 'New',
    createdBy: 'Tomas Ferreira',
    createdByEmail: 'tomas.ferreira@example.invalid',
    createdAt: daysAgo(2, 13, 22),
    updatedAt: daysAgo(2, 13, 22),
    screen_title: 'Payment Entry',
    summary_of_issue: 'Payment allocation loses the suspense entry when two payments post in the same minute',
    steps_to_reproduce: '1. Take two payments on the same account within the same minute.\n2. Open Unapplied Funds.',
    what_happened_exact_details: 'Only one of the two payments appears in suspense. The money is on the account ledger, so nothing is lost, but the second payment cannot be allocated from the screen.',
    request: 'Both payments should be listed so either can be applied.',
    dateTimeOfError: daysAgo(2, 12, 55),
    account_num: '4402-7781',
    needs_workaround: true,
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(2, 13, 22) },
      { status: 'Workaround requested by requester', at: daysAgo(2, 13, 22) },
    ],
  },
  {
    key: 'bc-search-apostrophe',
    type: 'defect',
    application: BILLING,
    status: 'Duplicate',
    duplicateOfKey: 'bc-payment-allocation',
    createdBy: 'Alina Brzezinski',
    createdByEmail: 'alina.brzezinski@example.invalid',
    createdAt: daysAgo(1, 15, 40),
    updatedAt: daysAgo(1, 16, 20),
    screen_title: 'Payment Entry',
    summary_of_issue: 'Second payment taken in the same minute does not show in unapplied funds',
    steps_to_reproduce: 'Two payments, one account, same minute.',
    what_happened_exact_details: 'The second one is not listed under Unapplied Funds.',
    request: 'Show both.',
    dateTimeOfError: daysAgo(1, 15, 10),
    account_num: '4402-7781',
    reviewer: 'bc_app_admin',
    decision_notes: 'Same defect as the one already open on this account. Closed as a duplicate.',
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(1, 15, 40) },
      { status: 'Defect/Enhancement Status: Duplicate', at: daysAgo(1, 16, 20), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'bc-statement-prior-term',
    type: 'defect',
    application: BILLING,
    status: 'Rejected',
    createdBy: 'Gregory Nkemdirim',
    createdByEmail: 'gregory.nkemdirim@example.invalid',
    createdAt: daysAgo(46, 10, 15),
    updatedAt: daysAgo(41, 15, 30),
    screen_title: 'Statement Print',
    summary_of_issue: 'Statement PDF prints the prior term premium in the summary box',
    steps_to_reproduce: '1. Print a statement for a renewed policy.\n2. Compare the summary box against the current term.',
    what_happened_exact_details: 'The summary box quotes the expiring term. The line items below it are correct for the new term.',
    request: 'Print the current term premium in the summary.',
    dateTimeOfError: daysAgo(47, 9, 0),
    policy_num: 'BC-4188220',
    reviewer: 'bc_owner_analyst',
    decision_notes: 'Not a defect. The summary box is specified to show the term being billed, which for an advance statement is the expiring term. Referred to the forms team for wording.',
    logged_defect: false,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(46, 10, 15) },
      { status: 'Defect/Enhancement Status: Requires Additional Review', at: daysAgo(44, 11, 0), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Rejected', at: daysAgo(41, 15, 30), by: 'bc_owner_analyst' },
    ],
  },
  {
    key: 'bc-collections-legacy',
    type: 'defect',
    application: BILLING,
    status: 'Retired',
    isRetired: true,
    createdBy: 'Hannah Oyelaran',
    createdByEmail: 'hannah.oyelaran@example.invalid',
    createdAt: daysAgo(180, 9, 0),
    updatedAt: daysAgo(96, 12, 0),
    screen_title: 'Collections (legacy)',
    summary_of_issue: 'Legacy collections screen throws an error on load',
    steps_to_reproduce: 'Open Collections from the old menu.',
    what_happened_exact_details: 'A server error page. The replacement screen works.',
    request: 'Fix or remove the old screen.',
    dateTimeOfError: daysAgo(181, 14, 0),
    reviewer: 'bc_owner_analyst',
    decision_notes: 'The screen was removed in 26.2. Retiring the ticket rather than fixing a page that no longer exists.',
    logged_defect: false,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(180, 9, 0) },
      { status: 'Defect/Enhancement Status: Deferred – Not in Current Scope', at: daysAgo(150, 10, 0), by: 'bc_app_admin' },
      { status: 'Retired', at: daysAgo(96, 12, 0), by: 'bc_owner_analyst' },
    ],
  },
  {
    key: 'bc-monitoring-rounding',
    type: 'defect',
    application: BILLING,
    status: 'Backlog - Monitoring Impact',
    createdBy: 'Elliot Vasquez',
    createdByEmail: 'elliot.vasquez@example.invalid',
    createdAt: daysAgo(58, 14, 0),
    updatedAt: daysAgo(50, 9, 30),
    screen_title: 'Installment Schedule',
    summary_of_issue: 'Final installment is a cent out on quarterly pay plans',
    steps_to_reproduce: 'Set up a quarterly plan on a premium that does not divide by four.',
    what_happened_exact_details: 'The last installment is one cent under the remaining balance, which leaves the account a cent short at term end.',
    request: 'Round the final installment to clear the balance.',
    dateTimeOfError: daysAgo(59, 11, 0),
    reviewer: 'bc_app_admin',
    decision_notes: 'Real but tiny. Held in the backlog while we count how many accounts it touches per month.',
    impact_notes: 'A one-cent residual blocks automatic account closure.',
    direct_dollar_impact: 0.01,
    policies_affected_count: 1400,
    occurrence: { count: 1400, timeframeCount: 1, timeframe: 'Quarter' },
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(58, 14, 0) },
      { status: 'Defect/Enhancement Status: Backlog - Monitoring Impact', at: daysAgo(50, 9, 30), by: 'bc_app_admin' },
    ],
  },

  {
    key: 'bc-refund-check-address',
    type: 'defect',
    application: BILLING,
    status: 'Requires Additional Review',
    createdBy: 'Yolanda Pretorius',
    createdByEmail: 'yolanda.pretorius@example.invalid',
    createdAt: daysAgo(17, 9, 55),
    updatedAt: daysAgo(14, 13, 10),
    screen_title: 'Disbursement → Refund',
    summary_of_issue: 'Refund cheque prints the agency address instead of the insured address',
    steps_to_reproduce: '1. Raise a refund on an agency bill account.\n2. Print the cheque.',
    what_happened_exact_details: 'The payee is the insured and the address is the agency. Two cheques went to the agency and had to be reissued.',
    request: 'Print the insured address when the payee is the insured.',
    dateTimeOfError: daysAgo(18, 11, 30),
    account_num: '6621-4408',
    reviewer: 'bc_app_admin',
    decision_notes: 'May be intentional for agency bill — the agency handles the refund in some states. Checking with Compliance before accepting it as a defect.',
    impact_notes: 'A refund cheque reaching the wrong party is a compliance exposure, not just a reissue cost.',
    direct_dollar_impact: 2140,
    policies_affected_count: 2,
    logged_defect: false,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(17, 9, 55) },
      { status: 'Defect/Enhancement Status: Requires Additional Review', at: daysAgo(14, 13, 10), by: 'bc_app_admin' },
    ],
  },

  // ══ Billing Center · cleanup tasks ═════════════════════════════════════════
  // A cleanup is a FLAG on a defect or an enhancement, plus its own status. Its
  // `cleanup_tag_type` says which it started as; `cleanup_only` means it was
  // never anybody's bug report.
  {
    key: 'bc-cleanup-billplan-column',
    type: 'defect',
    application: BILLING,
    status: 'New',
    isCleanup: true,
    cleanupStatus: 'In Progress',
    cleanupTagType: 'defect',
    createdBy: 'bc_app_admin',
    createdByEmail: 'bc.appadmin@example.invalid',
    createdVia: 'admin_cleanup',
    createdAt: daysAgo(27, 10, 0),
    updatedAt: daysAgo(9, 16, 45),
    screen_title: 'Invoice Grid',
    summary_of_issue: 'Remove the unused Bill Plan Override column from the invoice grid',
    steps_to_reproduce: '-',
    what_happened_exact_details: 'The column has been blank on every account since the 25.4 upgrade. It is still in the export.',
    request: 'Drop the column from the grid and the export.',
    dateTimeOfError: daysAgo(27, 10, 0),
    reviewer: 'bc_app_admin',
    isPublic: false,
    events: [
      { status: 'New', at: daysAgo(27, 10, 0) },
      { status: 'Cleanup Status: Not Started', at: daysAgo(27, 10, 0) },
      { status: 'Cleanup Status: In Progress', at: daysAgo(9, 16, 45), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'bc-cleanup-payment-links',
    type: 'enhancement',
    application: BILLING,
    status: 'New',
    isCleanup: true,
    cleanupStatus: 'Not Started',
    cleanupTagType: 'enhancement',
    enhancementRequestType: 'Run-Other Operational Work',
    priorityLevel: '4 - Low',
    createdBy: 'bc_owner_analyst',
    createdByEmail: 'bc.owner@example.invalid',
    createdVia: 'admin_cleanup',
    createdAt: daysAgo(15, 13, 30),
    updatedAt: daysAgo(15, 13, 30),
    screen_title: '-',
    summary_of_issue: 'Retire the duplicated Payment Detail report links',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Three menu entries open the same Payment Detail report. Keep one.',
    dateTimeOfError: daysAgo(15, 13, 30),
    isPublic: false,
    events: [
      { status: 'New', at: daysAgo(15, 13, 30) },
      { status: 'Cleanup Status: Not Started', at: daysAgo(15, 13, 30) },
    ],
  },
  {
    key: 'bc-cleanup-only-templates',
    type: 'defect',
    application: BILLING,
    status: 'New',
    isCleanup: true,
    cleanupStatus: 'Completed',
    cleanupTagType: 'cleanup_only',
    createdBy: 'bc_app_admin',
    createdByEmail: 'bc.appadmin@example.invalid',
    createdVia: 'admin_cleanup',
    createdAt: daysAgo(64, 9, 20),
    updatedAt: daysAgo(24, 11, 0),
    screen_title: '-',
    summary_of_issue: 'Archive the pre-2019 statement templates',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Forty-one templates predate the current statement format and cannot be selected. Archive them so the list is readable.',
    dateTimeOfError: daysAgo(64, 9, 20),
    reviewer: 'bc_app_admin',
    isPublic: false,
    events: [
      { status: 'Cleanup Status: New Cleanup item created', at: daysAgo(64, 9, 20) },
      { status: 'Defect/Enhancement Status: Switched to Cleanup Only', at: daysAgo(64, 9, 20) },
      { status: 'Cleanup Status: In Progress', at: daysAgo(38, 10, 0), by: 'bc_app_admin' },
      { status: 'Cleanup Status: Completed', at: daysAgo(24, 11, 0), by: 'bc_app_admin' },
    ],
  },

  // ══ Billing Center · enhancements ══════════════════════════════════════════
  {
    key: 'bc-bulk-apply-payment',
    type: 'enhancement',
    application: BILLING,
    status: 'Approved',
    enhancementRequestType: 'Build-Small Enhancement',
    priorityLevel: '2 - High',
    createdBy: 'Dana Whitfield',
    createdByEmail: 'dana.whitfield@example.invalid',
    createdAt: daysAgo(23, 9, 5),
    updatedAt: daysAgo(11, 10, 40),
    screen_title: '-',
    summary_of_issue: 'Add a bulk Apply Payment action to the unapplied funds screen',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Allocating a day of lockbox payments is one account at a time. Let us select several suspense entries and apply them in one pass.',
    dateTimeOfError: daysAgo(23, 9, 5),
    desiredCompletionDate: daysAgo(-60, 12, 0),
    reviewer: 'bc_owner_analyst',
    decision_notes: 'Approved for the next small-enhancement slot. Sized with the billing team at roughly a week.',
    impact_details: 'Saves the two lockbox clerks about forty minutes each per day.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(23, 9, 5) },
      { status: 'Defect/Enhancement Status: Pending Management Approval', at: daysAgo(18, 14, 0), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(11, 10, 40), by: 'bc_owner_analyst' },
    ],
  },
  {
    key: 'bc-next-invoice-date',
    type: 'enhancement',
    application: BILLING,
    status: 'Submitted',
    enhancementRequestType: 'Build-Small Enhancement',
    priorityLevel: '3 - Medium',
    createdBy: 'Tomas Ferreira',
    createdByEmail: 'tomas.ferreira@example.invalid',
    createdAt: daysAgo(52, 11, 25),
    updatedAt: daysAgo(29, 9, 0),
    screen_title: '-',
    summary_of_issue: 'Show the next scheduled invoice date on the policy summary',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Reps open the billing tab only to read the next invoice date. Put it on the summary.',
    dateTimeOfError: daysAgo(52, 11, 25),
    reviewer: 'bc_app_admin',
    decision_notes: 'Sent to the Service Desk with the 26.4 batch.',
    easyvista_ticket_id: 'SD-119012',
    easyvista_submitted_by: 'bc_app_admin',
    impact_details: 'One fewer screen on most billing calls.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(52, 11, 25) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(40, 15, 0), by: 'bc_app_admin' },
      { status: 'Defect/Enhancement Status: Submitted', at: daysAgo(29, 9, 0), by: 'bc_app_admin' },
    ],
  },
  {
    key: 'bc-delinquency-export',
    type: 'enhancement',
    application: BILLING,
    status: 'Future Consideration',
    enhancementRequestType: 'Build-Small Project (Not PPM Funded)',
    priorityLevel: '4 - Low',
    createdBy: 'Marcus Delaney',
    createdByEmail: 'marcus.delaney@example.invalid',
    createdAt: daysAgo(69, 16, 10),
    updatedAt: daysAgo(55, 11, 20),
    screen_title: '-',
    summary_of_issue: 'Let a billing analyst export the delinquency worklist to Excel',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'The worklist is read on screen and retyped into a spreadsheet every Monday.',
    dateTimeOfError: daysAgo(69, 16, 10),
    reviewer: 'bc_owner_analyst',
    decision_notes: 'Worth doing, not this year. A report request may cover it sooner — see the ageing dashboard.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(69, 16, 10) },
      { status: 'Defect/Enhancement Status: Future Consideration', at: daysAgo(55, 11, 20), by: 'bc_owner_analyst' },
    ],
  },
  {
    key: 'bc-autopay-confirmation',
    type: 'enhancement',
    application: BILLING,
    status: 'Deployed',
    enhancementRequestType: 'Run-Compliance/Regulatory/Rate Revision',
    priorityLevel: '1 - Urgent',
    createdBy: 'Priya Raghunathan',
    createdByEmail: 'priya.raghunathan@example.invalid',
    createdAt: daysAgo(112, 10, 0),
    updatedAt: daysAgo(33, 14, 30),
    screen_title: '-',
    summary_of_issue: 'Send a written confirmation when a rep enrols an insured in autopay',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'The state requires written confirmation of recurring payment authorisation. Nothing is sent today.',
    dateTimeOfError: daysAgo(112, 10, 0),
    reviewer: 'bc_owner_analyst',
    decision_notes: 'Compliance-driven. Prioritised ahead of the queue and released in 26.3.',
    easyvista_ticket_id: 'SD-116102',
    easyvista_submitted_by: 'bc_owner_analyst',
    jira_number: 'BILL-2088',
    release_number: '26.3.0',
    release_notes: 'Autopay enrolment now queues the AUTH-CONF letter.',
    impact_details: 'Closes a documented compliance gap.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(112, 10, 0) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(108, 9, 0), by: 'bc_owner_analyst' },
      { status: 'Defect/Enhancement Status: Submitted', at: daysAgo(101, 13, 0), by: 'bc_owner_analyst' },
      { status: 'Defect/Enhancement Status: Deployed', at: daysAgo(33, 14, 30), by: 'bc_owner_analyst' },
    ],
  },

  // ══ Billing Center · report requests ═══════════════════════════════════════
  // A report request is only visible on the public board to the person who filed
  // it, so every one of these has a reporter. `is_new_dashboard` picks the branch:
  // a NEW dashboard states its measures and their sources, a CHANGE names the
  // report and what should change about it.
  {
    key: 'bc-report-unapplied-ageing',
    type: 'report',
    application: BILLING,
    status: 'Delivered',
    reporter: BC_REP,
    createdAt: daysAgo(74, 9, 30),
    updatedAt: daysAgo(16, 15, 20),
    summary_of_issue: 'Unapplied cash by agency, aged',
    what_happened_exact_details: 'We cannot see how long money has been sitting in suspense per agency. Month-end reconciliation is done by exporting everything and pivoting it by hand.',
    isNewDashboard: true,
    measures_and_sources: 'Unapplied balance and age in days, from the suspense ledger. Grouped by agency from the producer code on the account.',
    needed_data: 'Suspense entries with their posting date, the account, and the agency that owns it.',
    primary_contact: 'Renata Alcázar, Billing Operations',
    reportUsageFrequency: 'Weekly',
    department: 'Billing Operations',
    desiredCompletionDate: daysAgo(20, 12, 0),
    levelOfEffort: 'M — up to a week',
    assignedTo: BC_ANALYST,
    approvedAt: daysAgo(66, 14, 0),
    approvedByName: 'Colleen Mabuza (Billing Operations Manager)',
    approvalRecordedBy: BC_ANALYST,
    completedAt: daysAgo(16, 15, 20),
    delivery_notes: 'Published to the Billing workspace as "Unapplied Cash Ageing". Refreshes nightly at 04:15. Agency grouping comes from the producer code, so accounts with no producer land in an Unassigned bucket — agreed with Renata as acceptable.',
    reviewer: 'bc_report_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(74, 9, 30) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(66, 14, 0), by: 'bc_report_analyst' },
      { status: 'Defect/Enhancement Status: In progress', at: daysAgo(44, 9, 0), by: 'bc_report_analyst' },
      { status: 'Defect/Enhancement Status: Delivered', at: daysAgo(16, 15, 20), by: 'bc_report_analyst' },
    ],
    assignments: [
      { to: BC_ANALYST, by: BC_OWNER, at: daysAgo(66, 14, 5) },
    ],
    hours: [
      { user: BC_ANALYST, hours: 3.5, on: dayAgo(44), note: 'Scoping session with Billing Operations; agreed the ageing buckets.' },
      { user: BC_ANALYST, hours: 6, on: dayAgo(40), note: 'Suspense ledger extract and the producer-code join.' },
      { user: BC_OWNER, hours: 2.25, on: dayAgo(38), note: 'Reviewed the agency grouping against the producer hierarchy.' },
      { user: BC_ANALYST, hours: 5.5, on: dayAgo(22), note: 'Built the ageing visual and the drill-through.' },
      { user: BC_ANALYST, hours: 1.75, on: dayAgo(16), note: 'Hand-over walkthrough and publish.' },
    ],
  },
  {
    key: 'bc-report-writeoff-column',
    type: 'report',
    application: BILLING,
    status: 'In progress',
    reporter: BC_REP,
    createdAt: daysAgo(31, 14, 0),
    updatedAt: daysAgo(4, 10, 15),
    summary_of_issue: 'Add a write-off column to the Monthly Billing Summary',
    what_happened_exact_details: 'The summary shows billed, collected and outstanding. Write-offs are missing, so the three columns do not reconcile and we explain the gap by hand every month.',
    isNewDashboard: false,
    existing_report_link: 'Billing workspace → Monthly Billing Summary (the one the controller circulates)',
    changes_requested: 'Add total write-offs for the month as its own column, next to Collected, and include it in the reconciliation total at the foot.',
    request: 'The three columns shown do not add up to the opening balance, and nothing on the report says why.',
    needed_data: 'Write-off transactions for the month, by account.',
    reportUsageFrequency: 'Monthly',
    department: 'Finance',
    levelOfEffort: 'S — up to 2 days',
    assignedTo: BC_OWNER,
    approvedAt: daysAgo(27, 11, 30),
    approvedByName: 'Yusuf Adeyemi (Controller)',
    approvalRecordedBy: BC_OWNER,
    reviewer: 'bc_owner_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(31, 14, 0) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(27, 11, 30), by: 'bc_owner_analyst' },
      { status: 'Defect/Enhancement Status: In progress', at: daysAgo(8, 9, 30), by: 'bc_owner_analyst' },
    ],
    assignments: [
      { to: BC_ANALYST, by: BC_OWNER, at: daysAgo(27, 11, 35) },
      // Reassigned once. This is what request_assignments exists for — without it
      // the first analyst's involvement would disappear the moment it moved.
      { to: BC_OWNER, by: BC_OWNER, at: daysAgo(8, 9, 25) },
    ],
    hours: [
      { user: BC_ANALYST, hours: 1.5, on: dayAgo(26), note: 'Read the existing summary definition.' },
      { user: BC_OWNER, hours: 4, on: dayAgo(8), note: 'Added the write-off measure; reconciliation now balances in test.' },
      { user: BC_OWNER, hours: 2.5, on: dayAgo(4), note: 'Controller review; wording of the column heading.' },
    ],
  },
  {
    key: 'bc-report-agency-receivables',
    type: 'report',
    application: BILLING,
    status: 'On hold',
    reporter: BC_REP,
    createdAt: daysAgo(48, 10, 45),
    updatedAt: daysAgo(26, 16, 0),
    summary_of_issue: 'Agency bill receivables ageing by producer',
    what_happened_exact_details: 'We need to see what each producer owes us and for how long, so the agency managers can chase it themselves instead of asking us for a list.',
    isNewDashboard: true,
    measures_and_sources: 'Outstanding agency bill balance by ageing bucket, from the agency bill ledger. Producer name and branch from the producer table.',
    needed_data: 'Open agency bill items with due dates, and the producer hierarchy.',
    primary_contact: 'Devon Achterberg, Agency Services',
    reportUsageFrequency: 'Monthly',
    department: 'Agency Services',
    reviewer: 'bc_report_analyst',
    decision_notes: 'Held: the producer hierarchy is being restructured this quarter and any grouping built now would have to be redone.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(48, 10, 45) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(40, 13, 0), by: 'bc_report_analyst' },
      { status: 'Defect/Enhancement Status: On hold', at: daysAgo(26, 16, 0), by: 'bc_report_analyst' },
    ],
  },
  {
    key: 'bc-report-suspense-worklist',
    type: 'report',
    application: BILLING,
    status: 'Approved',
    reporter: BC_ANALYST,
    createdAt: daysAgo(10, 8, 50),
    updatedAt: daysAgo(7, 11, 0),
    summary_of_issue: 'Daily suspense clearing worklist',
    what_happened_exact_details: 'A morning list of suspense entries over three days old, ordered by amount, so the clearing team knows where to start.',
    isNewDashboard: true,
    measures_and_sources: 'Suspense entries with age and amount, from the suspense ledger. No grouping — it is a worklist, not a summary.',
    needed_data: 'Open suspense entries, their posting date and amount, and the account they belong to.',
    primary_contact: 'Renata Alcázar, Billing Operations',
    reportUsageFrequency: 'Daily',
    department: 'Billing Operations',
    desiredCompletionDate: daysAgo(-21, 12, 0),
    levelOfEffort: 'S — up to 2 days',
    assignedTo: BC_ANALYST,
    approvedAt: daysAgo(7, 11, 0),
    approvedByName: 'Colleen Mabuza (Billing Operations Manager)',
    approvalRecordedBy: BC_ANALYST,
    reviewer: 'bc_report_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(10, 8, 50) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(7, 11, 0), by: 'bc_report_analyst' },
    ],
    assignments: [
      { to: BC_ANALYST, by: BC_ANALYST, at: daysAgo(7, 11, 5) },
    ],
  },
  {
    key: 'bc-report-collections-branch',
    type: 'report',
    application: BILLING,
    status: 'Delivered',
    reporter: BC_REP,
    createdAt: daysAgo(96, 13, 15),
    updatedAt: daysAgo(41, 16, 40),
    summary_of_issue: 'Split the Collections Activity report by branch',
    what_happened_exact_details: 'The report is a single company-wide figure. Each branch manager needs their own, and today somebody filters the export for them one at a time.',
    isNewDashboard: false,
    existing_report_link: 'Billing workspace → Collections Activity (weekly)',
    changes_requested: 'Add a branch slicer and a per-branch subtotal, keeping the company total as it is.',
    request: 'One number for the whole company cannot be acted on by anybody who runs a branch.',
    reportUsageFrequency: 'Weekly',
    department: 'Collections',
    levelOfEffort: 'S — up to 2 days',
    assignedTo: BC_OWNER,
    approvedAt: daysAgo(90, 10, 0),
    approvedByName: 'Colleen Mabuza (Billing Operations Manager)',
    approvalRecordedBy: BC_OWNER,
    completedAt: daysAgo(41, 16, 40),
    delivery_notes: 'Branch slicer added from the account servicing branch, not the producer branch — the two disagree for about 3% of accounts and servicing is the one Collections work by. Noted on the report itself.',
    reviewer: 'bc_owner_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(96, 13, 15) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(90, 10, 0), by: 'bc_owner_analyst' },
      { status: 'Defect/Enhancement Status: In progress', at: daysAgo(50, 9, 0), by: 'bc_owner_analyst' },
      { status: 'Defect/Enhancement Status: Delivered', at: daysAgo(41, 16, 40), by: 'bc_owner_analyst' },
    ],
    assignments: [
      { to: BC_OWNER, by: BC_OWNER, at: daysAgo(90, 10, 5) },
    ],
    hours: [
      { user: BC_OWNER, hours: 2, on: dayAgo(50), note: 'Confirmed which branch field Collections work by.' },
      { user: BC_OWNER, hours: 4.5, on: dayAgo(45), note: 'Slicer, subtotals and a re-test of the company total.' },
      { user: BC_ANALYST, hours: 1, on: dayAgo(41), note: 'Peer review before publish.' },
    ],
  },
  {
    key: 'bc-report-payment-plan-takeup',
    type: 'report',
    application: BILLING,
    status: 'New',
    reporter: BC_REP,
    createdAt: daysAgo(3, 9, 10),
    updatedAt: daysAgo(3, 9, 10),
    summary_of_issue: 'Payment plan take-up by product',
    what_happened_exact_details: 'Product managers want to know which pay plans customers actually choose, by product and by month, before the next rate filing.',
    isNewDashboard: true,
    measures_and_sources: 'Count and share of policies by pay plan, from the billing account pay plan, split by product from the policy.',
    needed_data: 'Pay plan per policy at inception, and the product code.',
    primary_contact: 'Sasha Lindqvist, Product',
    reportUsageFrequency: 'Quarterly',
    department: 'Product Management',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(3, 9, 10) },
    ],
  },
  {
    key: 'bc-report-transaction-export',
    type: 'report',
    application: BILLING,
    status: 'Rejected',
    reporter: BC_REP,
    createdAt: daysAgo(37, 15, 30),
    updatedAt: daysAgo(35, 10, 0),
    summary_of_issue: 'Weekly export of every payment transaction',
    what_happened_exact_details: 'A full extract of all payment transactions each week, emailed as a spreadsheet, so the team can analyse it themselves.',
    isNewDashboard: true,
    measures_and_sources: 'Every payment transaction row, unaggregated, from the payment ledger.',
    needed_data: 'All payment transactions, all fields.',
    primary_contact: 'Devon Achterberg, Agency Services',
    reportUsageFrequency: 'Weekly',
    department: 'Agency Services',
    reviewer: 'bc_report_analyst',
    decision_notes: 'Declined as asked. A weekly unfiltered extract of payment data by email is outside what data governance permits. Offered instead: a dashboard answering the specific questions, and a governed extract if a business case is approved. Waiting to hear which.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(37, 15, 30) },
      { status: 'Defect/Enhancement Status: Rejected', at: daysAgo(35, 10, 0), by: 'bc_report_analyst' },
    ],
  },
  {
    key: 'bc-report-redirected-from-other',
    type: 'report',
    application: BILLING,
    status: 'New',
    reporter: PC_REP,
    createdAt: daysAgo(19, 11, 20),
    updatedAt: daysAgo(13, 14, 50),
    summary_of_issue: 'Refunds issued after cancellation, by reason',
    what_happened_exact_details: 'We are trying to work out how much we refund after a cancellation and why. It was not clear whether this is billing data or policy data, so it was filed under Other.',
    isNewDashboard: true,
    measures_and_sources: 'Refund amount and count by cancellation reason, from the disbursement ledger joined to the policy cancellation.',
    needed_data: 'Disbursements flagged as refunds, and the cancellation reason on the policy.',
    primary_contact: 'Ines Kowalczyk, Finance',
    reportUsageFrequency: 'Monthly',
    department: 'Finance',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(19, 11, 20) },
      { status: 'Redirected to Billing Center', at: daysAgo(13, 14, 50), by: 'bc_owner_analyst' },
      { status: 'New', at: daysAgo(13, 14, 50), by: 'bc_owner_analyst' },
    ],
    // The hand-off that moved it here. A ticket that moved without a ledger row
    // would be invisible to the queue that sent it.
    routing: {
      fromApplication: OTHER,
      toApplication: BILLING,
      statusAtHandoff: 'New',
      note: 'Refund disbursements are billing data — the cancellation reason is only the split. Billing Center owns this.',
      at: daysAgo(13, 14, 50),
      by: 'bc_owner_analyst',
    },
  },

  // ══ Policy Center · defects and enhancements ═══════════════════════════════
  {
    key: 'pc-renewal-vehicle-year',
    type: 'defect',
    application: POLICY,
    status: 'Submitted',
    createdBy: 'Sofia Marchetti',
    createdByEmail: 'sofia.marchetti@example.invalid',
    createdAt: daysAgo(41, 8, 45),
    updatedAt: daysAgo(25, 13, 15),
    screen_title: 'Renewal → Vehicles',
    summary_of_issue: 'Renewal quote fails validation when a vehicle year is blank',
    steps_to_reproduce: '1. Open a renewal with a vehicle added before the year became mandatory.\n2. Quote.',
    what_happened_exact_details: 'Validation blocks the quote and points at a field the renewal screen does not display, so there is nothing to correct.',
    request: 'Either show the field so it can be filled, or default it from the VIN.',
    dateTimeOfError: daysAgo(42, 16, 20),
    policy_num: 'PC-8820471',
    reviewer: 'pc_app_admin',
    decision_notes: 'Confirmed on three renewals. Raised with the Service Desk.',
    easyvista_ticket_id: 'SD-118661',
    easyvista_submitted_by: 'pc_app_admin',
    impact_notes: 'Blocks renewal on any policy with a pre-2019 vehicle record.',
    policy_premium_impact: 1875.5,
    policies_affected_count: 61,
    occurrence: { count: 12, timeframeCount: 1, timeframe: 'Month' },
    needs_workaround: true,
    workaround_provided: true,
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(41, 8, 45) },
      { status: 'Workaround requested by requester', at: daysAgo(41, 8, 45) },
      { status: 'Workaround provided', at: daysAgo(39, 10, 0), by: 'pc_app_admin' },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(36, 9, 30), by: 'pc_app_admin' },
      { status: 'Defect/Enhancement Status: Submitted', at: daysAgo(25, 13, 15), by: 'pc_app_admin' },
    ],
  },
  {
    key: 'pc-additional-interest',
    type: 'defect',
    application: POLICY,
    status: 'Approved',
    createdBy: 'Nathan Okonjo',
    createdByEmail: 'nathan.okonjo@example.invalid',
    createdAt: daysAgo(8, 14, 30),
    updatedAt: daysAgo(5, 9, 20),
    screen_title: 'Policy Change → Additional Interests',
    summary_of_issue: 'Policy change wizard loses the additional interest when you step back',
    steps_to_reproduce: '1. Start a policy change.\n2. Add an additional interest.\n3. Press Back, then Next.',
    what_happened_exact_details: 'The additional interest is gone and has to be re-entered. Nothing warns that it was dropped, so it is easy to bind without it.',
    request: 'Keep entered data when navigating within the wizard.',
    dateTimeOfError: daysAgo(8, 14, 10),
    policy_num: 'PC-8901233',
    reviewer: 'pc_app_admin',
    decision_notes: 'Accepted. A silently dropped mortgagee is a compliance problem, not a convenience one.',
    impact_notes: 'A mortgagee can be silently dropped from a bound change.',
    policies_affected_count: 15,
    occurrence: { count: 5, timeframeCount: 1, timeframe: 'Week' },
    needs_workaround: true,
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(8, 14, 30) },
      { status: 'Workaround requested by requester', at: daysAgo(8, 14, 30) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(5, 9, 20), by: 'pc_app_admin' },
    ],
  },
  {
    key: 'pc-cancellation-reasons',
    type: 'defect',
    application: POLICY,
    status: 'Deployed',
    createdBy: 'Rebecca Lindgren',
    createdByEmail: 'rebecca.lindgren@example.invalid',
    createdAt: daysAgo(88, 10, 30),
    updatedAt: daysAgo(28, 11, 45),
    screen_title: 'Cancellation',
    summary_of_issue: 'Cancellation reason list still offers retired values',
    steps_to_reproduce: 'Start a cancellation and open the reason list.',
    what_happened_exact_details: 'Four reasons withdrawn in 2024 are still selectable, and two of them fail downstream when the notice is generated.',
    request: 'Remove the withdrawn reasons.',
    dateTimeOfError: daysAgo(89, 9, 0),
    reviewer: 'pc_app_admin',
    decision_notes: 'Fixed in 26.3.1 alongside the notice template refresh.',
    easyvista_ticket_id: 'SD-117980',
    easyvista_submitted_by: 'pc_app_admin',
    jira_number: 'POL-4471',
    release_number: '26.3.1',
    release_notes: 'Withdrawn cancellation reasons removed from the selectable list.',
    logged_defect: true,
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(88, 10, 30) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(84, 14, 0), by: 'pc_app_admin' },
      { status: 'Defect/Enhancement Status: Submitted', at: daysAgo(80, 10, 0), by: 'pc_app_admin' },
      { status: 'Defect/Enhancement Status: Deployed', at: daysAgo(28, 11, 45), by: 'pc_app_admin' },
    ],
  },
  {
    key: 'pc-deferred-bulk-endorse',
    type: 'enhancement',
    application: POLICY,
    status: 'Deferred – Not in Current Scope',
    enhancementRequestType: 'Build-PPM Funded Project',
    priorityLevel: '3 - Medium',
    createdBy: 'Sofia Marchetti',
    createdByEmail: 'sofia.marchetti@example.invalid',
    createdAt: daysAgo(120, 9, 0),
    updatedAt: daysAgo(72, 15, 0),
    screen_title: '-',
    summary_of_issue: 'Bulk endorsement across a schedule of policies',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'When a rate revision applies to a whole book, endorse them together rather than one policy at a time.',
    dateTimeOfError: daysAgo(120, 9, 0),
    reviewer: 'pc_owner_analyst',
    decision_notes: 'A project, not an enhancement. Deferred out of scope until it can be funded properly.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(120, 9, 0) },
      { status: 'Defect/Enhancement Status: Pending Management Approval', at: daysAgo(100, 11, 0), by: 'pc_app_admin' },
      { status: 'Defect/Enhancement Status: Deferred – Not in Current Scope', at: daysAgo(72, 15, 0), by: 'pc_owner_analyst' },
    ],
  },
  {
    key: 'pc-producer-filter',
    type: 'enhancement',
    application: POLICY,
    status: 'Approved',
    enhancementRequestType: 'Build-Small Enhancement',
    priorityLevel: '2 - High',
    createdBy: 'Nathan Okonjo',
    createdByEmail: 'nathan.okonjo@example.invalid',
    createdAt: daysAgo(20, 13, 0),
    updatedAt: daysAgo(9, 10, 30),
    screen_title: '-',
    summary_of_issue: 'Add a producer code filter to the submission worklist',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Underwriters work one agency at a time and scroll the whole worklist to find them.',
    dateTimeOfError: daysAgo(20, 13, 0),
    desiredCompletionDate: daysAgo(-45, 12, 0),
    reviewer: 'pc_owner_analyst',
    decision_notes: 'Approved. Small, and it removes a daily irritation for eleven underwriters.',
    impact_details: 'Eleven underwriters, several times a day.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(20, 13, 0) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(9, 10, 30), by: 'pc_owner_analyst' },
    ],
  },
  {
    key: 'pc-garaging-address',
    type: 'enhancement',
    application: POLICY,
    status: 'New',
    enhancementRequestType: 'Build-Small Enhancement',
    priorityLevel: '3 - Medium',
    createdBy: 'Rebecca Lindgren',
    createdByEmail: 'rebecca.lindgren@example.invalid',
    createdAt: daysAgo(1, 10, 5),
    updatedAt: daysAgo(1, 10, 5),
    screen_title: '-',
    summary_of_issue: 'Pre-fill the garaging address from the mailing address',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'They are the same address on most personal auto quotes and it is typed twice.',
    dateTimeOfError: daysAgo(1, 10, 5),
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(1, 10, 5) },
    ],
  },
  {
    key: 'pc-vin-decode-service',
    type: 'enhancement',
    application: POLICY,
    status: 'Pending Management Approval',
    enhancementRequestType: 'Build-Small Project (Not PPM Funded)',
    priorityLevel: '2 - High',
    createdBy: 'Sofia Marchetti',
    createdByEmail: 'sofia.marchetti@example.invalid',
    createdAt: daysAgo(29, 9, 30),
    updatedAt: daysAgo(13, 11, 15),
    screen_title: '-',
    summary_of_issue: 'Decode the VIN to fill vehicle make, model and year automatically',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Every vehicle is typed in by hand from the VIN, and the mismatches this creates are the single biggest source of rating corrections.',
    dateTimeOfError: daysAgo(29, 9, 30),
    desiredCompletionDate: daysAgo(-90, 12, 0),
    reviewer: 'pc_owner_analyst',
    decision_notes: 'Sized and costed. Waiting on management approval for the licence cost of the decode service — it is the licence, not the build, that needs a decision.',
    impact_details: 'Would remove an estimated 40 rating corrections a month.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(29, 9, 30) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(21, 14, 0), by: 'pc_app_admin' },
      { status: 'Defect/Enhancement Status: Pending Management Approval', at: daysAgo(13, 11, 15), by: 'pc_owner_analyst' },
    ],
  },
  {
    key: 'pc-cleanup-note-templates',
    type: 'defect',
    application: POLICY,
    status: 'New',
    isCleanup: true,
    cleanupStatus: 'In Progress',
    cleanupTagType: 'cleanup_only',
    createdBy: 'pc_app_admin',
    createdByEmail: 'pc.appadmin@example.invalid',
    createdVia: 'admin_cleanup',
    createdAt: daysAgo(35, 11, 15),
    updatedAt: daysAgo(6, 14, 0),
    screen_title: '-',
    summary_of_issue: 'Archive the pre-2019 policy note templates',
    steps_to_reproduce: '-',
    what_happened_exact_details: '-',
    request: 'Sixty-three note templates reference forms that no longer exist. Archive them.',
    dateTimeOfError: daysAgo(35, 11, 15),
    reviewer: 'pc_app_admin',
    isPublic: false,
    events: [
      { status: 'Cleanup Status: New Cleanup item created', at: daysAgo(35, 11, 15) },
      { status: 'Defect/Enhancement Status: Switched to Cleanup Only', at: daysAgo(35, 11, 15) },
      { status: 'Cleanup Status: In Progress', at: daysAgo(6, 14, 0), by: 'pc_app_admin' },
    ],
  },

  // ══ Policy Center · report requests ════════════════════════════════════════
  {
    key: 'pc-report-new-business',
    type: 'report',
    application: POLICY,
    status: 'Delivered',
    reporter: PC_REP,
    createdAt: daysAgo(63, 9, 0),
    updatedAt: daysAgo(20, 16, 0),
    summary_of_issue: 'New business submissions by producer, weekly',
    what_happened_exact_details: 'Agency managers need to see what each producer submitted, quoted and bound each week, without asking us to run it for them.',
    isNewDashboard: true,
    measures_and_sources: 'Counts of submissions, quotes and bound policies per producer per week, from the policy transaction log. Producer name and branch from the producer table.',
    needed_data: 'Submission, quote and bind events with their dates, and the producer on each.',
    primary_contact: 'Devon Achterberg, Agency Services',
    reportUsageFrequency: 'Weekly',
    department: 'Agency Services',
    desiredCompletionDate: daysAgo(24, 12, 0),
    levelOfEffort: 'M — up to a week',
    assignedTo: PC_ANALYST,
    approvedAt: daysAgo(58, 10, 30),
    approvedByName: 'Marta Kowalski (Agency Services Director)',
    approvalRecordedBy: PC_ANALYST,
    completedAt: daysAgo(20, 16, 0),
    delivery_notes: 'Published as "New Business by Producer". Weeks run Monday–Sunday to match the agency reporting calendar, which is not the fiscal week — called out on the report header so the two are not compared by accident.',
    reviewer: 'pc_report_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(63, 9, 0) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(58, 10, 30), by: 'pc_report_analyst' },
      { status: 'Defect/Enhancement Status: In progress', at: daysAgo(35, 9, 0), by: 'pc_report_analyst' },
      { status: 'Defect/Enhancement Status: Delivered', at: daysAgo(20, 16, 0), by: 'pc_report_analyst' },
    ],
    assignments: [
      { to: PC_ANALYST, by: PC_OWNER, at: daysAgo(58, 10, 35) },
    ],
    hours: [
      { user: PC_ANALYST, hours: 2.5, on: dayAgo(35), note: 'Requirements with Agency Services.' },
      { user: PC_ANALYST, hours: 7.25, on: dayAgo(31), note: 'Transaction log extract; producer join; weekly buckets.' },
      { user: PC_OWNER, hours: 3, on: dayAgo(28), note: 'Checked the quote-count definition against the underwriting one.' },
      { user: PC_ANALYST, hours: 4, on: dayAgo(22), note: 'Layout, filters and the producer drill-through.' },
      { user: PC_ANALYST, hours: 1.5, on: dayAgo(20), note: 'Publish and hand-over.' },
    ],
  },
  {
    key: 'pc-report-retention-month',
    type: 'report',
    application: POLICY,
    status: 'In progress',
    reporter: PC_REP,
    createdAt: daysAgo(26, 15, 45),
    updatedAt: daysAgo(2, 11, 30),
    summary_of_issue: 'Add effective-date month to the Retention dashboard',
    what_happened_exact_details: 'Retention is shown by quarter. Seasonality inside a quarter is invisible, and the renewal campaign is planned monthly.',
    isNewDashboard: false,
    existing_report_link: 'Policy workspace → Retention (the quarterly one)',
    changes_requested: 'Add a month dimension on the effective date so retention can be read by month as well as by quarter.',
    request: 'A quarterly figure cannot be lined up against a monthly renewal campaign.',
    reportUsageFrequency: 'Monthly',
    department: 'Underwriting',
    levelOfEffort: 'S — up to 2 days',
    assignedTo: PC_OWNER,
    approvedAt: daysAgo(22, 9, 15),
    approvedByName: 'Bernard Achebe (Underwriting Manager)',
    approvalRecordedBy: PC_OWNER,
    reviewer: 'pc_owner_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(26, 15, 45) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(22, 9, 15), by: 'pc_owner_analyst' },
      { status: 'Defect/Enhancement Status: In progress', at: daysAgo(6, 10, 0), by: 'pc_owner_analyst' },
    ],
    assignments: [
      { to: PC_OWNER, by: PC_OWNER, at: daysAgo(22, 9, 20) },
    ],
    hours: [
      { user: PC_OWNER, hours: 3.25, on: dayAgo(6), note: 'Added the month dimension; retention rate recalculated per month.' },
      { user: PC_OWNER, hours: 1.5, on: dayAgo(2), note: 'Underwriting review of the monthly denominators.' },
    ],
  },
  {
    key: 'pc-report-quote-to-bind',
    type: 'report',
    application: POLICY,
    status: 'Approved',
    reporter: PC_ANALYST,
    createdAt: daysAgo(14, 10, 20),
    updatedAt: daysAgo(11, 14, 0),
    summary_of_issue: 'Quote-to-bind conversion by channel',
    what_happened_exact_details: 'We want conversion from quote to bind split by channel — agency, direct and comparative rater — to see where quotes are lost.',
    isNewDashboard: true,
    measures_and_sources: 'Quote count, bind count and the ratio, by channel and month. Quotes and binds from the policy transaction log; channel from the submission source.',
    needed_data: 'Quote and bind events with the submission channel on each.',
    primary_contact: 'Sasha Lindqvist, Product',
    reportUsageFrequency: 'Monthly',
    department: 'Product Management',
    levelOfEffort: 'L — up to a month',
    assignedTo: PC_ANALYST,
    approvedAt: daysAgo(11, 14, 0),
    approvedByName: 'Marta Kowalski (Agency Services Director)',
    approvalRecordedBy: PC_ANALYST,
    reviewer: 'pc_report_analyst',
    decision_notes: 'Approved. Sized L because the channel field is unreliable before 2025 and has to be derived for the earlier period.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(14, 10, 20) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(11, 14, 0), by: 'pc_report_analyst' },
    ],
    assignments: [
      { to: PC_ANALYST, by: PC_OWNER, at: daysAgo(11, 14, 5) },
    ],
    hours: [
      { user: PC_ANALYST, hours: 2, on: dayAgo(5), note: 'Profiled the channel field to see how far back it is usable.' },
    ],
  },
  {
    key: 'pc-report-audit-premium',
    type: 'report',
    application: POLICY,
    status: 'On hold',
    reporter: PC_REP,
    createdAt: daysAgo(55, 11, 0),
    updatedAt: daysAgo(30, 9, 45),
    summary_of_issue: 'Audit premium adjustments by year',
    what_happened_exact_details: 'Finance want to see how much premium moves at audit, by year and by product, to judge whether the estimates are set well.',
    isNewDashboard: true,
    measures_and_sources: 'Premium at audit versus estimated premium, by policy year and product, from the audit transaction.',
    needed_data: 'Audit transactions with their estimated and final premium.',
    primary_contact: 'Ines Kowalczyk, Finance',
    reportUsageFrequency: 'Annually',
    department: 'Finance',
    reviewer: 'pc_report_analyst',
    decision_notes: 'On hold at the requester\'s request until the audit backlog is cleared — the current year would read as a collapse in adjustments when it is really a queue.',
    isPublic: false,
    events: [
      { status: 'New', at: daysAgo(55, 11, 0) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(48, 13, 30), by: 'pc_report_analyst' },
      { status: 'Defect/Enhancement Status: On hold', at: daysAgo(30, 9, 45), by: 'pc_report_analyst' },
    ],
  },

  // ══ Other · report requests nobody has claimed yet ═════════════════════════
  // `Other` is a real application row, not a flag: it is a queue with grants, it
  // appears in the queue's application filter, and Redirect moves a request out of
  // it into the application that owns the data.
  //
  // NOTHING IS EVER DELIVERED IN `Other`, AND NO HOURS ARE LOGGED AGAINST IT.
  // That is a modelling statement, not a gap in the data: `Other` means "nobody
  // knows whose data this is yet", and by the time somebody has built the report
  // they plainly know. Work happens after the request is routed OUT of here — see
  // `other-report-delivered-crosssystem`, which was delivered and therefore sits
  // in Billing Center with the hand-off recorded.
  //
  // `verify-throughput-page.mjs` relies on this: it is the one application whose
  // throughput is empty by construction rather than by accident, which is what
  // makes the page's per-card empty state checkable at all.
  {
    key: 'other-report-delinquency-view',
    type: 'report',
    application: OTHER,
    status: 'New',
    reporter: PC_REP,
    createdAt: daysAgo(5, 16, 15),
    updatedAt: daysAgo(5, 16, 15),
    summary_of_issue: 'Combined billing and policy view of accounts in delinquency',
    what_happened_exact_details: 'Service needs one screen showing an account in delinquency alongside the policies on it, so a call can be answered without opening both systems. It is not clear which side owns this.',
    isNewDashboard: true,
    measures_and_sources: 'Delinquency state and balance from billing; policy number, product and status from policy. Joined on the account.',
    needed_data: 'Accounts in delinquency, and the policies attached to each.',
    primary_contact: 'Priyanka Venkataraman, Customer Service',
    reportUsageFrequency: 'Daily',
    department: 'Customer Service',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(5, 16, 15) },
    ],
  },
  {
    key: 'other-report-rate-revision-reach',
    type: 'report',
    application: OTHER,
    status: 'Approved',
    reporter: BC_REP,
    createdAt: daysAgo(24, 9, 40),
    updatedAt: daysAgo(17, 15, 10),
    summary_of_issue: 'How many accounts the June rate revision actually touched',
    what_happened_exact_details: 'A one-off count of accounts and policies affected by the June revision, with the premium change, for the post-implementation review.',
    isNewDashboard: true,
    measures_and_sources: 'Count of policies re-rated and the total premium delta, from the rate revision batch log. Account count from the billing account.',
    needed_data: 'The revision batch output, and the accounts behind the policies in it.',
    primary_contact: 'Sasha Lindqvist, Product',
    reportUsageFrequency: 'One-off',
    department: 'Product Management',
    levelOfEffort: 'S — up to 2 days',
    approvedAt: daysAgo(17, 15, 10),
    approvedByName: 'Yusuf Adeyemi (Controller)',
    approvalRecordedBy: BC_OWNER,
    reviewer: 'bc_owner_analyst',
    decision_notes: 'Approved, and still in Other: it spans both systems and neither queue has claimed it. Whoever picks it up should route it to the side that owns the batch log first.',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(24, 9, 40) },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(17, 15, 10), by: 'bc_owner_analyst' },
    ],
    // Approved but NOT assigned and with no hours: work in `Other` is work on a
    // request whose owning application is still unknown, which is the one thing
    // this queue exists to resolve first.
  },
  {
    key: 'other-report-delivered-crosssystem',
    // FILED as Other, DELIVERED from Billing Center. It is here rather than in the
    // Other block above because a delivered request is not an unclaimed one — the
    // hand-off is the moment somebody decided whose data it was, and the routing
    // row below is that decision.
    type: 'report',
    application: BILLING,
    status: 'Delivered',
    reporter: BC_REP,
    createdAt: daysAgo(45, 13, 0),
    updatedAt: daysAgo(3, 15, 30),
    summary_of_issue: 'Accounts with a policy in one system and no billing account in the other',
    what_happened_exact_details: 'A reconciliation list of accounts that exist on one side and not the other, so the gaps can be worked through.',
    isNewDashboard: true,
    measures_and_sources: 'Count and list of unmatched accounts, from both account tables compared on the account number.',
    needed_data: 'Account numbers from both systems.',
    primary_contact: 'Ines Kowalczyk, Finance',
    reportUsageFrequency: 'Monthly',
    department: 'Finance',
    levelOfEffort: 'M — up to a week',
    assignedTo: BC_ANALYST,
    approvedAt: daysAgo(40, 10, 0),
    approvedByName: 'Yusuf Adeyemi (Controller)',
    approvalRecordedBy: BC_ANALYST,
    completedAt: daysAgo(3, 15, 30),
    delivery_notes: 'Delivered as a monthly reconciliation list rather than a dashboard — it is a worklist and it is meant to shrink to nothing. Matching is on account number alone; four known legacy accounts differ by a leading zero and are listed as exceptions.',
    reviewer: 'bc_report_analyst',
    isPublic: true,
    events: [
      { status: 'New', at: daysAgo(45, 13, 0) },
      // Routed BEFORE it was approved: the first thing anybody did was decide whose
      // data it was, which is what `Other` is for.
      { status: 'Redirected to Billing Center', at: daysAgo(42, 11, 0), by: 'bc_owner_analyst' },
      { status: 'New', at: daysAgo(42, 11, 0), by: 'bc_owner_analyst' },
      { status: 'Defect/Enhancement Status: Approved', at: daysAgo(40, 10, 0), by: 'bc_report_analyst' },
      { status: 'Defect/Enhancement Status: In progress', at: daysAgo(18, 9, 0), by: 'bc_report_analyst' },
      { status: 'Defect/Enhancement Status: Delivered', at: daysAgo(3, 15, 30), by: 'bc_report_analyst' },
    ],
    routing: {
      fromApplication: OTHER,
      toApplication: BILLING,
      statusAtHandoff: 'New',
      note: 'Both sides are compared, but the reconciliation list is a billing worklist and billing will own it afterwards. Taking it.',
      at: daysAgo(42, 11, 0),
      by: 'bc_owner_analyst',
    },
    assignments: [
      { to: BC_ANALYST, by: BC_OWNER, at: daysAgo(40, 10, 5) },
    ],
    hours: [
      { user: BC_ANALYST, hours: 4, on: dayAgo(18), note: 'Both account extracts; first pass at the match.' },
      { user: BC_ANALYST, hours: 5.5, on: dayAgo(10), note: 'Exception handling for the leading-zero accounts.' },
      { user: BC_OWNER, hours: 1.5, on: dayAgo(6), note: 'Reviewed the exception list with Finance.' },
      { user: BC_ANALYST, hours: 2, on: dayAgo(3), note: 'Published the monthly list and the runbook.' },
    ],
  },
];

// ── Writing ──────────────────────────────────────────────────────────────────

async function mapByName(model, { lower = false } = {}) {
  if (!model) return new Map();
  const rows = await model.findAll({ attributes: ['id', 'name'], raw: true });
  return new Map(rows.map((row) => [lower ? String(row.name).toLowerCase() : row.name, Number(row.id)]));
}

function need(map, key, what) {
  const value = map.get(key);
  if (!value) throw new Error(`${what} "${key}" is not in the database. Run the migrations first.`);
  return value;
}

async function main() {
  await dbApi.init();
  const models = dbApi.getModels() || {};
  const {
    Submission,
    SubmissionStatusEvent,
    SubmissionType,
    Application,
    DefectEnhancementStatus,
    CleanupStatus,
    CleanupTagType,
    EnhancementRequestType,
    PriorityLevel,
    SubmissionSource,
    OccurrenceTimeframe,
    LevelOfEffort,
    RequestTimeEntry,
    RequestAssignment,
    SubmissionRouting,
    User,
  } = models;
  if (!Submission) throw new Error('Submission model is not initialized');

  const sequelize = Submission.sequelize;
  const dialect = sequelize.getDialect();
  const existing = Number(await Submission.count());
  console.log(`${dialect} · ${existing} submissions already present\n`);

  const types = await mapByName(SubmissionType, { lower: true });
  const applications = await mapByName(Application);
  const statuses = await mapByName(DefectEnhancementStatus);
  const cleanupStatuses = await mapByName(CleanupStatus);
  const cleanupTagTypes = await mapByName(CleanupTagType, { lower: true });
  const enhancementTypes = await mapByName(EnhancementRequestType);
  const priorities = await mapByName(PriorityLevel);
  const sources = await mapByName(SubmissionSource, { lower: true });
  const timeframes = await mapByName(OccurrenceTimeframe);
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

  // ── The plan ──────────────────────────────────────────────────────────────
  const plan = SUBMISSIONS.map((entry) => {
    // A signed-in filer's name and email come from their users row, never from
    // the payload (services/reporterService.js). Writing anything else here
    // would produce a ticket the app itself could not have created.
    const reporterRow = entry.reporter ? usersByName.get(entry.reporter) : null;
    if (entry.reporter && !reporterRow) {
      throw new Error(`Account "${entry.reporter}" does not exist. Run npm run seed:team-accounts first.`);
    }
    const createdBy = reporterRow
      ? String(reporterRow.display_name || reporterRow.username)
      : entry.createdBy;
    const createdByEmail = reporterRow
      ? (String(reporterRow.email || '').trim() || '-')
      : entry.createdByEmail;

    const occurrence = entry.occurrence || null;
    return {
      entry,
      row: {
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        // `rep_form` unless the entry says otherwise: everything a requester files
        // comes through the form, and only the cleanup tasks above were entered by
        // an admin.
        created_via_id: need(sources, entry.createdVia || 'rep_form', 'Submission source'),
        created_by: createdBy,
        created_by_email: createdByEmail,
        reporter_user_id: reporterRow ? Number(reporterRow.id) : null,
        type_id: need(types, entry.type, 'Submission type'),
        application_id: need(applications, entry.application, 'Application'),
        policy_num: entry.policy_num || null,
        account_num: entry.account_num || null,
        transaction_num: entry.transaction_num || null,
        // Five NOT NULL columns mean nothing to a report request, and the submit
        // route fills them with '-'. Same here, for the same reason.
        screen_title: entry.screen_title ?? '-',
        summary_of_issue: entry.summary_of_issue,
        steps_to_reproduce: entry.steps_to_reproduce ?? '-',
        what_happened_exact_details: entry.what_happened_exact_details ?? '-',
        request: entry.request ?? '-',
        date_time_of_error: entry.dateTimeOfError || entry.createdAt,
        status_id: need(statuses, entry.status, 'Status'),
        reviewer: entry.reviewer || null,
        decision_notes: entry.decision_notes || null,
        duplicate_of: null, // resolved after every row has an id
        easyvista_ticket_id: entry.easyvista_ticket_id || null,
        easyvista_submitted_by: entry.easyvista_submitted_by || null,
        desired_completion_date: entry.desiredCompletionDate || null,
        impact_details: entry.impact_details || null,
        impact_notes: entry.impact_notes || null,
        policy_premium_impact: entry.policy_premium_impact ?? null,
        direct_dollar_impact: entry.direct_dollar_impact ?? null,
        policies_affected_count: entry.policies_affected_count ?? null,
        occurrence_count: occurrence ? occurrence.count : null,
        occurrence_timeframe_count: occurrence ? occurrence.timeframeCount : null,
        occurrence_timeframe_id: occurrence ? need(timeframes, occurrence.timeframe, 'Occurrence timeframe') : null,
        // Computed with the app's own helper rather than a number typed in here,
        // so a seeded rate can never disagree with what the portal would derive
        // from the same three inputs.
        occurrence_rate: occurrence
          ? calculateOccurrenceRate(occurrence.count, occurrence.timeframeCount, occurrence.timeframe)
          : null,
        logged_defect: entry.logged_defect ? 1 : 0,
        needs_workaround: entry.needs_workaround ? 1 : 0,
        workaround_provided: entry.workaround_provided ? 1 : 0,
        enhancement_request_type_id: entry.enhancementRequestType
          ? need(enhancementTypes, entry.enhancementRequestType, 'Enhancement request type')
          : null,
        priority_level_id: entry.priorityLevel ? need(priorities, entry.priorityLevel, 'Priority level') : null,
        jira_number: entry.jira_number || null,
        release_number: entry.release_number || null,
        release_notes: entry.release_notes || null,
        delivery_notes: entry.delivery_notes || null,
        is_cleanup: entry.isCleanup ? 1 : 0,
        cleanup_status_id: entry.cleanupStatus ? need(cleanupStatuses, entry.cleanupStatus, 'Cleanup status') : null,
        cleanup_tag_type_id: entry.cleanupTagType
          ? need(cleanupTagTypes, entry.cleanupTagType, 'Cleanup tag type')
          : null,
        is_retired: entry.isRetired ? 1 : 0,
        is_public: entry.isPublic ? 1 : 0,
        // Report-request columns. Tri-state on purpose: null means "not a report
        // request", which is a different answer from "a change to an existing one".
        is_new_dashboard: entry.type === 'report' ? (entry.isNewDashboard ? 1 : 0) : null,
        needed_data: entry.needed_data || null,
        measures_and_sources: entry.measures_and_sources || null,
        primary_contact: entry.primary_contact || null,
        existing_report_link: entry.existing_report_link || null,
        changes_requested: entry.changes_requested || null,
        report_usage_frequency: entry.reportUsageFrequency || null,
        department: entry.department || null,
        assigned_to: entry.assignedTo ? userId(entry.assignedTo) : null,
        level_of_effort_id: entry.levelOfEffort ? need(effortLevels, entry.levelOfEffort, 'Level of effort') : null,
        completed_at: entry.completedAt || null,
        approved_at: entry.approvedAt || null,
        approved_by_name: entry.approvedByName || null,
        approval_recorded_by: entry.approvalRecordedBy ? userId(entry.approvalRecordedBy) : null,
      },
    };
  });

  // ── Report it ─────────────────────────────────────────────────────────────
  const count = (predicate) => plan.filter(({ entry }) => predicate(entry)).length;
  const group = (of) => {
    const counts = new Map();
    for (const { entry } of plan) {
      const key = of(entry);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(' · ');
  };
  const totalHours = plan.reduce(
    (sum, { entry }) => sum + (entry.hours || []).reduce((inner, item) => inner + item.hours, 0),
    0,
  );

  console.log(`WHAT WILL BE SEEDED — ${plan.length} submissions`);
  console.log(`  by type          ${group((entry) => entry.type)}`);
  console.log(`  by application   ${group((entry) => entry.application)}`);
  console.log(`  by status        ${group((entry) => entry.status)}`);
  console.log(`  cleanup tasks    ${count((entry) => entry.isCleanup)} (${group((entry) => (entry.isCleanup ? entry.cleanupTagType : 'not a cleanup'))})`);
  console.log(`  public / private ${count((entry) => entry.isPublic)} public · ${count((entry) => !entry.isPublic)} private`);
  console.log(`  retired          ${count((entry) => entry.isRetired)}`);
  console.log(`  report requests  ${count((entry) => entry.type === 'report' && entry.isNewDashboard)} new dashboards · ${count((entry) => entry.type === 'report' && !entry.isNewDashboard)} changes to an existing one`);
  console.log(`  approvals        ${count((entry) => entry.approvedAt && entry.approvedByName)} (a name AND a date — either alone does not count)`);
  console.log(`  delivered        ${count((entry) => entry.completedAt)} with a completion date`);
  console.log(`  hours            ${plan.reduce((sum, { entry }) => sum + (entry.hours || []).length, 0)} entries, ${Math.round(totalHours * 100) / 100} hours`);
  console.log(`  assignment trail ${plan.reduce((sum, { entry }) => sum + (entry.assignments || []).length, 0)} rows`);
  console.log(`  status events    ${plan.reduce((sum, { entry }) => sum + entry.events.length, 0)}`);
  console.log(`  hand-offs        ${count((entry) => entry.routing)} routing row(s)`);
  console.log(`  duplicates       ${count((entry) => entry.duplicateOfKey)} pointing at their original`);

  // Which months the throughput page will find something in, at its default
  // "Last 3 months". An empty chart is the usual outcome of seeding without
  // checking this.
  const monthsDelivered = [...new Set(plan
    .filter(({ entry }) => entry.completedAt)
    .map(({ entry }) => entry.completedAt.slice(0, 7)))].sort();
  const monthsWorked = [...new Set(plan
    .flatMap(({ entry }) => (entry.hours || []).map((item) => item.on.slice(0, 7))))].sort();
  console.log(`\n  delivered in     ${monthsDelivered.join(', ')}`);
  console.log(`  hours worked in  ${monthsWorked.join(', ')}`);

  console.log('\n  No attachments: a file needs bytes, and neither this box nor the deployed');
  console.log('  instance can be given a file the other can read. The Files tab is empty.');

  if (!APPLY) {
    console.log('\nDRY RUN. Nothing was written.');
    console.log('To write:  node scripts/seedRealisticSubmissions.js --apply');
    if (existing > 0 && !ALLOW_EXISTING) {
      console.log(`\n  NOTE: --apply will REFUSE while ${existing} submissions are present.`);
    }
    return;
  }

  // Checked here rather than at the top so a dry run always prints the plan —
  // "show me what you would do" must not be answerable only from an empty table.
  if (existing > 0 && !ALLOW_EXISTING) {
    console.error('\nREFUSED: the submissions table is not empty.');
    console.error('Seeding on top would double every ticket and the two sets would be');
    console.error('indistinguishable. Purge first:');
    console.error('  node scripts/purgeSubmissions.js');
    console.error(`  node scripts/purgeSubmissions.js --apply --confirm=${existing}`);
    console.error('Or pass --allow-existing if adding to what is there is what you meant.');
    process.exitCode = 1;
    return;
  }

  // ── Write it ──────────────────────────────────────────────────────────────
  const idByKey = new Map();
  await sequelize.transaction(async (transaction) => {
    for (const { entry, row } of plan) {
      const created = await Submission.create(row, { transaction });
      const id = Number(created.id);
      idByKey.set(entry.key, id);

      for (const event of entry.events) {
        await SubmissionStatusEvent.create({
          submission_id: id,
          status: event.status,
          changed_at: event.at,
          changed_by: event.by || null,
        }, { transaction });
      }

      for (const item of entry.hours || []) {
        await RequestTimeEntry.create({
          submission_id: id,
          user_id: userId(item.user),
          hours: item.hours,
          worked_on: item.on,
          note: item.note || null,
          created_at: `${item.on}T17:00:00.000Z`,
        }, { transaction });
      }

      for (const item of entry.assignments || []) {
        await RequestAssignment.create({
          submission_id: id,
          assigned_to: item.to ? userId(item.to) : null,
          assigned_by: item.by ? userId(item.by) : null,
          assigned_at: item.at,
        }, { transaction });
      }

      if (entry.routing) {
        await SubmissionRouting.create({
          submission_id: id,
          from_application_id: need(applications, entry.routing.fromApplication, 'Application'),
          to_application_id: need(applications, entry.routing.toApplication, 'Application'),
          status_at_handoff: entry.routing.statusAtHandoff,
          note: entry.routing.note || null,
          routed_at: entry.routing.at,
          routed_by: entry.routing.by || null,
        }, { transaction });
      }
    }

    // Duplicate links, once every row has an id.
    for (const { entry } of plan) {
      if (!entry.duplicateOfKey) continue;
      const target = idByKey.get(entry.duplicateOfKey);
      if (!target) throw new Error(`"${entry.key}" says it duplicates "${entry.duplicateOfKey}", which is not in this set`);
      await Submission.update(
        { duplicate_of: target, duplicate_reference: `#${target}` },
        { where: { id: idByKey.get(entry.key) }, transaction },
      );
    }
  });

  const after = Number(await Submission.count());
  console.log(`\n${after} submissions after (was ${existing}, seeded ${plan.length})`);
  const first = Math.min(...idByKey.values());
  const last = Math.max(...idByKey.values());
  console.log(`ids #${first} – #${last}`);
  if (after !== existing + plan.length) {
    console.error('The count does not match what was seeded. Check the table.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => dbApi.close().catch(() => {}));
