"use strict";

/**
 * STARTER STUB — the SINGLE SOURCE OF TRUTH for in-app help documentation.
 *
 * This one module:
 *   - renders the in-app Help page (map these typed blocks to UI components),
 *   - is flattened to feed the AI assistant's how-to tools (see the
 *     grounded-data-assistant skill's helpKnowledge.js, which imports DOC_SECTIONS),
 *   - can seed or cross-link product tours (config/walkthroughs.js).
 *
 * Write each feature's guide ONCE here. Never fork a second copy for the AI or
 * the tours. Block types: heading, subheading, paragraph, steps, list, fields,
 * tip, note, warning, image.
 *
 * Copy into your codebase at a path BOTH the frontend Help page and the backend
 * helpKnowledge.js can import (e.g. a shared data/docContent.js) — record that
 * path in the project's CLAUDE.md.
 *
 * Module format: CommonJS on purpose — a plain-Node CJS backend `require()`s it
 * directly, and frontend bundlers (Next/webpack/Vite) import CJS named exports
 * fine (`import { DOC_SECTIONS } from ...`). If the backend itself is ESM
 * ("type": "module"), convert to `export const DOC_SECTIONS` AND change
 * helpKnowledge.js's require to an import — never keep two copies.
 */

const DOC_SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    audience: 'all',
    blocks: [
      { type: 'paragraph', text: 'A quick overview of the app and where the main features live.' },
      { type: 'subheading', text: 'Where to find it' },
      { type: 'paragraph', text: 'Everything starts from the dashboard — your home screen after signing in.' },
      { type: 'steps', items: [
        'Open the dashboard to see a live snapshot of your account.',
        'Use the main menu on the left to switch between feature areas.',
        'Use the search bar at the top to jump straight to any record.'
      ] },
      { type: 'tip', text: 'You can replay any guided tour or reopen these docs anytime from the help menu.' }
    ]
  },
  {
    id: 'feature-x',
    title: 'Using Feature X',
    audience: 'all',
    blocks: [
      { type: 'paragraph', text: 'Feature X lets you create and manage records of type X.' },
      { type: 'subheading', text: 'Where to find it' },
      { type: 'paragraph', text: 'Open "Feature X" from the main menu.' },
      { type: 'subheading', text: 'Create a record' },
      { type: 'steps', items: [
        'Click the "New" button at the top right.',
        'Fill in the required fields.',
        'Click Save — the record appears in the table with a status.'
      ] },
      { type: 'fields', items: [
        { name: 'Title', desc: 'A short name to identify the record.' },
        { name: 'Status', desc: 'Draft, active, or archived.' }
      ] },
      { type: 'note', text: 'Records are private to your account.' }
    ]
  }
];

module.exports = { DOC_SECTIONS };
