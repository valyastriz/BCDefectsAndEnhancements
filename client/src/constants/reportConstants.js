/**
 * How often a requested report will be used.
 *
 * **Mirrors `REPORT_USAGE_FREQUENCIES` in `server/src/constants.js` — keep the two
 * in step.** The server refuses anything else, so one list governs both.
 *
 * A fixed cadence scale rather than a managed lookup: it is not a
 * database-managed entity the way an application is, and free text would give an
 * analyst "Daily", "daily" and "every day" as three different answers.
 *
 * Lived in RepSubmitPage until the Add-a-ticket dialog needed the same six words;
 * two copies of a list the server validates against is how they drift apart.
 */
export const USAGE_FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'One-off'];
