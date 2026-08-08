#!/usr/bin/env node
/**
 * Build the three deliverable documents as PDFs, with every link still a link.
 *
 *   node client/scripts/build-docs-pdf.mjs [--out <dir>] [--keep-html]
 *
 * Markdown -> HTML (marked, GitHub-compatible heading slugs) -> PDF (Playwright
 * Chromium print). Chromium turns `<a href="#slug">` into a real PDF named
 * destination and `<a href="OTHER.pdf">` into a file link, so the contents list
 * and every cross-reference stay clickable in the PDF exactly as they are in
 * the markdown.
 *
 * Anchors are validated BEFORE rendering: a link to a heading that does not
 * exist is a build failure, not a dead link discovered by a reader. Run
 * `verify-docs-pdf.mjs` afterwards to assert the same thing about the produced
 * PDF bytes.
 */
import { chromium } from 'playwright';
import { marked, Marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DOCS = path.join(REPO, 'docs');

const DOCUMENTS = [
  {
    file: 'DEVELOPER_HANDOFF.md',
    title: 'Developer Handoff',
    subtitle: 'How the Service Requests Portal works, and why it works that way',
  },
  {
    file: 'USER_MANUAL.md',
    title: 'User Manual',
    subtitle: 'Everything the portal does, and how to do it',
  },
  {
    file: 'NEXT_STEPS.md',
    title: 'Next Steps',
    subtitle: 'The programme decision',
  },
];

const PRODUCT = 'Service Requests Portal';

/* ------------------------------------------------------------------ *
 * GitHub-compatible heading slugs
 *
 * GitHub lowercases, drops punctuation and symbols (keeping `-` and `_`),
 * turns spaces into hyphens, and disambiguates repeats with -1, -2. The docs
 * were written against those anchors, so this has to match them character for
 * character or the contents list stops working.
 * ------------------------------------------------------------------ */
function githubSlug(text, seen) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M} \-_]/gu, '')
    .replace(/ /g, '-');
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Every heading id a document will have, in order. */
function headingsOf(markdown) {
  const seen = new Map();
  const out = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type !== 'heading') continue;
    const plain = stripTags(marked.parseInline(token.text));
    out.push({ id: githubSlug(plain, seen), depth: token.depth, text: plain });
  }
  return out;
}

/**
 * Every id a document exposes: headings, plus the explicit `<a id="…">` anchors
 * used to target something that is not a heading (a numbered paragraph, say).
 */
function anchorIdsOf(markdown) {
  const ids = new Set(headingsOf(markdown).map((h) => h.id));
  for (const m of markdown.matchAll(/<a\b[^>]*\bid=["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

/* ------------------------------------------------------------------ *
 * Link rewriting
 * ------------------------------------------------------------------ */
const pdfNameFor = (mdFile) => mdFile.replace(/\.md$/i, '.pdf');
const isMarkdownDoc = (href) => DOCUMENTS.some((d) => href === d.file || href.startsWith(`${d.file}#`));

/**
 * `#anchor`            -> left alone (internal jump)
 * `OTHER.md#anchor`    -> `OTHER.pdf#nameddest=anchor` (sibling PDF, and it
 *                        lands on the section — a bare `#anchor` fragment only
 *                        opens the file; `nameddest` is what Acrobat and the
 *                        Chrome viewer actually honour across documents)
 * `handoff/shots/x.png`-> absolute file:// URL so it still opens
 * `https://…`          -> left alone
 */
function rewriteHref(href) {
  if (!href) return href;
  if (href.startsWith('#') || /^[a-z]+:/i.test(href) || href.startsWith('//')) return href;
  if (isMarkdownDoc(href)) {
    const [file, hash] = href.split('#');
    return pdfNameFor(file) + (hash ? `#nameddest=${hash}` : '');
  }
  const target = path.resolve(DOCS, href);
  return fs.existsSync(target) ? pathToFileURL(target).href : href;
}

function renderHtmlBody(markdown) {
  const seen = new Map();
  const renderer = {
    heading(token) {
      const inner = this.parser.parseInline(token.tokens);
      const id = githubSlug(stripTags(inner), seen);
      return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
    },
    link(token) {
      const href = rewriteHref(token.href);
      const title = token.title ? ` title="${token.title}"` : '';
      return `<a href="${href}"${title}>${this.parser.parseInline(token.tokens)}</a>`;
    },
    image(token) {
      const src = rewriteHref(token.href);
      const title = token.title ? ` title="${token.title}"` : '';
      const alt = token.text ? token.text.replace(/"/g, '&quot;') : '';
      return `<figure><img src="${src}" alt="${alt}"${title}>${
        alt ? `<figcaption>${alt}</figcaption>` : ''
      }</figure>`;
    },
  };
  const instance = new Marked({ gfm: true, breaks: false }, { renderer });
  return instance.parse(markdown);
}

/* ------------------------------------------------------------------ *
 * Page styling — print-first: nothing scrolls in a PDF, so anything that
 * would overflow (wide tables, long code lines) has to wrap instead.
 * ------------------------------------------------------------------ */
const STYLES = `
  :root {
    --ink: #14181f;
    --muted: #5a6472;
    --rule: #d7dce4;
    --link: #1d4ed8;
    --code-bg: #f5f7fa;
    --accent: #b3121d;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10.2pt;
    line-height: 1.55;
    color: var(--ink);
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Title page */
  .cover { height: 9.1in; display: flex; flex-direction: column; justify-content: center;
           break-after: page; text-align: left; }
  .cover .eyebrow { font-size: 11pt; letter-spacing: .14em; text-transform: uppercase;
                    color: var(--accent); font-weight: 700; margin-bottom: .35in; }
  .cover h1.cover-title { font-size: 34pt; line-height: 1.15; margin: 0 0 .18in; border: 0; padding: 0; }
  .cover .subtitle { font-size: 14pt; color: var(--muted); margin: 0 0 .5in; max-width: 5.6in; }
  .cover .meta { font-size: 9.5pt; color: var(--muted); border-top: 2px solid var(--rule);
                 padding-top: .16in; }
  .cover .meta strong { color: var(--ink); }

  h1, h2, h3, h4, h5, h6 { line-height: 1.25; break-after: avoid; break-inside: avoid; font-weight: 700; }
  h1 { font-size: 21pt; margin: 0 0 .18in; padding-bottom: .07in; border-bottom: 2px solid var(--rule);
       break-before: page; }
  h2 { font-size: 16pt; margin: .34in 0 .12in; padding-bottom: .05in; border-bottom: 1px solid var(--rule);
       break-before: page; }

  /* Pagination: a part divider (h1) opens a page, and the numbered section (h2)
     that follows it shares that page — otherwise the divider is left stranded at
     the foot of the contents list and the section title gets a page of its own.
     The document's own title h1 follows the cover, which already broke. */
  .cover + h1 { break-before: auto; }
  h1 + h2 { break-before: auto; }
  h3 { font-size: 12.6pt; margin: .26in 0 .08in; }
  h4 { font-size: 11pt; margin: .2in 0 .06in; }
  h5, h6 { font-size: 10.2pt; margin: .18in 0 .05in; color: var(--muted); }

  p, ul, ol, blockquote, table, pre, figure { margin: 0 0 .13in; }
  ul, ol { padding-left: .26in; }
  li { margin: .03in 0; }
  li > ul, li > ol { margin: .03in 0; }

  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }

  strong { font-weight: 700; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: .22in 0; }

  code, kbd, samp {
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: .88em;
    background: var(--code-bg);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: .5pt 3pt;
    overflow-wrap: anywhere;
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--accent);
    border-radius: 4px;
    padding: 7pt 9pt;
    font-size: 8.6pt;
    line-height: 1.42;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    break-inside: avoid;
  }
  pre code { background: none; border: 0; padding: 0; font-size: inherit; }

  blockquote {
    border-left: 3px solid var(--accent);
    background: #fbf6f6;
    padding: 6pt 10pt;
    color: #3a424e;
    break-inside: avoid;
  }
  blockquote > :last-child { margin-bottom: 0; }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 8.7pt;
    table-layout: auto;
    break-inside: auto;
  }
  th, td {
    border: 1px solid var(--rule);
    padding: 3.5pt 5pt;
    text-align: left;
    vertical-align: top;
    /* break-word, NOT anywhere: both wrap a word too long for its line, but
       anywhere also counts mid-word breaks when the browser computes a column's
       min-content width, so auto table layout shrinks a narrow first column
       until ordinary words split ("Submiss / ion"). break-word leaves
       min-content alone, so the column stays as wide as its longest word. */
    overflow-wrap: break-word;
  }
  th { background: #eef1f6; font-weight: 700; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  table code { font-size: .92em; padding: 0 2pt; }

  figure { margin: .16in 0; break-inside: avoid; text-align: center; }
  img { max-width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 4px; }
  figcaption { font-size: 8.4pt; color: var(--muted); margin-top: 4pt; font-style: italic; }

  /* The "Contents" lists in these docs are paragraphs of separated links. */
  h2[id="contents"] + p, h2[id="contents"] ~ p { orphans: 3; widows: 3; }
`;

function documentHtml(doc, bodyHtml, generatedOn) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${doc.title}</title>
<style>${STYLES}</style></head>
<body>
<section class="cover">
  <div class="eyebrow">${PRODUCT}</div>
  <h1 class="cover-title">${doc.title}</h1>
  <p class="subtitle">${doc.subtitle}</p>
  <div class="meta">
    Generated <strong>${generatedOn}</strong> from <strong>docs/${doc.file}</strong>.<br>
    The contents list and every cross-reference in this PDF are clickable.
  </div>
</section>
${bodyHtml}
</body></html>`;
}

const footerTemplate = (label) => `
<div style="width:100%;font-size:7.5pt;color:#5a6472;padding:0 .62in;
            font-family:'Segoe UI',Arial,sans-serif;display:flex;justify-content:space-between;">
  <span>${label}</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;

/* ------------------------------------------------------------------ */
async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(DOCS, 'pdf');
  const keepHtml = argv.includes('--keep-html');

  fs.mkdirSync(outDir, { recursive: true });

  const sources = DOCUMENTS.map((doc) => ({
    ...doc,
    markdown: fs.readFileSync(path.join(DOCS, doc.file), 'utf8'),
  }));

  // ---- Validate every anchor before rendering anything -------------
  const idsByFile = new Map(sources.map((s) => [s.file, anchorIdsOf(s.markdown)]));
  const dangling = [];
  for (const src of sources) {
    const lines = src.markdown.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (!href.includes('#')) continue;
        if (/^[a-z]+:/i.test(href)) continue;
        const [file, anchor] = href.split('#');
        const targetFile = file === '' ? src.file : file;
        const ids = idsByFile.get(targetFile);
        if (!ids) continue; // link into something that is not one of the three docs
        if (!ids.has(anchor)) dangling.push(`${src.file}:${i + 1}  ->  ${href}`);
      }
    });
  }
  if (dangling.length) {
    console.error(`\n  ${dangling.length} link(s) point at a heading that does not exist:`);
    for (const d of dangling) console.error(`   - ${d}`);
    console.error('\n  Fix the markdown (or the heading) — these would be dead links in the PDF.\n');
    process.exitCode = 1;
    return;
  }
  const totalAnchors = sources.reduce(
    (n, s) => n + [...s.markdown.matchAll(/\]\((#|[^)\s]*\.md#)[^)\s]*\)/g)].length,
    0,
  );
  console.log(`  anchors validated: ${totalAnchors} link(s), 0 dangling`);

  // ---- Render ------------------------------------------------------
  const generatedOn = new Date().toISOString().slice(0, 10);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const doc of sources) {
      const htmlPath = path.join(outDir, `.${doc.file.replace(/\.md$/, '')}.build.html`);
      fs.writeFileSync(htmlPath, documentHtml(doc, renderHtmlBody(doc.markdown), generatedOn), 'utf8');

      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      // Screenshots are large local PNGs; make sure decoding finished.
      await page.evaluate(() =>
        Promise.all(Array.from(document.images).filter((i) => !i.complete).map((i) =>
          new Promise((res) => { i.addEventListener('load', res); i.addEventListener('error', res); }))));

      const pdfPath = path.join(outDir, pdfNameFor(doc.file));
      await page.pdf({
        path: pdfPath,
        format: 'Letter',
        printBackground: true,
        tagged: true,
        outline: true,
        margin: { top: '0.6in', bottom: '0.6in', left: '0.62in', right: '0.62in' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: footerTemplate(`${PRODUCT} — ${doc.title}`),
      });
      await page.close();
      if (!keepHtml) fs.unlinkSync(htmlPath);

      const mb = (fs.statSync(pdfPath).size / 1024 / 1024).toFixed(1);
      results.push({ file: pdfNameFor(doc.file), mb });
      console.log(`  wrote ${path.relative(REPO, pdfPath).replace(/\\/g, '/')}  (${mb} MB)`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n  ${results.length} PDF(s) in ${path.relative(REPO, outDir).replace(/\\/g, '/')}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
