/**
 * Browser verification for the Manage metadata page.
 *
 * The checks that matter here are the ones no unit test can see:
 *   1. Usage counts arrive from the server and are rendered per value — the page's
 *      whole premise is that "25 tickets use this" is visible before you switch it
 *      off.
 *   2. Switching off a value tickets USE asks first; switching off an unused one
 *      does not. Two different paths through the same control.
 *   3. An unsaved rename in one row survives a save in another. This is the bug
 *      the rebuild had to fix, and it only reproduces through the real DOM.
 *   4. Per-container horizontal overflow at three widths in both themes.
 *
 * It performs exactly ONE reversible write — switching a value nothing uses off
 * and straight back on — and no others. The rename checks deliberately never
 * commit: a committed rename cannot be undone from here without knowing the row's
 * original sort order, and a verification pass that leaves the data changed is not
 * a verification pass. (An earlier version of this script did commit one, and had
 * to be undone by hand against the hosted database.)
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-metadata-page.mjs
 *   node scripts/verify-metadata-page.mjs --shots ./out
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
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

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shoot(page, label) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
}

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

  const login = await page.request.post(`${API}/api/auth/login`, {
    data: { username: USER, password: PASS },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

  // ── The server's own answer, to check the page against ────────────────────
  const meta = await page.request.get(`${API}/api/admin/meta/options`).then((r) => r.json());
  const listKeys = Object.keys(meta);
  const everyValueHasCount = listKeys.every((key) => (meta[key] || []).every(
    (item) => typeof item.usageCount === 'number',
  ));
  record(
    'every lookup value carries a usageCount from the server',
    everyValueHasCount,
    `${listKeys.length} lists, ${listKeys.reduce((n, k) => n + (meta[k] || []).length, 0)} values`,
  );
  record(
    'the endpoint returns the occurrence-timeframes list',
    Array.isArray(meta.occurrenceTimeframes) && meta.occurrenceTimeframes.length > 0,
    `${(meta.occurrenceTimeframes || []).length} timeframes`,
  );

  await page.goto(`${BASE}/admin/metadata`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.md-table tbody tr');

  // ── The rail ─────────────────────────────────────────────────────────────
  const railLabels = await page.$$eval('.md-railitem-name', (n) => n.map((e) => e.textContent.trim()));
  record(
    'the rail lists every category, including Occurrence Timeframes',
    railLabels.length === 9 && railLabels.includes('Occurrence Timeframes'),
    `${railLabels.length}: ${railLabels.join(' · ')}`,
  );

  const tiles = await page.$$eval('.md-tile', (nodes) => nodes.map((n) => ({
    num: n.querySelector('.md-tile-num').textContent.trim(),
    label: n.querySelector('.md-tile-lbl').textContent.trim(),
  })));
  const serverValueTotal = listKeys.reduce((n, k) => n + (meta[k] || []).length, 0);
  const serverUnused = listKeys.reduce(
    (n, k) => n + (meta[k] || []).filter((i) => Number(i.usageCount || 0) === 0).length, 0,
  );
  record(
    'the summary tiles agree with the server',
    tiles[0]?.num === '9'
      && Number(tiles[1]?.num) === serverValueTotal
      && Number(tiles[2]?.num) === serverUnused,
    tiles.map((t) => `${t.num} ${t.label}`).join(' | ') + ` (server: ${serverValueTotal} values, ${serverUnused} unused)`,
  );

  // ── Usage counts on screen ───────────────────────────────────────────────
  const statusRows = await page.$$eval('.md-table tbody tr', (rows) => rows
    .filter((r) => !r.classList.contains('md-consequence'))
    .map((r) => ({
      name: r.querySelector('.md-name-input')?.value,
      uses: Number(r.querySelector('.md-use-n')?.textContent || -1),
      locked: Boolean(r.querySelector('.md-name-lock')),
      offered: r.querySelector('input[type=checkbox]')?.checked,
    })));
  const serverStatuses = new Map((meta.statuses || []).map((s) => [s.name, Number(s.usageCount || 0)]));
  const mismatched = statusRows.filter((row) => serverStatuses.get(row.name) !== row.uses);
  record(
    'each row shows the server usage count for its own value',
    mismatched.length === 0 && statusRows.length === (meta.statuses || []).length,
    `${statusRows.length} rows${mismatched.length ? ` | mismatched: ${mismatched.map((m) => m.name).join(', ')}` : ''}`,
  );

  const retiredRow = statusRows.find((r) => r.name === 'Retired');
  record(
    'the system-protected status is shown and marked, not hidden',
    Boolean(retiredRow?.locked),
    retiredRow ? `Retired: locked=${retiredRow.locked}` : 'Retired row absent',
  );

  // ── Switching off: used vs unused ────────────────────────────────────────
  const usedRow = statusRows.find((r) => r.uses > 0 && !r.locked && r.offered);
  const unusedRow = statusRows.find((r) => r.uses === 0 && !r.locked && r.offered);

  // The switch input is the standard visually-hidden pattern (0x0, opacity 0), so
  // a real click lands on the label that wraps it. isChecked() reads the input.
  const switchLabel = (index) => `.md-table tbody tr:nth-of-type(${index + 1}) .md-switch`;
  const switchInput = (index) => `${switchLabel(index)} input`;

  if (usedRow) {
    const index = statusRows.indexOf(usedRow);
    await page.click(switchLabel(index));
    await page.waitForSelector('.md-consequence');
    const consequence = (await page.textContent('.md-consequence')).replace(/\s+/g, ' ').trim();
    const stillOn = await page.isChecked(switchInput(index));
    record(
      'switching off a value tickets USE states the consequence and changes nothing yet',
      stillOn && consequence.includes(`${usedRow.uses} ticket`),
      consequence.slice(0, 120),
    );
    await page.click('.md-cbtn:not(.md-cbtn--go)');
    const afterKeep = await page.isChecked(switchInput(index));
    record('"Keep offering it" leaves the value on', afterKeep);
  } else {
    record('switching off a value tickets USE states the consequence', false, 'Not run: no in-use, unlocked, offered status to test with');
  }

  if (unusedRow) {
    const index = statusRows.indexOf(unusedRow);
    await page.click(switchLabel(index));
    await page.waitForSelector('.md-saved', { timeout: 15000 });
    const nowOff = await page.isChecked(switchInput(index));
    const noPrompt = (await page.$$('.md-consequence')).length === 0;
    record(
      'switching off a value nothing uses saves immediately, with no prompt',
      nowOff === false && noPrompt,
      `${unusedRow.name}: offered=${nowOff}, prompt shown=${!noPrompt}`,
    );
    // Put it back so the database is left as it was found.
    await page.click(switchLabel(index));
    await page.waitForFunction(
      (sel) => document.querySelector(sel)?.checked === true,
      switchInput(index),
      { timeout: 15000 },
    );
    record('the flip is reversible from the same switch', true, `${unusedRow.name} restored`);
  } else {
    record('switching off a value nothing uses saves immediately', false, 'Not run: no unused, unlocked, offered status to test with');
  }

  // ── Renaming: the draft, and what happens when a commit is refused ────────
  //
  // Neither check writes anything. A committed rename cannot be undone by this
  // script without knowing the original sort order, so it does not make one — a
  // verification pass that leaves the data changed is not a verification pass.
  const editableRows = await page.$$eval('.md-table tbody tr', (rows) => rows
    .map((r, i) => ({
      index: i,
      name: r.querySelector('.md-name-input')?.value || '',
      locked: Boolean(r.querySelector('.md-name-lock')),
    }))
    .filter((r) => !r.locked));

  if (editableRows.length >= 2) {
    const [rowA, rowB] = editableRows;
    const aSel = `.md-table tbody tr:nth-of-type(${rowA.index + 1}) .md-name-input`;

    // Typing marks the row dirty and says how to commit it.
    await page.fill(aSel, 'ZZ draft that is never committed');
    const hint = await page.textContent(`.md-table tbody tr:nth-of-type(${rowA.index + 1}) .md-name-dirty`)
      .catch(() => '');
    record(
      'a typed rename is marked as uncommitted and says how to commit it',
      /Enter/.test(hint) && /Esc/.test(hint),
      hint.trim(),
    );

    // Escape, with focus still in the field: abandons the draft, writes nothing.
    await page.focus(aSel);
    await page.keyboard.press('Escape');
    const afterEsc = await page.inputValue(aSel);
    record(
      'Esc abandons a draft rename without writing it',
      afterEsc === rowA.name,
      `back to "${afterEsc}" (was "${rowA.name}")`,
    );

    // A refused commit — a name another value in the same list already has — must
    // leave what was typed in the box. This is what the draft-reset bug broke:
    // the reload that follows a save used to wipe the draft, so the admin lost
    // their text at the exact moment they needed to correct it.
    await page.fill(aSel, rowB.name);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.bs-notice', { timeout: 10000 }).catch(() => {});
    const refusalMessage = await page.textContent('.bs-notice').catch(() => '');
    const tableSurvived = (await page.$$('.md-table tbody tr')).length > 0;
    const afterRefusal = tableSurvived ? await page.inputValue(aSel) : '';
    record(
      'a refused rename says why and keeps the table and what was typed',
      tableSurvived && afterRefusal === rowB.name && /exist/i.test(refusalMessage),
      `"${refusalMessage.trim()}" | table kept=${tableSurvived} | box holds "${afterRefusal}"`,
    );

    // And leave the row exactly as it was found.
    await page.focus(aSel);
    await page.keyboard.press('Escape');
    const finalA = await page.inputValue(aSel);
    record(
      'the row is left as it was found',
      finalA === rowA.name,
      `"${finalA}"`,
    );
  } else {
    record('renaming behaviour', false, 'Not run: fewer than two editable rows');
  }

  // ── Read-only list ───────────────────────────────────────────────────────
  await page.click('.md-railitem:has-text("Submission Sources")');
  await page.waitForSelector('.md-name-lock');
  const readOnly = await page.evaluate(() => ({
    lockedRows: document.querySelectorAll('.md-name-lock').length,
    totalRows: document.querySelectorAll('.md-table tbody tr').length,
    addRow: Boolean(document.querySelector('.md-addrow')),
    allDisabled: [...document.querySelectorAll('.md-name-input')].every((i) => i.disabled),
    showsToken: Boolean(document.querySelector('.md-name-raw')),
  }));
  record(
    'the app-written list is read-only, and shows both its label and its stored token',
    readOnly.allDisabled && !readOnly.addRow && readOnly.showsToken,
    JSON.stringify(readOnly),
  );

  // ── Responsive ───────────────────────────────────────────────────────────
  await page.click('.md-railitem:has-text("Defect/Enhancement Statuses")');
  await page.waitForSelector('.md-table tbody tr');
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate((value) => {
        window.localStorage.setItem('bc-theme', value);
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await page.waitForTimeout(150);
      const offenders = await page.evaluate(OVERFLOW_PROBE, '.app-main');
      record(
        `metadata page has no clipped overflow — ${viewport.name} ${theme}`,
        offenders.length === 0,
        offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
      );
      if (viewport.name === 'phone') {
        const railVisible = await page.isVisible('.md-rail');
        const pickerVisible = await page.isVisible('.md-picker');
        record(
          `the rail becomes a dropdown, not a scroller — phone ${theme}`,
          railVisible === false && pickerVisible === true,
          `rail=${railVisible} picker=${pickerVisible}`,
        );
      }
      await shoot(page, `metadata-${viewport.name}-${theme}`);
    }
  }

  // The 409 is provoked on purpose by the duplicate-name check above, and the 401s
  // are the anonymous viewer probes every page makes. Anything else is a finding.
  const realErrors = consoleErrors.filter((t) => !/401|Unauthorized|409|Conflict/i.test(t));
  record('console is clean', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  // ── The harness polices itself ───────────────────────────────────────────
  // This script writes. So the last thing it does is prove it put everything
  // back — every name, every switch, every position. An earlier version did not,
  // and silently left a renamed status and a switched-off one in the database.
  const after = await page.request.get(`${API}/api/admin/meta/options`).then((r) => r.json());
  const fingerprint = (payload) => Object.keys(payload).sort().map((key) => (
    `${key}:${(payload[key] || []).map((i) => `${i.id}/${i.name}/${i.isActive ? 1 : 0}/${i.sortOrder}`).join(',')}`
  )).join(' || ');
  const beforePrint = fingerprint(meta);
  const afterPrint = fingerprint(after);
  const drift = beforePrint === afterPrint
    ? ''
    : Object.keys(after).filter((key) => (
      JSON.stringify(meta[key]) !== JSON.stringify(after[key])
    )).join(', ');
  record(
    'the database is left exactly as it was found',
    beforePrint === afterPrint,
    drift ? `changed lists: ${drift}` : 'every name, switch and position unchanged',
  );

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
