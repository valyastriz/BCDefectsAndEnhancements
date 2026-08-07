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
 * It also holds the two claims about what a REQUESTER sees that nothing else
 * checks: the summary owns its own row, and the duplicate check searches only the
 * kind of request being filed, saying so on screen.
 *
 * AND, since 2026-08-07, what a SESSION-LESS visitor gets — which is no longer a
 * form. Filing requires a signed-in person for every request type
 * (config.SUBMIT_REQUIRES_AUTH defaults on; test/submitRequiresAuth.test.js pins
 * which types), so the session-less context checks a wall with a way past it, the
 * ENDPOINT refusing an anonymous defect with 401 + authRequired rather than the
 * form merely hiding itself, and — the one that catches over-implementing this —
 * that the status board is still readable with no session at all. The gate is on
 * filing, not on reading.
 *
 * Nearly read-only: the duplicate-scope section creates ONE public report request
 * so the narrowing can be proved from both directions, and removes it again
 * through server/scripts/removeVerificationSubmissions.js.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-submit-form.mjs [--shots ./out]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OVERFLOW_PROBE } from './lib/overflow-probe.mjs';

const SERVER_DIR = path.resolve(fileURLToPath(new URL('../../server', import.meta.url)));

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const API = process.env.VERIFY_API_URL || 'http://localhost:4000';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin123';
// A reporting analyst: one grant, on one application, narrowed to report requests.
// Used to prove the Other queue reaches somebody who is not a super user and holds
// nothing on the application the request is eventually routed to.
const ANALYST_USER = process.env.ANALYST_USER || 'bc_report_analyst';
const ANALYST_PASS = process.env.ANALYST_PASS || PASS;

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
  // Both went up by ONE on 2026-08-07, when "Which application is this about?"
  // became a question on every branch rather than a value derived from the filer's
  // own AD group. This assertion exists to catch a field being LOST, and one was
  // deliberately added — so the number moves and the reason is recorded here rather
  // than the check being loosened.
  defect: { fields: 11, controls: 13, cards: 4 },
  enhancement: { fields: 4, controls: 6, cards: 3 },
  // Report requests (approved mockup v3, artifact 075982a2). Cards: Your
  // request · What you need · About the request · Screenshots. The two branches
  // ask a different number of questions, which is the whole point of the branch.
  // The counts went up by one when "Which application is the data from?" became a
  // required question rather than a value derived from the requester's own
  // membership — it decides which analysts ever see the request, so it is asked.
  reportNew: { cards: 4, required: 4 },
  reportChange: { cards: 4, required: 5 },
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

  // ── The heading names the portal's job, not one application ──────────────
  // It read "Submit a Billing Center request", derived from the viewer's own
  // application. This is the Service Requests Portal: it takes requests for
  // whatever application the requester works in, and naming one in the h1 made
  // the page look like somebody else's to everybody else. The ticket still
  // records the application and the confirmation still names it.
  const heading = (await page.textContent('.rs-head h1')).trim();
  const applications = await page.request.get(`${API}/api/viewer`)
    .then((response) => response.json())
    .then((body) => (body?.viewer?.applications || []).map((application) => application.name));
  record(
    'the heading names the service, not an application',
    heading === 'Submit a service request'
      && !applications.some((name) => heading.includes(name)),
    `"${heading}" (applications: ${applications.join(', ')})`,
  );

  // ── A DEFECT IS ASKED WHICH APPLICATION TOO, AND PREFILLED ───────────────
  // Until 2026-08-07 only a report request was asked; a defect took the filer's own
  // AD group, or their most-filed application, or the portal's first one. So a
  // Billing Center defect reported by somebody in Claims was filed into whichever
  // queue that named — the same fault the fifth pass fixed for report requests, one
  // type over, and invisible because the answer was usually right.
  const defectPicker = await page.evaluate(() => {
    const select = document.querySelector('#rs-application_name');
    if (!select) return null;
    const label = select.closest('.rs-field')?.querySelector('label')?.textContent?.trim() || '';
    return {
      label,
      value: select.value,
      options: [...select.options].map((option) => option.textContent.trim()),
    };
  });
  record(
    'a defect is asked which application it is about',
    Boolean(defectPicker) && defectPicker.label.startsWith('Which application is this about?'),
    defectPicker ? `"${defectPicker.label}"` : 'no picker on the defect branch',
  );
  record(
    'and it IS prefilled — a guess worth making, unlike on a report request',
    Boolean(defectPicker) && defectPicker.value !== ''
      && defectPicker.options.includes(defectPicker.value),
    defectPicker ? `default "${defectPicker.value}" of ${defectPicker.options.length - 1}` : '',
  );
  record(
    'and Other is offered, so a system the portal does not list still has a home',
    Boolean(defectPicker) && defectPicker.options.includes('Other'),
    defectPicker ? defectPicker.options.join(' · ') : '',
  );

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
  // Asked, not assumed. It used to be derived from the requester's own membership
  // and silently defaulted, which filed a report about billing data into whichever
  // queue the fallback named.
  const applicationPicker = await page.evaluate(() => {
    const select = document.querySelector('#rs-application_name');
    return select
      ? { options: [...select.options].map((option) => option.textContent.trim()), value: select.value }
      : null;
  });
  record(
    // `value === ''` is the load-bearing half. Every other branch PREFILLS this
    // picker with the filer's home application, and a report request deliberately
    // does not: where somebody works is a fair guess at where they saw a bug and a
    // poor one at whose DATA a report is about. A prefill is weaker than the
    // derivation the fifth pass removed, but it nudges toward the same wrong answer.
    'a report request is asked which application the data comes from, and NOT prefilled',
    Boolean(applicationPicker)
      && applicationPicker.value === ''
      && applicationPicker.options.length > 2
      && newLabels.some((l) => l.startsWith('Which application is the data from?')),
    applicationPicker
      ? `default "${applicationPicker.value}", options: ${applicationPicker.options.join(' · ')}`
      : 'no picker on the form',
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

  // ── The duplicate check searches its own kind ────────────────────────────
  // A report request is only ever a duplicate of another report request: "the
  // unapplied cash dashboard needs a write-off column" has nothing to do with a
  // broken invoice screen, and offering one as a possible duplicate of the other
  // spends the requester's attention on the one screen where they are trying not
  // to file twice. A defect and an enhancement stay eligible for each other,
  // because which of the two a sentence describes is a triage decision.
  //
  // The panel also has to SAY which it searched: a narrowed search that reports
  // "nothing like this" without saying what it looked at makes a bigger claim than
  // it can support.
  for (const [type, expected] of [
    ['Report request', 'existing report requests'],
    ['Enhancement', 'existing defects and enhancements'],
    ['Defect', 'existing defects and enhancements'],
  ]) {
    await page.click(`.rs-seg .rs-type:has-text("${type}")`);
    await page.waitForTimeout(140);
    const said = (await page.textContent('.rs-dupe-txt')).replace(/\s+/g, ' ').trim();
    record(
      `the duplicate check says what it will search — ${type}`,
      said.includes(expected),
      said,
    );
  }
  await page.click('.rs-seg .rs-type:has-text("Defect")');

  // And the narrowing is the SERVER's, not a label: one fixture report request,
  // searched from both directions.
  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'bc_csrf')?.value || '';
  const marker = 'VERIFY duplicate scope unapplied cash dashboard';
  const fixtureIds = [];
  let fixtureId = null;
  try {
    // ── The application is the SERVER's rule too ─────────────────────────────
    // A report request with no application used to fall through to the portal's
    // first one, so a report about billing data filed by somebody in Claims
    // landed in whichever queue the fallback named. Refused now, at the endpoint,
    // not only marked in the form.
    const applications = (await page.request.get(`${API}/api/viewer`).then((r) => r.json()))
      .viewer.applications;
    const blankApplication = await page.request.post(`${API}/api/submissions`, {
      multipart: {
        type: 'report',
        summary_of_issue: `${marker} — no application, must be refused`,
        what_happened_exact_details: 'The endpoint should refuse this before it reaches the queue.',
        measures_and_sources: 'One measure.',
        is_new_dashboard: 'true',
      },
    });
    const blankBody = await blankApplication.json().catch(() => ({}));
    record(
      'a report request with no application is refused, not defaulted',
      blankApplication.status() === 400 && /which application/i.test(blankBody.error || ''),
      `${blankApplication.status()} ${JSON.stringify(blankBody.error || blankBody).slice(0, 120)}`,
    );

    // And an ENHANCEMENT lands in the application it was filed against. The
    // server pinned every one of them to Billing Center regardless of the payload
    // — the same fault as above, one type over.
    // A REAL application that is not the viewer's own home one, and not the Other
    // queue — the point is that the payload's application survives, so it has to be
    // one the fallback would not have picked anyway.
    const secondApplication = applications
      .filter((row) => !/^other$/i.test(row.name))
      .at(-1);
    const filed = await page.request.post(`${API}/api/submissions`, {
      multipart: {
        type: 'enhancement',
        summary_of_issue: `${marker} enhancement — safe to delete`,
        request: 'Check that this lands in the application it was filed against.',
        application_name: secondApplication.name,
      },
    }).then((response) => response.json());
    if (filed?.id) fixtureIds.push(Number(filed.id));
    // The detail endpoint answers with the submission FLAT — `...mapSubmission(row)`
    // plus its attachments and lists — not wrapped in `.submission`.
    const filedRow = filed?.id
      ? await page.request.get(`${API}/api/admin/submissions/${filed.id}`).then((r) => r.json())
      : null;
    record(
      'an enhancement lands in the application it was filed against',
      filedRow?.application_name === secondApplication.name,
      `filed against ${secondApplication.name}, stored as ${filedRow?.application_name}`,
    );

    // ── "Other": the queue every reporting analyst can see ──────────────────
    // Sometimes the honest answer to "whose data is this?" is "both" or "I do not
    // know", and the request still has to land where somebody will pick it up.
    // Other is a real application, so it is a queue with grants, it appears in the
    // queue's application filter, and the existing Redirect action moves the
    // ticket to its real home with a trail in `submission_routings`.
    //
    // The strong claim is that an analyst with NO grant on either real application
    // can see it and route it. `ANALYST_USER` is one of those: its own grant is on
    // one application only.
    const otherApplication = applications.find((row) => /^other$/i.test(row.name));
    record(
      '"Other" is one of the applications a requester can choose',
      Boolean(otherApplication),
      applications.map((row) => row.name).join(' · '),
    );

    if (otherApplication) {
      const filedAsOther = await page.request.post(`${API}/api/submissions`, {
        multipart: {
          type: 'report',
          summary_of_issue: `${marker} other queue — safe to delete`,
          what_happened_exact_details: 'Nobody knows which system this comes out of yet.',
          measures_and_sources: 'One measure, source unknown.',
          is_new_dashboard: 'true',
          application_name: otherApplication.name,
        },
      }).then((response) => response.json());
      const otherId = Number(filedAsOther?.id);
      if (otherId) fixtureIds.push(otherId);
      const storedAsOther = otherId
        ? await page.request.get(`${API}/api/admin/submissions/${otherId}`).then((r) => r.json())
        : null;
      record(
        'a report request filed as Other lands in the Other queue',
        storedAsOther?.application_name === otherApplication.name && storedAsOther?.type === 'report',
        `#${otherId} stored as ${storedAsOther?.application_name} / ${storedAsOther?.type}`,
      );

      // An analyst whose only grant is on ONE application still works this queue.
      const analystContext = await browser.newContext();
      try {
        await analystContext.request.post(`${API}/api/auth/login`, {
          data: { username: ANALYST_USER, password: ANALYST_PASS },
        });
        const analystViewer = (await analystContext.request.get(`${API}/api/viewer`)
          .then((r) => r.json())).viewer;
        const seen = await analystContext.request
          .get(`${API}/api/admin/submissions?search=${encodeURIComponent(`${marker} other queue`)}`)
          .then((r) => r.json());
        const seenRows = Array.isArray(seen) ? seen : (seen.submissions || []);
        const asAnalyst = await analystContext.request.get(`${API}/api/admin/submissions/${otherId}`)
          .then((r) => r.json());
        record(
          'a reporting analyst sees the Other queue and may work what is in it',
          seenRows.some((row) => Number(row.id) === otherId) && asAnalyst.can_edit === true,
          `${analystViewer.user.username} administers ${JSON.stringify(analystViewer.adminApplicationIds)}; sees #${otherId}: ${seenRows.some((row) => Number(row.id) === otherId)}, can_edit: ${asAnalyst.can_edit}`,
        );

        // And routes it to its real home, which is the point of the queue.
        const target = applications.find((row) => !/^other$/i.test(row.name)
          && analystViewer.adminApplicationIds.includes(Number(row.id)));
        const csrfAnalyst = (await analystContext.cookies())
          .find((cookie) => cookie.name === 'bc_csrf')?.value || '';
        const redirected = await analystContext.request.post(
          `${API}/api/admin/submissions/${otherId}/redirect`,
          {
            headers: { 'X-CSRF-Token': csrfAnalyst, 'Content-Type': 'application/json' },
            data: { toApplicationId: target?.id, note: 'It is billing data after all.' },
          },
        );
        const afterMove = await page.request.get(`${API}/api/admin/submissions/${otherId}`)
          .then((r) => r.json());
        record(
          'and can route it out of Other to the application that owns it',
          redirected.ok()
            && afterMove.application_name === target?.name
            && (afterMove.routings || []).length === 1,
          `${redirected.status()} → ${afterMove.application_name}, ${(afterMove.routings || []).length} hand-off recorded`,
        );
      } finally {
        await analystContext.close();
      }
    }

    const application = applications[0];
    // Filed through the PUBLIC endpoint, signed in, so it HAS a reporter. The
    // admin create path leaves `reporter_user_id` null, and a report request
    // without one is searchable by nobody — the fixture would be invisible to
    // the very search it exists to be found by.
    const made = await page.request.post(`${API}/api/submissions`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        type: 'report',
        application_name: application.name,
        summary_of_issue: `${marker} — safe to delete`,
        what_happened_exact_details: 'Created by scripts/verify-submit-form.mjs. Removed by the same run.',
        measures_and_sources: 'One measure, from one place.',
        is_new_dashboard: true,
      },
    }).then((response) => response.json());
    fixtureId = Number(made?.submission?.id || made?.id);
    if (fixtureId) fixtureIds.push(fixtureId);

    const search = async (requestType) => page.request.post(`${API}/api/ai-search`, {
      headers: { 'Content-Type': 'application/json' },
      data: { query: marker, requestType },
    }).then((response) => response.json());

    const asReport = await search('report');
    const reportCards = [...(asReport.matches || []), ...(asReport.keywordMatches || [])];
    record(
      'searching as a report request finds report requests, and only those',
      reportCards.length > 0
        && reportCards.every((card) => String(card.type || '').toLowerCase() === 'report')
        && reportCards.some((card) => Number(card.id) === fixtureId),
      `${reportCards.length} cards, types: ${[...new Set(reportCards.map((card) => card.type))].join(', ')}`,
    );

    const asDefect = await search('defect');
    const defectCards = [...(asDefect.matches || []), ...(asDefect.keywordMatches || [])];
    record(
      'searching as a defect never offers a report request as the duplicate',
      defectCards.every((card) => String(card.type || '').toLowerCase() !== 'report')
        && !defectCards.some((card) => Number(card.id) === fixtureId),
      `${defectCards.length} cards, types: ${[...new Set(defectCards.map((card) => card.type))].join(', ') || 'none'}`,
    );
    record(
      'and the response says what it searched, so the client can too',
      asReport.meta?.searchedOnlyType === 'report' && asDefect.meta?.excludedType === 'report',
      `report: ${JSON.stringify(asReport.meta?.searchedOnlyType)} · defect excluded: ${JSON.stringify(asDefect.meta?.excludedType)}`,
    );

    // SEARCH IS THE THIRD WAY OUT. The board list and the by-id route both
    // refuse another person's report request; a semantic search over the same
    // rows would hand one back — and worse, hand back a SUMMARY of it, which is
    // a paraphrase of something the reader was never entitled to.
    const strangerContext = await browser.newContext();
    try {
      const strangerSearch = await strangerContext.request.post(`${API}/api/ai-search`, {
        headers: { 'Content-Type': 'application/json' },
        data: { query: marker, requestType: 'report' },
      }).then((response) => response.json());
      const strangerCards = [
        ...(strangerSearch.matches || []),
        ...(strangerSearch.keywordMatches || []),
      ];
      record(
        'a signed-out search cannot find somebody else\'s report request',
        !strangerCards.some((card) => Number(card.id) === fixtureId)
          && strangerCards.every((card) => String(card.type || '').toLowerCase() !== 'report'),
        `${strangerCards.length} cards, types: ${[...new Set(strangerCards.map((card) => card.type))].join(', ') || 'none'}`,
      );
      record(
        'and the AI summary it gets back does not describe one either',
        !new RegExp(`#${fixtureId}\\b`).test(String(strangerSearch.summary?.answer_summary || '')),
        strangerSearch.summary?.answer_summary
          ? `summary present, ${String(strangerSearch.summary.answer_summary).length} chars, no reference to #${fixtureId}`
          : 'no summary',
      );
    } finally {
      await strangerContext.close();
    }
  } finally {
    if (fixtureIds.length > 0) {
      const output = execFileSync(
        process.execPath,
        ['scripts/removeVerificationSubmissions.js', ...fixtureIds.map(String), '--apply'],
        { cwd: SERVER_DIR, encoding: 'utf8' },
      );
      console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
      const statuses = [];
      for (const id of fixtureIds) {
        statuses.push(`#${id} -> ${(await page.request.get(`${API}/api/admin/submissions/${id}`)).status()}`);
      }
      record(
        'the tickets this run created are gone again',
        statuses.every((line) => line.endsWith('404')),
        statuses.join(' · '),
      );
    }
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.rs-main .rs-card');
  }

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
      if (theme === 'light') {
        // The summary owns its row outright, at every width and in both branches.
        // It used to share one with the name box for an anonymous filer — which is
        // what a visitor to the live site is — so this asks the question the way it
        // is now true: is the summary the full width of its card, and is anything
        // else on its line?
        const who = await page.evaluate(() => {
          const summary = document.querySelector('#rs-summary_of_issue');
          const card = summary?.closest('.rs-card');
          const pad = card ? Number.parseFloat(getComputedStyle(card).paddingLeft) : 0;
          const summaryBox = summary?.getBoundingClientRect();
          const name = document.querySelector('#rs-created_by');
          const nameBox = name?.getBoundingClientRect();
          return {
            summaryShort: card
              ? Math.round(card.getBoundingClientRect().width - 2 * pad - summaryBox.width)
              : null,
            sharesLine: Boolean(nameBox) && Math.abs(nameBox.top - summaryBox.top) < 8,
            anonymous: Boolean(name),
          };
        });
        record(
          `the summary owns its row — ${viewport.name}, ${who.anonymous ? 'anonymous' : 'stated'} filer`,
          Math.abs(who.summaryShort) <= 2 && who.sharesLine === false,
          `summary ${who.summaryShort}px short of the card, shares its line with the name box: ${who.sharesLine}`,
        );
      }
      if (viewport.name === 'phone' && theme === 'light') {
        const phone = await measure(page);
        record(
          'the form column fits the reviewed height — phone',
          phone.height <= HEIGHT_CEILING.phone,
          `${phone.height}px (ceiling ${HEIGHT_CEILING.phone}px)`,
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

  // ── The page with nobody signed in ────────────────────────────────────────
  // THE RULE CHANGED ON 2026-08-07: filing needs a signed-in person, for every
  // request type, not just report requests (config.SUBMIT_REQUIRES_AUTH now
  // defaults on — see test/submitRequiresAuth.test.js). So there is no anonymous
  // FORM to check any more; what a session-less visitor gets is a wall.
  //
  // This section used to measure the anonymous form's layout, and it earned its
  // place then: the name box shared the summary's row and only a viewer the
  // server does not recognise ever saw it. That branch is gone, and the checks
  // that replace it are about the two things that can now go wrong instead —
  // a wall with no way past it, and an over-implemented gate that also locks
  // the reading everybody is still meant to be able to do.
  const anonymous = await browser.newContext({
    viewport: VIEWPORTS[0], deviceScaleFactor: 2, reducedMotion: 'reduce',
  });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(BASE, { waitUntil: 'networkidle' });
  await anonymousPage.waitForSelector('.rs-locked, .rs-main .rs-card');

  const wall = await anonymousPage.evaluate(() => {
    const locked = document.querySelector('.rs-locked');
    return {
      walled: Boolean(locked),
      // The form must not be rendered at all. A disabled form is worse than an
      // honest wall, and a rendered one would mean the gate is client-side.
      formPresent: Boolean(document.querySelector('.rs-main .rs-card')),
      heading: locked?.querySelector('h2')?.textContent?.trim() || null,
      // Names every type, not just report requests — the copy said "report an
      // issue" while the rule covered all three.
      namesEveryType: /defect/i.test(locked?.textContent || '')
        && /enhancement/i.test(locked?.textContent || '')
        && /report request/i.test(locked?.textContent || ''),
      signInHref: locked?.querySelector('a[href="/admin/login"]')?.getAttribute('href') || null,
      boardHref: locked?.querySelector('a[href="/public"]')?.getAttribute('href') || null,
    };
  });
  record(
    'signed out, the submit page is a wall and not a form',
    wall.walled && !wall.formPresent,
    `wall=${wall.walled} form rendered=${wall.formPresent} heading="${wall.heading}"`,
  );
  record(
    'the wall names all three request types, not just report requests',
    wall.namesEveryType,
    wall.namesEveryType ? '' : 'the copy still describes one type',
  );
  record(
    'and it offers somewhere to go: a sign-in link, and the board you can still read',
    // A dead wall is the failure this closes. There was deliberately no button
    // while SSO was the only route in; the local login accepts a `rep` account,
    // so there is now somewhere to send them.
    wall.signInHref === '/admin/login' && wall.boardHref === '/public',
    `sign in → ${wall.signInHref}, board → ${wall.boardHref}`,
  );

  for (const viewport of VIEWPORTS) {
    await anonymousPage.setViewportSize({ width: viewport.width, height: viewport.height });
    await anonymousPage.waitForFunction(
      (width) => Math.abs(document.documentElement.clientWidth - width) <= 20,
      viewport.width,
    );
    const offenders = await anonymousPage.evaluate(OVERFLOW_PROBE, '.app-main');
    record(
      `the sign-in wall has no clipped overflow — ${viewport.name}`,
      offenders.length === 0,
      offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
    );
  }
  await shoot(anonymousPage, 'submit-anonymous-wall');

  // ── The endpoint is the control, not the wall ─────────────────────────────
  // The wall is a courtesy. What actually closes the door is the POST refusing,
  // and it has to refuse a DEFECT now — the type that was open until today —
  // with the 401 + authRequired shape the form knows how to read, rather than the
  // 400 "Requester Name is required" that means a blank field.
  await anonymousPage.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
  const refused = await anonymous.request.post(`${API}/api/submissions`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      type: 'defect',
      // `applications` at the top of this function is a list of NAMES (there is a
      // second, block-scoped one further up holding objects — do not reach for
      // `.name` here).
      application_name: applications[0],
      created_by: 'Somebody With No Account',
      summary_of_issue: 'An anonymous defect that must not be accepted',
      screen_title: 'Anywhere',
      what_happened_exact_details: 'Filed with no session at all.',
    },
  });
  const refusedBody = await refused.json().catch(() => ({}));
  record(
    'an anonymous DEFECT is refused by the endpoint, not just hidden by the form',
    refused.status() === 401 && refusedBody.authRequired === true,
    `HTTP ${refused.status()} authRequired=${refusedBody.authRequired} "${String(refusedBody.error || '').slice(0, 70)}"`,
  );
  record(
    'and a typed name does not substitute for an account',
    refused.status() === 401,
    'a claim is not an identity',
  );

  // ── READING is still open, and that is the point of the distinction ───────
  // "Everything needs a login" is easy to over-implement into locking the status
  // board, which every requester reads and which carries no private data for a
  // stranger (a report request is already withheld from one). If this check ever
  // fails, the gate went on the wrong thing.
  const boardPage = await anonymous.newPage();
  await boardPage.goto(`${BASE}/public`, { waitUntil: 'networkidle' });
  const boardOpen = await boardPage.$$eval('.sb-item', (nodes) => nodes.length).catch(() => 0);
  record(
    'the status board is still readable with no session — the gate is on FILING',
    boardOpen > 0,
    `${boardOpen} rows on the board signed out`,
  );
  await boardPage.close();

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
