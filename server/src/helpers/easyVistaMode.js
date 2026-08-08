// Is the integration live, and is an un-wired send dressed up as a real one?
//
// WHY THESE TWO LIVE IN THEIR OWN MODULE. They used to sit in `src/easyvista.js`,
// which requires `helpers/easyVistaPayload` at its top — so when the payload
// helper needed to ask "are we live?" (a `DEMO-` catalog counts as configured only
// while nothing is transmitted, see `easyVistaCatalogStatus`), requiring back the
// other way gave a half-built module and `easyVistaIsLive` came out undefined.
// An undefined predicate reads as false, which would have made a demonstration
// catalog look real on a LIVE server — failing open, in the one place the whole
// guard exists to fail closed.
//
// Both are pure environment reads with no dependencies, so the lowest layer is
// where they belong. `src/easyvista.js` re-exports them, so every existing
// importer is untouched.
const isAffirmative = (flag) => {
  const value = String(flag || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
};

/**
 * Whether a send actually leaves this app.
 *
 * `EASYVISTA_ENABLED` is a deliberate master switch, and it is OFF unless set.
 * Credentials alone are not enough: the payload shape, the endpoint path and the
 * response parsing are all still unconfirmed, so an environment that happens to
 * have a base URL and a key configured must not start transmitting on its own.
 * Turning this on is the conscious act of saying the integration is ready.
 */
function easyVistaIsLive() {
  return isAffirmative(process.env.EASYVISTA_ENABLED)
    && Boolean(process.env.EASYVISTA_BASE_URL)
    && Boolean(process.env.EASYVISTA_API_KEY);
}

/**
 * Whether an un-wired send is presented as though it were real.
 *
 * The integration is built and waiting on EasyVista, so stakeholders are shown
 * the flow end to end — press send, get an incident number back, watch the
 * ticket move to Submitted. Demo mode is what lets that walkthrough read like
 * the real thing instead of a caveat, and it is the behaviour this app has had
 * for its whole life, so it is ON by default.
 *
 * It is only ever consulted when the integration is NOT live, so it can never
 * quiet a warning about a real transmission. Set `EASYVISTA_DEMO_MODE=false` to
 * get the "nothing was transmitted" wording back on every surface.
 */
function easyVistaDemoMode() {
  if (easyVistaIsLive()) return false;
  const flag = String(process.env.EASYVISTA_DEMO_MODE ?? '').trim().toLowerCase();
  return !(flag === 'false' || flag === '0' || flag === 'no' || flag === 'off');
}

module.exports = { easyVistaIsLive, easyVistaDemoMode };
