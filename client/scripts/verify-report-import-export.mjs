/**
 * Verification for the Excel round trip on report requests.
 *
 * WHY IT IS A ROUND TRIP. Export and import are one feature read in two
 * directions, and the only convincing test of the pair is to send a sheet out and
 * bring it back: this script exports a fully-filled report request, re-imports the
 * file the portal itself wrote, and compares every column on the copy against the
 * original. A header that does not re-import, a value the import drops, a boolean
 * that comes back the wrong way round — all of them show up as a mismatch here and
 * nowhere else. (Two headers had never round-tripped before this pattern was
 * checked: "Reported Date" and "Request Details".)
 *
 * The rest of the file is about what must NOT happen:
 *   - A name in a sheet becomes a user id or nothing. Unknown, ambiguous, or
 *     somebody with no grant on the application all import UNASSIGNED, with the
 *     reason reported per row — never guessed, never stored as text.
 *   - `Duration` becomes ONE time entry credited to that assignee on the day the
 *     request completed. With nobody to credit, the number stays out of the ledger
 *     and the row says so, because throughput reporting that invents an owner is
 *     worse than throughput reporting with a gap.
 *   - A report-request sheet may not carry 'Deployed'. It has to come back as an
 *     unknown status needing a decision, not import and then be unsaveable.
 *
 * IT WRITES: one report request through the API and up to four more through the
 * import, and removes all of them, printing the submission count.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-report-import-export.mjs
 */
import { request as playwrightRequest, chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// The CommonJS default export, not the named ESM bindings: `readFile`/`writeFile`
// exist only on it, and reaching for the named ones fails as 'not a function'.
import xlsxPkg from 'xlsx';

const XLSX = xlsxPkg;
void fs;

const API = process.env.VERIFY_API_URL || 'http://localhost:4000';
const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin123';

const MARKER = 'VERIFY xlsx round trip';
const SERVER_DIR = path.resolve(fileURLToPath(new URL('../../server', import.meta.url)));
const WORK_DIR = mkdtempSync(path.join(tmpdir(), 'verify-xlsx-'));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** The report-request fields, as the export names them. */
const REPORT_EXPORT_FIELDS = [
  'id', 'type', 'status', 'summary_of_issue', 'application_name', 'created_by',
  'what_happened_exact_details', 'request', 'desired_completion_date',
  'is_new_dashboard', 'needed_data', 'measures_and_sources', 'primary_contact',
  'existing_report_link', 'changes_requested', 'report_usage_frequency', 'department',
  'assigned_to_name', 'level_of_effort', 'hours_logged', 'completed_at',
  'approved_at', 'approved_by_name',
  // Travels BOTH ways. A team switching onto this portal imports requests that
  // were built and handed over somewhere else, and what was handed over is the
  // part of that record worth keeping — so it has to survive the round trip like
  // any other column, not be re-typed by hand afterwards.
  'delivery_notes',
];

async function run() {
  const context = await playwrightRequest.newContext({ baseURL: API });
  const login = await context.post('/api/auth/login', { data: { username: USER, password: PASS } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const csrf = (await context.storageState()).cookies.find((cookie) => cookie.name === 'bc_csrf')?.value;
  if (!csrf) throw new Error('no bc_csrf cookie');
  const headers = { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };

  const json = async (url) => context.get(url).then((response) => response.json());
  const viewer = (await json('/api/viewer')).viewer;
  const application = viewer.applications[0];
  const created = [];

  try {
    // ── The original, filled in completely ─────────────────────────────────
    const seed = await context.post('/api/admin/submissions', {
      headers,
      data: {
        type: 'report',
        status: 'New',
        application_name: application.name,
        created_by: 'Verification harness',
        created_by_email: 'verify@example.invalid',
        summary_of_issue: `${MARKER} original — safe to delete`,
        what_happened_exact_details: 'What the requester needs, in their words.',
        request: 'What is missing from the one they use today.',
        is_new_dashboard: false,
        existing_report_link: 'https://example.test/reports/unapplied-cash',
        changes_requested: 'A column for the write-off reason.',
        needed_data: 'Billing extract, nightly.',
        report_usage_frequency: 'Weekly',
        department: 'Claims Operations',
        desired_completion_date: '2026-09-30',
        is_public: false,
      },
    }).then((response) => response.json());
    const originalId = Number(seed?.submission?.id || seed?.id);
    created.push(originalId);
    record('a report request was created to export', Boolean(originalId), `#${originalId}`);

    // The analyst's half, through the endpoints that own it.
    const assignableUsers = (await json(`/api/admin/submissions/${originalId}`)).assignable_users || [];
    const analyst = assignableUsers.find((user) => user.name !== viewer.user.displayName) || assignableUsers[0];
    const levels = (await json('/api/admin/meta/options')).levelsOfEffort || [];
    const level = levels.find((row) => row.isActive)?.name;
    record(
      'there is somebody to assign it to and a level of effort to give it',
      Boolean(analyst) && Boolean(level),
      `${analyst?.name} · ${level} (${assignableUsers.length} assignable, ${levels.length} levels)`,
    );

    // Flat, not wrapped in `.submission`: the detail endpoint spreads the row.
    const currentRow = await json(`/api/admin/submissions/${originalId}`);
    const saved = await context.put(`/api/admin/submissions/${originalId}`, {
      headers,
      data: {
        ...currentRow,
        status: 'Delivered',
        assigned_to: analyst.id,
        level_of_effort: level,
        approved_at: '2026-07-01T00:00:00.000Z',
        approved_by_name: 'A Supervisor',
        delivery_notes: 'Delivered as a Power BI page under Billing > Unapplied cash. Refreshes nightly at 04:00.',
      },
    }).then((response) => response.json());
    await context.post(`/api/admin/submissions/${originalId}/time-entries`, {
      headers,
      data: { hours: 2.5, worked_on: '2026-08-03', note: MARKER },
    });
    record(
      'the analyst half is stored, and Delivered filled the completion date',
      (saved.submission || saved).completed_at != null,
      `assigned_to=${(saved.submission || saved).assigned_to} level=${(saved.submission || saved).level_of_effort}`,
    );

    // ── Export it ───────────────────────────────────────────────────────────
    const exported = await context.get(
      `/api/admin/submissions/export-xlsx?search=${encodeURIComponent(MARKER)}&fields=${REPORT_EXPORT_FIELDS.join(',')}`,
    );
    const exportPath = path.join(WORK_DIR, 'exported.xlsx');
    writeFileSync(exportPath, await exported.body());
    const sheet = XLSX.readFile(exportPath);
    const rows = XLSX.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]], { defval: '', raw: false });
    const original = rows.find((row) => String(row.Summary || '').includes(`${MARKER} original`));

    record(
      'the export carries every report column, with values',
      Boolean(original)
        && original['New Dashboard Request?'] === 'No'
        && original['Existing Report'] === 'https://example.test/reports/unapplied-cash'
        && original['Changes Requested'] === 'A column for the write-off reason.'
        && original['Usage Frequency'] === 'Weekly'
        && original.Department === 'Claims Operations'
        && original['Assigned To'] === analyst.name
        && original['Level of Effort'] === level
        && String(original['Hours Logged']) === '2.5'
        && Boolean(original['Complete Date'])
        && original['Approved By'] === 'A Supervisor'
        && String(original['Delivery Notes'] || '').startsWith('Delivered as a Power BI page'),
      original
        ? Object.entries(original)
          .filter(([, value]) => value !== '')
          .map(([key, value]) => `${key}=${String(value).slice(0, 22)}`)
          .join(' | ')
        : 'the exported sheet has no row for this ticket',
    );

    // ── Bring it back, alongside the rows that must NOT resolve ────────────
    const headerRow = Object.keys(rows[0] || {});
    const copy = { ...original, Summary: `${MARKER} copy — safe to delete` };
    const unknownPerson = {
      ...original,
      Summary: `${MARKER} unknown person — safe to delete`,
      'Assigned To': 'Somebody Who Does Not Exist',
      'Hours Logged': '4',
    };
    const unknownLevel = {
      ...original,
      Summary: `${MARKER} unknown level — safe to delete`,
      'Level of Effort': 'Enormous',
    };
    const sheetPath = path.join(WORK_DIR, 'reimport.xlsx');
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet([copy, unknownPerson, unknownLevel], { header: headerRow }),
      'Sheet1',
    );
    XLSX.writeFile(book, sheetPath);

    const multipart = (extra = {}) => ({
      multipart: {
        file: {
          name: 'reimport.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: readFileSync(sheetPath),
        },
        importMode: 'report',
        ...extra,
      },
      headers: { 'X-CSRF-Token': csrf },
    });

    const analysis = await context.post('/api/admin/submissions/import-xlsx/analyze', multipart())
      .then((response) => response.json());
    const claimed = Object.keys(analysis.suggestedMappings || {});
    record(
      'the sheet the portal wrote is recognised column for column',
      claimed.length >= REPORT_EXPORT_FIELDS.length - 2
        && claimed.includes('is_new_dashboard')
        && claimed.includes('level_of_effort')
        && claimed.includes('assigned_to')
        && claimed.includes('hours_logged')
        && (analysis.unknownStatuses || []).length === 0,
      `${claimed.length} fields claimed a header out of ${headerRow.length} in the sheet; unknown statuses: ${JSON.stringify(analysis.unknownStatuses)}`,
    );
    record(
      'and the statuses it offers are the report vocabulary, not the defect one',
      (analysis.allowedStatuses || []).includes('Delivered')
        && !(analysis.allowedStatuses || []).includes('Deployed'),
      (analysis.allowedStatuses || []).join(' · '),
    );

    // Read the STATUS as well as the body: a refused import answers with an error
    // object, and reporting its missing fields as "undefined" hides the reason.
    const post = async (label, options) => {
      const response = await context.post('/api/admin/submissions/import-xlsx', options);
      const body = await response.json().catch(() => ({}));
      if (!response.ok()) {
        throw new Error(`${label} failed: ${response.status()} ${JSON.stringify(body).slice(0, 400)}`);
      }
      return body;
    };

    const dry = await post('dry run', multipart({
      dryRun: 'true',
      columnMappings: JSON.stringify(analysis.suggestedMappings || {}),
    }));
    record(
      'a dry run reads all three rows and writes nothing',
      dry.validRows === 3 && dry.insertedRows === 0 && dry.dryRun === true,
      `${dry.validRows} valid, ${dry.insertedRows} inserted`,
    );

    const applied = await post('import', multipart({
      columnMappings: JSON.stringify(analysis.suggestedMappings || {}),
    }));
    record(
      'the import writes all three as report requests',
      applied.insertedRows === 3 && applied.invalidRows === 0,
      `${applied.insertedRows} inserted, ${applied.invalidRows} skipped, ${(applied.warnings || []).length} warnings`,
    );

    // Find what it wrote, so it can be compared and then removed.
    const queue = await json(`/api/admin/submissions?search=${encodeURIComponent(MARKER)}`);
    const list = Array.isArray(queue) ? queue : (queue.submissions || queue.rows || []);
    const byName = (needle) => list.find((row) => String(row.summary_of_issue || '').includes(needle));
    const copyRow = byName('copy');
    const unknownPersonRow = byName('unknown person');
    const unknownLevelRow = byName('unknown level');
    for (const row of [copyRow, unknownPersonRow, unknownLevelRow]) {
      if (row?.id && !created.includes(Number(row.id))) created.push(Number(row.id));
    }

    // Both sides read from the SAME list, so the comparison is like for like: one
    // mapper, one hydration, and any difference is the round trip's own doing.
    const originalRow = byName('original');
    const sameFields = [
      'type', 'status', 'is_new_dashboard', 'needed_data', 'measures_and_sources',
      'primary_contact', 'existing_report_link', 'changes_requested',
      'report_usage_frequency', 'department', 'assigned_to', 'level_of_effort',
      'approved_by_name', 'what_happened_exact_details', 'request',
      // Out and back again. This is the column a team migrating onto the portal
      // carries the most history in, and it was the one field the round trip
      // could not reproduce until it was mapped in both directions.
      'delivery_notes',
    ];
    const drifted = sameFields.filter((field) => (
      String(copyRow?.[field] ?? '') !== String(originalRow?.[field] ?? '')
    ));
    record(
      'the copy carries every value the original had',
      Boolean(copyRow) && drifted.length === 0,
      drifted.length
        ? drifted.map((field) => `${field}: "${originalRow?.[field]}" -> "${copyRow?.[field]}"`).join(' | ')
        : `${sameFields.length} fields identical, assigned_to=${copyRow?.assigned_to} level=${copyRow?.level_of_effort}`,
    );
    record(
      'and its completion date and hours came back too',
      Boolean(copyRow?.completed_at) && Number(copyRow?.hours_logged) === 2.5,
      `completed_at=${copyRow?.completed_at} hours_logged=${copyRow?.hours_logged}`,
    );

    // Hours became a real entry, owned by the person and dated by the day worked.
    const copyDetail = await json(`/api/admin/submissions/${copyRow.id}`);
    const entries = copyDetail.time_entries || [];
    record(
      'the imported Duration is one time entry, credited to the assignee',
      entries.length === 1
        && Number(entries[0].user_id) === Number(analyst.id)
        && Number(entries[0].hours) === 2.5
        && /Imported/i.test(entries[0].note || ''),
      JSON.stringify(entries.map((entry) => ({ who: entry.user_name, hours: entry.hours, day: entry.worked_on }))),
    );
    record(
      'and the imported assignee starts the handover trail',
      (copyDetail.assignments || []).length === 1
        && Number(copyDetail.assignments[0].assigned_to) === Number(analyst.id),
      JSON.stringify((copyDetail.assignments || []).map((row) => row.assigned_to_name)),
    );

    // ── What must not resolve ──────────────────────────────────────────────
    const warnings = (applied.warnings || []).map((warning) => `${warning.rowNumber}: ${warning.message}`);
    record(
      'an unknown person imports unassigned, and says so',
      unknownPersonRow?.assigned_to == null
        && warnings.some((line) => /no portal user matches "Somebody Who Does Not Exist"/.test(line)),
      warnings.join(' | ') || 'no warnings returned',
    );
    record(
      'their hours are not credited to anybody, and that is reported too',
      Number(unknownPersonRow?.hours_logged || 0) === 0
        && warnings.some((line) => /hours need somebody to credit them to/.test(line)),
      `hours_logged=${unknownPersonRow?.hours_logged}`,
    );
    record(
      'a level of effort the list does not have leaves the request unsized',
      unknownLevelRow?.level_of_effort == null
        && warnings.some((line) => /Level of Effort "Enormous"/.test(line)),
      `level_of_effort=${unknownLevelRow?.level_of_effort}`,
    );

    // ── A report sheet may not carry 'Deployed' ────────────────────────────
    const deployedPath = path.join(WORK_DIR, 'deployed.xlsx');
    const deployedBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      deployedBook,
      XLSX.utils.json_to_sheet([{ ...original, Summary: `${MARKER} deployed — safe to delete`, 'Defect/Enhancement Status': 'Deployed' }], { header: headerRow }),
      'Sheet1',
    );
    XLSX.writeFile(deployedBook, deployedPath);
    const refused = await context.post('/api/admin/submissions/import-xlsx', {
      multipart: {
        file: {
          name: 'deployed.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: readFileSync(deployedPath),
        },
        importMode: 'report',
        columnMappings: JSON.stringify(analysis.suggestedMappings || {}),
      },
      headers: { 'X-CSRF-Token': csrf },
    });
    const refusedBody = await refused.json();
    record(
      "a report sheet carrying 'Deployed' stops for a decision instead of importing it",
      refused.status() === 400
        && refusedBody.mappingRequired === true
        && (refusedBody.unknownStatuses || []).includes('Deployed')
        && !(refusedBody.allowedStatuses || []).includes('Deployed'),
      `${refused.status()} unknown=${JSON.stringify(refusedBody.unknownStatuses)}`,
    );

    // ── The dialog offers the fourth type, and the right columns with it ────
    const browser = await chromium.launch();
    try {
      const browserContext = await browser.newContext({ viewport: { width: 1500, height: 950 } });
      await browserContext.request.post(`${API}/api/auth/login`, {
        data: { username: USER, password: PASS },
      });
      const page = await browserContext.newPage();
      await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
      await page.click('button:has-text("Data")');
      await page.click('button[role="menuitem"]:has-text("Import")');
      await page.waitForSelector('.xl-steps');
      const rowTypes = await page.$$eval('.xl-body select option', (nodes) => nodes.map((node) => node.textContent.trim()));
      record(
        'the import dialog offers Report requests as a row type',
        rowTypes.includes('Report requests'),
        rowTypes.join(' · '),
      );

      await page.selectOption('.xl-body select', 'report');
      await page.setInputFiles('input[type="file"][accept*="xlsx"]', sheetPath);
      await page.waitForSelector('.xl-map, .xl-maps, .xl-preview', { timeout: 20000 });
      const offered = await page.$$eval('.xl-body option', (nodes) => nodes.map((node) => node.textContent.trim()));
      record(
        'and the fields it can map to are the report ones, not the defect ones',
        offered.includes('Level of Effort')
          && offered.includes('Assigned To')
          && offered.includes('Hours Logged')
          && !offered.includes('Steps to Reproduce')
          && !offered.includes('Screen Title'),
        `${offered.length} options, report columns present=${offered.includes('Level of Effort')}, defect-only present=${offered.includes('Screen Title')}`,
      );
      // The go-ahead, and what came out of it. Named individually because these
      // are the two an owner migrating a back catalogue asks for by name, and
      // "the report ones" above would still pass with either of them missing.
      record(
        'including the go-ahead it was given and what was delivered',
        offered.includes('Approved By')
          && offered.includes('Approved Date')
          && offered.includes('Delivery Notes'),
        `Approved By=${offered.includes('Approved By')} · Approved Date=${offered.includes('Approved Date')} · Delivery Notes=${offered.includes('Delivery Notes')}`,
      );
      await page.keyboard.press('Escape');
    } finally {
      await browser.close();
    }
  } finally {
    if (created.length > 0) {
      const output = execFileSync(
        process.execPath,
        ['scripts/removeVerificationSubmissions.js', ...created.map((id) => String(id)), '--apply'],
        { cwd: SERVER_DIR, encoding: 'utf8' },
      );
      console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
      const remaining = await context.get(`/api/admin/submissions?search=${encodeURIComponent(MARKER)}`)
        .then((response) => response.json())
        .catch(() => []);
      const left = Array.isArray(remaining) ? remaining : (remaining.submissions || remaining.rows || []);
      record(
        'every ticket this run created is gone again',
        left.length === 0,
        left.length ? `still present: ${left.map((row) => `#${row.id}`).join(', ')}` : `${created.length} removed`,
      );
    }
    await context.dispose();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const result of failed) console.log(`  - ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
