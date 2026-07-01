const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The `public-watchers` socket room includes unauthenticated clients, so every
// payload broadcast to it must go through the mapPublicSubmission allow-list —
// the same guarantee mapPublicSubmission gives the public REST endpoints.
// Regression guard for the leak where emitPublicUpdate was handed the full
// internal row via mapSubmission.

const SRC_DIR = path.join(__dirname, '..', 'src');

function collectJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('every emitPublicUpdate call site wraps its payload in mapPublicSubmission', () => {
  const callSites = [];
  for (const file of collectJsFiles(SRC_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    const regex = /emitPublicUpdate\s*\(\s*([A-Za-z0-9_.$]*)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Skip the function definition itself (socket.js).
      const preceding = text.slice(Math.max(0, match.index - 20), match.index);
      if (/function\s+$/.test(preceding)) continue;
      callSites.push({ file: path.relative(SRC_DIR, file), arg: match[1] });
    }
  }
  assert.ok(callSites.length > 0, 'expected at least one emitPublicUpdate call site');
  for (const site of callSites) {
    assert.strictEqual(
      site.arg,
      'mapPublicSubmission',
      `emitPublicUpdate in ${site.file} must wrap its payload in mapPublicSubmission(...) — `
      + 'the public-watchers room includes unauthenticated sockets',
    );
  }
});
