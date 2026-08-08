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

// The application the "it isn't listed" control creates. DETERMINISTIC rather than
// unique-per-run on purpose: there is no DELETE endpoint for an application, so if
// a run is killed between the create and the cleanup the row survives — and a
// deterministic name means the next run can clear it before creating, instead of
// colliding with its own litter and reporting a duplicate refusal as a failure.
//
// The VERIFY prefix is what removeVerificationApplications.js refuses to work
// without, so this can never point at a real queue.
const CREATED_APPLICATION = 'VERIFY Reports Only Queue';
// Three tickets: a defect in a wired application, a defect in an unwired one, and a
// report request. They carry the redirect-target and hand-off-affordance checks.
const HANDOFF_MARKER = 'VERIFY handoff and redirect';

let createdApplicationId = null;
// The two hand-off fixtures (one wired application, one not), removed with the rest.
const handoffFixtureIds = [];

/**
 * Take the fixture application back out, and say what happened.
 *
 * Idempotent — the script reports "not present, nothing to do" — so it is safe both
 * as the normal cleanup and as the safety net after a crash. It also refuses an
 * application any submission points at, so it cannot orphan a ticket.
 */
function runServerScript(argv, { quiet = false } = {}) {
  let output;
  try {
    output = execFileSync(process.execPath, argv, { cwd: SERVER_DIR, encoding: 'utf8' });
  } catch (error) {
    output = String(error?.stdout || '') + String(error?.stderr || error?.message || '');
  }
  if (!quiet) console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
  return output;
}

function removeCreatedApplication(options = {}) {
  return runServerScript(
    ['scripts/removeVerificationApplications.js', CREATED_APPLICATION, '--apply'],
    options,
  );
}

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

/** The double-submit CSRF token, read from the cookie the way lib/api.js does. */
async function csrfToken(page) {
  return page.evaluate(() => (
    document.cookie.split('; ').find((part) => part.startsWith('bc_csrf='))?.split('=')[1] || ''
  ));
}

/**
 * Open one specific ticket by searching for its marker.
 *
 * Deliberately NOT "click the first row" or "find #id in the table": the queue is
 * sorted by last update and paginated, so both depend on what else the shared
 * database happens to hold. Searching narrows it to one row whatever the data.
 *
 * Waits for the list RESPONSE carrying the search term, then for the row, then for
 * the modal — never for a fixed sleep. Returns false if the search found nothing,
 * so a caller records a real reason instead of timing out on a click.
 */
async function openBySearch(page, term, id) {
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.admin-search input', { timeout: 15000 });

  // TWO narrowings have to be widened first, and both are saved per admin rather
  // than being properties of the page — so what this script sees depends on what
  // the account last looked at, which is not something a check may depend on.
  //
  //   1. The KIND switch opens on "Defects & enhancements". A report request is a
  //      different kind, done by different people, and is not in that list at all.
  //   2. The application SCOPE opens on whatever this admin PINNED. With Billing
  //      Center pinned, a ticket in `Other` is simply not in the queue — which is
  //      the queue working correctly, and reads exactly like a broken selector.
  const allKinds = await page.$('.bs-seg button:text-is("All kinds")');
  if (allKinds) {
    await allKinds.click();
    await page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
      && res.status() === 200, { timeout: 15000 }).catch(() => null);
  }
  // '' is "All applications". Set explicitly rather than assumed — this is a look,
  // not a pin, so it changes nothing about where the admin lands tomorrow.
  const scope = await page.$('.admin-scope-select');
  if (scope) {
    await scope.selectOption('');
    await page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
      && res.status() === 200, { timeout: 15000 }).catch(() => null);
  }

  await page.fill('.admin-search input', term);

  // Wait for THE ROW, not for the response. The search is debounced and the table
  // re-renders when it lands, so a response-then-$() sequence grabs an element
  // handle that is detached a moment later — "Element is not attached to the DOM",
  // which reads exactly like a broken selector. A locator re-resolves on every
  // action, so it survives the re-render.
  //
  // Matched on the ticket id rather than "the first row": the empty state renders a
  // row of its own, so "a row exists" is not "the ticket was found".
  const row = page.locator('.admin-submissions-table tbody tr', { hasText: String(id) }).first();
  try {
    await row.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    return false;
  }

  // Wait for THIS ticket's detail response, not merely for the modal. The footer
  // renders as soon as the modal opens, with whatever `detail` currently holds — so
  // reading the hand-off button before this lands reports the previous ticket's
  // answer, or none at all. It also proves the row that opened is the right one.
  const [detailResponse] = await Promise.all([
    page.waitForResponse((res) => new RegExp(`/api/admin/submissions/${id}(\\?|$)`).test(res.url())
      && res.status() === 200, { timeout: 15000 }).catch(() => null),
    row.locator('td').nth(1).click(),
  ]);
  if (!detailResponse) return false;
  await page.waitForSelector('.dm-modal', { timeout: 15000 });
  await page.waitForSelector('.dm-foot-actions', { timeout: 15000 });
  return true;
}

/**
 * Put the queue back the way this run found it.
 *
 * `openBySearch` widens the kind switch, widens the application scope and types in
 * the search box — and all three are persisted to `bc.admin.filters` in
 * localStorage, so they SURVIVE a page load. The sections that run afterwards were
 * written against a queue nobody had touched, and the Delivery-pane section timed
 * out looking for a ticket the leftover search had filtered away.
 *
 * The context is fresh per run, so "as found" is simply no stored filters at all.
 */
async function resetQueueView(page) {
  await page.evaluate(() => window.localStorage.removeItem('bc.admin.filters'));
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.admin-submissions-table tbody tr', { timeout: 15000 }).catch(() => {});
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
    // The URL as well as the text. A failed-resource console error says only
    // "the server responded with a status of 409" — which endpoint it was is in
    // the location, and without it the filter below cannot tell a refusal this
    // script deliberately provokes from a real one.
    if (message.type() === 'error') {
      consoleErrors.push(`${message.text()} @ ${message.location()?.url || 'unknown'}`);
    }
  });

  await openAdmin(page);

  // Clear any fixture application a previous killed run left behind, so the create
  // below is a create and not a collision with our own litter.
  removeCreatedApplication({ quiet: true });

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

  // ── "The application isn't listed" — an analyst adding one ────────────────
  // The half of the seventeenth pass's feature that had no UI: the endpoint
  // existed and was tested, and nothing called it.
  //
  // IT WRITES an application, and there is no DELETE endpoint for one — so the
  // fixture comes out through server/scripts/removeVerificationApplications.js in
  // the `finally` below, and the count is printed. The name carries the VERIFY
  // marker that script refuses to work without.
  await page.click('.at-modes .at-seg button:has-text("New ticket")');
  await page.click('.at-grouprow .at-seg button:text-is("Defect")');
  const controlOnDefect = await page.isVisible('.at-body .aac');
  await page.click('.at-grouprow .at-seg button:text-is("Report request")');
  const controlOnReport = await page.isVisible('.at-body .aac');
  record(
    'adding an application is offered on the report branch and nowhere else',
    controlOnReport === true && controlOnDefect === false,
    `report=${controlOnReport} defect=${controlOnDefect} — what it creates takes report requests only`,
  );

  await page.click('.at-body .aac-toggle');
  await page.waitForSelector('.at-body .aac--open input');
  await page.fill('.at-body .aac--open input', CREATED_APPLICATION);
  // Wait for the RESPONSE, not for a sleep: a fixed wait here passes while the
  // request is still in flight and then reads the picker before it has the option.
  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/admin/applications')
      && response.request().method() === 'POST'),
    page.click('.at-body .aac--open .bs-btn-secondary'),
  ]);
  const createStatus = createResponse.status();
  const createBody = await createResponse.json().catch(() => null);
  createdApplicationId = createBody?.id ?? null;
  record(
    'typing a name in creates it, and says who it was shared with',
    createStatus === 201 && createBody?.reportsOnly === true && Number(createBody?.grantedTo) > 0,
    `HTTP ${createStatus} · ${JSON.stringify(createBody)}`,
  );

  // The picker that just created it has to be re-read, or the new value is not in
  // it — the whole reason `onCreated` is awaited.
  await page.waitForSelector('.at-body .aac-added');
  const afterCreate = await page.evaluate((name) => {
    const select = [...document.querySelectorAll('.at-body select')]
      .find((node) => node.closest('.at-f')?.textContent?.includes('Application'));
    return {
      offered: select ? [...select.options].map((option) => option.value).includes(name) : false,
      selected: select?.value || '',
      note: document.querySelector('.at-body .aac-added')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    };
  }, CREATED_APPLICATION);
  record(
    'and it appears in the picker that created it, already selected',
    afterCreate.offered === true && afterCreate.selected === CREATED_APPLICATION,
    `offered=${afterCreate.offered} selected="${afterCreate.selected}"`,
  );
  record(
    'the confirmation says what it is, not just that it worked',
    /report requests only/i.test(afterCreate.note) && /shared with/i.test(afterCreate.note),
    afterCreate.note.slice(0, 140),
  );

  // The reason it is offered on one branch only: it takes nothing else. Switching
  // to a defect must withdraw it AND move the selection off it, or the picker
  // points at an option it is no longer rendering and draws blank.
  await page.click('.at-grouprow .at-seg button:text-is("Defect")');
  const afterSwitch = await page.evaluate((name) => {
    const select = [...document.querySelectorAll('.at-body select')]
      .find((node) => node.closest('.at-f')?.textContent?.includes('Application'));
    return {
      offered: select ? [...select.options].map((option) => option.value).includes(name) : false,
      selected: select?.value || '',
    };
  }, CREATED_APPLICATION);
  record(
    'a reports-only application is not offered for a defect, and is dropped if it was chosen',
    afterSwitch.offered === false && afterSwitch.selected !== CREATED_APPLICATION && afterSwitch.selected !== '',
    `offered=${afterSwitch.offered} selection moved to "${afterSwitch.selected}"`,
  );

  // The refusal path, in the server's own words. It distinguishes a name already in
  // the list from one that exists but is switched OFF, so the message is kept
  // verbatim rather than rewritten — and what was typed stays in the box.
  await page.click('.at-grouprow .at-seg button:text-is("Report request")');
  await page.click('.at-body .aac-toggle');
  await page.waitForSelector('.at-body .aac--open input');
  await page.fill('.at-body .aac--open input', CREATED_APPLICATION.toLowerCase());
  const [dupeResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/admin/applications')
      && response.request().method() === 'POST'),
    page.click('.at-body .aac--open .bs-btn-secondary'),
  ]);
  await page.waitForSelector('.at-body .aac--open .bs-notice');
  const dupe = await page.evaluate(() => ({
    message: document.querySelector('.aac--open .bs-notice')?.textContent?.trim() || '',
    kept: document.querySelector('.aac--open input')?.value || '',
  }));
  record(
    'a duplicate is refused case-insensitively, says why, and keeps what was typed',
    dupeResponse.status() === 409
      && /already in the list/i.test(dupe.message)
      && dupe.kept === CREATED_APPLICATION.toLowerCase(),
    `HTTP ${dupeResponse.status()} · "${dupe.message}" · box holds "${dupe.kept}"`,
  );

  // Reset to the plain new/defect shape for the responsive pass.
  await page.click('.at-body .aac--open .bs-btn-ghost');
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

  // ── Redirect targets per type, and the hand-off affordance ────────────────
  // Three rules meet here, and each was a hole before this pass:
  //
  //   1. A reports-only application must not be a redirect target for a defect. A
  //      redirect is the FIFTH path that sets `application_id`, and it was the one
  //      `helpers/applicationScope.js` did not cover — so a defect could be moved
  //      into a queue granted only to report workers, where no defect admin can
  //      see it. Invisible, not merely unassigned.
  //   2. Adding an application is offered in the redirect dialog too, because that
  //      is the triage action for "this belongs somewhere else" — but for a report
  //      request only, since nothing else could be sent to what it creates.
  //   3. An application the Service Desk is not wired up to shows the Send greyed
  //      out with the reason, instead of enabled and failing on click.
  //
  // ASKED OF THIS RUN'S OWN FIXTURES rather than of whatever happens to be at the
  // top of the queue, and each is opened by SEARCHING for its marker — so the check
  // does not depend on sort order, on the page size, or on what the seeded data
  // happens to contain today. All three come out again in the `finally` below.
  const fixtureSpecs = [
    {
      key: 'defect-billing',
      label: 'a defect in Billing Center',
      type: 'defect',
      application: 'Billing Center',
      // Billing Center carries a DEMO- catalog on this database, so it must keep
      // pretend-sending end to end. Asserting only the greyed half would let the
      // change that breaks the walkthrough through.
      expectBlocked: false,
      expectReportsOnlyTarget: false,
    },
    {
      key: 'defect-other',
      label: 'a defect in Other',
      type: 'defect',
      application: 'Other',
      expectBlocked: true,
      expectReportsOnlyTarget: false,
    },
    {
      key: 'report-other',
      label: 'a report request in Other',
      type: 'report',
      application: 'Other',
      // Never asked: a report request is finished by the analyst and the button is
      // withheld entirely (hidesHandoff).
      expectBlocked: null,
      expectReportsOnlyTarget: true,
    },
  ];

  for (const spec of fixtureSpecs) {
    const summary = `${HANDOFF_MARKER} ${spec.key}`;
    const created = await page.request.post(`${API}/api/admin/submissions`, {
      data: {
        type: spec.type,
        created_by: 'Verification Script',
        created_by_email: '-',
        application_name: spec.application,
        summary_of_issue: summary,
        what_happened_exact_details: 'Checking redirect targets and the hand-off affordance.',
        request: '-',
        screen_title: '-',
        steps_to_reproduce: '-',
        date_time_of_error: '-',
        status: 'New',
        ...(spec.type === 'report' ? { is_new_dashboard: true } : {}),
      },
      headers: { 'X-CSRF-Token': await csrfToken(page) },
    });
    const row = await created.json().catch(() => null);
    if (!created.ok() || !row?.id) {
      record(`fixtures exist for ${spec.label}`, false,
        `HTTP ${created.status()} — ${JSON.stringify(row).slice(0, 160)}`);
      continue;
    }
    handoffFixtureIds.push(String(row.id));
    spec.id = row.id;
  }

  for (const spec of fixtureSpecs) {
    if (!spec.id) continue;

    // The detail response first: it is where the button's reason comes from, so a
    // wrong answer here is a different fault from a wrong-looking button.
    const detail = await page.request.get(`${API}/api/admin/submissions/${spec.id}`)
      .then((response) => response.json());
    if (spec.expectBlocked === null) {
      record(
        `a report request carries no hand-off verdict at all — ${spec.label}`,
        detail.easyvista_catalog === null,
        `easyvista_catalog=${JSON.stringify(detail.easyvista_catalog)} — it is never handed on`,
      );
    } else {
      record(
        `the detail response says whether ${spec.label} can be sent to`,
        Boolean(detail.easyvista_catalog)
          && detail.easyvista_catalog.configured === !spec.expectBlocked,
        `configured=${detail.easyvista_catalog?.configured} `
          + `demoOnly=${detail.easyvista_catalog?.demoOnly} (expected configured=${!spec.expectBlocked})`,
      );
    }

    if (!(await openBySearch(page, `${HANDOFF_MARKER} ${spec.key}`, spec.id))) {
      record(`the queue can open ${spec.label}`, false,
        `searching for "${HANDOFF_MARKER} ${spec.key}" did not open #${spec.id}`);
      continue;
    }

    // ── The hand-off button ────────────────────────────────────────────────
    const button = await page.evaluate(() => {
      const send = [...document.querySelectorAll('.dm-foot-actions button')]
        .find((node) => /Submit to|Re-submit to/.test(node.textContent));
      return {
        present: Boolean(send),
        disabled: send ? send.disabled : null,
        title: send?.getAttribute('title') || '',
        note: document.querySelector('.dm-foot-blocked')?.textContent?.replace(/\s+/g, ' ').trim() || '',
      };
    });
    if (spec.expectBlocked === null) {
      record(
        `no hand-off button is offered for ${spec.label}`,
        button.present === false && button.note === '',
        `button present=${button.present}, note="${button.note}"`,
      );
    } else {
      record(
        `the hand-off button reflects the catalog for ${spec.label}`,
        button.present && button.disabled === spec.expectBlocked,
        `disabled=${button.disabled} expected=${spec.expectBlocked}`,
      );
      if (spec.expectBlocked) {
        // The note has to carry the whole procedure, because every step of it
        // already exists — the number is editable behind the unlock on this tab,
        // and Submitted is in the status dropdown. A note that only diagnosed the
        // problem would leave the admin at a dead end.
        record(
          'and the note says to raise it by hand and come back with the number',
          /by hand/i.test(button.note)
            && /number/i.test(button.note)
            && /Submitted/.test(button.note)
            && button.title === button.note,
          button.note.slice(0, 200),
        );
      } else {
        record(
          'and a walkthrough application is left able to send, with no note',
          button.note === '' && button.title === '',
          `note="${button.note}" title="${button.title}"`,
        );
      }
    }

    // ── The redirect dialog's targets ──────────────────────────────────────
    await page.click('.dm-foot button[aria-label="More actions"]');
    const item = await page.$('button[role="menuitem"]:has-text("Redirect")');
    if (!item) {
      record(`the redirect dialog offers the right targets for ${spec.label}`, false,
        'Not run: nowhere to redirect to');
    } else {
      await item.click();
      await page.waitForSelector('.bs-modal:not(.dm-modal) select');
      const dialog = await page.evaluate((name) => {
        const modal = [...document.querySelectorAll('.bs-modal:not(.dm-modal)')].pop();
        const select = modal?.querySelector('select');
        const options = select ? [...select.options].map((option) => option.textContent.trim()) : [];
        return {
          options,
          offersCreate: Boolean(modal?.querySelector('.aac')),
          offersReportsOnly: options.includes(name),
        };
      }, CREATED_APPLICATION);
      record(
        `the redirect dialog offers the right targets for ${spec.label}`,
        dialog.offersReportsOnly === spec.expectReportsOnlyTarget,
        `reports-only target offered=${dialog.offersReportsOnly} `
          + `(expected ${spec.expectReportsOnlyTarget}) · ${dialog.options.join(' / ')}`,
      );
      record(
        `and offers adding an application for ${spec.label}`,
        dialog.offersCreate === spec.expectReportsOnlyTarget,
        `control present=${dialog.offersCreate}, expected ${spec.expectReportsOnlyTarget}`,
      );
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  // The endpoint is the control; the hidden option is only the courtesy. Asked
  // directly, because this is the half that actually refuses — and it is a path
  // `applicationScope` did not cover until this pass.
  const defectFixture = fixtureSpecs.find((spec) => spec.key === 'defect-billing');
  if (defectFixture?.id && createdApplicationId) {
    const refused = await page.request.post(
      `${API}/api/admin/submissions/${defectFixture.id}/redirect`,
      {
        data: { toApplicationId: createdApplicationId },
        headers: { 'X-CSRF-Token': await csrfToken(page) },
      },
    );
    const body = await refused.json().catch(() => ({}));
    record(
      'redirecting a defect into a reports-only queue is refused by the endpoint',
      refused.status() === 400 && /report requests only/i.test(String(body.error || '')),
      `HTTP ${refused.status()} · ${String(body.error || '').slice(0, 120)}`,
    );
    // And it did not move. A refusal that returned 400 after writing would be worse
    // than one that let it through, because nothing would say so.
    const after = await page.request.get(`${API}/api/admin/submissions/${defectFixture.id}`)
      .then((response) => response.json());
    record(
      'and the refusal wrote nothing — the ticket is still in its own queue',
      after.application_name === 'Billing Center',
      `application_name=${after.application_name}`,
    );
  }

  // ── The soft association: an `Other` ticket appearing in a real queue ─────
  // `Other` means "nobody has worked out whose system this is yet". An analyst who
  // picks one up could either move it out — a claim about whose data it is that
  // nobody can make yet — or leave it where they never see it again. This is the
  // third option, and it is the only place in the portal where two columns answer
  // "whose queue is this".
  //
  // What is checked here is the part the unit tests cannot see: that the control
  // appears on exactly the tickets it should, that the choice survives a save, and
  // that the ticket then shows up in BOTH queues.
  const softFixture = fixtureSpecs.find((spec) => spec.key === 'report-other');
  const wiredFixture = fixtureSpecs.find((spec) => spec.key === 'defect-billing');

  const openTriage = async (spec) => {
    if (!(await openBySearch(page, `${HANDOFF_MARKER} ${spec.key}`, spec.id))) return false;
    await page.click('.dm-tab:has-text("Triage")');
    await page.waitForSelector('.dm-groups', { timeout: 15000 });
    return true;
  };

  // Read the label rather than an nth-of-type: the Triage tab has several selects,
  // and their order is exactly the kind of thing a layout change moves.
  const readSoftControl = () => page.evaluate(() => {
    const field = [...document.querySelectorAll('.dm-groups .bs-field')]
      .find((node) => node.textContent.includes('Also show it in'));
    const select = field?.querySelector('select');
    return {
      present: Boolean(select),
      value: select?.value ?? null,
      options: select ? [...select.options].map((option) => ({
        value: option.value,
        label: option.textContent.trim(),
      })) : [],
    };
  });

  if (wiredFixture?.id && await openTriage(wiredFixture)) {
    const control = await readSoftControl();
    record(
      'a ticket in a real application is not offered a second queue',
      control.present === false,
      'Billing Center already answers "whose queue is this" — a second answer there '
        + `would be an ambiguity. present=${control.present}`,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  const defectInOther = fixtureSpecs.find((spec) => spec.key === 'defect-other');
  if (defectInOther?.id && await openTriage(defectInOther)) {
    const control = await readSoftControl();
    record(
      'a DEFECT in Other is not offered a reports-only queue to appear in',
      control.present
        && !control.options.some((option) => option.label === CREATED_APPLICATION),
      `present=${control.present} · ${control.options.map((o) => o.label).join(' / ')} — `
        + 'that queue takes report requests only, so a defect listed there is one '
        + 'nobody in it can act on',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }

  if (softFixture?.id && await openTriage(softFixture)) {
    const control = await readSoftControl();
    const firstQueue = control.options.find((option) => option.value !== '');
    record(
      'a ticket in Other is offered the queues this admin works in',
      control.present && control.value === '' && Boolean(firstQueue)
        && !control.options.some((option) => option.label === 'Other'),
      `present=${control.present} value="${control.value}" · ${control.options.map((o) => o.label).join(' / ')}`,
    );

    if (firstQueue) {
      await page.selectOption('.dm-groups .bs-field:has-text("Also show it in") select', firstQueue.value);
      // Wait for the SAVE response, not for a sleep — and read the ticket back from
      // the API rather than trusting the screen, because the claim is about what
      // was stored.
      const [saveResponse] = await Promise.all([
        page.waitForResponse((res) => new RegExp(`/api/admin/submissions/${softFixture.id}(\\?|$)`).test(res.url())
          && res.request().method() === 'PUT', { timeout: 15000 }).catch(() => null),
        page.click('.dm-foot-actions .bs-btn-primary'),
      ]);
      const stored = await page.request.get(`${API}/api/admin/submissions/${softFixture.id}`)
        .then((response) => response.json());
      record(
        'choosing a queue is saved against the ticket',
        saveResponse?.status() === 200
          && Number(stored.working_application_id) === Number(firstQueue.value),
        `HTTP ${saveResponse?.status()} · working_application_id=${stored.working_application_id} `
          + `(expected ${firstQueue.value})`,
      );
      record(
        'and the ticket does NOT move — it is still in Other',
        stored.application_name === 'Other',
        `application_name=${stored.application_name} — moving it would be a claim `
          + 'about whose data it is that nobody can make yet',
      );

      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // The point of the whole feature: it now appears in BOTH lists. Asked of the
      // real queue scope, which is what an analyst actually looks at.
      const appearsIn = async (queueName) => {
        await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.admin-search input', { timeout: 15000 });
        const allKinds = await page.$('.bs-seg button:text-is("All kinds")');
        if (allKinds) {
          await allKinds.click();
          await page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
            && res.status() === 200, { timeout: 15000 }).catch(() => null);
        }
        await Promise.all([
          page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
            && res.url().includes('application='), { timeout: 15000 }).catch(() => null),
          page.selectOption('.admin-scope-select', queueName),
        ]);
        await Promise.all([
          page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
            && res.url().includes('search='), { timeout: 15000 }).catch(() => null),
          page.fill('.admin-search input', `${HANDOFF_MARKER} ${softFixture.key}`),
        ]);
        return page.evaluate((id) => [...document.querySelectorAll('.admin-submissions-table tbody tr')]
          .some((tr) => tr.textContent.includes(String(id))), softFixture.id);
      };

      const inChosen = await appearsIn(firstQueue.label);
      const inOther = await appearsIn('Other');
      record(
        'the ticket now appears in the chosen queue AND still in Other',
        inChosen && inOther,
        `${firstQueue.label}=${inChosen} · Other=${inOther} — one ticket, two lists, one owner`,
      );
    }
  }

  // Everything above widened the kind switch and the application scope and typed
  // in the search box, and all three persist. Put them back before the sections
  // that assume an untouched queue.
  await resetQueueView(page);

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
      // WAIT FOR THE PUT, do not click and sleep. The button is "Save Changes"
      // and it is rendered in BOTH the header and the footer, so a bare
      // `button:has-text("Save")` was ambiguous; and a fixed 900ms pause read the
      // database before a slow save had landed, which surfaced as "delivery notes
      // stored ''" — a failure that reads like the feature is broken when the
      // click is what missed.
      const [saveResponse] = await Promise.all([
        page.waitForResponse((response) => (
          response.request().method() === 'PUT'
          && response.url().includes(`/api/admin/submissions/${createdId}`)
        ), { timeout: 90000 }),
        page.click('.dm-foot button:has-text("Save Changes")'),
      ]);
      record(
        'the Delivery pane saves without complaint',
        saveResponse.ok(),
        `PUT ${saveResponse.status()}`,
      );
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

      // CLOSE IT, then PROVE IT CLOSED. Escape-and-hope was fine until this
      // section started saving: a modal mid-save does not close on the first
      // Escape, and what is left behind is `.bs-modal-backdrop`, which swallows
      // every click after it. The failure then surfaces hundreds of lines later
      // as "the kind switch never refetched", which is a lie about the product.
      // Waiting on the backdrop being gone is the difference between a check that
      // reports the queue and one that reports the modal.
      await page.keyboard.press('Escape');
      await page.waitForSelector('.bs-modal-backdrop', { state: 'detached', timeout: 30000 })
        .catch(async () => {
          // Still there: an unsaved-changes prompt is in front of it. Take the
          // discard, which is correct here — everything this section meant to
          // save, it already saved and read back.
          const discard = await page.$('button:has-text("Discard"), button:has-text("Close anyway")');
          if (discard) await discard.click();
          await page.waitForSelector('.bs-modal-backdrop', { state: 'detached', timeout: 30000 });
        });

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
      // The 90s is a TIMEOUT, not a loosened assertion — the predicate below is
      // unchanged and still insists on the exact query. Playwright's default 30s
      // timed out here three times against the hosted database while passing on a
      // re-run, which is a slow shared Postgres and not a broken filter. A check
      // that fails intermittently teaches people to re-run instead of to read it,
      // which is worse than a check that waits.
      const switchKind = async (label, expectQuery) => {
        await Promise.all([
          page.waitForResponse((response) => (
            response.request().method() === 'GET'
            && response.url().includes('/api/admin/submissions?')
            && (expectQuery
              ? response.url().includes(expectQuery)
              : !response.url().includes('types='))
          ), { timeout: 90000 }),
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
    const fixtures = [createdId, bannerId, ...handoffFixtureIds].filter(Boolean).map(String);
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

    // And the application. Removed AFTER the tickets, because the removal script
    // refuses an application any submission still points at — which is the guard
    // working, but it would read as a broken cleanup.
    if (createdApplicationId) {
      const output = removeCreatedApplication();
      const stillThere = (await page.request.get(`${API}/api/viewer`)
        .then((response) => response.json())
        .catch(() => null))?.viewer?.applications || [];
      record(
        'the application this run created is gone again, and its grants with it',
        /1 application/.test(output)
          && !stillThere.some((app) => app.name === CREATED_APPLICATION),
        `${output.split('\n').filter((line) => /applications after|grant/.test(line)).join(' · ').trim()
          || 'no count line'} · still offered=${stillThere.some((app) => app.name === CREATED_APPLICATION)}`,
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

  // Two refusals this script provokes ON PURPOSE, and neither is a defect:
  //   * the anonymous 401 probes;
  //   * the 409 from POST /api/admin/applications, which is the duplicate-name
  //     check above proving a second "VERIFY Reports Only Queue" is refused.
  //
  // Narrowed to that endpoint rather than allowing 409 anywhere: 409 is also the
  // optimistic-concurrency conflict on a submission save, and a blanket exemption
  // would hide two admins overwriting each other — which is the thing that status
  // code exists to report.
  const realErrors = consoleErrors.filter((text) => {
    if (/401|Unauthorized/i.test(text)) return false;
    if (/\b409\b/.test(text) && /\/api\/admin\/applications\b/.test(text)) return false;
    return true;
  });
  record(
    'console is clean apart from the refusals this run provokes on purpose',
    realErrors.length === 0,
    realErrors.slice(0, 3).join(' | '),
  );

  await browser.close();

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const entry of failed) console.log(`  - ${entry.name}: ${entry.detail}`);
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // The safety net, and it earned its place: the redirect/hand-off fixtures are
  // created BEFORE the try/finally that owns the Delivery-pane ones, so the first
  // version of this section left three tickets and an application behind the moment
  // a selector timed out mid-run. Both cleanups run here as well, and both are
  // idempotent — they report "not present, nothing to do" when the `finally` inside
  // `run()` already took them.
  //
  // Tickets first: the application removal refuses an application any submission
  // still points at, which is the guard working but reads as a failed cleanup.
  .finally(() => {
    if (handoffFixtureIds.length > 0) {
      const output = runServerScript(
        ['scripts/removeVerificationSubmissions.js', ...handoffFixtureIds, '--apply'],
        { quiet: true },
      );
      if (/removing:/.test(output)) {
        console.log('\nSafety net removed stranded ticket fixtures:');
        console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
      }
    }
    const output = removeCreatedApplication({ quiet: true });
    if (/removing \(id/.test(output)) {
      console.log('\nSafety net removed the fixture application:');
      console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
    }
  });
