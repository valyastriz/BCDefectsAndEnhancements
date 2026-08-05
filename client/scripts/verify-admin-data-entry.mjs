/**
 * Browser verification for the three admin data-entry dialogs — Add a ticket,
 * Import from Excel, Export to Excel.
 *
 * Committed rather than thrown away, because the checks it runs are the ones that
 * have found real defects here and a document-level "does the page look right"
 * pass cannot see any of them:
 *
 *   1. PER-CONTAINER horizontal overflow (scrollWidth vs clientWidth). A
 *      document-level check misses overflow that an `overflow: hidden` ancestor
 *      clips — the gutter just vanishes instead of scrolling.
 *   2. Field and input counts per branch, so a layout change can be shown to have
 *      removed nothing.
 *   3. The export dialog's grouped field list against the server's real field
 *      list, so a field added server-side cannot go missing from the dialog.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-admin-data-entry.mjs
 *   node scripts/verify-admin-data-entry.mjs --shots ./out   # also write PNGs
 *
 * Credentials come from ADMIN_USER / ADMIN_PASS, defaulting to the seeded pair.
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


async function openAdmin(page) {
  const response = await page.request.post(`${API}/api/auth/login`, {
    data: { username: USER, password: PASS },
  });
  if (!response.ok()) throw new Error(`login failed: ${response.status()} ${await response.text()}`);
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.admin-header-row', { timeout: 15000 });
}

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    window.localStorage.setItem('bc-theme', value);
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
}

async function shoot(page, label) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
}

/** Count the dialog's visible labelled fields and its visible inputs. */
async function countVisible(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.at-body, .xl-body');
    if (!body) return { fields: 0, inputs: 0 };
    const shown = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
    const fields = [...body.querySelectorAll('.at-f')].filter(shown).length;
    const inputs = [...body.querySelectorAll('input, select, textarea')].filter(shown).length;
    return { fields, inputs };
  });
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
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await openAdmin(page);

  // ── The export dialog against the server's own field list ────────────────
  const serverFields = await page.request.get(`${API}/api/admin/submissions/export-fields`)
    .then((response) => response.json());

  await page.click('button:has-text("Data")');
  await page.click('button[role="menuitem"]:has-text("Export")');
  await page.waitForSelector('.xl-groups .xl-ck');

  const dialogKeys = await page.$$eval('.xl-group-body .xl-ck span', (nodes) => nodes.map((n) => n.textContent.trim()));
  const serverLabels = serverFields.fields.map((field) => field.label);
  const missing = serverLabels.filter((label) => !dialogKeys.includes(label));
  const extra = dialogKeys.filter((label) => !serverLabels.includes(label));
  record(
    'export dialog offers every server export field, and nothing else',
    missing.length === 0 && extra.length === 0 && dialogKeys.length === serverLabels.length,
    `dialog ${dialogKeys.length} / server ${serverLabels.length}${missing.length ? ` | missing: ${missing.join(', ')}` : ''}${extra.length ? ` | extra: ${extra.join(', ')}` : ''}`,
  );

  const groupNames = await page.$$eval('.xl-group-head b', (nodes) => nodes.map((n) => n.textContent.trim()));
  record('export fields are grouped', groupNames.length >= 7, `groups: ${groupNames.join(' · ')}`);

  // "What's on screen" is a claim about THIS admin's columns, so it has to be
  // derived from them. A wrongly-shaped prop makes it silently vanish, which is
  // exactly what happened the first time this ran.
  const presetLabels = await page.$$eval('.xl-preset', (nodes) => nodes.map((n) => n.textContent.trim()));
  const screenPreset = presetLabels.find((label) => /on screen/i.test(label));
  const visibleColumnCount = await page.$$eval('.admin-submissions-table thead th', (nodes) => nodes.length);
  record(
    'the export presets include a derived "what’s on screen"',
    Boolean(screenPreset),
    `presets: ${presetLabels.join(' · ')}${visibleColumnCount ? ` | queue shows ${visibleColumnCount} columns` : ''}`,
  );

  const countBanner = await page.textContent('.xl-count');
  record(
    'export leads with how many tickets match the filters',
    /\d+\s*ticket/i.test(countBanner.replace(/\s+/g, ' ')),
    countBanner.replace(/\s+/g, ' ').trim().slice(0, 90),
  );

  // Clear → the button must refuse rather than offer an empty file.
  await page.click('.xl-preset:has-text("Clear")');
  const clearedLabel = await page.textContent('.bs-modal-foot .bs-btn-primary');
  const clearedDisabled = await page.isDisabled('.bs-modal-foot .bs-btn-primary');
  record(
    'zero columns disables the download and says why',
    clearedDisabled && /at least one column/i.test(clearedLabel),
    `"${clearedLabel.trim()}" disabled=${clearedDisabled}`,
  );

  await page.click('.xl-preset:has-text("Everything")');
  const everythingLabel = await page.textContent('.bs-modal-foot .bs-btn-primary');
  record(
    'the download button states the shape of the file',
    new RegExp(`× ${serverLabels.length} columns`).test(everythingLabel),
    everythingLabel.trim(),
  );

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setTheme(page, theme);
      await page.waitForTimeout(120);
      const offenders = await page.evaluate(OVERFLOW_PROBE, '.bs-modal');
      record(
        `export dialog has no clipped overflow — ${viewport.name} ${theme}`,
        offenders.length === 0,
        offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
      );
      await shoot(page, `export-${viewport.name}-${theme}`);
    }
  }
  await page.click('.bs-close');

  // ── Add a ticket: every branch, in both modes ────────────────────────────
  await page.setViewportSize(VIEWPORTS[0]);
  await setTheme(page, 'light');
  await page.click('button:has-text("Add a ticket")');
  await page.waitForSelector('.at-body');

  const BRANCHES = [
    { label: 'defect', type: 'Defect', tag: null, expectBranch: 'defect' },
    { label: 'enhancement', type: 'Enhancement', tag: null, expectBranch: 'enhancement' },
    { label: 'cleanup-internal', type: 'Cleanup', tag: 'Internal only', expectBranch: 'none' },
    { label: 'cleanup-defect', type: 'Cleanup', tag: 'Defect', expectBranch: 'defect' },
    { label: 'cleanup-enhancement', type: 'Cleanup', tag: 'Enhancement', expectBranch: 'enhancement' },
  ];

  for (const mode of ['New ticket', 'Historical ticket']) {
    await page.click(`.at-modes .at-seg button:has-text("${mode}")`);
    for (const branch of BRANCHES) {
      await page.click(`.at-grouprow .at-seg button:text-is("${branch.type}")`);
      if (branch.tag) await page.click(`.at-tagrow .at-seg button:text-is("${branch.tag}")`);
      const actualBranch = await page.getAttribute('.at-body', 'data-branch');
      const counts = await countVisible(page);
      const key = `${mode === 'New ticket' ? 'new' : 'hist'}/${branch.label}`;
      record(
        `add-a-ticket branch is computed, not read off the type — ${key}`,
        actualBranch === branch.expectBranch,
        `data-branch=${actualBranch} expected=${branch.expectBranch}, ${counts.fields} fields / ${counts.inputs} inputs`,
      );

      // The hand-off offer is cleanup-only, tagged-only, new-mode-only.
      const handoffVisible = await page.isVisible('.at-flag');
      const shouldOffer = branch.type === 'Cleanup'
        && branch.expectBranch !== 'none'
        && mode === 'New ticket';
      record(
        `hand-off is offered only where it can work — ${key}`,
        handoffVisible === shouldOffer,
        `visible=${handoffVisible} expected=${shouldOffer}`,
      );

      // Historical-only fields must be ABSENT in new mode, not disabled.
      const histCount = await page.$$eval('.at-only-hist', (nodes) => nodes.filter((n) => n.offsetParent !== null).length);
      record(
        `wrong-mode fields are absent, not disabled — ${key}`,
        mode === 'New ticket' ? histCount === 0 : histCount > 0,
        `visible .at-only-hist = ${histCount}`,
      );
    }
  }

  // Reset to the plain new/defect shape for the responsive pass.
  await page.click('.at-modes .at-seg button:has-text("New ticket")');
  await page.click('.at-grouprow .at-seg button:text-is("Defect")');

  // ── Screenshots ──────────────────────────────────────────────────────────
  // The dialog this replaced could attach up to three; losing that would make an
  // admin file the ticket and then reopen it to add the evidence. Every branch
  // offers it, and it is the rep form's own drop zone — so drag, browse and paste
  // all work, and it accepts exactly what the upload endpoint accepts.
  for (const branch of BRANCHES) {
    await page.click(`.at-grouprow .at-seg button:text-is("${branch.type}")`);
    if (branch.tag) await page.click(`.at-tagrow .at-seg button:text-is("${branch.tag}")`);
    const dropVisible = await page.isVisible('.at-body .rs-drop');
    record(
      `screenshots can be attached — ${branch.label}`,
      dropVisible,
      `drop zone visible=${dropVisible}`,
    );
  }
  await page.click('.at-grouprow .at-seg button:text-is("Defect")');

  const dropRules = await page.textContent('.at-body .rs-shot-rules');
  record(
    'the drop zone states its real limits',
    /0 of 3 added/.test(dropRules) && /10 MB/.test(dropRules),
    dropRules.replace(/\s+/g, ' ').trim(),
  );
  const acceptAttr = await page.getAttribute('.at-body .rs-drop-input', 'accept');
  record(
    'it accepts only what the upload endpoint accepts',
    acceptAttr === 'image/*',
    `accept="${acceptAttr}"`,
  );

  // Attach a real PNG through the picker, then check it is listed and removable.
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.setInputFiles('.at-body .rs-drop-input', {
    name: 'evidence.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await page.waitForSelector('.at-body .rs-shot');
  const attached = await page.evaluate(() => ({
    count: document.querySelectorAll('.at-body .rs-shot').length,
    name: document.querySelector('.at-body .rs-shot-name')?.textContent,
    rules: document.querySelector('.at-body .rs-shot-rules')?.textContent.trim(),
    hasThumb: Boolean(document.querySelector('.at-body .rs-shot img')?.src?.startsWith('blob:')),
  }));
  record(
    'an attached screenshot is listed with a live thumbnail',
    attached.count === 1 && attached.name === 'evidence.png' && attached.hasThumb,
    JSON.stringify(attached),
  );
  await page.click('.at-body .rs-shot-x');
  record(
    'and can be removed again',
    (await page.$$('.at-body .rs-shot')).length === 0,
  );

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setTheme(page, theme);
      await page.waitForTimeout(120);
      const offenders = await page.evaluate(OVERFLOW_PROBE, '.bs-modal');
      record(
        `add-a-ticket has no clipped overflow — ${viewport.name} ${theme}`,
        offenders.length === 0,
        offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
      );
      await shoot(page, `add-ticket-${viewport.name}-${theme}`);
    }
  }

  // Saving with nothing filled in must name the fields, not throw.
  await page.setViewportSize(VIEWPORTS[0]);
  await setTheme(page, 'light');
  await page.fill('.at-body input[placeholder^="e.g. Renewal"]', '');
  await page.click('.bs-modal-foot .bs-btn-primary');
  await page.waitForSelector('.at-body .bs-notice');
  const validation = await page.textContent('.at-body .bs-notice');
  record(
    'an incomplete ticket is refused by name',
    /Missing required field/i.test(validation),
    validation.trim().slice(0, 120),
  );
  await page.click('.bs-close');

  // ── Import: step 1 ───────────────────────────────────────────────────────
  await page.click('button:has-text("Data")');
  await page.click('button[role="menuitem"]:has-text("Import")');
  await page.waitForSelector('.xl-steps');
  const stepLabels = await page.$$eval('.xl-step', (nodes) => nodes.map((n) => n.textContent.trim()));
  record('import is drawn as a sequence', stepLabels.length === 3, stepLabels.join(' → '));
  const onStep = await page.getAttribute('.xl-step--on', 'aria-current');
  record('import opens on step 1', onStep === 'step', `aria-current=${onStep}`);
  const chooseDisabled = await page.isDisabled('.xl-drop .bs-btn');
  record(
    'a file cannot be chosen before the row type is set',
    chooseDisabled,
    `Choose a file disabled=${chooseDisabled}`,
  );
  await page.selectOption('.xl-body select', 'defect');
  const chooseEnabled = await page.isDisabled('.xl-drop .bs-btn');
  record('setting the row type unlocks the file picker', chooseEnabled === false);

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await setTheme(page, theme);
      await page.waitForTimeout(120);
      const offenders = await page.evaluate(OVERFLOW_PROBE, '.bs-modal');
      record(
        `import dialog has no clipped overflow — ${viewport.name} ${theme}`,
        offenders.length === 0,
        offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
      );
      await shoot(page, `import-${viewport.name}-${theme}`);
    }
  }
  await page.click('.bs-close');

  // ── A dialog opened from inside another dialog ───────────────────────────
  // The detail modal renders the redirect dialog inside its own DOM, so a
  // descendant selector meant for the detail modal's body (`.dm-modal
  // .bs-modal-body { padding: 0 }`) reached the nested one too and stripped its
  // gutters. Checked here because it is a whole class of bug — a nested modal
  // inheriting the outer one's layout overrides — not a one-off.
  await page.setViewportSize(VIEWPORTS[0]);
  await setTheme(page, 'light');
  await page.click('.admin-submissions-table tbody tr:first-of-type td:nth-of-type(2)');
  await page.waitForSelector('.dm-modal');
  await page.click('.dm-foot button[aria-label="More actions"]');
  const redirectItem = await page.$('button[role="menuitem"]:has-text("Redirect")');
  if (redirectItem) {
    await redirectItem.click();
    await page.waitForSelector('.bs-modal-backdrop .bs-modal:not(.dm-modal)');
    const nested = await page.evaluate(() => {
      const body = [...document.querySelectorAll('.bs-modal:not(.dm-modal) > .bs-modal-body')].pop();
      if (!body) return null;
      const style = getComputedStyle(body);
      return {
        paddingLeft: Math.round(Number.parseFloat(style.paddingLeft)),
        paddingRight: Math.round(Number.parseFloat(style.paddingRight)),
        display: style.display,
      };
    });
    record(
      'a dialog opened from inside the detail modal keeps its own padding',
      Boolean(nested) && nested.paddingLeft >= 16 && nested.paddingRight >= 16 && nested.display !== 'grid',
      nested ? `padding ${nested.paddingLeft}/${nested.paddingRight}, display ${nested.display}` : 'no nested modal body found',
    );
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(120);
      const offenders = await page.evaluate(OVERFLOW_PROBE, '.bs-modal:not(.dm-modal)');
      record(
        `redirect dialog has no clipped overflow — ${viewport.name}`,
        offenders.length === 0,
        offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
      );
    }
    await shoot(page, 'redirect-dialog');
    await page.keyboard.press('Escape');
  } else {
    record('a dialog opened from inside the detail modal keeps its own padding', false,
      'Not run: this admin has nowhere to redirect to (needs a second active application)');
  }
  await page.setViewportSize(VIEWPORTS[0]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── The page itself, behind the dialogs ──────────────────────────────────
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(150);
    const offenders = await page.evaluate(OVERFLOW_PROBE, '.app-main');
    record(
      `admin queue has no clipped overflow — ${viewport.name}`,
      offenders.length === 0,
      offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
    );
  }

  const realErrors = consoleErrors.filter((text) => !/401|Unauthorized/i.test(text));
  record('console is clean apart from the anonymous 401 probes', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await browser.close();

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
