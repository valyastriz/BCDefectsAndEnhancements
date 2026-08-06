// The approval-evidence upload filter.
//
// Uploads were image-only on purpose: the filter existed so that arbitrary
// content "cannot be stored and later served same-origin from /uploads"
// (src/middleware/upload.js). Widening it for approval documents is only safe
// because those files never reach that path — but the filter still has to refuse
// the types that can execute, and it has to refuse them however they are
// disguised. That is what this file checks.
const test = require('node:test');
const assert = require('node:assert/strict');

const { approvalFileFilter } = require('../src/middleware/upload');

/** Run the filter and report what it decided. */
function judge(originalname, mimetype) {
  let verdict;
  approvalFileFilter({}, { originalname, mimetype }, (error, accepted) => {
    verdict = error ? { rejected: true, message: error.message, status: error.status } : { accepted };
  });
  return verdict;
}

test('accepts the shapes an approval actually arrives in', () => {
  const cases = [
    ['signoff.pdf', 'application/pdf'],
    ['RE approved.msg', 'application/vnd.ms-outlook'],
    ['RE approved.msg', 'application/octet-stream'],
    ['approval.eml', 'message/rfc822'],
    ['sign-off.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['screenshot.png', 'image/png'],
    ['photo.HEIC', 'image/heic'],
  ];
  for (const [name, mime] of cases) {
    assert.deepEqual(judge(name, mime), { accepted: true }, `${name} (${mime})`);
  }
});

test('refuses the types that can execute in the origin', () => {
  // These are exactly what the image-only filter was protecting against. An SVG
  // is a script container; HTML and XML are worse.
  for (const [name, mime] of [
    ['approval.svg', 'image/svg+xml'],
    ['approval.html', 'text/html'],
    ['approval.htm', 'text/html'],
    ['approval.xhtml', 'application/xhtml+xml'],
    ['approval.xml', 'application/xml'],
    ['payload.js', 'text/javascript'],
    ['run.exe', 'application/octet-stream'],
    ['macro.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
  ]) {
    const verdict = judge(name, mime);
    assert.equal(verdict.rejected, true, `${name} must be refused`);
    assert.equal(verdict.status, 400);
  }
});

test('an allowed extension does not excuse a mismatched type', () => {
  // The double-extension trick: `approval.svg.pdf` has extname '.pdf', so an
  // extension-only check would wave it through. The browser reports the real
  // mime type, and both have to agree.
  const verdict = judge('approval.svg.pdf', 'image/svg+xml');
  assert.equal(verdict.rejected, true);
  assert.match(verdict.message, /does not look like a PDF file/);
});

test('and an allowed type does not excuse a denied extension', () => {
  // The mirror image: claim application/pdf on a .svg.
  assert.equal(judge('approval.pdf.svg', 'application/pdf').rejected, true);
});

test('a file with no name or no type is refused rather than guessed at', () => {
  assert.equal(judge('', '').rejected, true);
  assert.equal(judge('approval.pdf', '').rejected, true, 'no mime type is not a pass');
  assert.equal(judge('noextension', 'application/pdf').rejected, true);
});

test('the refusal says what IS accepted', () => {
  // A rejection an analyst cannot act on just becomes a support ticket.
  const verdict = judge('approval.svg', 'image/svg+xml');
  assert.match(verdict.message, /PDF, Word or Excel file, an Outlook message, or an image/);
});

test('a parameterised mime type still matches', () => {
  // Browsers send `text/plain; charset=utf-8` for a .txt, and the parameter is
  // not part of the type.
  assert.deepEqual(judge('notes.txt', 'text/plain; charset=utf-8'), { accepted: true });
});
