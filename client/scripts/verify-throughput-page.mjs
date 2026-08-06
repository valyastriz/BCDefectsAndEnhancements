/**
 * Browser verification for the reporting throughput page.
 *
 * The checks that matter here are the ones no unit test can see:
 *   1. **Two views, and the SERVER picks.** A super user gets the team page; an
 *      admin with a plain grant gets their own numbers, in a different
 *      composition, with no per-analyst chart or table row anywhere on it. Both
 *      are opened for real, in a real browser, with a real session each.
 *   2. **Every chart's marks agree with its own axis** — CHART_SCALE_PROBE for the
 *      columns (it exists because a chart drew 27 above the line marked 30) and
 *      the same measurement by hand for the horizontal bars, whose widths are
 *      percentages of a plot column that is not the row.
 *   3. **One hue per single-series chart, two for the two-series one**, resolved
 *      from --chart-1/--chart-2 in whichever theme is on — and the dark steps are
 *      NOT the light ones, so both are asserted.
 *   4. **No number is reachable only by hovering**: every value drawn in every
 *      chart is also in the table twin.
 *   5. Per-container overflow at three widths in both themes.
 *
 * IT WRITES, because charts with no bars prove nothing. It creates two report
 * requests, marks them delivered in two different months, logs hours against
 * them as two different people — and then removes all of it and prints the
 * submission count to prove the table is back where it started. The removal goes
 * through `server/scripts/removeVerificationSubmissions.js`, because there is no
 * submission DELETE endpoint and there should not be one.
 *
 * The second identity is `lead_admin`, which is not a guessed credential: it is in
 * `server/.env` as `ADMIN_LOGINS` with `SEED_ADMIN_PASSWORD`, seeded by
 * `npm run seed:admin`.
 *
 * Usage (server on :4000 and Vite on :5173 must already be running):
 *   node scripts/verify-throughput-page.mjs
 *   node scripts/verify-throughput-page.mjs --shots ./out
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OVERFLOW_PROBE } from './lib/overflow-probe.mjs';
import { CHART_SCALE_PROBE } from './lib/chart-scale-probe.mjs';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5173';
const API = process.env.VERIFY_API_URL || 'http://localhost:4000';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin123';
// A second admin who is NOT a manager, so the other view can be opened for real.
const ANALYST_USER = process.env.ANALYST_USER || 'lead_admin';
const ANALYST_PASS = process.env.ANALYST_PASS || PASS;

const SERVER_DIR = path.resolve(fileURLToPath(new URL('../../server', import.meta.url)));

const shotsIndex = process.argv.indexOf('--shots');
const SHOTS = shotsIndex === -1 ? null : (process.argv[shotsIndex + 1] || './verify-shots');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1500, height: 950 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'phone', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];

// The validated chart steps, one pair per theme. Asserted rather than trusted:
// the dark pair is not the light pair brightened, and a refactor that "simplified"
// the tokens into one pair would fail the dark lightness band silently.
const CHART_COLOURS = {
  light: { 1: 'rgb(37, 99, 235)', 2: 'rgb(235, 104, 52)' },
  dark: { 1: 'rgb(59, 130, 246)', 2: 'rgb(226, 98, 47)' },
};

const MARKER = 'VERIFY throughput fixture';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shoot(page, label) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
}

/** A day this month and a day in the month before it, as the columns store them. */
function fixtureDays() {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 2);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { thisMonth: iso(thisMonth), lastMonth: iso(lastMonth) };
}

/**
 * One signed-in session with the CSRF token the admin API demands.
 *
 * The double-submit pair is the whole point of the header: the cookie is set on
 * login and every mutation has to echo it back, so a script that writes has to
 * play by the same rule the client does.
 */
async function signIn(context, username, password) {
  const login = await context.request.post(`${API}/api/auth/login`, {
    data: { username, password },
  });
  if (!login.ok()) throw new Error(`login failed for ${username}: ${login.status()}`);
  const cookies = await context.cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'bc_csrf')?.value || '';
  if (!csrf) throw new Error(`no bc_csrf cookie for ${username}`);
  return {
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    get: (url) => context.request.get(`${API}${url}`).then((r) => r.json()),
    post: async (url, data) => {
      const response = await context.request.post(`${API}${url}`, {
        headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
        data,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok()) throw new Error(`POST ${url} ${response.status()}: ${JSON.stringify(body)}`);
      return body;
    },
    put: async (url, data) => {
      const response = await context.request.put(`${API}${url}`, {
        headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
        data,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok()) throw new Error(`PUT ${url} ${response.status()}: ${JSON.stringify(body)}`);
      return body;
    },
    del: async (url) => {
      const response = await context.request.delete(`${API}${url}`, {
        headers: { 'X-CSRF-Token': csrf },
      });
      if (!response.ok()) throw new Error(`DELETE ${url} ${response.status()}`);
      return response.json().catch(() => ({}));
    },
  };
}

/** How many tickets the portal holds, from the page the Access card reads. */
async function ticketCount(session) {
  const access = await session.get('/api/admin/access');
  const inApplications = (access.applications || []).reduce((sum, app) => sum + Number(app.ticketCount || 0), 0);
  return inApplications + Number(access.unassignedTicketCount || 0);
}

/**
 * Horizontal bars, measured the way CHART_SCALE_PROBE measures columns.
 *
 * The bar's width is a percentage of `.tp-plot`, NOT of the row — the row also
 * holds the value label, and a percentage of the wrong box is exactly the class of
 * fault the column probe exists for. The longest bar in a chart must fill its plot
 * exactly, and every other bar must be its own share of it.
 */
const BAR_SCALE_PROBE = () => {
  const worst = [];
  for (const chart of document.querySelectorAll('.tp-bars')) {
    const fills = [...chart.querySelectorAll('.tp-fill')];
    const stated = fills.map((fill) => Number(fill.getAttribute('data-value')));
    if (fills.length === 0 || stated.some((value) => !Number.isFinite(value))) {
      worst.push({ error: 'a bar states no value' });
      continue;
    }
    const max = Math.max(...stated);
    if (max <= 0) continue;
    fills.forEach((fill, index) => {
      const plot = fill.parentElement.getBoundingClientRect().width;
      const drawn = fill.getBoundingClientRect().width;
      const expected = (stated[index] / max) * plot;
      const offBy = Math.abs(drawn - expected);
      if (offBy > 1) {
        worst.push({
          stated: stated[index],
          drawnAs: Math.round((drawn / plot) * max * 100) / 100,
          offByPx: Math.round(offBy * 100) / 100,
          max,
        });
      }
    });
  }
  return worst;
};

/** Every colour a chart actually paints, by series slot. */
const CHART_HUE_PROBE = () => {
  const hues = (nodes) => [...new Set([...nodes].map((node) => getComputedStyle(node).backgroundColor))];
  const cards = [...document.querySelectorAll('.tp-card')];
  return cards.map((card) => ({
    title: card.querySelector('h3')?.textContent || '',
    hasLegend: Boolean(card.querySelector('.tp-legend')),
    barHues: hues(card.querySelectorAll('.tp-fill')),
    columnHues: hues(card.querySelectorAll('.tp-colfill')),
    slot1: hues(card.querySelectorAll('.tp-fill--1, .tp-colfill')),
    slot2: hues(card.querySelectorAll('.tp-fill--2')),
  }));
};

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    window.localStorage.setItem('bc-theme', value);
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
  await page.waitForTimeout(120);
}

async function run() {
  const browser = await chromium.launch();
  const manager = await browser.newContext({
    viewport: VIEWPORTS[0], deviceScaleFactor: 2, reducedMotion: 'reduce',
  });
  const analystContext = await browser.newContext({
    viewport: VIEWPORTS[0], deviceScaleFactor: 2, reducedMotion: 'reduce',
  });

  const consoleErrors = [];
  const page = await manager.newPage();
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  const boss = await signIn(manager, USER, PASS);
  const analyst = await signIn(analystContext, ANALYST_USER, ANALYST_PASS);

  const bossViewer = (await boss.get('/api/viewer')).viewer;
  const analystViewer = (await analyst.get('/api/viewer')).viewer;
  record(
    'the two identities are the two ranks the page has views for',
    bossViewer.canManageAnyApplication === true && analystViewer.canManageAnyApplication === false,
    `${USER}: manager of ${JSON.stringify(bossViewer.managerApplicationIds)} · ${ANALYST_USER}: admin of ${JSON.stringify(analystViewer.adminApplicationIds)}`,
  );

  const baselineTickets = await ticketCount(boss);
  const applicationId = Number(analystViewer.adminApplicationIds[0]);
  const analystId = Number(analystViewer.user.id);
  const bossId = Number(bossViewer.user.id);
  const days = fixtureDays();
  const created = [];
  // submission id → its hours entries, so the fixture can be taken back out the
  // way it went in.
  const loggedEntries = new Map();

  try {
    // ── The fixture ─────────────────────────────────────────────────────────
    // Two delivered requests in two months, worked by two people, and closed by
    // one each — so "worked on" and "closed" cannot agree, which is the gap the
    // whole page is built around.
    const application = (bossViewer.applications || []).find((app) => Number(app.id) === applicationId);
    for (const [index, when] of [days.lastMonth, days.thisMonth].entries()) {
      const body = await boss.post('/api/admin/submissions', {
        type: 'report',
        status: 'New',
        application_name: application.name,
        created_by: 'Verification harness',
        created_by_email: 'verify@example.invalid',
        summary_of_issue: `${MARKER} ${index === 0 ? 'A' : 'B'} — safe to delete`,
        what_happened_exact_details: 'Created by scripts/verify-throughput-page.mjs. Removed by the same run.',
        request: 'A report request that exists only to give the throughput charts something to draw.',
        is_public: false,
      });
      const id = Number(body?.submission?.id || body?.id);
      if (!id) throw new Error(`create returned no id: ${JSON.stringify(body).slice(0, 200)}`);
      created.push({ id, when });
    }
    record('two report requests were created', created.length === 2, created.map((row) => `#${row.id}`).join(' '));

    // Delivered, and held by different people at the finish.
    for (const [index, row] of created.entries()) {
      const current = await boss.get(`/api/admin/submissions/${row.id}`);
      const existing = current.submission || current;
      await boss.put(`/api/admin/submissions/${row.id}`, {
        ...existing,
        assigned_to: index === 0 ? bossId : analystId,
        completed_at: `${row.when}T12:00:00.000Z`,
      });
    }

    // Hours, by the day WORKED. Both people on both requests, so each of them
    // worked on two and closed one.
    const logged = [
      [boss, created[0].id, 4, days.lastMonth],
      [analyst, created[0].id, 2.5, days.lastMonth],
      [boss, created[1].id, 1.25, days.thisMonth],
      [analyst, created[1].id, 3, days.thisMonth],
    ];
    for (const [session, id, hours, workedOn] of logged) {
      const answer = await session.post(`/api/admin/submissions/${id}/time-entries`, {
        hours, worked_on: workedOn, note: MARKER,
      });
      // Every response carries the request's whole list, so the last one per
      // request is what the cleanup below needs.
      loggedEntries.set(id, answer.entries || []);
    }
    record(
      'hours were logged by two people across two months',
      [...loggedEntries.values()].reduce((sum, list) => sum + list.length, 0) === 4,
      [...loggedEntries.entries()].map(([id, list]) => `#${id}: ${list.length}`).join(' · '),
    );

    // ── What the server answers each of them ────────────────────────────────
    const window = (() => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return `from=${iso(start)}&to=${iso(now)}`;
    })();
    const teamAnswer = await boss.get(`/api/admin/throughput?${window}&application_id=${applicationId}`);
    const selfAnswer = await analyst.get(`/api/admin/throughput?${window}&application_id=${applicationId}`);

    record(
      'the server names the view, and names a different one for each rank',
      teamAnswer.scope === 'team' && selfAnswer.scope === 'self',
      `${USER}: ${teamAnswer.scope} · ${ANALYST_USER}: ${selfAnswer.scope}`,
    );
    record(
      'the team answer credits both people, and only closed sums to delivered',
      teamAnswer.delivered === 2
        && teamAnswer.analysts.length === 2
        && teamAnswer.analysts.reduce((sum, row) => sum + row.closed, 0) === 2
        && teamAnswer.analysts.reduce((sum, row) => sum + row.worked, 0) === 4
        && teamAnswer.total_hours === 10.75,
      `delivered ${teamAnswer.delivered}, hours ${teamAnswer.total_hours}, ${teamAnswer.analysts.map((a) => `${a.name} ${a.hours}h w${a.worked}/c${a.closed}`).join(' · ')}`,
    );
    record(
      "the analyst's answer contains their own numbers and no colleague at all",
      selfAnswer.analysts.length === 1
        && Number(selfAnswer.analysts[0].user_id) === analystId
        && selfAnswer.total_hours === 5.5
        && selfAnswer.delivered === 1
        && !JSON.stringify(selfAnswer).includes(`"user_id":${bossId}`),
      `${selfAnswer.analysts.length} analyst, ${selfAnswer.total_hours}h, ${selfAnswer.delivered} delivered`,
    );

    // ── The team page ───────────────────────────────────────────────────────
    await page.goto(`${BASE}/admin/throughput`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.tp-card');
    // The picker opens on the viewer's home application; the fixture is in the
    // one the analyst administers, so make the page look at that.
    await page.selectOption('.tp-filters select[aria-label="Application"]', String(applicationId));
    await page.waitForSelector('.tp-bars');

    const heading = await page.textContent('.tp-page h2');
    record('the team view is titled for the team', heading.trim() === 'Reporting throughput', heading.trim());

    const tiles = await page.$$eval('.md-tile', (nodes) => nodes.map((node) => ({
      num: node.querySelector('.md-tile-num').textContent.trim(),
      label: node.querySelector('.md-tile-lbl').textContent.trim(),
    })));
    record(
      'the four tiles say what the server said',
      tiles.length === 4
        && tiles[0].num === String(teamAnswer.delivered)
        && tiles[1].num === `${teamAnswer.total_hours} h`
        && tiles[2].num === String(teamAnswer.analysts.length),
      tiles.map((tile) => `${tile.num} ${tile.label}`).join(' | '),
    );

    const cards = await page.$$eval('.tp-card h3', (nodes) => nodes.map((node) => node.textContent.trim()));
    record(
      'three charts, in the order the mockup sets',
      cards.length === 3
        && cards[0] === 'Hours by analyst'
        && cards[1] === 'Requests worked on, and requests closed'
        && cards[2] === 'Delivered by month',
      cards.join(' · '),
    );

    // ── Colour: one hue per single-series chart, two for the two-series one ──
    for (const theme of THEMES) {
      await setTheme(page, theme);
      const hues = await page.evaluate(CHART_HUE_PROBE);
      const hours = hues.find((card) => card.title === 'Hours by analyst');
      const credit = hues.find((card) => card.title.startsWith('Requests worked on'));
      const months = hues.find((card) => card.title === 'Delivered by month');
      const expected = CHART_COLOURS[theme];
      record(
        `one hue for every bar of a single-series chart — ${theme}`,
        hours.barHues.length === 1 && hours.barHues[0] === expected[1] && hours.hasLegend === false,
        `${hours.barHues.join(', ')} (legend: ${hours.hasLegend})`,
      );
      record(
        `two hues and a legend where there are two series — ${theme}`,
        credit.barHues.length === 2
          && credit.slot1.includes(expected[1])
          && credit.slot2.includes(expected[2])
          && credit.hasLegend === true,
        credit.barHues.join(', '),
      );
      record(
        `the columns wear slot 1, and the validated step for this theme — ${theme}`,
        months.columnHues.length === 1 && months.columnHues[0] === expected[1],
        months.columnHues.join(', '),
      );
    }
    await setTheme(page, 'light');

    // ── Geometry: does every mark sit where its own axis says? ──────────────
    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(140);

        const columns = await page.evaluate(CHART_SCALE_PROBE);
        record(
          `every column sits where its axis says — ${viewport.name} ${theme}`,
          columns.length === 0,
          columns.length ? JSON.stringify(columns.slice(0, 3)) : '',
        );
        const bars = await page.evaluate(BAR_SCALE_PROBE);
        record(
          `every bar is its own share of its plot — ${viewport.name} ${theme}`,
          bars.length === 0,
          bars.length ? JSON.stringify(bars.slice(0, 3)) : '',
        );
        const offenders = await page.evaluate(OVERFLOW_PROBE, '.app-main');
        record(
          `throughput page has no clipped overflow — ${viewport.name} ${theme}`,
          offenders.length === 0,
          offenders.length ? JSON.stringify(offenders.slice(0, 3)) : '',
        );
        if (viewport.name === 'phone') {
          const pillsVisible = await page.isVisible('.tp-range');
          const selectVisible = await page.isVisible('.tp-rangeselect');
          record(
            `the timeframe pills become a select — phone ${theme}`,
            pillsVisible === false && selectVisible === true,
            `pills=${pillsVisible} select=${selectVisible}`,
          );
        }
        await shoot(page, `throughput-team-${viewport.name}-${theme}`);
      }
    }
    await page.setViewportSize(VIEWPORTS[0]);
    await setTheme(page, 'light');

    // ── The table twin, and nothing readable by hover alone ─────────────────
    const toggleBefore = await page.getAttribute('.tp-table-toggle', 'aria-expanded');
    record('the table twin is drawn closed', toggleBefore === 'false', `aria-expanded=${toggleBefore}`);
    await page.click('.tp-table-toggle');
    await page.waitForSelector('#tp-table .tp-table tbody tr');
    const table = await page.$$eval('#tp-table .tp-table tbody tr', (rows) => rows.map((row) => (
      [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim())
    )));
    const foot = await page.$$eval('#tp-table .tp-table tfoot td', (cells) => cells.map((cell) => cell.textContent.trim()));
    const everyNumberIsInTheTable = teamAnswer.analysts.every((analystRow) => table.some((row) => (
      row[0] === analystRow.name
      && row[1] === String(analystRow.hours)
      && row[2] === String(analystRow.worked)
      && row[3] === String(analystRow.closed)
    )));
    record(
      'every value in every chart is also a row in the table',
      everyNumberIsInTheTable && foot[1] === String(teamAnswer.total_hours),
      `${table.length} rows, total ${foot.join(' / ')}`,
    );

    // The tooltip is an enhancement on top of that, and it answers to the keyboard.
    await page.focus('.tp-row');
    await page.waitForTimeout(120);
    const tip = await page.evaluate(() => {
      const node = document.querySelector('.tp-tip');
      return { open: node.getAttribute('data-open'), text: node.textContent.trim() };
    });
    record(
      'focusing a bar with the keyboard shows what hovering it shows',
      tip.open === 'true' && tip.text.length > 0,
      tip.text.replace(/\s+/g, ' '),
    );
    await shoot(page, 'throughput-team-table-open');

    // ── The analyst's own page, in their own browser ────────────────────────
    const analystPage = await analystContext.newPage();
    const analystConsole = [];
    analystPage.on('console', (message) => { if (message.type() === 'error') analystConsole.push(message.text()); });
    await analystPage.goto(`${BASE}/admin/throughput`, { waitUntil: 'networkidle' });
    await analystPage.waitForSelector('.tp-card');

    const analystHeading = await analystPage.textContent('.tp-page h2');
    record(
      'the analyst gets a page titled for them, not the team page',
      analystHeading.trim() === 'Your reporting work',
      analystHeading.trim(),
    );

    const composition = await analystPage.evaluate(() => ({
      tiles: [...document.querySelectorAll('.md-tile-lbl')].map((node) => node.textContent.trim()),
      cards: [...document.querySelectorAll('.tp-card h3')].map((node) => node.textContent.trim()),
      perPersonCharts: document.querySelectorAll('.tp-bars').length,
      allOption: [...document.querySelectorAll('select[aria-label="Application"] option')]
        .map((node) => node.textContent.trim()),
    }));
    record(
      'a different composition: four tiles about them, two charts, no per-analyst bars',
      composition.perPersonCharts === 0
        && composition.cards.length === 2
        && composition.cards[0] === 'Your hours'
        && composition.cards[1] === 'Requests you closed'
        && composition.tiles[0] === 'Requests you worked on'
        && composition.tiles[1] === 'Requests you closed',
      `${composition.cards.join(' · ')} | ${composition.tiles.join(' · ')}`,
    );
    record(
      '"All applications" is withheld — rank is per application',
      !composition.allOption.includes('All applications'),
      composition.allOption.join(' · '),
    );

    await analystPage.click('.tp-table-toggle');
    await analystPage.waitForSelector('#tp-table .tp-table');
    const analystTable = await analystPage.evaluate(() => ({
      headers: [...document.querySelectorAll('#tp-table th')].map((node) => node.textContent.trim()),
      body: document.querySelector('#tp-table').textContent,
    }));
    record(
      'the analyst\'s table is by month, and names nobody',
      analystTable.headers.join('|') === 'Month|Hours|Closed'
        && !analystTable.body.includes(bossViewer.user.displayName),
      analystTable.headers.join(' | '),
    );

    for (const theme of THEMES) {
      await setTheme(analystPage, theme);
      for (const viewport of VIEWPORTS) {
        await analystPage.setViewportSize({ width: viewport.width, height: viewport.height });
        await analystPage.waitForTimeout(140);
        const columns = await analystPage.evaluate(CHART_SCALE_PROBE);
        const offenders = await analystPage.evaluate(OVERFLOW_PROBE, '.app-main');
        record(
          `the analyst page draws true and does not overflow — ${viewport.name} ${theme}`,
          columns.length === 0 && offenders.length === 0,
          [
            columns.length ? `scale ${JSON.stringify(columns.slice(0, 2))}` : '',
            offenders.length ? `overflow ${JSON.stringify(offenders.slice(0, 2))}` : '',
          ].filter(Boolean).join(' | '),
        );
        await shoot(analystPage, `throughput-mine-${viewport.name}-${theme}`);
      }
    }

    // ── The empty state, which is what the page looks like on day one ───────
    // The other application has no report requests at all, so it is the real
    // thing rather than a mocked one.
    const emptyPage = await manager.newPage();
    await emptyPage.goto(`${BASE}/admin/throughput`, { waitUntil: 'networkidle' });
    await emptyPage.waitForSelector('.tp-card');
    await emptyPage.selectOption('.tp-filters select[aria-label="Application"]', String(
      (bossViewer.applications || []).map((app) => Number(app.id)).find((id) => id !== applicationId) || applicationId,
    ));
    // Waited for rather than slept through: the hosted database is a round trip
    // away and a fixed pause is how a check starts passing on a fast day only.
    await emptyPage.waitForSelector('.tp-empty h4');
    const empty = await emptyPage.evaluate(() => ({
      cards: document.querySelectorAll('.tp-card').length,
      empties: [...document.querySelectorAll('.tp-empty h4')].map((node) => node.textContent.trim()),
      distinct: new Set([...document.querySelectorAll('.tp-empty p')].map((node) => node.textContent.trim())).size,
    }));
    record(
      'an application with nothing delivered says which kind of nothing, per card',
      empty.empties.length === 3 && empty.distinct === 3,
      empty.empties.join(' · '),
    );
    await shoot(emptyPage, 'throughput-empty-desktop-light');
    await emptyPage.close();

    const realErrors = [...consoleErrors, ...analystConsole].filter((text) => !/401|Unauthorized|403|Forbidden/i.test(text));
    record('console is clean', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

    // ── Putting it back ─────────────────────────────────────────────────────
    // Hours come out through their own endpoint, which is the same path an
    // analyst deleting a mistyped entry takes. Every POST answers with the
    // request's whole list, so the ids are already in hand — there is no GET for
    // them on their own, and adding one just to clean up would be a new endpoint
    // built for a test.
    for (const [submissionId, entries] of loggedEntries) {
      for (const entry of entries) {
        await boss.del(`/api/admin/submissions/${submissionId}/time-entries/${entry.id}`);
      }
    }
    record(
      'the hours were removed through the endpoint that owns them',
      true,
      `${[...loggedEntries.values()].reduce((sum, list) => sum + list.length, 0)} entries`,
    );
  } finally {
    if (created.length > 0) {
      // No submission DELETE endpoint, on purpose — so the fixture leaves through
      // Sequelize, and the script prints the count rather than claiming it.
      const output = execFileSync(
        process.execPath,
        ['scripts/removeVerificationSubmissions.js', ...created.map((row) => String(row.id)), '--apply'],
        { cwd: SERVER_DIR, encoding: 'utf8' },
      );
      console.log(output.trim().split('\n').map((line) => `      ${line}`).join('\n'));
    }

    // ── The harness polices itself ──────────────────────────────────────────
    // This script writes, so the last thing it does is prove it put everything
    // back — the ticket count, and that no hours or completion of its own is left
    // anywhere in time. In the `finally`, so it still reports after a failed
    // check, and on the session already open, because logging in again for it
    // costs a third of the login rate limit's budget for no gain.
    const finalCount = await ticketCount(boss);
    const finalThroughput = await boss.get('/api/admin/throughput?from=2020-01-01&to=2099-12-31');
    await browser.close();

    record(
      'the database is left exactly as it was found',
      finalCount === baselineTickets
        && finalThroughput.delivered === 0
        && finalThroughput.total_hours === 0,
      `${finalCount} tickets (baseline ${baselineTickets}), ${finalThroughput.delivered} delivered and ${finalThroughput.total_hours} hours left behind`,
    );
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
