#!/usr/bin/env node
/**
 * The documentation set is written in US English. This proves it.
 *
 *   node scripts/check-doc-spelling.mjs
 *
 * WHY THIS EXISTS. Converting the docs to US spelling was declared finished four
 * times and was wrong three of them, because each pass searched a hand-written
 * list of British words and a list can only find the inflections its author
 * thought of. The rounds it missed, in order: prefixes and plurals
 * (`unrecognised`, `defences`), every `-our` word (`honour`, `labour`, `flavour`
 * — 19 of them), the `-ise` stragglers (`sanitised`, `serialisation`,
 * `vectorised`), and finally `greyed` and `judgement`, whose families nothing had
 * looked at.
 *
 * So this does NOT enumerate British words. It matches every FAMILY of
 * British/American divergence as a pattern and subtracts an allow-list of words
 * that are identical in both spellings. A checker that can only see what you
 * listed will always report clean.
 *
 * Inline `code` spans and fenced blocks are skipped: column names, env vars,
 * status values and CSS properties are not prose and must not be rewritten.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const FILES = [
  'docs/DEVELOPER_HANDOFF.md',
  'docs/USER_MANUAL.md',
  'docs/NEXT_STEPS.md',
  'README.md',
  'CLAUDE.md',
];

/**
 * Words that match a family below but are correct American English. Every entry
 * is here because it was a false positive, not on suspicion.
 */
const SAME_IN_BOTH = new Set(
  `advise advised advises advising otherwise likewise wise precise concise promise
   promised promises promising raise raised raises raising surprise surprised
   surprising exercise exercises exercised franchise supervise supervised supervises
   revise revised revises compromise compromised compromises expertise merchandise
   premise premises enterprise disguise rise rises rising arise arises arising
   comprise comprised comprises devise devised noise paradise treatise guise demise
   excise incise apprise
   our four hour hours tour tours your yours pour poured pours
   metre
   service services serviced office offices notice noticed notices practice
   practices choice choices voice voices invoice invoices twice price prices priced
   device devices
   analogue league colleague colleagues plague vague dialogue
   call called calls install installed installing installs full fully until still
   skill skills bill billing fill filled fills tell telling well`
    .trim()
    .split(/\s+/),
);

const FAMILIES = {
  '-ise / -isation': /\b[a-z]+(?:ise|ised|ises|ising|isation|isations)\b/gi,
  '-yse': /\b[a-z]+(?:yse|ysed|yses|ysing)\b/gi,
  // Anchored at the END, so `fourth`, `fourteen` and `yourself` — which merely
  // CONTAIN "our" — are not reported. The suffixes keep `favourite` and
  // `neighbourhood` in scope, which a bare -our$ would miss.
  '-our': /\b[a-z]+our(?:s|ed|ing|ite|ites|able|ful|ly|hood|ism)?\b/gi,
  '-re': /\b(?:metres|centre|centres|centred|litre|litres|fibre|fibres|theatre|calibre|sombre|spectre|lustre|manoeuvre)\b/gi,
  '-ce': /\b(?:defence|defences|offence|offences|pretence|licence|licences|practise|practised|practising)\b/gi,
  '-ogue': /\b(?:catalogue|catalogues|catalogued|monologue|epilogue|prologue)\b/gi,
  'doubled -l-': /\b(?:travelling|travelled|traveller|cancelling|cancelled|labelling|labelled|modelling|modelled|signalling|signalled|totalling|totalled|fuelling|fuelled|marvellous|counsellor|levelling|levelled|dialling|dialled)\b/gi,
  'single -l-': /\b(?:fulfil|fulfils|fulfilment|enrol|enrols|enrolment|instal|instals|instalment|skilful|wilful|appal|appals|distil|instil|annul)\b/gi,
  '-mme': /\b(?:programme|programmes|programmed)\b/gi,
  'ae / oe': /\b(?:encyclopaedia|paediatric|foetus|oestrogen|anaemia|archaeology)\b/gi,
  '-t preterite': /\b(?:learnt|spelt|burnt|dreamt|leapt|spilt)\b/gi,
  '-gement': /\b(?:judgement|judgements|acknowledgement|acknowledgements|abridgement|lodgement)\b/gi,
  'grey': /\b(?:grey|greyed|greyish)\b/gi,
  misc: /\b(?:ageing|whilst|amongst|sceptic|sceptical|scepticism|storey|storeys|tyre|tyres|kerb|kerbs|plough|draught|draughts|aluminium|mould|moulded|smoulder|gaol|jewellery|cheque|cheques|aeroplane|behove|orientated|speciality|specialities)\b/gi,
};

const found = [];
for (const rel of FILES) {
  const lines = readFileSync(path.join(REPO, rel), 'utf8').split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const prose = line.replace(/`[^`]*`/g, ' ');
    for (const [family, re] of Object.entries(FAMILIES)) {
      re.lastIndex = 0;
      for (const m of prose.matchAll(re)) {
        if (SAME_IN_BOTH.has(m[0].toLowerCase())) continue;
        found.push(`${rel}:${i + 1}  [${family}]  ${m[0]}`);
      }
    }
  });
}

if (found.length) {
  console.error(`\n  ${found.length} British spelling(s) in prose:`);
  for (const f of found) console.error(`   - ${f}`);
  console.error(
    '\n  Fix them, or add the word to SAME_IN_BOTH if it is correct US English.\n',
  );
  process.exit(1);
}
console.log(`  ${FILES.length} documents, 0 British spellings in prose.`);
