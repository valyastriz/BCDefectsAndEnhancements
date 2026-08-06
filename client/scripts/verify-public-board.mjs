/**
 * Browser verification for the public status board's per-type track.
 *
 * WHY THIS SCRIPT EXISTS. The board's four-stop track was hard-coded to
 * Reported → Approved → With Service Desk → Deployed, and a report request never
 * reaches either of the last two — it is built in the portal, not handed to the
 * Service Desk. So a delivered report request drew as **stuck at Reported**:
 * its status was not on the track at all, and nothing after stop one could be
 * reached. That is the defect that blocked showing this type to requesters, and
 * it is invisible to every unit test, because it is a claim about what a reporter
 * sees on a row.
 *
 * What it checks:
 *   1. A report request travels Reported → Approved → In progress → Delivered,
 *      with a date under each stop it reached and its own word on the row.
 *   2. A defect still travels the Service Desk track — the change is per type, not
 *      a replacement.
 *   3. 'On hold' reads as parked rather than as a track that stopped moving.
 *   4. `completed_at` is filled when a report request is marked Delivered, because
 *      the throughput page counts by that column and the board's own word for the
 *      end state must not leave it empty.
 *   5. Per-container overflow at three widths in both themes.
 *
 * IT WRITES: one public report request, walked through its statuses, and removed
 * again through server/scripts/removeVerificationSubmissions.js with the count
 * printed. Nothing else on the board is touched.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-public-board.mjs
 *   node scripts/verify-public-board.mjs --shots ./out
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OVERFLOW_PROBE } from './lib/overflow-probe.mjs';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const API = process.env.VERIFY_API_URL || 'http://localhost:4000';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin123';

const shotsIndex = process.argv.indexOf('--shots');
const SHOTS = shotsIndex === -1 ? null : (process.argv[shotsIndex + 1] || './verify-shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1500, height: 950 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'phone', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];

const MARKER = 'VERIFY public board';
const SERVER_DIR = path.resolve(fileURLToPath(new URL('../../server', import.meta.url)));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shoot(page, label) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
}

/** What one row on the board says: its stage word, and its expanded track. */
const ROW_PROBE = (reference) => {
  const items = [...document.querySelectorAll('.sb-item')];
  const row = items.find((item) => item.querySelector('.sb-ref')?.textContent?.trim() === reference);
  if (!row) return { found: false, refs: items.slice(0, 5).map((item) => item.querySelector('.sb-ref')?.textContent?.trim()) };
  return {
    found: true,
    typeChip: row.querySelector('.sb-type')?.textContent?.trim() || null,
    stage: row.querySelector('.sb-stage-lbl')?.textContent?.trim() || null,
    parked: row.querySelector('.sb-out--holding')?.textContent?.trim() || null,
    pipsOn: row.querySelectorAll('.sb-pips i.on').length,
    // Present only once the row is expanded.
    stops: [...row.querySelectorAll('.sb-stop')].map((stop) => ({
      label: stop.querySelector('.sb-stop-lbl')?.textContent?.trim(),
      date: stop.querySelector('.sb-stop-date')?.textContent?.trim(),
      done: stop.classList.contains('is-done'),
      now: stop.classList.contains('is-now'),
    })),
  };
};

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORTS[0], deviceScaleFactor: 2, reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const login = await context.request.post(`${API}/api/auth/login`, {
    data: { username: USER, password: PASS },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'bc_csrf')?.value || '';
  if (!csrf) throw new Error('no bc_csrf cookie');
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };

  const viewer = (await context.request.get(`${API}/api/viewer`).then((r) => r.json())).viewer;
  const application = (viewer.applications || [])[0];

  let createdId = null;
  try {
    // ── The fixture: one public report request, walked through its statuses ──
    const created = await context.request.post(`${API}/api/admin/submissions`, {
      headers,
      data: {
        type: 'report',
        status: 'New',
        application_name: application.name,
        created_by: 'Verification harness',
        created_by_email: 'verify@example.invalid',
        summary_of_issue: `${MARKER} — safe to delete`,
        what_happened_exact_details: 'Created by scripts/verify-public-board.mjs. Removed by the same run.',
        measures_and_sources: 'One measure, from one place.',
        is_new_dashboard: true,
        is_public: true,
      },
    }).then((response) => response.json());
    createdId = Number(created?.submission?.id || created?.id);
    record('a public report request was created', Boolean(createdId), `#${createdId}`);

    const save = async (patch) => {
      const current = await context.request.get(`${API}/api/admin/submissions/${createdId}`)
        .then((response) => response.json());
      const response = await context.request.put(`${API}/api/admin/submissions/${createdId}`, {
        headers,
        data: { ...(current.submission || current), ...patch },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok()) throw new Error(`PUT ${response.status()}: ${JSON.stringify(body)}`);
      return body.submission || body;
    };

    // Each status change writes its own history entry, which is where the board
    // reads the date under each stop from.
    await save({ status: 'Approved' });
    await save({ status: 'In progress' });
    const delivered = await save({ status: 'Delivered' });

    record(
      'marking it Delivered fills the completion date the throughput page counts by',
      Boolean(delivered.completed_at) && delivered.is_complete === true,
      `completed_at=${delivered.completed_at} is_complete=${delivered.is_complete}`,
    );

    // ── The board ───────────────────────────────────────────────────────────
    await page.goto(`${BASE}/public`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sb-item');

    const reference = `#${createdId}`;
    let row = await page.evaluate(ROW_PROBE, reference);
    record(
      'the delivered report request is on the board, at its own last stop',
      row.found && row.stage === 'Delivered' && row.pipsOn === 4,
      row.found ? `stage="${row.stage}" pips on=${row.pipsOn}` : `not found among ${JSON.stringify(row.refs)}`,
    );
    // It used to be called a Defect here: the chip read
    // `type === 'enhancement' ? 'Enhancement' : 'Defect'`, so every third type
    // landed in the else.
    record(
      'and it is called what it is, not a defect',
      row.typeChip === 'Report',
      `chip="${row.typeChip}"`,
    );

    await page.click(`.sb-item:has(.sb-ref:text-is("${reference}")) .sb-row`);
    await page.waitForTimeout(200);
    row = await page.evaluate(ROW_PROBE, reference);
    record(
      'its track is Reported → Approved → In progress → Delivered, dated at every stop',
      row.stops.map((stop) => stop.label).join(' → ') === 'Reported → Approved → In progress → Delivered'
        && row.stops.every((stop) => stop.done && stop.date && stop.date !== '—'),
      row.stops.map((stop) => `${stop.label} ${stop.date}`).join(' · '),
    );
    await shoot(page, 'public-board-report-track');

    // The two stops a report request never reaches must not appear on it at all.
    record(
      'and it never mentions the Service Desk hand-off it does not make',
      !row.stops.some((stop) => /Service Desk|Deployed/i.test(stop.label)),
      row.stops.map((stop) => stop.label).join(' · '),
    );

    // A defect on the same board still travels the other track — the change is
    // per type, not a replacement.
    const defectRow = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sb-item')];
      for (const item of items) {
        const stage = item.querySelector('.sb-stage-lbl')?.textContent?.trim();
        if (stage && /Service Desk|Deployed|Reported|Approved/i.test(stage)) {
          const ref = item.querySelector('.sb-ref')?.textContent?.trim();
          return { ref, stage };
        }
      }
      return null;
    });
    if (defectRow) {
      await page.click(`.sb-item:has(.sb-ref:text-is("${defectRow.ref}")) .sb-row`);
      await page.waitForTimeout(200);
      const other = await page.evaluate(ROW_PROBE, defectRow.ref);
      record(
        'a defect still travels the Service Desk track',
        other.stops.some((stop) => /Service Desk/i.test(stop.label))
          && other.stops.some((stop) => stop.label === 'Deployed'),
        `${defectRow.ref}: ${other.stops.map((stop) => stop.label).join(' → ')}`,
      );
      await page.click(`.sb-item:has(.sb-ref:text-is("${defectRow.ref}")) .sb-row`);
    } else {
      record('a defect still travels the Service Desk track', false, 'no other row on the board to compare against');
    }

    // ── Parked, not stalled ─────────────────────────────────────────────────
    await save({ status: 'On hold' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.sb-item');
    row = await page.evaluate(ROW_PROBE, reference);
    record(
      "'On hold' reads as parked rather than as a track that stopped",
      // The pill carries a glyph before its word, so this asks what it says, not
      // what its textContent is character for character.
      /On hold/.test(row.parked || '') && row.stage === null,
      `parked="${row.parked}" stage="${row.stage}"`,
    );
    await shoot(page, 'public-board-report-onhold');

    // ── Back to Delivered for the responsive pass ───────────────────────────
    await save({ status: 'Delivered' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.sb-item');
    await page.click(`.sb-item:has(.sb-ref:text-is("${reference}")) .sb-row`);

    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.evaluate((value) => {
          window.localStorage.setItem('bc-theme', value);
          document.documentElement.setAttribute('data-theme', value);
        }, theme);
        await page.waitForTimeout(140);
        const offenders = await page.evaluate(OVERFLOW_PROBE, '.app-main');
        record(
          `status board has no clipped overflow — ${viewport.name} ${theme}`,
          offenders.length === 0,
          offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
        );
        await shoot(page, `public-board-${viewport.name}-${theme}`);
      }
    }

    // The stage tiles count both vocabularies at each position, so the numbers
    // still sum to the total with a report request on the board.
    await page.setViewportSize(VIEWPORTS[0]);
    const tiles = await page.$$eval('.pb-tile', (nodes) => nodes.map((node) => ({
      label: node.querySelector('.pb-tile-lbl')?.textContent?.trim(),
      count: Number(node.querySelector('.pb-tile-num')?.textContent?.trim()),
    })));
    const everything = tiles.find((tile) => tile.label === 'Everything');
    const stops = tiles.filter((tile) => tile.label !== 'Everything');
    record(
      'the stage tiles name both vocabularies and still sum to the whole board',
      stops.some((tile) => /In progress/.test(tile.label || ''))
        && stops.some((tile) => /Delivered/.test(tile.label || ''))
        && stops.reduce((sum, tile) => sum + tile.count, 0) === everything.count,
      tiles.map((tile) => `${tile.count} ${tile.label}`).join(' | '),
    );

    const realErrors = consoleErrors.filter((text) => !/401|Unauthorized|403/i.test(text));
    record('console is clean', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  } finally {
    if (createdId) {
      const output = execFileSync(
        process.execPath,
        ['scripts/removeVerificationSubmissions.js', String(createdId), '--apply'],
        { cwd: SERVER_DIR, encoding: 'utf8' },
      );
      console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
      const gone = await context.request.get(`${API}/api/admin/submissions/${createdId}`);
      record(
        'the ticket this run put on the board is gone again',
        gone.status() === 404,
        `GET /api/admin/submissions/${createdId} -> ${gone.status()}`,
      );
    }
    await browser.close();
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
