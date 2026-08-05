/**
 * Browser verification for the compacted Submit-a-request form.
 *
 * The compaction's whole claim is "shorter, with nothing removed", so the checks
 * are the two halves of that claim:
 *   1. The measured height of the form column, against the approved review's
 *      figures (1626px -> 1209px desktop, an 11% cut on a phone).
 *   2. The field and input counts, which must be IDENTICAL to the pre-compaction
 *      form — 10 fields and 12 inputs for a defect. A layout change that quietly
 *      dropped a field would pass a height check and fail this one.
 * Plus the card count (six -> four) and per-container overflow at three widths in
 * both themes.
 *
 * Read-only: it fills nothing and submits nothing.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-submit-form.mjs [--shots ./out]
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

// From the approved review (artifact 58f88812): the pre-compaction form's own
// counts, which the compacted one has to match exactly.
//
// `controls` counts every input/textarea/select in the DOM, not only the visible
// ones — the screenshot picker's <input type=file> is display:none by design (the
// Browse button proxies it) and a visible-only count would read as a lost field.
// One control comes off when the viewer's name is already known: the reporter is
// then stated as "Filing as", not asked for.
const EXPECTED = {
  defect: { fields: 10, controls: 12, cards: 4 },
  enhancement: { fields: 3, controls: 5, cards: 3 },
};
// The measured heights the review reported for the compacted form. Treated as a
// ceiling with slack, not an exact match — fonts and data move it a little.
const HEIGHT_CEILING = { desktop: 1320, phone: 2600 };

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

/** Cards, labelled fields and real inputs currently on screen. */
async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('.rs-main');
    if (!main) return null;
    const shown = (el) => el.offsetParent !== null;
    return {
      height: Math.round(main.getBoundingClientRect().height),
      cards: [...main.querySelectorAll('.rs-card')].filter(shown).length,
      fields: [...main.querySelectorAll('.rs-field')].filter(shown).length,
      controls: main.querySelectorAll('input, textarea, select').length,
      reporterIsStated: Boolean(main.querySelector('.rs-reporter')),
      groupLabels: [...main.querySelectorAll('.rs-grouplabel')].filter(shown).map((n) => n.textContent.trim()),
      dropHeight: Math.round(document.querySelector('.rs-drop')?.getBoundingClientRect().height || 0),
    };
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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const login = await page.request.post(`${API}/api/auth/login`, {
    data: { username: USER, password: PASS },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.rs-main .rs-card');

  // ── Defect: the default shape ────────────────────────────────────────────
  const defect = await measure(page);
  record(
    'a defect is four cards, not six',
    defect.cards === EXPECTED.defect.cards,
    `${defect.cards} cards: ${defect.groupLabels.join(' · ')}`,
  );
  const expectedDefectControls = EXPECTED.defect.controls - (defect.reporterIsStated ? 1 : 0);
  record(
    'the compaction removed no fields',
    defect.fields === EXPECTED.defect.fields && defect.controls === expectedDefectControls,
    `${defect.fields} fields / ${defect.controls} controls (expected ${EXPECTED.defect.fields} / ${expectedDefectControls}, reporter ${defect.reporterIsStated ? 'stated' : 'asked'})`,
  );
  record(
    'the type picker shares the group-label row instead of owning a card',
    (await page.$$('.rs-cardhead .rs-seg .rs-type')).length === 2
      && !defect.groupLabels.includes('What are you reporting?'),
    `group labels: ${defect.groupLabels.join(' · ')}`,
  );
  record(
    'the workaround question lost its card but kept its question',
    !defect.groupLabels.includes('Do you need a workaround?')
      && (await page.isVisible('.rs-flag')),
    `flag visible=${await page.isVisible('.rs-flag')}`,
  );
  record(
    'the drop zone is a row, not a column',
    defect.dropHeight > 0 && defect.dropHeight < 110,
    `${defect.dropHeight}px tall`,
  );
  record(
    'the form column fits the reviewed height',
    defect.height <= HEIGHT_CEILING.desktop,
    `${defect.height}px (ceiling ${HEIGHT_CEILING.desktop}px)`,
  );
  // The reference-numbers heading is the only thing marking those three fields
  // optional, so flattening the box must not have taken it with it.
  record(
    'the reference-numbers heading survived the box being flattened',
    await page.isVisible('.rs-sub-head'),
    (await page.textContent('.rs-sub-head').catch(() => '')).replace(/\s+/g, ' ').trim(),
  );
  // Textareas are deliberately untouched — they carry the actual report.
  const textareaRows = await page.$$eval('.rs-main textarea', (n) => n.map((t) => t.rows));
  record(
    'the textareas were left at their full height',
    textareaRows.includes(5) && textareaRows.includes(3),
    `rows: ${textareaRows.join(', ')}`,
  );

  // ── Enhancement: the other branch ────────────────────────────────────────
  await page.click('.rs-seg .rs-type:has-text("Enhancement")');
  await page.waitForTimeout(150);
  const enhancement = await measure(page);
  record(
    'an enhancement is three cards',
    enhancement.cards === EXPECTED.enhancement.cards,
    `${enhancement.cards} cards: ${enhancement.groupLabels.join(' · ')}`,
  );
  await page.click('.rs-seg .rs-type:has-text("Defect")');
  await page.waitForTimeout(150);

  // ── Responsive ───────────────────────────────────────────────────────────
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
        `submit form has no clipped overflow — ${viewport.name} ${theme}`,
        offenders.length === 0,
        offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
      );
      if (viewport.name === 'phone' && theme === 'light') {
        const phone = await measure(page);
        record(
          'the form column fits the reviewed height — phone',
          phone.height <= HEIGHT_CEILING.phone,
          `${phone.height}px (ceiling ${HEIGHT_CEILING.phone}px)`,
        );
        // The name/summary pair goes back to one per row where there is no width.
        const columns = await page.evaluate(
          () => getComputedStyle(document.querySelector('.rs-row--who')).gridTemplateColumns,
        );
        record(
          'name and summary stop sharing a row on a phone',
          columns.split(' ').length === 1,
          `grid-template-columns: ${columns}`,
        );
      }
      await shoot(page, `submit-${viewport.name}-${theme}`);
    }
  }

  const realErrors = consoleErrors.filter((t) => !/401|Unauthorized/i.test(t));
  record('console is clean', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

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
