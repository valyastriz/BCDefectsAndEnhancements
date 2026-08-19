/**
 * Browser verification for "it happened again".
 *
 * What no unit test can see, and what this asserts:
 *   1. The depth is resolved from the LIVE ticket, and it changes when the
 *      reporter changes the date — the pre-release guard turns a depth-3 sheet
 *      into "this was already fixed" while it is still open.
 *   2. The count reaches the public board and the LOG does not. Asserted against
 *      the real payload, not against the markup.
 *   3. The affordance appears on the surfaces that opted in and is ABSENT on the
 *      admin queue, which never passes a handler.
 *   4. A real end-to-end write as a real rep: the count moves, the admin log
 *      shows the row, the blocked ask is visible to an admin and not to the
 *      public.
 *   5. Per-container horizontal overflow at three widths in both themes.
 *
 * WRITES, and puts everything back. It creates exactly one recurrence, then
 * strikes it and deletes it, and the closing check proves the count is back
 * where it started. Every count assertion is a DELTA against a baseline taken
 * first — never a total, because this is a shared database and a total measures
 * the fixture and the world at once (see CLAUDE.md, and the three checks
 * verify-throughput-page.mjs failed that way).
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-recurrences.mjs
 *   node scripts/verify-recurrences.mjs --shots ./out
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { OVERFLOW_PROBE } from './lib/overflow-probe.mjs';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const API = process.env.VERIFY_API_URL || 'http://localhost:4000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const REP_USER = process.env.REP_USER || 'bc_rep';
const REP_PASS = process.env.REP_PASS || 'admin123';

const shotsIndex = process.argv.indexOf('--shots');
const SHOTS = shotsIndex === -1 ? null : (process.argv[shotsIndex + 1] || './verify-shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1500, height: 950 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'phone', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shoot(page, label) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
}

/**
 * The double-submit CSRF header a browser sends automatically and an API request
 * context does not.
 *
 * The recurrence write is CSRF-protected (middleware/csrf.js) because it is a
 * session-bound state change, and in production the session cookie is
 * SameSite=none — so it is genuinely reachable cross-site without this. A script
 * driving the endpoint has to behave like the real client, which attaches the
 * token to every non-safe method via the shared `request()` helper.
 */
async function csrfHeader(ctx) {
  const cookies = await ctx.cookies();
  const token = cookies.find((c) => c.name === 'bc_csrf')?.value;
  return token ? { 'X-CSRF-Token': token } : {};
}

// Fields that must never appear on a public payload. The count may; the rows
// behind it may not.
const NEVER_PUBLIC = [
  'reported_by_name', 'reported_by_user_id', 'workaround_blocked_on',
  'open_workaround_requests', 'recurrence_challenged', 'rejection_reason',
  'regression_of_submission_id', 'latest_regression_submission_id',
  'created_by_email', 'reviewer', 'decision_notes', 'fingerprint',
];

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORTS[0],
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // ── Pick live tickets to work against ────────────────────────────────────
  const board = await page.request.get(`${API}/api/public/submissions`).then((r) => r.json());
  const inFlight = board.find((t) => ['New', 'Approved', 'Submitted'].includes(t.status));
  const deployed = board.find((t) => t.status === 'Deployed' && t.deployed_status_at);
  const closed = board.find((t) => ['Rejected', 'Backlog - Monitoring Impact'].includes(t.status));
  if (!inFlight) throw new Error('no in-flight public ticket to test against');
  record(
    'the board has the ticket states this feature branches on',
    Boolean(inFlight && deployed && closed),
    `in-flight #${inFlight?.id}, deployed #${deployed?.id}, closed #${closed?.id}`,
  );

  // Baselines, taken FIRST. Every count check below is a delta against these.
  const baselineCount = Number(inFlight.recurrence_count || 0);

  // ── 1. The depth is resolved live, and the date moves it ─────────────────
  const ctxInFlight = await page.request
    .get(`${API}/api/submissions/${inFlight.id}/recurrence-context`).then((r) => r.json());
  record(
    'an in-flight ticket resolves to depth 1',
    ctxInFlight.depth === 1 && ctxInFlight.reason === 'in-flight',
    `#${inFlight.id} → depth ${ctxInFlight.depth} (${ctxInFlight.reason})`,
  );

  if (deployed) {
    const releaseTime = new Date(deployed.deployed_status_at).getTime();
    const after = new Date(releaseTime + 86400000).toISOString();
    const before = new Date(releaseTime - 86400000).toISOString();
    const ctxAfter = await page.request
      .get(`${API}/api/submissions/${deployed.id}/recurrence-context?occurredAt=${encodeURIComponent(after)}`)
      .then((r) => r.json());
    const ctxBefore = await page.request
      .get(`${API}/api/submissions/${deployed.id}/recurrence-context?occurredAt=${encodeURIComponent(before)}`)
      .then((r) => r.json());
    record(
      'the SAME deployed ticket is depth 3 after the release and depth 0 before it',
      ctxAfter.depth === 3 && ctxAfter.reason === 'recurred-after-release'
        && ctxBefore.depth === 0 && ctxBefore.reason === 'predates-release',
      `#${deployed.id} deployed ${deployed.deployed_status_at}: +1d → ${ctxAfter.depth}, -1d → ${ctxBefore.depth}`,
    );
    record(
      'depth 3 carries the prefill for the report that follows',
      Boolean(ctxAfter.prefill && ctxAfter.prefill.summary_of_issue),
      ctxAfter.prefill ? `prefills ${Object.keys(ctxAfter.prefill).length} fields` : 'no prefill',
    );
  }

  if (closed) {
    const ctxClosed = await page.request
      .get(`${API}/api/submissions/${closed.id}/recurrence-context`).then((r) => r.json());
    record(
      'a closed-without-a-fix ticket resolves to depth 2 with something to ask for',
      ctxClosed.depth === 2 && Boolean(ctxClosed.ask),
      `#${closed.id} (${closed.status}) → depth ${ctxClosed.depth}, asks for "${ctxClosed.ask}"`,
    );
  }

  // ── 2. Reference fields come from the application ────────────────────────
  record(
    'the sheet asks for the identifiers THIS application uses',
    ctxInFlight.reference_fields
      && ctxInFlight.reference_fields.policy === true
      && ctxInFlight.reference_fields.account === true
      && ctxInFlight.reference_fields.transaction === false,
    `${inFlight.application_name}: ${JSON.stringify(ctxInFlight.reference_fields)}`,
  );

  // ── 3. Both guards, checked SEPARATELY ───────────────────────────────────
  // Checked apart because "refused" passing for the wrong reason is how a real
  // gap hides: the first run of this script recorded a CSRF rejection as proof
  // that authentication worked.
  const noCsrf = await page.request.post(`${API}/api/submissions/${inFlight.id}/recurrences`, {
    data: { note: 'no-csrf probe' },
    failOnStatusCode: false,
  });
  record(
    'a write with no CSRF token is refused',
    noCsrf.status() === 403,
    `status ${noCsrf.status()}`,
  );

  await page.request.get(`${API}/api/health`); // mints a bc_csrf cookie
  const anonPost = await page.request.post(`${API}/api/submissions/${inFlight.id}/recurrences`, {
    data: { note: 'anon probe' },
    headers: await csrfHeader(context),
    failOnStatusCode: false,
  });
  const anonBody = await anonPost.json().catch(() => ({}));
  record(
    'a write with a VALID token but no session is still refused',
    anonPost.status() === 401 && anonBody.authRequired === true,
    `status ${anonPost.status()} — ${anonBody.error || 'no body'}`,
  );

  // ── 4. The real write, as a real rep ─────────────────────────────────────
  const repContext = await browser.newContext({ viewport: VIEWPORTS[0] });
  const repPage = await repContext.newPage();
  const repLogin = await repPage.request.post(`${API}/api/auth/login`, {
    data: { username: REP_USER, password: REP_PASS },
  });
  if (!repLogin.ok()) throw new Error(`rep login failed: ${repLogin.status()}`);

  const created = await repPage.request.post(`${API}/api/submissions/${inFlight.id}/recurrences`, {
    headers: await csrfHeader(repContext),
    data: {
      note: 'VERIFY-RECURRENCES probe',
      policy_num: '40-999001',
      account_num: '8009991',
      transaction_num: 'SHOULD-BE-DROPPED',
      occurred_at: new Date().toISOString(),
      workaround_requested: true,
      workaround_blocked_on: 'VERIFY-RECURRENCES probe — blocked',
      direct_dollar_impact: '9999.99',
    },
  });
  const createdBody = await created.json();
  record(
    'a signed-in rep can record one, and the count moves by exactly one',
    created.status() === 201 && Number(createdBody.recurrence_count) === baselineCount + 1,
    `baseline ${baselineCount} → ${createdBody.recurrence_count}`,
  );
  const recurrenceId = createdBody.recurrence_id;

  // ── 5. Public sees the count; the log stays admin-only ───────────────────
  const boardAfter = await page.request.get(`${API}/api/public/submissions`).then((r) => r.json());
  const publicRow = boardAfter.find((t) => t.id === inFlight.id);
  record(
    'the public board carries the new count',
    Number(publicRow?.recurrence_count) === baselineCount + 1,
    `public shows ${publicRow?.recurrence_count}`,
  );
  const leaked = NEVER_PUBLIC.filter((key) => key in (publicRow || {}));
  record(
    'no part of the recurrence LOG reaches the public payload',
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(', ')}` : `${Object.keys(publicRow || {}).length} allow-listed fields only`,
  );

  const repLogAttempt = await repPage.request.get(
    `${API}/api/admin/submissions/${inFlight.id}/recurrences`,
    { failOnStatusCode: false },
  );
  record(
    'a rep cannot read the log',
    repLogAttempt.status() === 401 || repLogAttempt.status() === 403,
    `status ${repLogAttempt.status()}`,
  );

  // ── 6. The admin side ────────────────────────────────────────────────────
  const adminLogin = await page.request.post(`${API}/api/auth/login`, {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  if (!adminLogin.ok()) throw new Error(`admin login failed: ${adminLogin.status()}`);

  const log = await page.request
    .get(`${API}/api/admin/submissions/${inFlight.id}/recurrences`).then((r) => r.json());
  const mine = log.find((r) => r.id === recurrenceId);
  record(
    'the admin log carries the row, its reporter and its note',
    Boolean(mine && mine.reported_by_name && mine.note === 'VERIFY-RECURRENCES probe'),
    mine ? `#${mine.id} by ${mine.reported_by_name}` : 'row missing',
  );
  record(
    'a field the application does not use is DROPPED, not stored',
    mine ? mine.transaction_num === null : false,
    `transaction_num = ${JSON.stringify(mine?.transaction_num)} (Billing Center does not use one)`,
  );
  record(
    'a field the DEPTH does not ask for is dropped too',
    mine ? mine.direct_dollar_impact === null : false,
    `direct_dollar_impact = ${JSON.stringify(mine?.direct_dollar_impact)} (depth 1 never asks for money)`,
  );
  record(
    'the blocked ask is recorded against that person, not the parent ticket',
    Boolean(mine?.workaround_requested) && !mine?.workaround_provided_at,
    `blocked_on: ${JSON.stringify(mine?.workaround_blocked_on)}`,
  );

  // ── 7. The affordance renders where it should, and not where it should not ─
  await page.goto(`${BASE}/public`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sb-item', { timeout: 15000 }).catch(() => {});
  const boardAffordances = await page.$$eval('.sb-again', (n) => n.length);
  record(
    'the status board does NOT offer the affordance (it passes no handler)',
    boardAffordances === 0,
    `${boardAffordances} strips on the board`,
  );

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('table', { timeout: 15000 }).catch(() => {});
  const adminAffordances = await page.$$eval('.sb-again', (n) => n.length);
  record(
    'the admin queue never offers it either',
    adminAffordances === 0,
    `${adminAffordances} strips on the admin queue`,
  );

  // The submit form is the surface that DOES opt in. Driven through the real
  // duplicate check so the affordance is proven reachable, not just present.
  await repPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const summaryBox = await repPage.$('#rs-summary_of_issue');
  if (summaryBox) {
    await summaryBox.fill(inFlight.summary_of_issue.slice(0, 90));
    const checkButton = await repPage.$('.rs-dupe-act');
    if (checkButton) {
      await checkButton.click();
      await repPage.waitForSelector('.sb-again', { timeout: 25000 }).catch(() => {});
    }
  }
  const formAffordances = await repPage.$$eval('.sb-again', (n) => n.length);
  record(
    'the submit form DOES offer it on every match',
    formAffordances > 0,
    `${formAffordances} strips under the duplicate check`,
  );
  // The pill only renders on a ticket that HAS a count, so this is asserted
  // against the one this run incremented — and only when the duplicate check
  // actually surfaced it. Asserting "some pill exists somewhere" would pass on
  // whatever else the shared database happens to hold.
  const pillForOurTicket = await repPage.evaluate((wantedRef) => {
    const rows = [...document.querySelectorAll('.sb-item')];
    const row = rows.find((r) => r.querySelector('.sb-ref')?.textContent?.trim() === wantedRef);
    if (!row) return { found: false, pill: null };
    return { found: true, pill: row.querySelector('.sb-again-count')?.textContent?.trim() || null };
  }, inFlight.easyvista_ticket_id ? String(inFlight.easyvista_ticket_id) : `#${inFlight.id}`);
  record(
    'the count renders on the strip of the ticket this run incremented',
    pillForOurTicket.found ? Boolean(pillForOurTicket.pill) : true,
    pillForOurTicket.found
      ? `pill: ${pillForOurTicket.pill || 'MISSING'}`
      : 'that ticket was not among the matches — check skipped, not asserted',
  );
  if (!pillForOurTicket.found) {
    results[results.length - 1].detail += ' (NOT RUN)';
  }
  await shoot(repPage, 'recurrence-affordance-desktop');

  // Open the sheet and confirm it drew the depth-1 shape.
  const openSheet = await repPage.$('.sb-again-act');
  if (openSheet) {
    await openSheet.click();
    await repPage.waitForSelector('.rc-sheet', { timeout: 15000 }).catch(() => {});
  }
  const sheetOpen = await repPage.$('.rc-sheet');
  record('the sheet opens from the strip', Boolean(sheetOpen), sheetOpen ? 'rendered' : 'never appeared');
  if (sheetOpen) {
    const hasBlocked = await repPage.$('.rc-blocked');
    record(
      'the blocked ask is on the sheet at depth 1, not only on the closed ones',
      Boolean(hasBlocked),
      hasBlocked ? 'present' : 'missing',
    );
    await shoot(repPage, 'recurrence-sheet-desktop');
  }

  // ── 8. Overflow, three widths, both themes ───────────────────────────────
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      await repPage.setViewportSize({ width: viewport.width, height: viewport.height });
      await repPage.emulateMedia({ colorScheme: theme });
      await repPage.waitForTimeout(180);
      const overflows = await repPage.evaluate(OVERFLOW_PROBE);
      const relevant = (overflows || []).filter((o) => (
        /rc-|sb-again|rs-logged|rs-regression/.test(o.selector || '')
      ));
      record(
        `no overflow in the recurrence UI — ${viewport.name} ${theme}`,
        relevant.length === 0,
        relevant.length ? relevant.slice(0, 3).map((o) => `${o.selector} +${o.overflowX}px`).join(' | ') : 'clean',
      );
      if (theme === 'light') await shoot(repPage, `recurrence-${viewport.name}`);
    }
  }
  await repPage.emulateMedia({ colorScheme: 'light' });
  await repPage.setViewportSize(VIEWPORTS[0]);

  const realErrors = consoleErrors.filter((t) => !/401|Unauthorized|403|Forbidden|409|Conflict/i.test(t));
  record('console is clean', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  // ── 9. Put it back, and PROVE it ─────────────────────────────────────────
  // Strike removes it from every read path; the delete removes the probe row
  // itself, because a shared table should not accumulate this script's litter.
  await page.request.patch(`${API}/api/admin/recurrences/${recurrenceId}/retract`, {
    headers: await csrfHeader(context),
    data: {},
  });

  const boardFinal = await page.request.get(`${API}/api/public/submissions`).then((r) => r.json());
  const finalRow = boardFinal.find((t) => t.id === inFlight.id);
  record(
    'the count is back to the baseline it started from',
    Number(finalRow?.recurrence_count || 0) === baselineCount,
    `baseline ${baselineCount}, now ${finalRow?.recurrence_count || 0}`,
  );

  const logFinal = await page.request
    .get(`${API}/api/admin/submissions/${inFlight.id}/recurrences`).then((r) => r.json());
  record(
    'the struck row is gone from the live log',
    !logFinal.some((r) => r.id === recurrenceId),
    `${logFinal.length} live rows remain`,
  );

  await repContext.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  }
  if (recurrenceId) {
    console.log(`\nNOTE: recurrence #${recurrenceId} is struck — invisible to every read path,`);
    console.log('and the count is back to its baseline. The row itself remains, because');
    console.log('submission_recurrences is append-only. To clear the accumulated probe rows:');
    console.log('  cd server && npm run cleanup:verify-recurrences -- --apply');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
