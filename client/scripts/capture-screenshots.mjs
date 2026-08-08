/**
 * The documentation screenshot harness.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/capture-screenshots.mjs
 *   node scripts/capture-screenshots.mjs --out ../docs/handoff/screenshots
 *   node scripts/capture-screenshots.mjs --only submit          # substring filter
 *   node scripts/capture-screenshots.mjs --list                 # names only, no browser
 *
 * WHY THIS EXISTS. The 41 shots under docs/handoff/screenshots were taken by
 * hand on 2026-08-05 and were stale within a day. Forty-three of them had already
 * been re-taken once, after the portal was renamed. Every re-shoot by hand is the
 * same afternoon again, and the manual cannot be trusted while its pictures are of
 * a build nobody is running.
 *
 * THE MANIFEST IS AN OUTPUT, NOT AN INPUT. `docs/handoff/screenshot-manifest.json`
 * is WRITTEN from the SHOTS registry below at the end of a full run. A manifest
 * read as input can list a shot the script cannot take, and then the two disagree
 * silently in the direction that makes the documentation wrong. Written as output
 * it cannot: what is in the manifest is what came out of the browser, with the
 * viewport, theme and account each shot was taken under recorded beside it.
 *
 * WHAT IT BORROWS from the seven verify-*.mjs scripts, deliberately rather than
 * re-inventing: the viewport pair (1500x950 and 390x844, both @2x),
 * `reducedMotion: 'reduce'`, the theme forced through `localStorage['bc-theme']`
 * before the app mounts, and — most importantly — their SELECTORS. Every selector
 * in this file was either taken from a verify script that already proves it
 * against the real DOM, or read off the component that renders it. None was
 * guessed, because the fourth trap in plan.md §0.3 is that a browser probe is
 * wrong more often than the code is.
 *
 * THE RULES IT FOLLOWS, each of which was a bug first:
 *   - Wait for the RESPONSE a click causes, never for a number of milliseconds. A
 *     fixed sleep reads the previous filter's rows.
 *   - Prove a modal closed (`state: 'detached'`). An `.bs-modal-backdrop` left
 *     behind swallows every later click and surfaces hundreds of lines away as an
 *     unrelated failure.
 *   - Wait for `document.fonts.ready` and for images to settle before shooting, or
 *     the shot catches a font swap mid-flight and every text metric in it is a lie.
 *   - Never assume a shot worked. Each one is checked for a non-trivial file size
 *     and the run reports what it could not take rather than writing a manifest
 *     that claims it did.
 *
 * IT WRITES, once: two rows through the Excel import, so the import result step
 * can be photographed at all (the client's step 3 is a real import, not a dry
 * run). Both carry the VERIFY marker and are removed through
 * server/scripts/removeVerificationSubmissions.js, whose printed count is the
 * proof — see plan.md §0.3. Pass `--no-import` to skip that shot and write
 * nothing at all.
 *
 * LOGIN RATE LIMIT: /api/auth/login allows 10 attempts per 15 minutes per IP.
 * This run signs in four times. Two full runs back to back will start answering
 * 429, which looks exactly like a broken check — the script says so explicitly
 * rather than failing with a selector error. Restart the server to reset it.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, statSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import xlsxPkg from 'xlsx';

const XLSX = xlsxPkg;

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const API = process.env.VERIFY_API_URL || 'http://localhost:4000';
const PASS = process.env.ADMIN_PASS || 'admin123';

const argOf = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] || fallback);
};
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Two levels up, not one: this file lives in `client/scripts`, and the docs are at
// the REPO root. `../docs/...` quietly created `client/docs/handoff/screenshots`
// and wrote a full set of 62 shots into it.
const OUT = path.resolve(HERE, argOf('--out', '../../docs/handoff/screenshots'));
const MANIFEST = path.resolve(OUT, '../screenshot-manifest.json');
const ONLY = argOf('--only', '');
const LIST_ONLY = process.argv.includes('--list');
const SKIP_IMPORT = process.argv.includes('--no-import');
const SERVER_DIR = path.resolve(HERE, '../../server');

const DESKTOP = { width: 1500, height: 950 };
const PHONE = { width: 390, height: 844 };

const IMPORT_MARKER = 'VERIFY import result shot';

// ── Sessions ─────────────────────────────────────────────────────────────────
// Four, and each one is a different ANSWER from the server, not a cosmetic
// difference:
//   anon    — no session. What every requester sees, and what the public board
//             shows a stranger (no report requests at all).
//   bc_rep  — a requester with report requests of their own. The ONLY way the
//             report-request track appears on the board, because a report request
//             is visible to the person who filed it and nobody else.
//   admin   — super user AND a manager, so the throughput page answers with the
//             team composition.
//   analyst — bc_report_analyst: one grant, narrowed to report requests. The
//             throughput page answers with the personal composition, and the
//             queue draws the report column set.
const ACCOUNTS = {
  anon: null,
  bc_rep: 'bc_rep',
  admin: process.env.ADMIN_USER || 'admin',
  analyst: 'bc_report_analyst',
};

const results = [];
function record(file, ok, detail = '') {
  results.push({ file, ok, detail });
  console.log(`${ok ? 'SHOT' : 'FAIL'}  ${file}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Everything that has to be true before the shutter opens.
 *
 * `fonts.ready` is the one that matters: without it a shot can catch the fallback
 * font, and every width in the picture is then a width the app never renders.
 */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images]
      .filter((image) => !image.complete)
      .map((image) => new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
    // Two frames, so a layout the font metrics just changed has been painted.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function shoot(page, file, { fullPage = false } = {}) {
  const target = path.join(OUT, file);
  await settle(page);
  await page.screenshot({ path: target, fullPage });
  // A screenshot call that "worked" and wrote 0 bytes is the failure mode that
  // produces a manifest describing pictures nobody can open.
  const size = statSync(target).size;
  if (size < 2048) throw new Error(`wrote only ${size} bytes`);
  return size;
}

/** Force the theme before the app reads it, then reload so it mounts that way. */
async function useTheme(page, theme) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('bc-theme', value);
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
}

/** Open a page at a route and wait for the thing that says it has drawn. */
async function open(page, route, ready) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  if (ready) await page.waitForSelector(ready, { timeout: 30000 });
}

/**
 * Click, and wait for the request the click causes.
 *
 * The predicate takes the URL so a wait can insist on the QUERY, not just the
 * path — waiting for "a /api/admin/submissions response" after changing a filter
 * happily resolves on the response that was already in flight for the previous
 * one. That is trap 4, and it cost an afternoon.
 */
async function clickAndWait(page, selector, urlMatches) {
  await Promise.all([
    page.waitForResponse((response) => urlMatches(response.url()) && response.status() < 400, { timeout: 30000 }),
    page.click(selector),
  ]);
}

/** Close whatever modal is open, and prove the backdrop is gone. */
async function closeModal(page) {
  const closer = await page.$('.bs-modal-backdrop .bs-close');
  if (closer) await closer.click();
  else await page.keyboard.press('Escape');
  await page.waitForSelector('.bs-modal-backdrop', { state: 'detached', timeout: 15000 });
}

/**
 * Expand a board row that actually draws a TRACK, preferring the furthest along.
 *
 * Not "the first row": StatusBoardRow renders the four-stop `<ol class="sb-track">`
 * only for a ticket still travelling. One that ended — Duplicate, Rejected,
 * Retired — draws a `.sb-prose` sentence instead ("Where it stands"), and one On
 * hold draws the parked pill. After the reseed the newest row happened to be a
 * Duplicate, so waiting for `.sb-stop` timed out against a page that was working
 * perfectly.
 *
 * `order` is the preference: a stop late in the track shows several dates filled
 * in, which is the picture worth having.
 */
async function expandTrackedRow(page, order) {
  const ref = await page.evaluate((wanted) => {
    const rows = [...document.querySelectorAll('.sb-item')]
      .map((item) => ({
        ref: item.querySelector('.sb-ref')?.textContent?.trim() || null,
        stage: item.querySelector('.sb-stage-lbl')?.textContent?.trim() || null,
      }))
      // A stage label present at all means it is on a track rather than ended.
      .filter((row) => row.ref && row.stage);
    if (rows.length === 0) return null;
    const rank = (stage) => {
      const index = wanted.indexOf(stage);
      return index === -1 ? -1 : index;
    };
    rows.sort((left, right) => rank(right.stage) - rank(left.stage));
    return rows[0].ref;
  }, order);
  if (!ref) throw new Error('no board row is on a track — every visible row has ended or is parked');
  await page.click(`.sb-item:has(.sb-ref:text-is("${ref}")) .sb-row`);
  await page.waitForSelector(`.sb-item:has(.sb-ref:text-is("${ref}")) .sb-stop`);
  return ref;
}

// The two tracks, in order, so a shot can ask for the furthest-along row.
const DEFECT_TRACK = ['Reported', 'Approved', 'With Service Desk', 'Deployed'];
const REPORT_TRACK = ['Reported', 'Approved', 'In progress', 'Delivered'];

// ── The registry ─────────────────────────────────────────────────────────────
// Each entry: { file, route, state, as, viewport, theme, shot(page, ctx) }
//
// `state` is the manifest's own description and is written straight into it, so
// the sentence that explains a picture lives beside the code that takes it.
// Order matters only within a group — every group gets a fresh page.
const SHOTS = [
  // ══ Signing in comes first now ════════════════════════════════════════════
  // Filing requires a signed-in person, for EVERY request type, since 2026-08-07.
  // So the first thing a visitor with no session meets is the wall, and every
  // form shot below it is taken as somebody. There is no anonymous form left to
  // photograph — the eight shots that used to be here were of one.
  {
    file: '00-submit-signin-required.png',
    route: '/', as: 'anon', ready: '.rs-locked',
    state: 'What a visitor with no session sees at the submit page: filing requires a signed-in person, for every request type. Not a disabled form — the form is not rendered at all, and the endpoint refuses the POST regardless',
  },
  {
    file: '01-submit-page-empty.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'Submit a service request, signed in — initial state, no request type chosen yet. "Filing as" states who the ticket will belong to, and the name field is gone because the server takes the identity from the session and discards anything the body claims',
  },
  {
    file: '02-submit-defect.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'Defect branch — the questions asked about something that is broken',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Defect")');
      await page.waitForSelector('.rs-field');
    },
  },
  {
    file: '03-submit-defect-filled.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'Defect part-way through, with the readiness rail ticking items off',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Defect")');
      await page.waitForSelector('#rs-summary_of_issue');
      // Filled by ID (`rs-<field name>`, set by the page's own Field wrapper) —
      // a placeholder is display copy and changes without warning.
      await page.fill(
        '#rs-summary_of_issue',
        'Direct bill invoice shows a zero balance while a payment is still pending',
      );
      await page.fill('#rs-screen_title', 'Account Summary → Billing');
      await page.fill(
        '#rs-what_happened_exact_details',
        'The invoice header reads $0.00 due while the Unapplied Funds panel still holds the payment.',
      );
    },
  },
  {
    file: '04-submit-enhancement.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'Enhancement branch — a shorter form, because nothing is broken to describe',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Enhancement")');
      await page.waitForSelector('.rs-field');
    },
  },

  // ══ The report-request branches ═══════════════════════════════════════════
  {
    file: '06-submit-report-new.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'Report request, NEW dashboard branch — measures and where they come from. Which application the DATA comes from is asked and never defaulted: it decides which analysts ever see the request',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Report request")');
      await page.waitForSelector('.rs-seg--sub');
      await page.waitForSelector('.rs-report-new, .rs-field');
    },
  },
  {
    file: '07-submit-report-change.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'Report request, CHANGE branch — which report, and what should change about it. Only the chosen branch\'s answers are stored, so the other branch cannot sit on the row contradicting the one that was asked',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Report request")');
      await page.waitForSelector('.rs-seg--sub');
      await page.click('.rs-seg--sub .rs-type:has-text("A change to one you already use")');
      await page.waitForSelector('.rs-field');
    },
  },
  {
    file: '08-submit-validation.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card',
    state: 'What a submit attempt with nothing filled in says, and where it says it — per field, not one banner. "You can press Submit with fields empty — we will point them out first" is a promise the form keeps',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Defect")');
      await page.waitForSelector('.rs-field');
      await page.click('.rs-rail .rs-submit');
      // `.rs-bad` is the per-field message and `.rs-field.is-bad` the field it
      // belongs to — both from the page's own Field wrapper.
      await page.waitForSelector('.rs-field.is-bad .rs-bad', { timeout: 15000 });
    },
  },

  // ══ The public status board ═══════════════════════════════════════════════
  {
    file: '10-board-signed-out.png',
    route: '/public', as: 'anon', ready: '.sb-item',
    state: 'Public status board, signed out — defects and enhancements only. No report request appears at all: they are visible to the person who filed them and nobody else',
  },
  {
    file: '11-board-row-expanded.png',
    route: '/public', as: 'anon', ready: '.sb-item',
    state: 'A row opened to its four-stop track: Reported → Approved → With Service Desk → Deployed, with a date under each stop it actually reached and an em dash under the ones it has not',
    async shot(page) {
      await expandTrackedRow(page, DEFECT_TRACK);
    },
  },
  {
    file: '12-board-filters-open.png',
    route: '/public', as: 'anon', ready: '.sb-item',
    state: 'The grouped filter panel a requester can narrow the board with',
    async shot(page) {
      await page.click('.pb-filterbtn');
      await page.waitForSelector('.pb-filter-groups');
    },
  },
  {
    file: '13-board-report-track.png',
    route: '/public', as: 'bc_rep', ready: '.sb-item',
    state: 'The same board as the person who filed the report requests: theirs travel a DIFFERENT track — Reported → Approved → In progress → Delivered — and never mention the Service Desk hand-off a report request does not make',
    async shot(page) {
      await expandTrackedRow(page, REPORT_TRACK);
    },
  },
  {
    file: '14-board-ai-search.png',
    route: '/public', as: 'anon', ready: '.sb-item',
    state: 'Ticket search opened — "Closest matches", which describes what it found and deliberately never rules on whether a request has already been reported',
    async shot(page) {
      // `.ai-entry-strip` is the collapsed panel's own button; `.ai-search-panel`
      // is what replaces it. Both read off components/common/AiSearchPanel.jsx.
      await page.click('.ai-entry-strip');
      await page.waitForSelector('.ai-search-panel');
    },
  },

  // ══ Signing in ════════════════════════════════════════════════════════════
  {
    file: '20-admin-login.png',
    route: '/admin/login', as: 'anon', ready: 'form, input[type="password"]',
    state: 'Admin sign-in. Two kinds of account may sign in: admin (triage) and rep (a requester following their own requests)',
  },

  // ══ The admin queue ═══════════════════════════════════════════════════════
  {
    file: '21-admin-queue.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'The triage queue as a super user, all applications. Only New wears the left stripe — every status having its own colour made the stripe distinguish nothing',
  },
  {
    file: '22-admin-queue-kind-switch.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'The one-click switch between the two kinds of work, set to Report requests — a different column set, and its own saved layout',
    async shot(page) {
      await clickAndWait(
        page,
        '[aria-label="Kind of request"] button:text-is("Report requests")',
        (url) => url.includes('/api/admin/submissions'),
      );
      await page.waitForSelector('.admin-submissions-table tbody tr');
    },
  },
  {
    file: '23-admin-filters-open.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'The grouped admin filter panel',
    async shot(page) {
      // The Filters button carries aria-controls; the gear beside it is a
      // different button and opens Customize View. They were one selector in the
      // first draft of this file, which took the same picture twice.
      await page.click('button[aria-controls="admin-filter-panel"]');
      await page.waitForSelector('.filter-panel .filter-groups');
    },
  },
  {
    file: '24-admin-customize-view.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Customize View — which columns and which filters this admin sees, saved per admin and per queue',
    async shot(page) {
      await page.click('.bs-icon-btn[aria-label="Customize columns and filters"]');
      await page.waitForSelector('.bs-modal .toggle-row');
    },
  },
  {
    file: '25-admin-bulk-actions.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The bulk action bar, with rows selected — retire, unretire and change visibility in one pass',
    async shot(page) {
      const boxes = await page.$$('.admin-submissions-table tbody input[type="checkbox"]');
      if (boxes.length < 2) throw new Error('fewer than two selectable rows');
      await boxes[0].check();
      await boxes[1].check();
      await page.waitForSelector('.bulk-action-bar');
    },
  },
  {
    file: '26-admin-scope-one-application.png',
    route: '/admin', as: 'admin', ready: '.admin-scope-select',
    state: 'The queue scoped to one application. An admin sees only the applications they hold a grant on; a super user may switch between all of them',
    async shot(page) {
      const value = await page.$$eval('.admin-scope-select option', (nodes) => {
        const match = nodes.find((node) => node.textContent.trim() === 'Billing Center');
        return match?.value || null;
      });
      if (!value) throw new Error('Billing Center is not in the scope select');
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/admin/submissions') && response.status() < 400),
        page.selectOption('.admin-scope-select', value),
      ]);
      await page.waitForSelector('.admin-submissions-table tbody tr');
    },
  },
  {
    file: '27-admin-queue-analyst.png',
    route: '/admin', as: 'analyst', ready: '.admin-header-row',
    state: 'The same queue as bc_report_analyst, whose single grant covers report requests on Billing Center only. No defect is on this screen, and no Manage metadata in the menu. Not the queue with rows hidden — the server sends only what that grant covers, by application AND by request type',
  },
  {
    file: '28-admin-queue-other.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: '`Other`, scoped, with every kind of request showing. It is a working list rather than a holding pen: a system with no configured application to submit to the Service Desk lands here, and so does one nobody has identified yet. Either way the work is still tracked — reports get built from it, and a defect or an enhancement is raised on the Service Desk by hand with its incident number typed back in',
    async shot(page) {
      const allKinds = await page.$('.bs-seg button:text-is("All kinds")');
      if (allKinds) {
        await allKinds.click();
        await page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
          && res.status() === 200, { timeout: 30000 }).catch(() => null);
      }
      await page.selectOption('.admin-scope-select', 'Other');
      // The rendered table, not the response: several requests carry this URL, so
      // "one of those came back" resolves on a request already in flight for the
      // previous scope and photographs the wrong rows.
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll('.admin-submissions-table tbody tr')];
        return rows.length > 0 && rows.every((row) => row.textContent.includes('Other'));
      }, null, { timeout: 30000 });
    },
  },

  // ══ The detail modal, tab by tab ══════════════════════════════════════════
  {
    file: '30-detail-triage.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'Ticket detail — the Triage tab, which is where it opens: status, reviewer, decision notes and the assignee',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      await page.click('.dm-tab:has-text("Triage")');
      await page.waitForSelector('.dm-modal');
    },
  },
  {
    file: '31-detail-report-tab.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The Report tab — what the requester actually wrote, read-only, because a triage decision must not be able to rewrite the report it was made from',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      await page.click('.dm-tab:has-text("Report")');
      await page.waitForSelector('.dm-modal');
    },
  },
  {
    file: '32-detail-impact.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The Impact tab on a defect — dollar impact, policies affected and how often it happens',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      await page.click('.dm-tab:has-text("Impact")');
      await page.waitForSelector('#dm-panel-impact');
    },
  },
  {
    file: '33-detail-history.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The History tab — every status change with who made it and when, plus where the ticket came from',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      await page.click('.dm-tab:has-text("History")');
      await page.waitForSelector('.dm-modal');
    },
  },
  {
    file: '34-detail-files.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The Files tab. Empty on this data set: the seed writes no attachments, because a row pointing at bytes that are not there is worse than an empty tab',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      await page.click('.dm-tab:has-text("Files")');
      await page.waitForSelector('.dm-modal');
    },
  },
  {
    file: '35-detail-service-desk.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The Service Desk tab — the hand-off downstream, and the incident number behind a lock, because for every ticket the portal sent that number is its own record of what it did',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      const tab = await page.$('.dm-tab:has-text("Service Desk")');
      if (!tab) throw new Error('no Service Desk tab on this ticket');
      await tab.click();
      await page.waitForSelector('.dm-modal');
    },
  },
  {
    file: '36-detail-report-request.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'A REPORT REQUEST\'s Report tab — its own layout: what it is for, who to ask or which report, and what they need. It asked a defect\'s questions until the fifth pass, so an analyst could open one and not read what had been requested',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'report');
      await page.click('.dm-tab:has-text("Report")');
      await page.waitForSelector('.dm-report-grid');
    },
  },
  {
    file: '37-detail-delivery-pane.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The Delivery pane — the analyst\'s half of a report request: go-ahead, level of effort, hours by person and day, the assignment trail and the delivery notes',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'report');
      await page.click('.dm-tab:has-text("Delivery")');
      await page.waitForSelector('.dm-hrs, .dm-modal');
    },
  },
  {
    file: '38-detail-actions-menu.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'The More actions menu — retire, change visibility, and Redirect, which moves a ticket to another application\'s queue and records the hand-off',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'defect');
      await page.click('.dm-foot button[aria-label="More actions"]');
      await page.waitForSelector('.dm-drop, [role="menu"]');
    },
  },

  // ══ `Other`, and the work the Service Desk is not wired up for ════════════
  // The three things the demonstration set could not show until
  // `npm run seed:unwired-work` put them there. Each is documented in the user
  // manual, and each was documented with no picture.
  {
    file: '39-detail-other-unwired.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr',
    state: 'A DEFECT in `Other` — the catch-all working list, for a system with no configured application to submit to the Service Desk and for one nobody has identified yet. Two things in one picture: "Also show it in" under Ownership & tracking, which puts the ticket in an analyst\'s own queue WITHOUT moving it out of `Other`; and the footer, where Submit is greyed out and the note gives the whole manual procedure — raise it by hand, come back, unlock the number, set Submitted',
    async shot(page, ctx) {
      await ctx.openTicketBySearch(page, {
        search: 'Commission statement PDF drops the agency code',
      });
      await page.click('.dm-tab:has-text("Triage")');
      await page.waitForSelector('.dm-groups');
      // Prove BOTH halves are actually on screen before the shutter: a picture of
      // a tab that failed to render the picker would be worse than no picture.
      await page.waitForFunction(() => {
        const picker = [...document.querySelectorAll('.dm-groups .bs-field')]
          .some((node) => node.textContent.includes('Also show it in'));
        const blocked = Boolean(document.querySelector('.dm-foot-blocked'));
        return picker && blocked;
      }, null, { timeout: 30000 });
    },
  },

  // ══ Add a ticket — four branches, two modes ═══════════════════════════════
  {
    file: '40-add-ticket-new-defect.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Add a ticket → New ticket → Defect. An admin filing on somebody else\'s behalf',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, { mode: 'New ticket', type: 'Defect' });
    },
  },
  {
    file: '41-add-ticket-historical-defect.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Add a ticket → Historical ticket → Defect. The backdated mode: it asks for the dates and the status the ticket already had, and builds the timeline from them',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, { mode: 'Historical ticket', type: 'Defect' });
    },
  },
  {
    file: '42-add-ticket-historical-enhancement.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Add a ticket → Historical ticket → Enhancement',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, { mode: 'Historical ticket', type: 'Enhancement' });
    },
  },
  {
    file: '43-add-ticket-cleanup.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Add a ticket → Cleanup, tagged Internal only. A cleanup is stored as a flag on a defect or an enhancement plus its own status — the tag row is what records which, and "Internal only" is the one that was never anybody\'s bug report',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, { mode: 'New ticket', type: 'Cleanup', tag: 'Internal only' });
    },
  },
  {
    file: '44-add-ticket-report-new.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Add a ticket → Report request → Something new. Asks for the measures and where they come from',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, { mode: 'New ticket', type: 'Report request', reportBranch: 'Something new' });
    },
  },
  {
    file: '45-add-ticket-report-change.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Add a ticket → Report request → A change to one they already use. Asks which report FIRST, because you cannot describe what should happen to a report before saying which one it is',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, {
        mode: 'New ticket', type: 'Report request', reportBranch: 'A change to one they already use',
      });
    },
  },
  {
    file: '46-add-ticket-add-application.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'A reporting analyst adding an application by typing its name in, from under the Application picker. Offered on the REPORT branch only, because what it creates takes report requests and nothing else — and offered only to somebody who works report requests. Creating it also grants it, in the same transaction, to everybody who does: an application is a queue, and one with no grants is visible to nobody but a super user. The same control is in the Redirect dialog, which is where an analyst realises an `Other` request is really Marketing Analytics\'',
    async shot(page, ctx) {
      await ctx.openAddTicket(page, { mode: 'New ticket', type: 'Report request' });
      // Expanded, never submitted: a shot that pressed Add would leave an
      // application behind, and there is no DELETE endpoint for one.
      await page.click('.at-body .aac-toggle');
      await page.waitForSelector('.at-body .aac--open input');
      await page.fill('.at-body .aac--open input', 'Producer Portal');
    },
  },

  // ══ Excel, both directions ════════════════════════════════════════════════
  {
    file: '50-export-fields.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Export to Excel — the field picker, grouped, with presets. The groups come from the SERVER\'s field list, so a new column cannot be exportable and unlisted',
    async shot(page, ctx) {
      await ctx.openDataMenu(page, 'Export');
      await page.waitForSelector('.xl-groups .xl-ck');
    },
  },
  {
    file: '51-export-report-group.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'The Report request group of export fields, expanded — including Approved By, Approved Date, Delivery Notes and Hours Logged, which is SUM(hours) computed on read and never a stored column',
    async shot(page, ctx) {
      await ctx.openDataMenu(page, 'Export');
      await page.waitForSelector('.xl-groups .xl-ck');
      const head = await page.$('.xl-group-head:has-text("Report request")');
      if (head) await head.click();
      await page.waitForSelector('.xl-group-body');
    },
  },
  {
    file: '52-import-step1.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Import from Excel, step 1 — pick a file and say which kind of ticket the sheet holds. The mode forces the type of every row, which is why a report sheet needs its own',
    async shot(page, ctx) {
      await ctx.openDataMenu(page, 'Import');
      await page.waitForSelector('.xl-steps');
    },
  },
  {
    file: '53-import-step2-columns.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Import step 2 — what each column of the sheet became, with the "Review all N mappings" fold opened. Most columns match themselves; the point of the step is the ones that did not. The first rows are shown as they WILL be imported, before anything is written',
    async shot(page, ctx) {
      await ctx.openDataMenu(page, 'Import');
      await page.waitForSelector('.xl-steps');
      await ctx.attachImportSheet(page);
      await ctx.openMappingFold(page);
    },
  },
];

// Two more shots that need a real import, so they are appended conditionally.
const IMPORT_RESULT_SHOTS = [
  {
    file: '54-import-step3-result.png',
    route: '/admin', as: 'admin', ready: '.admin-header-row',
    state: 'Import step 3 — what landed. Rows that came in MINUS a field get their own quieter warnings banner, separate from rows that were skipped, because one list for both would make the difference invisible',
    writes: true,
    async shot(page, ctx) {
      await ctx.openDataMenu(page, 'Import');
      await page.waitForSelector('.xl-steps');
      await ctx.attachImportSheet(page);
      // Step 3 is a REAL import — the client sends no dryRun flag, so "Nothing is
      // written until you press Import" means pressing it writes. Both rows carry
      // the VERIFY marker and are removed in the teardown below, whose printed
      // count is the proof.
      //
      // The button names its own row count ("Import 2 rows"), so it is matched on
      // the prefix rather than on the exact label.
      await clickAndWait(
        page,
        '.at-foot button:has-text("Import ")',
        (url) => url.includes('/api/admin/submissions/import-xlsx') && !url.includes('analyze'),
      );
      await page.waitForSelector('.xl-result');
    },
  },
];

// ── The pages that are their own screens ─────────────────────────────────────
const PAGE_SHOTS = [
  {
    file: '60-metadata.png',
    route: '/admin/metadata', as: 'admin', ready: '.md-table tbody tr',
    state: 'Manage metadata — every lookup the portal offers. Editing one renames or withdraws a value on every ticket that holds it, so the three WRITES are super-user only while the READ stays open to every admin',
  },
  {
    file: '61-metadata-statuses.png',
    route: '/admin/metadata', as: 'admin', ready: '.md-table tbody tr',
    state: 'The Statuses panel. Three values are marked "Report requests only" — one table serves every type, and without the marking an admin has no way to know which dropdown a value appears in',
    async shot(page) {
      await page.click('.md-railitem:has-text("Defect/Enhancement Statuses")');
      await page.waitForSelector('.md-table tbody tr');
    },
  },
  {
    file: '62-metadata-consequence.png',
    route: '/admin/metadata', as: 'admin', ready: '.md-table tbody tr',
    state: 'What a lookup edit says it will do before it does it — the consequence line, and the lock on a name that is in use',
    async shot(page) {
      await page.click('.md-railitem:has-text("Defect/Enhancement Statuses")');
      await page.waitForSelector('.md-table tbody tr');
      await page.waitForSelector('.md-consequence, .md-name-lock');
    },
  },
  {
    file: '63-access.png',
    route: '/admin/access', as: 'admin', ready: '.access-adlist, table',
    state: 'Access management, super-user only. A grant is (person, application, role, request type) — an analyst is an admin grant narrowed to report requests, and a combination the three named scopes cannot express reads as Mixed rather than being rounded to the nearest one',
  },
  {
    file: '64-throughput-team.png',
    route: '/admin/throughput', as: 'admin', ready: '.tp-card',
    state: 'Reporting throughput as a MANAGER — the team composition, with a bar per analyst. The server decides which of the two shapes to answer with; it is not the personal view with rows hidden',
    async shot(page) {
      await page.waitForSelector('.tp-bars');
    },
  },
  {
    file: '65-throughput-team-table.png',
    route: '/admin/throughput', as: 'admin', ready: '.tp-card',
    state: 'The same page with the per-analyst table opened',
    async shot(page) {
      await page.waitForSelector('.tp-bars');
      await page.click('.tp-table-toggle');
      await page.waitForSelector('#tp-table .tp-table tbody tr');
    },
  },
  {
    file: '66-throughput-self.png',
    route: '/admin/throughput', as: 'analyst', ready: '.tp-card',
    state: 'The same page as somebody who is NOT a manager: four tiles about them, two column charts, and no .tp-bars anywhere — so there is no per-colleague mark on the screen at all. The narrowing is in the QUERY, not in the browser',
  },
];

// ── Theme and phone passes ───────────────────────────────────────────────────
// Every surface, dark, and the three a requester uses at 390px. Not decoration:
// the manual has to show what the app looks like on the device it is opened on,
// and dark mode is where an unstyled select or a black-on-black option shows up.
const THEME_SHOTS = [
  { file: '70-dark-submit.png', route: '/', as: 'bc_rep', ready: '.rs-main .rs-card', theme: 'dark', state: 'Submit form, dark theme' },
  { file: '71-dark-board.png', route: '/public', as: 'anon', ready: '.sb-item', theme: 'dark', state: 'Public status board, dark theme' },
  { file: '72-dark-admin-queue.png', route: '/admin', as: 'admin', ready: '.admin-header-row', theme: 'dark', state: 'Admin queue, dark theme' },
  { file: '73-dark-throughput.png', route: '/admin/throughput', as: 'admin', ready: '.tp-card', theme: 'dark', state: 'Throughput page, dark theme — the two chart colours have their own pair per theme and both were run through the contrast validator' },
  { file: '74-dark-metadata.png', route: '/admin/metadata', as: 'admin', ready: '.md-table tbody tr', theme: 'dark', state: 'Manage metadata, dark theme' },
  {
    file: '75-dark-detail-report.png',
    route: '/admin', as: 'admin', ready: '.admin-submissions-table tbody tr', theme: 'dark',
    state: 'A report request\'s Delivery pane, dark theme',
    async shot(page, ctx) {
      await ctx.openTicket(page, 'report');
      await page.click('.dm-tab:has-text("Delivery")');
      await page.waitForSelector('.dm-hrs, .dm-modal');
    },
  },

  { file: '80-phone-submit.png', route: '/', as: 'bc_rep', ready: '.rs-main .rs-card', viewport: PHONE, state: 'Submit form at 390px — one field per row, and the three type segments stacked one per row' },
  { file: '80b-phone-signin-required.png', route: '/', as: 'anon', ready: '.rs-locked', viewport: PHONE, state: 'The sign-in wall at 390px' },
  {
    file: '81-phone-submit-report.png',
    route: '/', as: 'bc_rep', ready: '.rs-main .rs-card', viewport: PHONE,
    state: 'Report request branch at 390px',
    async shot(page) {
      await page.click('.rs-seg .rs-type:has-text("Report request")');
      await page.waitForSelector('.rs-seg--sub');
    },
  },
  { file: '82-phone-board.png', route: '/public', as: 'anon', ready: '.sb-item', viewport: PHONE, state: 'Public status board at 390px' },
  {
    file: '83-phone-board-expanded.png',
    route: '/public', as: 'anon', ready: '.sb-item', viewport: PHONE,
    state: 'An expanded row at 390px',
    async shot(page) {
      await expandTrackedRow(page, DEFECT_TRACK);
    },
  },
  { file: '84-phone-admin-queue.png', route: '/admin', as: 'admin', ready: '.admin-header-row', viewport: PHONE, state: 'Admin queue at 390px' },
  { file: '85-phone-throughput.png', route: '/admin/throughput', as: 'admin', ready: '.tp-card', viewport: PHONE, state: 'Throughput page at 390px' },
  { file: '86-phone-metadata.png', route: '/admin/metadata', as: 'admin', ready: '.md-table tbody tr', viewport: PHONE, state: 'Manage metadata at 390px' },
];

// ── Running ──────────────────────────────────────────────────────────────────

/**
 * Sign in ONCE per account and keep the cookies.
 *
 * Reused as a `storageState` across every (theme, viewport) context that account
 * needs, so the run costs three logins rather than one per context. That matters:
 * `/api/auth/login` allows 10 attempts per 15 minutes per IP, and the first
 * version of this file logged in six times — two runs back to back would have
 * started answering 429, which looks exactly like a broken check.
 */
async function signInOnce(browser, username) {
  const context = await browser.newContext();
  try {
    const response = await context.request.post(`${API}/api/auth/login`, {
      data: { username, password: PASS },
    });
    if (response.status() === 429) {
      throw new Error(
        `login for "${username}" answered 429. /api/auth/login allows 10 attempts per 15 minutes `
        + 'per IP. Restart the server to reset the limiter, then re-run. '
        + '(A 429 mid-run looks exactly like a broken check, which is why this says so.)',
      );
    }
    if (!response.ok()) throw new Error(`login for "${username}" failed: ${response.status()}`);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/**
 * A sheet of two report requests to import.
 *
 * Written with the export's own header labels, because the import matches on
 * `aliases` — a header the portal itself writes is the only header guaranteed to
 * round-trip. Both rows carry the VERIFY marker so the removal script will accept
 * them; it refuses anything else.
 */
function buildImportSheet() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bc-shots-'));
  const file = path.join(dir, 'report-requests.xlsx');
  const rows = [
    {
      Summary: `${IMPORT_MARKER} — unapplied cash by state`,
      Description: 'A worked example for the import screenshot. Removed by the same run.',
      Application: 'Billing Center',
      'Requester Name': 'Ines Kowalczyk',
      'Defect/Enhancement Status': 'Approved',
      Department: 'Finance',
      'Report Usage Frequency': 'Monthly',
      'Measures and Sources': 'Unapplied balance by state, from the suspense ledger.',
      'Level of Effort': 'S — up to 2 days',
    },
    {
      Summary: `${IMPORT_MARKER} — collections contact outcomes`,
      Description: 'A second worked example, so the result step reports more than one row.',
      Application: 'Billing Center',
      'Requester Name': 'Devon Achterberg',
      'Defect/Enhancement Status': 'New',
      Department: 'Collections',
      'Report Usage Frequency': 'Weekly',
      'Measures and Sources': 'Contact attempts and outcomes, from the collections activity log.',
      // Deliberately not a real level of effort, so the result step shows the
      // warnings banner: a row that landed minus a field is not a row that was
      // skipped, and the screenshot should show both being said differently.
      'Level of Effort': 'Medium-ish',
    },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Report Requests');
  XLSX.writeFile(book, file);
  return file;
}

function makeHelpers(importSheetPath) {
  return {
    /**
     * Open the first ticket of a kind, from the queue, and prove it is that kind.
     *
     * WAITING ON THE RESPONSE IS NOT ENOUGH HERE, and this cost a shot: the queue
     * fires several requests whose URL contains `/api/admin/submissions`, so a
     * wait for "one of those" resolves on a request that was already in flight for
     * the PREVIOUS filter. The rows on screen are then still the old ones, the
     * click lands on a defect, and the dark-theme Delivery-pane shot spent thirty
     * seconds looking for a tab that a defect does not have. Exactly trap 4 in
     * plan.md §0.3, in new clothes.
     *
     * So this waits on the RENDERED TABLE instead — every visible row's own type
     * badge has to agree with the kind that was asked for — and then confirms the
     * modal that opened belongs to the row that was clicked.
     */
    async openTicket(page, kind) {
      const label = kind === 'report' ? 'Report requests' : 'Defects & enhancements';
      await page.click(`[aria-label="Kind of request"] button:text-is("${label}")`);

      // The type badge is the first chip under the summary (submissionColumns.jsx
      // renders `inlineDisplayType(row)` there), so the table itself says what it
      // is showing.
      //
      // Asked as "no report row is present" rather than "every row says defect or
      // enhancement", because that chip is NOT always the type: `inlineDisplayType`
      // returns "Cleanup Only" for a cleanup that was never a bug report, and the
      // stricter form failed on the one such row in the seeded data — against a
      // filter that had applied perfectly.
      await page.waitForFunction((wanted) => {
        const rows = [...document.querySelectorAll('.admin-submissions-table tbody tr')];
        if (rows.length === 0) return false;
        const kinds = rows.map((row) => (
          row.querySelector('.cell-summary-meta')?.firstElementChild?.textContent?.trim().toLowerCase() || ''
        ));
        return wanted === 'report'
          ? kinds.every((value) => value === 'report')
          : kinds.every((value) => value !== 'report');
      }, kind, { timeout: 30000 });

      // From the ID CELL, not the row. A row's textContent runs its cells
      // together with no separator, so `#222` immediately followed by the
      // Reported date `8/6/2026` matched `#(\d+)` as **2228** — an id that does
      // not exist, against a modal that had opened correctly. Read the narrowest
      // element that holds the value.
      const id = await page.$eval(
        '.admin-submissions-table tbody tr:first-of-type td:nth-of-type(2)',
        (cell) => (cell.textContent.match(/#?(\d+)/) || [])[1] || null,
      );
      if (!id) throw new Error('could not read the first row\'s ticket id');

      // Click, then wait on the DOM rather than on a response. Opening a ticket
      // does not necessarily produce a request whose URL carries its id — the
      // modal draws from the row the list already has — so a response wait here
      // either matches something incidental or times out against a screen that is
      // plainly correct. Asserting the modal is open AND names the ticket that was
      // clicked is the stronger claim, and it is the one that matters: it is what
      // rules out a stale row from the previous filter.
      await page.click('.admin-submissions-table tbody tr:first-of-type td:nth-of-type(2)');
      await page.waitForFunction(
        (wanted) => document.querySelector('.dm-modal')?.textContent?.includes(`#${wanted}`) === true,
        id,
        { timeout: 30000 },
      );
      return id;
    },

    /**
     * Open ONE specific ticket, found by searching for its summary.
     *
     * `openTicket` above takes the first row of a kind, which is right when any
     * example will do. These shots are of a particular ticket — the defect in
     * `Other` that the seed puts there — so the row has to be found rather than
     * assumed, and the queue is sorted by last update.
     *
     * Two narrowings are widened first and BOTH are saved per admin, so what this
     * sees would otherwise depend on what the account last looked at: the kind
     * switch opens on "Defects & enhancements", and the application scope opens on
     * whatever was pinned. Waits on the ROW rather than on the response, because
     * the search is debounced and the table re-renders when it lands — an element
     * handle taken before that is detached by the time it is clicked.
     */
    async openTicketBySearch(page, { search }) {
      const allKinds = await page.$('.bs-seg button:text-is("All kinds")');
      if (allKinds) {
        await allKinds.click();
        await page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
          && res.status() === 200, { timeout: 30000 }).catch(() => null);
      }
      const scope = await page.$('.admin-scope-select');
      // '' is "All applications". A look, not a pin — it changes nothing about
      // where this account lands next time.
      if (scope) {
        await scope.selectOption('');
        await page.waitForResponse((res) => res.url().includes('/api/admin/submissions')
          && res.status() === 200, { timeout: 30000 }).catch(() => null);
      }
      await page.fill('.admin-search input', search);

      // Matched on the SUMMARY, never on a ticket id: ids advance permanently and
      // change on every reseed, so a number written into this file is a shot that
      // breaks the next time the demonstration data is rebuilt.
      const row = page.locator('.admin-submissions-table tbody tr', { hasText: search }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });

      // From the ID CELL, not the row — a row's textContent runs its cells together
      // with no separator, so `#222` followed by a date matched `#(\d+)` as 2228.
      const id = await row.locator('td').nth(1).evaluate(
        (cell) => (cell.textContent.match(/#?(\d+)/) || [])[1] || null,
      );
      if (!id) throw new Error(`no ticket id on the row matching "${search}"`);

      // Wait for THIS ticket's detail response, not merely for the modal: the
      // footer renders as soon as the modal opens, with whatever `detail` currently
      // holds, so a shot taken before this lands photographs the previous ticket's
      // answer. It also proves the row that opened is the right one.
      await Promise.all([
        page.waitForResponse((res) => new RegExp(`/api/admin/submissions/${id}(\\?|$)`).test(res.url())
          && res.status() === 200, { timeout: 30000 }),
        row.locator('td').nth(1).click(),
      ]);
      await page.waitForSelector('.dm-modal', { timeout: 30000 });
      await page.waitForSelector('.dm-foot-actions', { timeout: 30000 });
    },

    /**
     * Open Add a ticket at a given mode and branch.
     *
     * `Cleanup` is its OWN segment in this dialog (TYPE_SEGMENTS in
     * AddTicketModal.jsx is Defect · Enhancement · Cleanup · Report request) even
     * though a cleanup is stored as a flag on a defect or an enhancement — which
     * is what the tag row underneath then asks: Internal only · Defect ·
     * Enhancement. The first draft of this file tried to reach it through the tag
     * row and clicked nothing.
     */
    async openAddTicket(page, { mode, type, tag, reportBranch }) {
      await page.click('button:has-text("Add a ticket")');
      await page.waitForSelector('.at-body');
      await page.click(`.at-modes .at-seg button:has-text("${mode}")`);
      await page.click(`.at-grouprow .at-seg button:text-is("${type}")`);
      if (tag) {
        await page.click(`.at-tagrow .at-seg button:text-is("${tag}")`);
      }
      if (reportBranch) {
        await page.click(`.at-only-report .at-tagrow .at-seg button:text-is("${reportBranch}")`);
      }
      await page.waitForSelector('.at-body');
    },

    /** Open the Data menu and pick one of its two entries. */
    async openDataMenu(page, entry) {
      await page.click('button:has-text("Data")');
      await page.waitForSelector(`button[role="menuitem"]:has-text("${entry}")`);
      await page.click(`button[role="menuitem"]:has-text("${entry}")`);
      await page.waitForSelector('.xl-modal, .xl-body');
    },

    /**
     * Attach the fixture sheet and let the analyze step finish.
     *
     * THE MODE GOES FIRST, and the order is not cosmetic: `analyzeImportFile`
     * (hooks/useImportModal.js) returns early with "Choose Import As … before
     * selecting a file" when no mode is set, so attaching the file first fires no
     * request at all — which is exactly how the first version of this failed,
     * waiting sixty seconds for a response that was never going to come.
     *
     * The mode also FORCES the type of every row, which is why a report sheet
     * needs its own: imported as `defect`, none of its report columns are read.
     */
    async attachImportSheet(page) {
      await page.selectOption('.xl-body select', 'report');
      await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes('import-xlsx/analyze') && response.status() < 400,
          { timeout: 60000 },
        ),
        // The input lives in AdminHeader, not the modal, and is display:none — the
        // drop zone clicks it. setInputFiles does not need it visible.
        page.setInputFiles('input[type="file"][accept*="xlsx"]', importSheetPath),
      ]);
      // `.xl-matched` is the green "N of N columns matched" banner and is the
      // thing that is actually VISIBLE when step 2 draws. `.xl-maps` lives inside
      // a collapsed <details class="at-fold"> ("Review all N mappings"), so
      // waiting on it hangs for thirty seconds against a screen that rendered
      // correctly — waitForSelector's default state is `visible`, and a closed
      // <details> is not.
      await page.waitForSelector('.xl-matched', { timeout: 30000 });
    },

    /** Open the "Review all N mappings" fold, which is closed by default. */
    async openMappingFold(page) {
      await page.click('.at-fold > summary:has-text("mapping")');
      await page.waitForSelector('.xl-maps .xl-map');
    },
  };
}

async function run() {
  mkdirSync(OUT, { recursive: true });

  const importSheetPath = SKIP_IMPORT ? null : buildImportSheet();
  const helpers = makeHelpers(importSheetPath);

  const all = [
    ...SHOTS,
    ...(SKIP_IMPORT ? [] : IMPORT_RESULT_SHOTS),
    ...PAGE_SHOTS,
    ...THEME_SHOTS,
  ].filter((entry) => !ONLY || entry.file.includes(ONLY));

  if (LIST_ONLY) {
    for (const entry of all) {
      console.log(`${entry.file.padEnd(38)} ${entry.as.padEnd(8)} ${(entry.theme || 'light').padEnd(6)} ${entry.viewport === PHONE ? '390' : '1500'}  ${entry.route}`);
    }
    console.log(`\n${all.length} shots`);
    return;
  }

  console.log(`${all.length} shots → ${OUT}\n`);

  const browser = await chromium.launch();

  // Sign in once per account that this run actually needs, before anything else,
  // so a 429 is reported as a rate limit at the top rather than as a broken
  // selector forty shots in.
  const needed = [...new Set(all.map((entry) => entry.as))].filter((as) => ACCOUNTS[as]);
  const sessions = new Map();
  for (const as of needed) {
    sessions.set(as, await signInOnce(browser, ACCOUNTS[as]));
    console.log(`      signed in as ${ACCOUNTS[as]} (${as})`);
  }
  if (needed.length > 0) console.log('');

  // One context per (account, theme, viewport). The theme has to be set with an
  // addInitScript BEFORE the app mounts, and a viewport change mid-context leaves
  // a layout that was measured at the old width — both are cheaper to get right
  // by building the context than by fixing up a shared one.
  const contexts = new Map();
  const contextFor = async (as, theme, viewport) => {
    const key = `${as}|${theme}|${viewport.width}`;
    if (contexts.has(key)) return contexts.get(key);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
      ...(sessions.has(as) ? { storageState: sessions.get(as) } : {}),
    });
    await context.addInitScript((value) => {
      window.localStorage.setItem('bc-theme', value);
      document.documentElement.setAttribute('data-theme', value);
    }, theme);
    contexts.set(key, context);
    return context;
  };

  const createdByImport = [];
  try {
    for (const entry of all) {
      const theme = entry.theme || 'light';
      const viewport = entry.viewport || DESKTOP;
      let page;
      try {
        const context = await contextFor(entry.as, theme, viewport);
        page = await context.newPage();
        await open(page, entry.route, entry.ready);
        if (entry.shot) await entry.shot(page, helpers);
        const size = await shoot(page, entry.file);
        record(entry.file, true, `${Math.round(size / 1024)} kB`);
        if (entry.writes) {
          // Read the ids straight off the result panel so the teardown removes
          // exactly what this run inserted, rather than searching by marker and
          // hoping nothing else matches.
          const ids = await page.$$eval(
            '.xl-result a, .xl-result [data-submission-id], .xl-rows',
            (nodes) => nodes.map((node) => node.textContent).join(' ').match(/#(\d+)/g) || [],
          );
          for (const id of ids) createdByImport.push(Number(id.slice(1)));
        }
      } catch (error) {
        record(entry.file, false, error.message.split('\n')[0].slice(0, 200));
        // Photograph the failure. A timed-out selector tells you what was not
        // there; the picture tells you what WAS, which is the half that says
        // whether the probe or the product is wrong (plan.md §0.3, trap 4).
        if (page) {
          const debug = path.join(OUT, `_failed-${entry.file}`);
          await page.screenshot({ path: debug, fullPage: true }).catch(() => {});
          console.log(`      state at failure → ${debug}`);
        }
      } finally {
        if (page) await page.close();
      }
    }
  } finally {
    // ── Put back what the import shot wrote ─────────────────────────────────
    if (!SKIP_IMPORT) {
      // The result panel does not always print ids, so fall back to asking the
      // queue for anything carrying the marker. Either way the removal script is
      // what refuses a ticket that is not ours.
      let ids = [...new Set(createdByImport)];
      if (ids.length === 0) {
        try {
          const context = await contextFor('admin', 'light', DESKTOP);
          const found = await context.request
            .get(`${API}/api/admin/submissions?search=${encodeURIComponent(IMPORT_MARKER)}`)
            .then((response) => response.json());
          const rows = Array.isArray(found) ? found : (found.submissions || found.rows || []);
          ids = rows
            .filter((row) => String(row.summary_of_issue || '').startsWith('VERIFY'))
            .map((row) => Number(row.id));
        } catch (error) {
          console.log(`      could not search for leftovers: ${error.message}`);
        }
      }
      if (ids.length > 0) {
        const output = execFileSync(
          process.execPath,
          ['scripts/removeVerificationSubmissions.js', ...ids.map(String), '--apply'],
          { cwd: SERVER_DIR, encoding: 'utf8' },
        );
        console.log(`\n      ${output.trim().split('\n').join('\n      ')}`);
      } else {
        console.log('\n      nothing to remove — the import shot wrote nothing');
      }
    }
    await browser.close();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} shots taken`);
  if (failed.length > 0) {
    console.log('\nNot taken:');
    for (const result of failed) console.log(`  - ${result.file}: ${result.detail}`);
  }

  // ── The manifest, written from what actually came out ────────────────────
  // Only on a full run: a filtered run would otherwise rewrite the manifest as
  // though the shots it skipped do not exist.
  if (ONLY) {
    console.log('\nFiltered run — the manifest was NOT rewritten.');
  } else {
    const taken = new Set(results.filter((result) => result.ok).map((result) => result.file));
    const manifest = {
      captured: new Date().toISOString().slice(0, 10),
      capturedBy: 'client/scripts/capture-screenshots.mjs',
      source: 'the hosted Supabase database, seeded by server/scripts/seedRealisticSubmissions.js — '
        + 'production data, which the owner confirmed is entirely test data and fine to photograph. '
        + 'Server on :4000, Vite on :5173.',
      capture: {
        browser: 'Chromium (Playwright)',
        desktop: '1500x950 @2x',
        mobile: '390x844 @2x',
        reducedMotion: 'reduce',
        theme: "forced via localStorage['bc-theme'] in an addInitScript, before the app mounts",
        settle: 'document.fonts.ready, all images complete, two animation frames',
      },
      accounts: {
        anon: 'no session — what every requester sees',
        bc_rep: 'a requester with report requests of their own; the only way the report-request track appears on the board',
        admin: 'super user and a manager, so the throughput page answers with the team composition',
        analyst: 'bc_report_analyst — one grant, narrowed to report requests on Billing Center',
      },
      screenshots: [...SHOTS, ...(SKIP_IMPORT ? [] : IMPORT_RESULT_SHOTS), ...PAGE_SHOTS, ...THEME_SHOTS]
        .filter((entry) => taken.has(entry.file))
        .map((entry) => ({
          file: entry.file,
          route: entry.route,
          as: entry.as,
          theme: entry.theme || 'light',
          viewport: entry.viewport === PHONE ? '390x844' : '1500x950',
          state: entry.state,
        })),
    };
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\nmanifest → ${MANIFEST} (${manifest.screenshots.length} entries)`);

    // ── Prune what the registry no longer knows about ──────────────────────
    // A renamed shot leaves its old file behind, and an orphan PNG is worse than
    // a missing one: it is a picture of a build nobody is running, sitting in the
    // folder the documentation links into. Forty-one of them were what made this
    // harness necessary. Only ever on a full, successful-manifest run, and every
    // deletion is named.
    if (failed.length === 0) {
      const known = new Set(manifest.screenshots.map((entry) => entry.file));
      const stale = readdirSync(OUT)
        .filter((file) => file.toLowerCase().endsWith('.png'))
        .filter((file) => !known.has(file));
      for (const file of stale) {
        rmSync(path.join(OUT, file), { force: true });
        console.log(`      pruned stale ${file}`);
      }
      if (stale.length > 0) console.log(`      ${stale.length} stale file(s) removed`);
    } else {
      console.log('      stale files NOT pruned — some shots failed, so the registry is not a complete picture');
    }
  }

  if (failed.length > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
