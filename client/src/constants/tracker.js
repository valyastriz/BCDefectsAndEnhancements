// ── The downstream ticketing system, as users see it ────────────────────────
//
// Every user-visible mention of the system approved tickets are handed off to
// goes through this label. The portal integrates with EasyVista today, but the
// UI deliberately does not say so: the tool is expected to be replaced, and when
// it is, this line is the change.
//
// Scope note — this is a DISPLAY name only. The integration's own identifiers
// keep the vendor name on purpose, because renaming them is a migration with no
// user-facing benefit: the `easyvista_ticket_id` column, the
// `/api/admin/submissions/:id/easyvista-preview` route, the `EASYVISTA_*`
// environment variables, and `server/src/easyvista.js` all stay as they are.
// Server-side copy has its own copy of this constant (server/src/constants.js) —
// the two must be changed together.
export const TRACKER_LABEL = 'Service Desk';

/** "Submit to the Service Desk" — the article reads oddly for some names, so it
 *  lives here rather than being hardcoded at each call site. */
export const TRACKER_LABEL_THE = `the ${TRACKER_LABEL}`;
