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

// The Delivery-pane section creates one report request and then removes it. The
// marker is what removeVerificationSubmissions refuses to work without, so a
// mistyped id cannot delete a real ticket.
const DELIVERY_MARKER = 'VERIFY delivery pane';
const SERVER_DIR = path.resolve(fileURLToPath(new URL('../../server', import.meta.url)));

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
    // The fourth type. Its own branch rather than a cleanup tag, because a report
    // request is a stored type and is never handed to the Service Desk.
    { label: 'report', type: 'Report request', tag: null, expectBranch: 'report' },
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

  // ── The report-request branch's own two shapes ───────────────────────────
  // A change asks WHICH report first — you cannot describe what should happen to
  // one before saying which it is — and a new one asks for measures and their
  // sources. Each sub-branch must show its own fields and hide the other's.
  await page.click('.at-modes .at-seg button:has-text("New ticket")');
  await page.click('.at-grouprow .at-seg button:text-is("Report request")');
  for (const [pick, expected] of [['Something new', 'new'], ['A change to one they already use', 'change']]) {
    await page.click(`.at-only-report .at-seg button:text-is("${pick}")`);
    const shape = await page.evaluate(() => {
      const shown = (selector) => [...document.querySelectorAll(selector)]
        .filter((node) => node.offsetParent !== null).length;
      const labels = [...document.querySelectorAll('.at-only-report .at-f')]
        .filter((node) => node.offsetParent !== null)
        .map((node) => node.querySelector('.at-f-lbl')?.textContent?.replace(/\*|optional/g, '').trim());
      return {
        report: document.querySelector('.at-body')?.getAttribute('data-report'),
        newFields: shown('.at-report-new .at-f'),
        changeFields: shown('.at-report-change .at-f'),
        labels,
      };
    });
    record(
      `the report branch asks its own questions — ${expected}`,
      shape.report === expected
        && (expected === 'new' ? shape.newFields > 0 && shape.changeFields === 0
          : shape.changeFields > 0 && shape.newFields === 0)
        && shape.labels.includes('Describe what they need')
        && shape.labels.includes(expected === 'new' ? 'Measures, and where they come from' : 'Which report is it?'),
      `data-report=${shape.report}, ${shape.newFields} new / ${shape.changeFields} change fields | ${shape.labels.join(' · ')}`,
    );
  }

  // The figures a report request has no use for, and the hand-off it never makes.
  const reportExclusions = await page.evaluate(() => ({
    impactFold: [...document.querySelectorAll('.at-fold')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => node.querySelector('summary')?.textContent?.trim().split(' ')[0]),
    handoff: document.querySelector('.at-flag')?.offsetParent !== null,
    defectSections: [...document.querySelectorAll('.at-only-def, .at-only-enh')]
      .filter((node) => node.offsetParent !== null).length,
  }));
  record(
    'a report request is not offered dollar impact, a hand-off, or the other types’ fields',
    !reportExclusions.impactFold.includes('Impact')
      && reportExclusions.handoff === false
      && reportExclusions.defectSections === 0,
    JSON.stringify(reportExclusions),
  );

  // Its historical status list is its own nine words, and its timeline its own
  // stops — the two that differ are In progress and Delivered.
  await page.click('.at-modes .at-seg button:has-text("Historical ticket")');
  const reportStatuses = await page.evaluate(() => {
    const select = [...document.querySelectorAll('.at-body select')]
      .find((node) => node.previousElementSibling?.textContent?.includes('Current status')
        || node.closest('.at-f')?.textContent?.includes('Current status'));
    const stops = [...document.querySelectorAll('.at-fold-body .at-f-lbl')]
      .map((node) => node.textContent.replace(/optional/g, '').trim());
    return {
      options: select ? [...select.options].map((option) => option.value) : [],
      stops,
    };
  });
  record(
    'a historical report request ends at one of its own statuses, never Submitted or Deployed',
    reportStatuses.options.includes('In progress')
      && reportStatuses.options.includes('Delivered')
      && reportStatuses.options.includes('On hold')
      && !reportStatuses.options.includes('Submitted')
      && !reportStatuses.options.includes('Deployed'),
    reportStatuses.options.join(' · '),
  );
  record(
    'and its status timeline offers its own stops',
    reportStatuses.stops.includes('In progress')
      && reportStatuses.stops.includes('Delivered')
      && !reportStatuses.stops.includes('Deployed'),
    reportStatuses.stops.join(' · '),
  );

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

  // ── Only `New` wears the stripe ──────────────────────────────────────────
  // Every status used to have its own colour, so every row carried one and the
  // stripe distinguished nothing. It marks the one thing the status column
  // cannot say at a glance: this has not been looked at yet.
  //
  // Read off the PSEUDO-ELEMENT that actually paints it, not off the class — the
  // class is still written for every row, and asserting on it would pass no
  // matter what the stylesheet did.
  await page.setViewportSize(VIEWPORTS[0]);
  await setTheme(page, 'light');
  const stripes = await page.evaluate(() => {
    const transparent = (colour) => !colour || colour === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(colour);
    const seen = { newPainted: 0, newBare: 0, otherPainted: [], otherBare: 0 };
    for (const row of document.querySelectorAll('.admin-submissions-table tbody tr')) {
      const cell = row.querySelector('td');
      if (!cell) continue;
      const painted = !transparent(getComputedStyle(cell, '::after').backgroundColor);
      const isNew = row.classList.contains('row-status--new');
      if (isNew) {
        if (painted) seen.newPainted += 1; else seen.newBare += 1;
      } else if (painted) {
        seen.otherPainted.push([...row.classList].find((name) => name.startsWith('row-status--')) || '(none)');
      } else {
        seen.otherBare += 1;
      }
    }
    return seen;
  });
  record(
    'only New rows wear the left stripe',
    stripes.otherPainted.length === 0 && stripes.newBare === 0 && (stripes.newPainted + stripes.otherBare) > 0,
    `New: ${stripes.newPainted} striped / ${stripes.newBare} bare · everything else: ${stripes.otherBare} bare`
      + (stripes.otherPainted.length ? `, STILL STRIPED: ${[...new Set(stripes.otherPainted)].join(', ')}` : ''),
  );

  // ── A dialog opened from inside another dialog ───────────────────────────
  // The detail modal renders the redirect dialog inside its own DOM, so a
  // descendant selector meant for the detail modal's body (`.dm-modal
  // .bs-modal-body { padding: 0 }`) reached the nested one too and stripped its
  // gutters. Checked here because it is a whole class of bug — a nested modal
  // inheriting the outer one's layout overrides — not a one-off.
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

  // ── The Delivery pane, on a report request this run creates ──────────────
  // Verified through the UI rather than only through the API, because the pane is
  // where an analyst records everything the throughput page counts: the assignee,
  // the level of effort, the approval and the hours. Creating the ticket through
  // the dialog rather than the API is deliberate — it is the same act an admin
  // performs, so the fourth segment is checked end to end.
  //
  // IT WRITES. The ticket is removed at the end through
  // server/scripts/removeVerificationSubmissions.js, and the count is printed.
  let createdId = null;
  // A second fixture: a REP-filed ticket, which is what the new-submissions banner
  // counts. Both come out again in the `finally`.
  let bannerId = null;
  const scopedApplication = (await page.request.get(`${API}/api/viewer`)
    .then((response) => response.json()))
    .viewer.applications[0].name;
  try {
    await page.setViewportSize(VIEWPORTS[0]);
    await setTheme(page, 'light');
    await page.click('button:has-text("Add a ticket")');
    await page.waitForSelector('.at-body');
    await page.click('.at-grouprow .at-seg button:text-is("Report request")');
    await page.fill('.at-body input[placeholder^="e.g. Renewal"]', `${DELIVERY_MARKER} — safe to delete`);
    await page.fill('.at-body input[placeholder="First and last name"]', 'Verification harness');
    await page.fill(
      '.at-only-report textarea[placeholder^="What it should show"]',
      'Created by scripts/verify-admin-data-entry.mjs. Removed by the same run.',
    );
    await page.fill('.at-report-new textarea[placeholder^="e.g. Unapplied cash"]', 'One measure, from one place.');
    await page.click('.bs-modal-foot .bs-btn-primary');
    await page.waitForSelector('.bs-success, .at-body .bs-notice');

    const notice = await page.textContent('.bs-success, .at-body .bs-notice');
    createdId = Number((notice.match(/#(\d+)/) || [])[1]) || null;
    record(
      'a report request can be added through the dialog',
      Boolean(createdId) && /Report request/i.test(notice),
      notice.replace(/\s+/g, ' ').trim().slice(0, 120),
    );

    if (createdId) {
      // What the server actually stored, before looking at any of it on screen.
      const stored = await page.request.get(`${API}/api/admin/submissions/${createdId}`)
        .then((response) => response.json());
      const row = stored.submission || stored;
      record(
        'it is stored as a report request, with the branch it was filled in as',
        row.type === 'report' && row.is_new_dashboard === true && row.status === 'New',
        `type=${row.type} is_new_dashboard=${row.is_new_dashboard} status=${row.status} measures="${String(row.measures_and_sources || '').slice(0, 40)}"`,
      );

      // Open it in the queue by searching for it, rather than trusting sort order.
      await page.fill('.admin-cmdbar input[type="search"], input[placeholder^="Search ID"]', String(createdId));
      await page.waitForTimeout(400);
      await page.click('.admin-submissions-table tbody tr:first-of-type td:nth-of-type(2)');
      await page.waitForSelector('.dm-modal');

      const tabs = await page.$$eval('.dm-tab', (nodes) => nodes.map((node) => node.textContent.trim()));
      record(
        'the detail modal carries a Delivery tab where the hand-off would be',
        tabs.includes('Delivery') && !tabs.some((tab) => /Service Desk|EasyVista/i.test(tab)),
        tabs.join(' · '),
      );

      // ── The request itself, on the Report tab ─────────────────────────────
      // The requester's eight fields were stored, exported and imported but drawn
      // NOWHERE in this modal: the tab asked a defect's questions (policy number,
      // screen, time it happened) and showed the summary alone, so an analyst
      // could not read what had been asked for.
      await page.click('.dm-tab:has-text("Report")');
      await page.waitForSelector('.dm-report-grid');
      const reportTab = await page.evaluate(() => ({
        labels: [...document.querySelectorAll('.dm-rofield > span')].map((node) => node.textContent.trim()),
        values: [...document.querySelectorAll('.dm-ro')].map((node) => node.textContent.trim()),
      }));
      record(
        'the Report tab shows what was actually requested',
        ['Described in their words', 'Data it needs', 'Measures, and where they come from', 'Application']
          .every((label) => reportTab.labels.includes(label))
        && !reportTab.labels.includes('Policy #')
        && !reportTab.labels.includes('Steps to Reproduce'),
        reportTab.labels.join(' · '),
      );

      // ── The Impact tab keeps only the notes ──────────────────────────────
      // Dollar impact, policies affected and an occurrence rate are
      // defect/enhancement measures: a dashboard that does not exist yet affects
      // no policies and recurs no number of times a month. Its SIZE is level of
      // effort and hours, on Delivery.
      await page.click('.dm-tab:has-text("Impact")');
      await page.waitForTimeout(160);
      await page.waitForSelector('#dm-panel-impact');
      const impactTab = await page.evaluate(() => {
        const pane = document.querySelector('#dm-panel-impact');
        return {
          numbers: pane.querySelectorAll('input[type="number"]').length,
          textareas: pane.querySelectorAll('textarea').length,
          groups: [...pane.querySelectorAll('.dm-group-label')].map((node) => node.textContent.trim()),
          labels: [...pane.querySelectorAll('.bs-field > span')].map((node) => node.textContent.trim()),
        };
      });
      record(
        'a report request’s Impact tab is impact notes and nothing else',
        impactTab.numbers === 0
          && impactTab.textareas === 1
          && impactTab.groups.length === 0
          && impactTab.labels.some((label) => /Impact notes/i.test(label)),
        `${impactTab.numbers} number inputs, ${impactTab.textareas} textareas, groups: ${impactTab.groups.join(', ') || 'none'}`,
      );

      await page.click('.dm-tab:has-text("Delivery")');
      await page.waitForSelector('.dm-hrs');

      const pane = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.dm-group-label')].map((node) => node.textContent.trim());
        const fields = [...document.querySelectorAll('.bs-field > span')].map((node) => node.textContent.trim());
        const selectFor = (text) => [...document.querySelectorAll('.bs-field')]
          .find((field) => field.querySelector('span')?.textContent?.includes(text))
          ?.querySelector('select');
        return {
          groups: labels,
          fields,
          // Not just "the select is there": the list behind it comes through the
          // metadata load, and it arrived empty for a while because the client's
          // normalizer dropped the whole lookup. A select with only its
          // placeholder is a dropdown that cannot be used.
          effortOptions: [...(selectFor('Level of effort')?.options || [])].map((option) => option.textContent.trim()),
          assigneeOptions: [...(selectFor('Assigned to')?.options || [])].length,
          hoursFoldOpen: document.querySelector('.dm-fold-btn')?.getAttribute('aria-expanded'),
          hoursSummary: document.querySelector('.dm-fold-sum')?.textContent?.replace(/\s+/g, ' ').trim(),
        };
      });
      record(
        'the pane groups assignment, sizing, go-ahead and hours',
        pane.groups.includes('Assignment')
          && pane.groups.includes('Sizing')
          && pane.groups.includes('Go-ahead')
          && pane.groups.includes('Hours logged')
          && pane.fields.some((field) => /Assigned to/i.test(field))
          && pane.fields.some((field) => /Level of effort/i.test(field)),
        `${pane.groups.join(' · ')} | hours fold open=${pane.hoursFoldOpen} (${pane.hoursSummary})`,
      );
      record(
        'the hours ledger is drawn closed, with its total on the label',
        pane.hoursFoldOpen === 'false' && /0/.test(pane.hoursSummary || ''),
        `aria-expanded=${pane.hoursFoldOpen} summary="${pane.hoursSummary}"`,
      );
      record(
        'its two dropdowns are populated, not just present',
        pane.effortOptions.length > 1 && pane.assigneeOptions > 1,
        `level of effort: ${pane.effortOptions.join(' · ')} | ${pane.assigneeOptions} assignee options`,
      );

      // ── What a report request answers instead of "what shipped" ───────────
      // Release # and Release Notes are deploy language; nothing ships here. The
      // question that does apply — what the requester actually got — had nowhere
      // to go until delivery_notes. Only the presence check here; the write and
      // the History tab come after the hours ledger below, so this section does
      // not leave the Delivery pane half-way through its own flow.
      record(
        'the pane asks what was delivered',
        pane.groups.includes('Delivery notes')
          && pane.fields.some((field) => /What was delivered/i.test(field)),
        pane.groups.join(' · '),
      );

      // Log an hour through the pane, which is the one write this section makes
      // beyond the ticket itself — and it comes back out with the ticket.
      await page.click('.dm-fold-btn');
      await page.waitForSelector('.dm-hrs-add');
      const today = new Date();
      const workedOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await page.fill('.dm-hrs-add input[type="date"]', workedOn);
      await page.fill('.dm-hrs-add input[type="number"]', '1.5');
      await page.click('.dm-hrs-add button:has-text("Log")');
      await page.waitForSelector('.dm-hrs-row');
      const logged = await page.evaluate(() => ({
        rows: document.querySelectorAll('.dm-hrs-row').length,
        amount: document.querySelector('.dm-hrs-amt')?.textContent?.trim(),
        who: document.querySelector('.dm-hrs-who')?.textContent?.trim(),
        summary: document.querySelector('.dm-fold-sum')?.textContent?.replace(/\s+/g, ' ').trim(),
      }));
      record(
        'logging hours records who, when and how many, and the total follows',
        logged.rows === 1 && /1\.5/.test(logged.amount || '') && /1\.5/.test(logged.summary || ''),
        JSON.stringify(logged),
      );

      // ── Delivery notes, written and read back ─────────────────────────────
      const deliveryNote = 'VERIFY delivery note — safe to delete';
      await page.fill('.dm-group:has(.dm-group-label:text-is("Delivery notes")) textarea', deliveryNote);
      await page.click('.dm-save, button:has-text("Save")');
      await page.waitForTimeout(900);
      const savedNote = await page.request.get(`${API}/api/admin/submissions/${createdId}`)
        .then((response) => response.json())
        .then((body) => body.submission || body);
      record(
        'what was delivered survives the round trip to the database',
        String(savedNote.delivery_notes || '') === deliveryNote,
        `stored "${String(savedNote.delivery_notes || '').slice(0, 40)}"`,
      );
      // Left blank, the server stamps whoever saved — so the record ties to a
      // person without anybody typing their own name.
      record(
        'saving also records who worked it, without asking them to type it',
        String(savedNote.reviewer || '').trim().length > 0,
        `reviewer="${savedNote.reviewer}"`,
      );

      // ── The History tab: no Release group, and a protected ticket number ──
      await page.click('.dm-tab:has-text("History")');
      await page.waitForSelector('.dm-locked');
      const history = await page.evaluate(() => ({
        groups: [...document.querySelectorAll('.dm-group-label')].map((node) => node.textContent.trim()),
        locked: Boolean(document.querySelector('.dm-locked')),
        unlockButton: Boolean([...document.querySelectorAll('.dm-locked-btn')]
          .find((node) => /unlock/i.test(node.textContent || ''))),
        editableBeforeUnlock: Boolean(document.querySelector('.dm-locked input')),
      }));
      record(
        'a report request is not asked for a release number or release notes',
        !history.groups.includes('Release'),
        history.groups.join(' · '),
      );
      record(
        'the Service Desk number is read-only until deliberately unlocked',
        history.locked && history.unlockButton && !history.editableBeforeUnlock,
        `locked=${history.locked} button=${history.unlockButton} input before unlock=${history.editableBeforeUnlock}`,
      );
      await page.click('.dm-locked-btn');
      await page.waitForSelector('.dm-locked--open input');
      record(
        'and one click opens it, with the original still on screen to revert to',
        Boolean(await page.$('.dm-locked--open input')) && Boolean(await page.$('.dm-locked-was')),
        (await page.textContent('.dm-locked-was'))?.trim() || '',
      );
      await shoot(page, 'detail-history-ticket-unlocked');
      // Back to Delivery for the overflow sweep below, which is about that pane.
      await page.click('.dm-tab:has-text("Delivery")');
      await page.waitForSelector('.dm-hrs');

      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await setTheme(page, theme);
          await page.waitForTimeout(140);
          const offenders = await page.evaluate(OVERFLOW_PROBE, '.dm-modal');
          record(
            `delivery pane has no clipped overflow — ${viewport.name} ${theme}`,
            offenders.length === 0,
            offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
          );
          await shoot(page, `delivery-${viewport.name}-${theme}`);
        }
      }

      await page.setViewportSize(VIEWPORTS[0]);
      await setTheme(page, 'light');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.fill('.admin-cmdbar input[type="search"], input[placeholder^="Search ID"]', '');
      await page.waitForTimeout(300);

      // ── Switching between the two kinds of work ─────────────────────────────
      // Report requests and defects are different jobs done by different people.
      // The switch writes `filters.types` — the same value the filter panel's
      // multi-select writes — so the segments, the chips and the table cannot
      // disagree about what is on screen.
      const kindSegments = await page.$$eval(
        '[aria-label="Kind of request"] button',
        (nodes) => nodes.map((node) => node.textContent.trim()),
      );
      record(
        'the queue offers a one-click switch between the two kinds of work',
        kindSegments.join(' | ') === 'All kinds | Defects & enhancements | Report requests',
        kindSegments.join(' | ') || 'no switch on the queue',
      );

      // Read the row IDS rather than a Type column: which columns are on screen is
      // this admin's own choice (CustomizeViewModal), so a check that depends on
      // one being visible measures the preference, not the filter. The fixture
      // report request is the row that must appear and disappear.
      const idsOnScreen = async () => page.$$eval(
        '.admin-submissions-table tbody tr td[data-label="ID"]',
        (cells) => cells.map((cell) => Number(String(cell.textContent).replace(/\D/g, ''))).filter(Boolean),
      );
      // Wait for the LIST to come back, not for a guessed number of milliseconds:
      // every filter change refetches, and against the hosted database that takes
      // longer than any sleep worth writing. A fixed pause here read the previous
      // filter's rows and called it a failure.
      // Matched on the QUERY the click produces (`types=Report`), not merely on the
      // endpoint: a list fetch is often already in flight when the click lands, and
      // waiting for "a response from this URL" resolves on that one instead — which
      // reads the previous filter's rows and reports a passing filter as broken.
      const switchKind = async (label, expectQuery) => {
        await Promise.all([
          page.waitForResponse((response) => (
            response.request().method() === 'GET'
            && response.url().includes('/api/admin/submissions?')
            && (expectQuery
              ? response.url().includes(expectQuery)
              : !response.url().includes('types='))
          )),
          page.click(`[aria-label="Kind of request"] button:text-is("${label}")`),
        ]);
        await page.waitForTimeout(250);
      };

      await switchKind('Report requests', 'types=Report');
      const reportRows = await idsOnScreen();
      const reportChip = await page.$$eval('.admin-chip', (nodes) => nodes.map((n) => n.textContent.trim()));
      record(
        'switching to report requests puts the report request in the table',
        reportRows.includes(createdId) && reportChip.some((chip) => /Type: Report/i.test(chip)),
        `${reportRows.length} rows${reportRows.includes(createdId) ? ` including #${createdId}` : `, missing #${createdId}`} · chips: ${reportChip.join(' / ')}`,
      );

      // ── The two queues do not share a column set ─────────────────────────
      // A report request has no Service Desk number, no JIRA card and no cleanup
      // status, and does have somebody it is assigned to. Read from the header
      // row, which is what an admin actually sees.
      const headersNow = async () => page.$$eval(
        '.admin-submissions-table thead th',
        (nodes) => nodes.map((node) => node.textContent.trim()).filter(Boolean),
      );
      const reportHeaders = await headersNow();
      record(
        'the report queue shows Assigned To and drops the columns that mean nothing to it',
        reportHeaders.some((header) => /Assigned To/i.test(header))
          && !reportHeaders.some((header) => /Cleanup Status/i.test(header))
          && !reportHeaders.some((header) => /JIRA/i.test(header))
          && !reportHeaders.some((header) => /Service Desk|EasyVista/i.test(header)),
        reportHeaders.join(' · '),
      );
      // And it calls the status column what it is. A report request's statuses
      // are their own list, so "Defect/Enhancement Status" names a list it is
      // not on.
      record(
        'and its status column is called Status, not Defect/Enhancement Status',
        // `[^A-Za-z]`, not `\s`: a sortable header renders its caret glued to the
        // label ("▼Status"), so a whitespace boundary never matches and the check
        // failed against a header that was already correct.
        reportHeaders.some((header) => /(^|[^A-Za-z])Status$/.test(header))
          && !reportHeaders.some((header) => /Defect\/Enhancement Status/i.test(header)),
        reportHeaders.filter((header) => /Status/i.test(header)).join(' · '),
      );

      await switchKind('Defects & enhancements', 'types=Defect');
      const workRows = await idsOnScreen();
      record(
        'and switching to defects and enhancements takes it out again',
        workRows.length > 0 && !workRows.includes(createdId),
        `${workRows.length} rows, report request present: ${workRows.includes(createdId)}`,
      );

      const workHeaders = await headersNow();
      record(
        'and the defect queue keeps its own, unchanged',
        workHeaders.some((header) => /Service Desk|EasyVista/i.test(header))
          && workHeaders.some((header) => /Cleanup Status/i.test(header))
          && !workHeaders.some((header) => /Assigned To/i.test(header)),
        workHeaders.join(' · '),
      );
      await switchKind('All kinds', '');

      // ── Getting back from the new-submissions view ───────────────────────────
      // The banner REPLACES the whole filter set. For a while the only way back
      // was Clear all, which also threw away the application an admin was scoped
      // to — so answering "what's new?" cost them their place. Needs a rep-filed
      // New ticket for the banner to exist at all, so this makes one.
      const submitted = await page.request.post(`${API}/api/submissions`, {
        multipart: {
          type: 'defect',
          summary_of_issue: `${DELIVERY_MARKER} banner — safe to delete`,
          screen_title: 'Invoice Details',
          what_happened_exact_details: 'Created by scripts/verify-admin-data-entry.mjs to raise the new-submissions banner.',
          date_of_error: new Date().toISOString().slice(0, 10),
          application_name: scopedApplication,
        },
      });
      bannerId = Number((await submitted.json().catch(() => ({})))?.id) || null;
      record(
        'a rep-filed ticket was created to raise the banner',
        Boolean(bannerId),
        bannerId ? `#${bannerId}` : `POST /api/submissions -> ${submitted.status()}`,
      );

      if (bannerId) {
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('.admin-header-row');
        // Scope to one application, which is the thing that used to be lost.
        await page.selectOption('.admin-scope-select', scopedApplication);
        await page.waitForTimeout(400);
        const before = await page.inputValue('.admin-scope-select');

        await page.click('button:has-text("View new submissions"), .admin-alert button');
        await page.waitForTimeout(500);
        const afterJump = await page.evaluate(() => ({
          scope: document.querySelector('.admin-scope-select')?.value,
          chips: [...document.querySelectorAll('.admin-chip')].map((node) => node.textContent.trim()),
          hasBack: Boolean(document.querySelector('.admin-chip--back')),
        }));
        record(
          'the new-submissions view offers a way back to what was on screen',
          afterJump.hasBack && afterJump.scope !== before,
          `scope ${before} -> ${afterJump.scope || '(all)'} · chips: ${afterJump.chips.join(' / ')}`,
        );

        await page.click('.admin-chip--back');
        await page.waitForTimeout(500);
        const afterBack = await page.evaluate(() => ({
          scope: document.querySelector('.admin-scope-select')?.value,
          hasBack: Boolean(document.querySelector('.admin-chip--back')),
        }));
        record(
          'and taking it restores the application scope rather than clearing everything',
          afterBack.scope === before && afterBack.hasBack === false,
          `scope back to ${afterBack.scope}, offer withdrawn: ${!afterBack.hasBack}`,
        );
      }
    }
  } finally {
    const fixtures = [createdId, bannerId].filter(Boolean).map(String);
    if (fixtures.length > 0) {
      const output = execFileSync(
        process.execPath,
        ['scripts/removeVerificationSubmissions.js', ...fixtures, '--apply'],
        { cwd: SERVER_DIR, encoding: 'utf8' },
      );
      console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
      const statuses = [];
      for (const id of fixtures) {
        statuses.push(`#${id} -> ${(await page.request.get(`${API}/api/admin/submissions/${id}`)).status()}`);
      }
      record(
        'the tickets this run created are gone again',
        statuses.every((line) => line.endsWith('404')),
        statuses.join(' · '),
      );
    }
  }

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
