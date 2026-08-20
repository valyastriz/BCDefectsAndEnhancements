/**
 * Every image the docs point at must exist, and every shot taken must be used.
 *
 * Cheap, and it closes a real gap: `capture-screenshots.mjs` reports what it
 * could not take, but nothing checked whether the MANUAL was pointing at a
 * picture that was never produced. A run where four shots failed left four
 * `![...]` links resolving to nothing, and a reader meets a broken image where
 * the explanation should be.
 *
 * Three checks, and the third is the one that catches a half-finished feature:
 *   1. every image referenced by a doc exists on disk
 *   2. every reference resolves to a file the manifest claims was taken
 *   3. every shot in the manifest is referenced by at least one doc — a picture
 *      nobody links to is either a gap in the manual or a shot to delete
 *
 * Usage:  node scripts/check-doc-images.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DOCS = path.resolve(HERE, '../../docs');
const SHOTS_DIR = path.join(DOCS, 'handoff/screenshots');
const MANIFEST = path.join(DOCS, 'handoff/screenshot-manifest.json');

const DOC_FILES = ['USER_MANUAL.md', 'DEVELOPER_HANDOFF.md', 'NEXT_STEPS.md'];

const problems = [];
const referenced = new Set();

for (const name of DOC_FILES) {
  const full = path.join(DOCS, name);
  if (!existsSync(full)) {
    problems.push(`${name}: missing entirely`);
    continue;
  }
  const text = readFileSync(full, 'utf8');
  // Markdown image links pointing into the screenshots folder.
  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]*handoff\/screenshots\/[^)]+)\)/g)) {
    const rel = match[1].trim();
    const file = path.basename(rel);
    referenced.add(file);
    if (!existsSync(path.join(DOCS, rel))) {
      problems.push(`${name}: references ${file}, which does not exist`);
    }
  }
}

// The manifest is an OUTPUT of the capture run, so it is the record of what the
// browser actually produced — a reference to something absent from it is a
// reference to a picture nobody took.
let manifestFiles = new Set();
if (existsSync(MANIFEST)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const entries = manifest.screenshots || manifest.entries || [];
  manifestFiles = new Set(entries.map((entry) => entry.file).filter(Boolean));
  for (const file of referenced) {
    if (!manifestFiles.has(file)) {
      problems.push(`${file} is referenced by a doc but is not in the manifest — was it actually taken?`);
    }
  }
  for (const file of manifestFiles) {
    if (!referenced.has(file)) {
      problems.push(`${file} was taken but no doc uses it`);
    }
  }
} else {
  problems.push('screenshot-manifest.json is missing — run capture-screenshots.mjs');
}

// Leftover debug captures from a failed run should never be committed.
if (existsSync(SHOTS_DIR)) {
  for (const file of readdirSync(SHOTS_DIR)) {
    if (file.startsWith('_failed-')) problems.push(`${file}: leftover failure capture, delete it`);
  }
}

console.log(`${referenced.size} image reference(s) across ${DOC_FILES.length} docs`);
console.log(`${manifestFiles.size} shot(s) in the manifest`);

if (problems.length === 0) {
  console.log('\nAll good: every reference resolves, and every shot is used.');
} else {
  console.log(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
}
