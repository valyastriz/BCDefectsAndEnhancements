/**
 * Per-container horizontal-overflow probe, for use with page.evaluate().
 *
 * Why per-container and not `document.scrollWidth > innerWidth`: overflow that an
 * `overflow: hidden` ancestor clips does not widen the document at all. The
 * right-hand gutter simply vanishes and the page looks fine. Every layout defect
 * of that class found in this project was invisible to a document-level check.
 *
 * What it deliberately does NOT report:
 *  - containers that are MEANT to scroll sideways (`overflow-x: auto|scroll`);
 *  - visually-hidden elements and everything inside them — a `clip: rect(0 0 0 0)`
 *    screen-reader label holds content far wider than its 1px box by design, and
 *    so do its children;
 *  - form controls, which scroll their own value. A text input holding more
 *    characters than fit is not a layout defect;
 *  - overflow a descendant's NEGATIVE horizontal margin accounts for. A full-bleed
 *    band (`margin: 0 -24px`, cancelling a wrapper's padding so the band reaches
 *    the screen edge — see `.rs-stickybar` in index.css) is meant to stick out, and
 *    it makes every ancestor up to the clipping element measure wide. The
 *    allowance therefore propagates upward, or the finding just moves one level up
 *    the tree each time it is excused;
 *  - ancestors of a genuine offender. Only the deepest element in a chain is
 *    reported, because an overflowing child makes every parent overflow too.
 */
export const OVERFLOW_PROBE = (selector) => {
  const root = document.querySelector(selector);
  if (!root) return [{ error: `no element matches ${selector}` }];

  const SELF_SCROLLING_TAGS = new Set(['input', 'textarea', 'select']);

  const isScreenReaderOnly = (el, style) => (
    style.clip === 'rect(0px, 0px, 0px, 0px)'
    || (el.clientWidth <= 1 && el.clientHeight <= 1)
  );

  /** How far this element deliberately sticks out of its own parent. */
  const ownBleed = (style) => {
    const left = Math.max(0, -(Number.parseFloat(style.marginLeft) || 0));
    const right = Math.max(0, -(Number.parseFloat(style.marginRight) || 0));
    return left + right;
  };

  const offenders = [];

  /** Returns { overflowed, bleed } — `bleed` is what this subtree excuses above it. */
  const walk = (el, insideHidden) => {
    const style = getComputedStyle(el);
    const hidden = insideHidden || isScreenReaderOnly(el, style);

    let childOverflowed = false;
    let inheritedBleed = 0;
    for (const child of el.children) {
      const result = walk(child, hidden);
      if (result.overflowed) childOverflowed = true;
      inheritedBleed = Math.max(inheritedBleed, result.bleed);
    }

    const intentional = style.overflowX === 'auto' || style.overflowX === 'scroll';
    const selfScrolling = SELF_SCROLLING_TAGS.has(el.tagName.toLowerCase());
    const excess = el.scrollWidth - el.clientWidth;
    const overflows = excess > 1
      && excess > inheritedBleed
      && !intentional
      && !selfScrolling
      && !hidden;

    if (overflows && !childOverflowed) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString?.().slice(0, 80) || '',
        id: el.id || undefined,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: style.overflowX,
      });
    }

    // A container that clips does not pass a bleed on to its own parent.
    const clips = intentional || style.overflowX === 'hidden' || style.overflowX === 'clip';
    return {
      overflowed: overflows,
      bleed: clips ? 0 : Math.max(ownBleed(style), inheritedBleed),
    };
  };

  walk(root, false);
  return offenders;
};
