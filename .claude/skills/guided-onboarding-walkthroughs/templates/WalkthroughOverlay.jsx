'use client';

/**
 * STARTER STUB — the overlay renderer. Reads the active step, navigates to its
 * `route`, locates the `target` element, and renders a spotlight + explanatory
 * card with next/back/skip controls — falling back to a centered card when the
 * target is absent. Keep this renderer DUMB: all "which step / what's next" logic
 * lives in WalkthroughContext.
 *
 * Built-in behavior this template guarantees (keep these when restyling):
 * - card is CLAMPED inside the viewport; on narrow screens it renders as a
 *   full-width bottom sheet instead of an anchored card
 * - target is re-measured on BOTH scroll and resize (spotlight tracks the page)
 * - target lookup retries for several seconds so lazy-loaded routes can mount
 *   before falling back to the centered card
 * - theme-token styling (works in light AND dark mode), dialog aria roles,
 *   Esc to exit, keyboard-reachable controls
 *
 * Copy into your frontend (e.g. components/walkthrough/WalkthroughOverlay.jsx)
 * and lazy-load it (next/dynamic) so tours don't weigh down the main bundle.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FormattedMessage } from 'react-intl';
import { Box, Button, Paper, Typography, useMediaQuery, useTheme } from '@mui/material';

import { useWalkthrough } from 'contexts/WalkthroughContext';

const PADDING = 8;
const CARD_WIDTH = 340;
const RETRY_MS = 5000; // keep retrying while lazy routes mount

export default function WalkthroughOverlay() {
  const { active, stepIndex, next, back, skip, finish } = useWalkthrough();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const isNarrow = useMediaQuery('(max-width:600px)');
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);

  const step = active?.steps?.[stepIndex] || null;
  const isLast = active ? stepIndex === active.steps.length - 1 : false;

  // Navigate to the step's route if we're not already there.
  useEffect(() => {
    if (step?.route && pathname !== step.route) router.push(step.route);
  }, [step, pathname, router]);

  // Measure the target element so we can spotlight it. Re-measures on scroll AND
  // resize; retries for RETRY_MS before falling back to a centered card so
  // lazy-loaded route content has time to mount.
  useLayoutEffect(() => {
    if (!step) return undefined;
    if (step.placement === 'center' || !step.target) {
      setRect(null);
      return undefined;
    }

    let raf;
    let found = false;
    const startedAt = performance.now();

    const measure = () => {
      const el = document.querySelector(step.target);
      if (el) {
        if (!found) {
          found = true;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else if (!found && performance.now() - startedAt > RETRY_MS) {
        setRect(null); // graceful fallback to centered card
      }
    };

    const tick = () => {
      measure();
      if (!found && performance.now() - startedAt <= RETRY_MS) {
        raf = requestAnimationFrame(tick);
      }
    };
    tick();

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true); // capture: any scroll container
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  // Esc exits the tour; focus the card when the step changes.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    cardRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stepIndex, skip]);

  if (!active || !step) return null;

  const backdrop = theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';

  const spotlight = rect && {
    position: 'fixed',
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
    borderRadius: 8,
    boxShadow: `0 0 0 9999px ${backdrop}`,
    pointerEvents: 'none',
    transition: 'all 0.2s ease',
    zIndex: theme.zIndex.modal
  };

  // Clamp the anchored card inside the viewport; below 600px use a bottom sheet.
  let cardStyle;
  if (isNarrow) {
    cardStyle = { position: 'fixed', left: 0, right: 0, bottom: 0, borderRadius: '12px 12px 0 0', zIndex: theme.zIndex.modal + 1 };
  } else if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(rect.left, PADDING), vw - CARD_WIDTH - PADDING);
    const below = rect.top + rect.height + PADDING * 2;
    const top = below + 200 > vh ? Math.max(rect.top - 200 - PADDING, PADDING) : below;
    cardStyle = { position: 'fixed', top, left, width: CARD_WIDTH, zIndex: theme.zIndex.modal + 1 };
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: 420, zIndex: theme.zIndex.modal + 1 };
  }

  return (
    <>
      {/* Dimmed backdrop (cut-out spotlight when a target is measured). */}
      {rect && !isNarrow ? (
        <Box sx={spotlight} />
      ) : (
        <Box sx={{ position: 'fixed', inset: 0, bgcolor: backdrop, zIndex: theme.zIndex.modal }} />
      )}

      <Paper
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-step-title"
        elevation={8}
        sx={{ ...cardStyle, p: 2.5, outline: 'none' }}
      >
        <Typography id="walkthrough-step-title" variant="h5" sx={{ mb: 1 }}>
          <FormattedMessage id={step.titleId} defaultMessage={step.titleDefault} />
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          <FormattedMessage id={step.bodyId} defaultMessage={step.bodyDefault} />
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Button size="small" color="inherit" onClick={skip}>
            <FormattedMessage id="wt-skip" defaultMessage="Skip" />
          </Button>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Typography variant="caption" color="text.disabled">
              {stepIndex + 1} / {active.steps.length}
            </Typography>
            {stepIndex > 0 && (
              <Button size="small" onClick={back}>
                <FormattedMessage id="wt-back" defaultMessage="Back" />
              </Button>
            )}
            <Button size="small" variant="contained" onClick={isLast ? finish : next}>
              {isLast ? <FormattedMessage id="wt-done" defaultMessage="Done" /> : <FormattedMessage id="wt-next" defaultMessage="Next" />}
            </Button>
          </Box>
        </Box>
      </Paper>
    </>
  );
}
