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
  // Report requests (approved mockup v3, artifact 075982a2). Cards: Your
  // request · What you need · About the request · Screenshots. The two branches
  // ask a different number of questions, which is the whole point of the branch.
  reportNew: { cards: 4, required: 3 },
  reportChange: { cards: 4, required: 4 },
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
      // `.rs-filedby` since the report-request work: the reporter stopped being
      // drawn as a bordered box (`.rs-reporter`) and became a line of text, so
      // it is no longer a `.rs-field` either. Both counts below move with it.
      reporterIsStated: Boolean(main.querySelector('.rs-filedby')),
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
  // A stated reporter costs BOTH a control and a field now. It used to cost only
  // a control, because "Filing as" was still a `.rs-field` — a bordered box that
  // looked like an input without being one. It is a line of text above the
  // summary since the report-request work, so the question it answers is no
  // longer a field on the form at all.
  const expectedDefectFields = EXPECTED.defect.fields - (defect.reporterIsStated ? 1 : 0);
  const expectedDefectControls = EXPECTED.defect.controls - (defect.reporterIsStated ? 1 : 0);
  record(
    'the compaction removed no fields',
    defect.fields === expectedDefectFields && defect.controls === expectedDefectControls,
    `${defect.fields} fields / ${defect.controls} controls (expected ${expectedDefectFields} / ${expectedDefectControls}, reporter ${defect.reporterIsStated ? 'stated' : 'asked'})`,
  );
  record(
    'the type picker shares the group-label row instead of owning a card',
    // Three since report requests joined defect and enhancement.
    (await page.$$('.rs-cardhead .rs-seg:not(.rs-seg--sub) .rs-type')).length === 3
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
  // ── Report requests ──────────────────────────────────────────────────────
  // The third type (plan.md §4 Phase 1). What matters here is not the field
  // count but the two conditional rules: a change asks which report and what is
  // not working; a new dashboard asks for measures and a contact instead.
  await page.click('.rs-seg .rs-type:has-text("Report request")');
  await page.waitForTimeout(180);

  record(
    'the type picker offers three segments, report last',
    (await page.$$eval('.rs-cardhead .rs-seg:not(.rs-seg--sub) .rs-type-name', (n) => n.map((e) => e.textContent)))
      .join('|') === 'Defect|Enhancement|Report request',
  );
  record(
    'the heading stopped calling everything an issue',
    !(await page.textContent('.rs-head h1')).includes('issue'),
    (await page.textContent('.rs-head h1')).trim(),
  );
  record(
    '"Filing as" is a line above the summary, not a box beside it',
    (await page.$$('.rs-reporter')).length === 0
      && (await page.$$('.rs-filedby')).length === 1
      && await page.evaluate(() => {
        const who = document.querySelector('.rs-filedby')?.getBoundingClientRect();
        const sum = document.querySelector('#rs-summary_of_issue')?.getBoundingClientRect();
        return Boolean(who && sum && who.bottom <= sum.top);
      }),
  );

  const reportNew = await measure(page);
  record(
    'a new-dashboard request is four cards',
    reportNew.cards === EXPECTED.reportNew.cards,
    `${reportNew.cards} cards: ${reportNew.groupLabels.join(' · ')}`,
  );
  const visibleLabels = () => page.$$eval(
    '.rs-main .rs-field > label, .rs-main .rs-field > .rs-grouptitle',
    (nodes) => nodes.filter((n) => n.getClientRects().length > 0).map((n) => n.textContent.trim()),
  );
  const newLabels = await visibleLabels();
  record(
    'a new dashboard asks for measures and a contact',
    newLabels.some((l) => l.startsWith('Measures, and where they come from'))
      && newLabels.some((l) => l.startsWith('Who owns the questions about it?')),
    newLabels.join(' | '),
  );
  record(
    'and is NOT asked which report, nor what is not working',
    !newLabels.some((l) => l.startsWith('Which report is it?'))
      && !newLabels.some((l) => l.includes('not working')),
    newLabels.join(' | '),
  );
  record(
    'the checklist lists exactly what a new dashboard needs',
    (await page.$$('.rs-check li')).length === EXPECTED.reportNew.required,
    (await page.$$eval('.rs-check li', (n) => n.map((e) => e.firstChild?.nextSibling?.textContent?.trim()))).join(' | '),
  );

  await page.click('.rs-seg--sub .rs-type:has-text("A change to one you already use")');
  await page.waitForTimeout(180);
  const changeLabels = await visibleLabels();
  record(
    'a change asks which report FIRST, then what is not working and what should change',
    changeLabels.indexOf(changeLabels.find((l) => l.startsWith('Which report is it?')))
      < changeLabels.indexOf(changeLabels.find((l) => l.startsWith('Describe what you need')))
      && changeLabels.some((l) => l.includes('not working'))
      && changeLabels.some((l) => l.startsWith('What should change?')),
    changeLabels.join(' | '),
  );
  record(
    'and is NOT asked for measures',
    !changeLabels.some((l) => l.startsWith('Measures, and where they come from')),
    changeLabels.join(' | '),
  );
  record(
    'the checklist follows the branch',
    (await page.$$('.rs-check li')).length === EXPECTED.reportChange.required,
    `${(await page.$$('.rs-check li')).length} required (expected ${EXPECTED.reportChange.required})`,
  );

  // Pressing Submit empty must mark the branch's own fields, not a defect's.
  await page.click('.rs-rail .rs-submit');
  await page.waitForTimeout(200);
  record(
    'submitting an empty change request marks its four fields',
    (await page.$$('.rs-field.is-bad')).length === EXPECTED.reportChange.required,
    `${(await page.$$('.rs-field.is-bad')).length} marked`,
  );

  // The rail must not promise a Service Desk hand-off a report request never makes.
  const reportSteps = await page.$$eval('.rs-steps li b', (n) => n.map((e) => e.textContent));
  record(
    'a report request is promised delivery, not a hand-off',
    reportSteps[2] === 'Delivered',
    reportSteps.join(' → '),
  );
  await page.click('.rs-seg .rs-type:has-text("Defect")');
  await page.waitForTimeout(180);
  const defectSteps = await page.$$eval('.rs-steps li b', (n) => n.map((e) => e.textContent));
  record(
    'and a defect still gets the Service Desk step',
    defectSteps[2].includes('Service Desk'),
    defectSteps.join(' → '),
  );

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
        // The name/summary pair goes back to one per row where there is no
        // width. `.rs-row--who` only exists for an ANONYMOUS filer now — a known
        // reporter is a line of text and the summary owns the row outright — so
        // the two cases are asserted separately rather than one crashing on the
        // other's absence.
        const who = await page.evaluate(() => {
          const row = document.querySelector('.rs-row--who');
          const summary = document.querySelector('#rs-summary_of_issue');
          const card = summary?.closest('.rs-card');
          const pad = card ? Number.parseFloat(getComputedStyle(card).paddingLeft) : 0;
          return {
            paired: Boolean(row),
            columns: row ? getComputedStyle(row).gridTemplateColumns : '',
            summaryShort: card
              ? Math.round(card.getBoundingClientRect().width - 2 * pad - summary.getBoundingClientRect().width)
              : null,
          };
        });
        record(
          who.paired
            ? 'name and summary stop sharing a row on a phone'
            : 'a stated reporter leaves the summary the whole row',
          who.paired ? who.columns.split(' ').length === 1 : Math.abs(who.summaryShort) <= 2,
          who.paired ? `grid-template-columns: ${who.columns}` : `summary ${who.summaryShort}px short of the card`,
        );

        // Three segments do not fit one line at 390px: one per row, same width
        // each, so none of them reads as emphasised.
        const seg = await page.evaluate(() => {
          const items = [...document.querySelectorAll('.rs-cardhead .rs-seg:not(.rs-seg--sub) .rs-type')];
          return {
            rows: new Set(items.map((e) => Math.round(e.getBoundingClientRect().top))).size,
            widths: new Set(items.map((e) => Math.round(e.getBoundingClientRect().width))).size,
          };
        });
        record(
          'the three type segments stack one per row on a phone',
          seg.rows === 3 && seg.widths === 1,
          JSON.stringify(seg),
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
