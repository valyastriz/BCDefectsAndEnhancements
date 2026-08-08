#!/usr/bin/env node
/**
 * Prove the generated documentation PDFs are actually navigable.
 *
 *   node client/scripts/verify-docs-pdf.mjs [--out <dir>]
 *
 * Asserts what a reader would otherwise have to discover by clicking:
 *
 *   1. Every internal link annotation resolves to a destination that exists in
 *      the same PDF — a contents entry that lands nowhere is the exact failure
 *      this whole exercise is meant to avoid.
 *   2. Every cross-document link points at a sibling PDF that exists, and its
 *      `nameddest` exists in that PDF.
 *   3. Every `#anchor` link present in the markdown survived into the PDF, by
 *      count — so a silently dropped link is caught.
 *   4. Bookmarks (the PDF outline) are present.
 *   5. Nothing overflows the printable page width: tables and code blocks wrap
 *      instead of being sheared off at the right margin, which a PDF cannot
 *      scroll to reveal.
 *
 * Requires the PDFs to have been built first (build-docs-pdf.mjs).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DOCS = path.join(REPO, 'docs');

const DOCUMENTS = [
  { md: 'DEVELOPER_HANDOFF.md', pdf: 'DEVELOPER_HANDOFF.pdf' },
  { md: 'USER_MANUAL.md', pdf: 'USER_MANUAL.pdf' },
  { md: 'NEXT_STEPS.md', pdf: 'NEXT_STEPS.pdf' },
];

/** Letter, minus the 0.62in side margins the build uses, at 96dpi. */
const CONTENT_WIDTH_PX = Math.round((8.5 - 0.62 * 2) * 96);

const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

async function loadPdf(pdfjs, file) {
  const data = new Uint8Array(fs.readFileSync(file));
  return pdfjs.getDocument({ data, useSystemFonts: false, verbosity: 0 }).promise;
}

/**
 * Resolve a named destination to a 1-based page number, or null if the name
 * does not exist in that document.
 *
 * Note: `doc.getDestinations()` returns {} for Chromium-produced PDFs — it
 * stores destinations in a name tree the bulk enumerator does not walk — so
 * every check here goes through the per-name lookup, which does resolve.
 */
async function destPage(doc, name, cache) {
  if (cache.has(name)) return cache.get(name);
  let page = null;
  try {
    const dest = await doc.getDestination(name);
    if (Array.isArray(dest) && dest[0] && typeof dest[0] === 'object' && 'num' in dest[0]) {
      page = (await doc.getPageIndex(dest[0])) + 1;
    } else if (dest) {
      page = 0; // resolves, but not to a page reference we can number
    }
  } catch {
    page = null;
  }
  cache.set(name, page);
  return page;
}

async function collectLinks(doc) {
  const links = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    for (const a of await page.getAnnotations()) {
      if (a.subtype === 'Link') links.push({ page: i, dest: a.dest, url: a.unsafeUrl ?? a.url });
    }
  }
  return links;
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(DOCS, 'pdf');

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Open every document up front, so cross-document links can be checked
  // against the real target rather than assumed good.
  const docsByPdf = new Map();
  const destCaches = new Map();
  for (const d of DOCUMENTS) {
    const file = path.join(outDir, d.pdf);
    if (!fs.existsSync(file)) {
      fail(`${d.pdf} was not built`);
      continue;
    }
    docsByPdf.set(d.pdf, await loadPdf(pdfjs, file));
    destCaches.set(d.pdf, new Map());
  }
  if (failures.length) {
    console.log('\n  Build the PDFs first: node client/scripts/build-docs-pdf.mjs\n');
    process.exit(1);
  }

  for (const d of DOCUMENTS) {
    console.log(`\n${d.pdf}`);
    const doc = docsByPdf.get(d.pdf);
    const cache = destCaches.get(d.pdf);
    const links = await collectLinks(doc);

    const internal = links.filter((l) => typeof l.dest === 'string');
    const external = links.filter((l) => !l.dest && l.url);

    console.log(`  ${doc.numPages} pages, ${links.length} link annotations ` +
                `(${internal.length} internal, ${external.length} external)`);

    // 1. internal destinations resolve, and land somewhere real
    const broken = [];
    const landings = new Set();
    for (const l of internal) {
      const page = await destPage(doc, l.dest, cache);
      if (page === null) broken.push(l);
      else landings.add(page);
    }
    if (broken.length) {
      for (const b of broken.slice(0, 10)) fail(`internal link on page ${b.page} -> "${b.dest}" has no destination`);
      if (broken.length > 10) fail(`…and ${broken.length - 10} more broken internal links`);
    } else {
      pass(`all ${internal.length} internal links resolve to a real destination`);
    }
    // A contents list whose entries all land on one page is broken in practice
    // even though every individual link "resolves".
    if (internal.length >= 5 && landings.size < 2) {
      fail(`every internal link lands on the same page (${[...landings]}) — navigation is not working`);
    } else if (internal.length >= 5) {
      pass(`those links land across ${landings.size} distinct pages`);
    }

    // 2. cross-document links land on a real section of a real file
    const crossDoc = external.filter((l) => l.url.startsWith('file:') && /\.pdf(#|$)/i.test(l.url));
    let crossOk = 0;
    for (const l of crossDoc) {
      const [rawPath, frag] = l.url.split('#');
      const target = fileURLToPath(rawPath);
      const name = path.basename(target);
      if (!fs.existsSync(target)) { fail(`cross-doc link on page ${l.page} -> missing file ${name}`); continue; }
      if (frag) {
        if (!frag.startsWith('nameddest=')) {
          fail(`cross-doc link on page ${l.page} -> "#${frag}" is a bare fragment; viewers will open the file but not jump`);
          continue;
        }
        const destName = frag.slice('nameddest='.length);
        const targetDoc = docsByPdf.get(name);
        if (!targetDoc) { fail(`cross-doc link on page ${l.page} -> ${name} is not one of the built documents`); continue; }
        if ((await destPage(targetDoc, destName, destCaches.get(name))) === null) {
          fail(`cross-doc link on page ${l.page} -> ${name}#${destName} has no such destination`);
          continue;
        }
      }
      crossOk++;
    }
    if (crossDoc.length) pass(`${crossOk}/${crossDoc.length} cross-document links open the right section of the right file`);

    // 3. nothing from the markdown got dropped
    const markdown = fs.readFileSync(path.join(DOCS, d.md), 'utf8');
    const mdAnchors = [...markdown.matchAll(/\]\(#[^)\s]+\)/g)].length;
    if (internal.length < mdAnchors) {
      fail(`markdown has ${mdAnchors} same-document anchor links but the PDF only has ${internal.length}`);
    } else {
      pass(`all ${mdAnchors} markdown anchor links survived into the PDF`);
    }

    // 4. bookmarks
    const outline = await doc.getOutline();
    const countOutline = (nodes) =>
      (nodes ?? []).reduce((n, o) => n + 1 + countOutline(o.items), 0);
    const bookmarks = countOutline(outline);
    if (bookmarks < 2) fail(`only ${bookmarks} PDF bookmark(s) — the outline sidebar will be useless`);
    else pass(`${bookmarks} PDF bookmarks for the sidebar`);
  }

  // 5. overflow: re-render the HTML at the printable width and measure
  console.log('\nprintable-width overflow');
  const browser = await chromium.launch();
  try {
    for (const d of DOCUMENTS) {
      const htmlPath = path.join(outDir, `.${d.md.replace(/\.md$/, '')}.build.html`);
      if (!fs.existsSync(htmlPath)) {
        console.log(`  skip  ${d.md} (re-run the build with --keep-html to check overflow)`);
        continue;
      }
      const page = await browser.newPage({ viewport: { width: CONTENT_WIDTH_PX, height: 1000 } });
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      const over = await page.evaluate((limit) => {
        const bad = [];
        for (const el of document.querySelectorAll('table, pre, figure, img, p, h1, h2, h3, h4')) {
          const w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
          if (w > limit + 1) {
            bad.push({ tag: el.tagName.toLowerCase(), width: Math.round(w),
                       text: (el.textContent || '').trim().slice(0, 60) });
          }
        }
        return bad;
      }, CONTENT_WIDTH_PX);
      await page.close();
      if (over.length) {
        for (const o of over.slice(0, 6)) fail(`${d.pdf}: <${o.tag}> is ${o.width}px wide (max ${CONTENT_WIDTH_PX}) — "${o.text}"`);
        if (over.length > 6) fail(`${d.pdf}: …and ${over.length - 6} more overflowing elements`);
      } else {
        pass(`${d.pdf}: nothing exceeds the ${CONTENT_WIDTH_PX}px printable width`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(
    failures.length
      ? `\n  ${failures.length} check(s) failed.\n`
      : '\n  All checks passed — the PDFs are navigable.\n',
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
