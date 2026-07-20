/**
 * STARTER STUB — the walkthrough registry: the SINGLE SOURCE OF TRUTH for which
 * guided tours exist. Append an object here to add a tour; no per-page tour code.
 *
 * Each step NAVIGATES to a real screen (`route`) and spotlights a real on-screen
 * element (`target` = a stable `data-tour` selector) while explaining it. Steps
 * that point at a concrete element always carry a `target`; intro/concept/detail
 * steps (no known element) use `placement: 'center'` and descriptive wording.
 * When a target isn't on screen, the overlay falls back to a centered card.
 *
 * `featureKey` (optional) gates a tour behind a feature toggle.
 * Each message has an `*Id` (i18n id) and an English `*Default` fallback.
 *
 * Copy into your frontend (e.g. config/walkthroughs.js).
 */

export const WELCOME_SEEN_KEY = '_welcomeSeen';

export const WALKTHROUGHS = [
  {
    key: 'getting_started',
    titleId: 'wt-getting-started-title',
    titleDefault: 'Getting started',
    descId: 'wt-getting-started-desc',
    descDefault: 'A quick tour of where everything lives.',
    steps: [
      {
        placement: 'center', // intro step — no element to highlight
        route: '/dashboard',
        titleId: 'wt-gs-s1-title',
        titleDefault: 'Welcome',
        bodyId: 'wt-gs-s1-body',
        bodyDefault:
          'This is your home base. This quick tour shows you around; you can skip anytime and replay any tour later from the help menu.'
      },
      {
        target: '[data-tour="nav-primary"]', // highlights a real element
        route: '/dashboard',
        titleId: 'wt-gs-s2-title',
        titleDefault: 'The main menu',
        bodyId: 'wt-gs-s2-body',
        bodyDefault: 'Everything is grouped here. Click any item and the work area changes to match.'
      },
      {
        target: '[data-tour="app-search"]',
        route: '/dashboard',
        titleId: 'wt-gs-s3-title',
        titleDefault: 'Search anything',
        bodyId: 'wt-gs-s3-body',
        bodyDefault: 'The search bar searches your whole account at once — jump straight to any record by name.'
      }
    ]
  },
  {
    key: 'feature_x',
    featureKey: 'feature_x', // OPTIONAL — only shown when this feature is enabled
    titleId: 'wt-featurex-title',
    titleDefault: 'Using Feature X',
    descId: 'wt-featurex-desc',
    descDefault: 'How to get the most out of Feature X.',
    steps: [
      {
        target: '[data-tour="featurex-new"]',
        route: '/feature-x',
        titleId: 'wt-fx-s1-title',
        titleDefault: 'Create one',
        bodyId: 'wt-fx-s1-body',
        bodyDefault: 'Use this button to create a new record. Fill in the essentials and save.'
      },
      {
        target: '[data-tour="featurex-table"]',
        route: '/feature-x',
        titleId: 'wt-fx-s2-title',
        titleDefault: 'See them all',
        bodyId: 'wt-fx-s2-body',
        bodyDefault: 'Every record lives here with a status. Click a row to open it.'
      }
    ]
  }
];

export const WALKTHROUGH_KEYS = WALKTHROUGHS.map((w) => w.key);

/** Look up a walkthrough by its key. */
export function getWalkthrough(key) {
  return WALKTHROUGHS.find((w) => w.key === key) || null;
}
