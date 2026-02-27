const dotenv = require('dotenv');
const db = require('../db');

dotenv.config();

function isoDaysAgo(daysAgo, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function boolSql(value) {
  return value ? 1 : 0;
}

async function insertSubmission(entry) {
  const result = await db.execute(
    `INSERT INTO submissions (
      created_at, updated_at, created_by, created_by_email, type, application_name,
      policy_num, account_num, transaction_num, screen_title, summary_of_issue,
      steps_to_reproduce, what_happened_exact_details, request, date_time_of_error,
      status, reviewer, decision_notes, fingerprint, duplicate_reference, duplicate_of,
      easyvista_ticket_id, desired_completion_date, impact_details, impact_notes,
      policy_premium_impact, direct_dollar_impact, policies_affected_count,
      logged_defect, enhancement_request_type, priority_level, jira_number,
      release_number, release_notes, is_cleanup, cleanup_status, cleanup_tag_type,
      easyvista_submitted_by, is_retired, is_public
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      entry.created_at,
      entry.updated_at,
      entry.created_by,
      entry.created_by_email,
      entry.type,
      entry.application_name,
      entry.policy_num,
      entry.account_num,
      entry.transaction_num,
      entry.screen_title,
      entry.summary_of_issue,
      entry.steps_to_reproduce,
      entry.what_happened_exact_details,
      entry.request,
      entry.date_time_of_error,
      entry.status,
      entry.reviewer,
      entry.decision_notes,
      null,
      null,
      null,
      entry.easyvista_ticket_id,
      entry.desired_completion_date,
      entry.impact_details,
      entry.impact_notes,
      entry.policy_premium_impact,
      entry.direct_dollar_impact,
      entry.policies_affected_count,
      boolSql(entry.logged_defect),
      entry.enhancement_request_type,
      entry.priority_level,
      entry.jira_number,
      entry.release_number,
      entry.release_notes,
      boolSql(entry.is_cleanup),
      entry.cleanup_status,
      entry.cleanup_tag_type,
      entry.easyvista_submitted_by,
      boolSql(entry.is_retired),
      boolSql(entry.is_public),
    ],
  );

  return Number(result.lastInsertId);
}

async function insertEvent(submissionId, status, changedAt, changedBy = 'seed-script') {
  await db.execute(
    `INSERT INTO submission_status_events (submission_id, status, changed_at, changed_by)
     VALUES (?, ?, ?, ?)`,
    [submissionId, status, changedAt, changedBy],
  );
}

async function seedSampleData() {
  await db.init();

  try {
    const existingRows = await db.query('SELECT COUNT(*) AS count FROM submissions');
    const existingCount = Number(existingRows[0]?.count || 0);
    if (existingCount > 0) {
      console.log(`Skipped sample seed: submissions table already has ${existingCount} row(s).`);
      return;
    }

    const samples = [
      {
        submission: {
          created_at: isoDaysAgo(8, 9),
          updated_at: isoDaysAgo(6, 16),
          created_by: 'Alice Rep',
          created_by_email: 'alice.rep@example.com',
          type: 'defect',
          application_name: 'Billing Center',
          policy_num: 'BC-1001',
          account_num: 'AC-9001',
          transaction_num: 'TX-5001',
          screen_title: 'Policy Search',
          summary_of_issue: 'Search results intermittently blank after submit',
          steps_to_reproduce: 'Open search, enter valid policy, press Search twice quickly.',
          what_happened_exact_details: 'Second request returns blank table though API responded 200.',
          request: 'Ensure deterministic results and prevent blank state.',
          date_time_of_error: isoDaysAgo(8, 8),
          status: 'Approved',
          reviewer: 'lead_admin',
          decision_notes: 'Validated in staging.',
          easyvista_ticket_id: 'EV-41001',
          desired_completion_date: isoDaysAgo(2, 12),
          impact_details: null,
          impact_notes: 'Affects call-center lookup speed.',
          policy_premium_impact: null,
          direct_dollar_impact: 1250,
          policies_affected_count: 18,
          logged_defect: true,
          enhancement_request_type: null,
          priority_level: null,
          jira_number: 'JIRA-101',
          release_number: '24.2.1',
          release_notes: 'Pending QA verification',
          is_cleanup: false,
          cleanup_status: null,
          cleanup_tag_type: null,
          easyvista_submitted_by: 'ops_admin',
          is_retired: false,
          is_public: true,
        },
        events: [
          { status: 'New', changed_at: isoDaysAgo(8, 9) },
          { status: 'Defect/Enhancement Status: Approved', changed_at: isoDaysAgo(6, 16) },
        ],
      },
      {
        submission: {
          created_at: isoDaysAgo(7, 10),
          updated_at: isoDaysAgo(4, 11),
          created_by: 'Brian Rep',
          created_by_email: 'brian.rep@example.com',
          type: 'enhancement',
          application_name: 'Billing Center',
          policy_num: null,
          account_num: 'AC-9002',
          transaction_num: null,
          screen_title: 'Invoice Details',
          summary_of_issue: 'Need export CSV from invoice history',
          steps_to_reproduce: 'Open account > invoices > try export.',
          what_happened_exact_details: '-',
          request: 'Add CSV export with filters.',
          date_time_of_error: isoDaysAgo(7, 9),
          status: 'Submitted',
          reviewer: 'ops_admin',
          decision_notes: 'Sent to EV for backlog prioritization.',
          easyvista_ticket_id: 'EV-41002',
          desired_completion_date: isoDaysAgo(1, 12),
          impact_details: 'Saves manual report prep time weekly.',
          impact_notes: null,
          policy_premium_impact: null,
          direct_dollar_impact: null,
          policies_affected_count: null,
          logged_defect: false,
          enhancement_request_type: 'Build-Small Enhancement',
          priority_level: '2 - High',
          jira_number: null,
          release_number: null,
          release_notes: null,
          is_cleanup: false,
          cleanup_status: null,
          cleanup_tag_type: null,
          easyvista_submitted_by: 'lead_admin',
          is_retired: false,
          is_public: true,
        },
        events: [
          { status: 'New', changed_at: isoDaysAgo(7, 10) },
          { status: 'Defect/Enhancement Status: Submitted', changed_at: isoDaysAgo(4, 11) },
        ],
      },
      {
        submission: {
          created_at: isoDaysAgo(5, 8),
          updated_at: isoDaysAgo(1, 15),
          created_by: 'Cara Rep',
          created_by_email: 'cara.rep@example.com',
          type: 'defect',
          application_name: 'Billing Center',
          policy_num: 'BC-1003',
          account_num: null,
          transaction_num: 'TX-5003',
          screen_title: 'Account Overview',
          summary_of_issue: 'UI cleanup for stale warning banners',
          steps_to_reproduce: 'Open account with prior warning then refresh.',
          what_happened_exact_details: 'Banner remains visible after issue no longer applies.',
          request: 'Clear stale banner state on refresh.',
          date_time_of_error: isoDaysAgo(5, 8),
          status: 'New',
          reviewer: 'lead_admin',
          decision_notes: null,
          easyvista_ticket_id: null,
          desired_completion_date: null,
          impact_details: null,
          impact_notes: 'Confuses reps during intake.',
          policy_premium_impact: null,
          direct_dollar_impact: null,
          policies_affected_count: null,
          logged_defect: false,
          enhancement_request_type: null,
          priority_level: null,
          jira_number: null,
          release_number: null,
          release_notes: null,
          is_cleanup: true,
          cleanup_status: 'In Progress',
          cleanup_tag_type: 'defect',
          easyvista_submitted_by: 'Unknown',
          is_retired: false,
          is_public: false,
        },
        events: [
          { status: 'New', changed_at: isoDaysAgo(5, 8) },
          { status: 'Cleanup Status: Not Started', changed_at: isoDaysAgo(5, 8) },
          { status: 'Type Changed: From (Defect) to (Defect + Cleanup)', changed_at: isoDaysAgo(4, 9) },
          { status: 'Cleanup Status: In Progress', changed_at: isoDaysAgo(1, 15) },
        ],
      },
      {
        submission: {
          created_at: isoDaysAgo(4, 9),
          updated_at: isoDaysAgo(0, 10),
          created_by: 'Dina Rep',
          created_by_email: 'dina.rep@example.com',
          type: 'enhancement',
          application_name: 'Billing Center',
          policy_num: null,
          account_num: 'AC-9010',
          transaction_num: null,
          screen_title: 'Payment Plan',
          summary_of_issue: 'Cleanup task shifted from defect to enhancement approach',
          steps_to_reproduce: 'N/A',
          what_happened_exact_details: 'Original fix was defect-oriented but requirement is enhancement.',
          request: 'Move to enhancement stream while preserving cleanup track.',
          date_time_of_error: isoDaysAgo(4, 9),
          status: 'New',
          reviewer: 'ops_admin',
          decision_notes: null,
          easyvista_ticket_id: null,
          desired_completion_date: null,
          impact_details: 'Improves payment-plan setup workflow clarity.',
          impact_notes: null,
          policy_premium_impact: null,
          direct_dollar_impact: null,
          policies_affected_count: null,
          logged_defect: false,
          enhancement_request_type: 'Run-Other Operational Work',
          priority_level: '3 - Medium',
          jira_number: null,
          release_number: null,
          release_notes: null,
          is_cleanup: true,
          cleanup_status: 'Not Started',
          cleanup_tag_type: 'enhancement',
          easyvista_submitted_by: 'Unknown',
          is_retired: false,
          is_public: false,
        },
        events: [
          { status: 'New', changed_at: isoDaysAgo(4, 9) },
          { status: 'Cleanup Status: Not Started', changed_at: isoDaysAgo(4, 9) },
          { status: 'Type Changed: From (Defect + Cleanup) to (Enhancement + Cleanup)', changed_at: isoDaysAgo(0, 10) },
        ],
      },
      {
        submission: {
          created_at: isoDaysAgo(3, 14),
          updated_at: isoDaysAgo(0, 9),
          created_by: 'Evan Rep',
          created_by_email: 'evan.rep@example.com',
          type: 'defect',
          application_name: 'Billing Center',
          policy_num: null,
          account_num: null,
          transaction_num: null,
          screen_title: 'Statement Delivery',
          summary_of_issue: 'Standalone cleanup-only archive task',
          steps_to_reproduce: 'N/A',
          what_happened_exact_details: 'Legacy notes cleanup required.',
          request: 'Archive and normalize old statement templates.',
          date_time_of_error: isoDaysAgo(3, 14),
          status: 'New',
          reviewer: 'lead_admin',
          decision_notes: null,
          easyvista_ticket_id: null,
          desired_completion_date: null,
          impact_details: null,
          impact_notes: null,
          policy_premium_impact: null,
          direct_dollar_impact: null,
          policies_affected_count: null,
          logged_defect: false,
          enhancement_request_type: null,
          priority_level: null,
          jira_number: null,
          release_number: null,
          release_notes: null,
          is_cleanup: true,
          cleanup_status: 'Not Started',
          cleanup_tag_type: 'cleanup_only',
          easyvista_submitted_by: 'Unknown',
          is_retired: false,
          is_public: false,
        },
        events: [
          { status: 'Cleanup Status: New Cleanup item created', changed_at: isoDaysAgo(3, 14) },
          { status: 'Defect/Enhancement Status: Switched to Cleanup Only', changed_at: isoDaysAgo(3, 14) },
          { status: 'Type Changed: From (Defect) to (Cleanup Only)', changed_at: isoDaysAgo(3, 14) },
        ],
      },
    ];

    for (const sample of samples) {
      const submissionId = await insertSubmission(sample.submission);
      for (const event of sample.events) {
        await insertEvent(submissionId, event.status, event.changed_at);
      }
      console.log(`Seeded sample submission #${submissionId} (${sample.submission.summary_of_issue}).`);
    }

    console.log(`Seed complete: ${samples.length} sample submissions inserted.`);
  } finally {
    await db.close();
  }
}

seedSampleData().catch((error) => {
  console.error(error);
  process.exit(1);
});
