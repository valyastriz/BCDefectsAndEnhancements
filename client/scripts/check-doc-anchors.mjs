#!/usr/bin/env node
/**
 * Every anchor link in the documentation set, checked against the headings that
 * actually exist.
 *
 *   node scripts/check-doc-anchors.mjs
 *
 * WHY THIS EXISTS. The documents are the deliverable, and they cross-reference
 * each other heavily — the handoff alone carries over a hundred anchor links.
 * Renaming a heading silently moves its slug and every link to it becomes a dead
 * click that nothing complains about: not the editor, not a build, and not the
 * PDF export, which happily renders a broken link. Two whole parts of the
 * handoff were misnumbered for weeks for exactly that reason.
 *
 * It needs no server, no browser and no database — it reads the markdown. Run it
 * after touching any heading, and before exporting the PDFs.
 *
 * THE SLUG RULES ARE GITHUB'S, deliberately. The documents were written against
 * GitHub's anchors and are read on GitHub, so anything close-but-not-identical
 * here would pass links that a reader finds broken. GitHub lowercases, drops
 * everything that is not a letter/number/mark/space/hyphen/underscore, turns
 * spaces into hyphens, and disambiguates repeats with -1, -2.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// Every file that both HOLDS anchor links and OFFERS anchor targets.
const FILES = [
  'docs/DEVELOPER_HANDOFF.md',
  'docs/USER_MANUAL.md',
  'docs/NEXT_STEPS.md',
  'README.md',
];

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

/** Strip the inline markdown a renderer resolves before it slugs a heading. */
const plainText = (s) =>
  s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

/**
 * Ids a document exposes: its headings, plus explicit `<a id="…">` anchors used
 * to target something that is not a heading (a numbered paragraph, say).
 * Headings inside fenced code are NOT headings — a shell comment starting with
 * `#` would otherwise register as one.
 */
function anchorsOf(markdown) {
  const seen = new Map();
  const ids = new Set();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) ids.add(githubSlug(plainText(m[2]), seen));
  }
  for (const m of markdown.matchAll(/<a\b[^>]*\bid=["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

const bodies = new Map();
const idsByFile = new Map();
for (const rel of FILES) {
  const md = readFileSync(path.join(REPO, rel), 'utf8');
  bodies.set(rel, md);
  idsByFile.set(rel, anchorsOf(md));
}

/** Resolve a link's target file, relative to the document holding the link. */
function resolveTarget(fromRel, href) {
  const [filePart] = href.split('#');
  if (filePart === '') return fromRel;
  const abs = path.resolve(path.dirname(path.join(REPO, fromRel)), filePart);
  const rel = path.relative(REPO, abs).replace(/\\/g, '/');
  return idsByFile.has(rel) ? rel : null;
}

const dead = [];
let checked = 0;

for (const rel of FILES) {
  bodies.get(rel).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (!href.includes('#')) continue;
      if (/^[a-z]+:/i.test(href)) continue; // http:, mailto:, …
      const target = resolveTarget(rel, href);
      if (!target) continue; // points outside the documentation set
      checked++;
      const anchor = href.split('#')[1];
      if (!idsByFile.get(target).has(anchor)) {
        dead.push(`${rel}:${i + 1}  ->  ${href}`);
      }
    }
  });
}

if (dead.length) {
  console.error(`\n  ${dead.length} dead anchor link(s):`);
  for (const d of dead) console.error(`   - ${d}`);
  console.error('\n  Fix the link, or the heading it points at.\n');
  process.exit(1);
}
console.log(`  ${checked} anchor link(s) across ${FILES.length} documents, 0 dead.`);
