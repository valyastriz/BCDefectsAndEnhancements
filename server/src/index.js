const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { PORT, IS_PRODUCTION, DEV_IMPERSONATION_ENABLED, uploadsRoot } = require('./config');
const { corsMiddleware } = require('./middleware/cors');
const { createSessionMiddleware } = require('./middleware/session');
const { csrfProtection } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./socket');
const { startKeepAlive } = require('./keepAlive');
const db = require('../db');

// ── Route modules ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const viewerRoutes = require('./routes/viewerRoutes');
const metaRoutes = require('./routes/metaRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const publicRoutes = require('./routes/publicRoutes');
const adminSubmissionRoutes = require('./routes/adminSubmissionRoutes');
const recurrenceRoutes = require('./routes/recurrenceRoutes');
const adminViewPreferenceRoutes = require('./routes/adminViewPreferenceRoutes');
const accessRoutes = require('./routes/accessRoutes');
const reportApplicationRoutes = require('./routes/reportApplicationRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const importRoutes = require('./routes/importRoutes');
const easyvistaRoutes = require('./routes/easyvistaRoutes');
const aiSearchRoutes = require('./routes/aiSearchRoutes');

// ── App & server ─────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

// ── Global middleware ────────────────────────────────────────────────────────
const sessionMiddleware = createSessionMiddleware();
app.use(helmet({
  // This is an API server; the SPA HTML (and its CSP) is served by the frontend host.
  contentSecurityPolicy: false,
  // Allow the separate frontend origin to load attachment images from /uploads.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));
app.use(corsMiddleware());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(csrfProtection());
app.use('/uploads', express.static(uploadsRoot, {
  setHeaders: (res) => {
    // Prevent browsers from MIME-sniffing stored files into executable content.
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// ── Socket.io ────────────────────────────────────────────────────────────────
initSocket(server, sessionMiddleware);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use(authRoutes);
app.use(viewerRoutes);
app.use(metaRoutes);
app.use(submissionRoutes);
app.use(publicRoutes);
app.use(adminSubmissionRoutes);
app.use(recurrenceRoutes);
app.use(adminViewPreferenceRoutes);
app.use(accessRoutes);
app.use(reportApplicationRoutes);
app.use(attachmentRoutes);
app.use(deliveryRoutes);
app.use(importRoutes);
app.use(easyvistaRoutes);
app.use(aiSearchRoutes);

// Dev-only identity switching. Registered ONLY when all three gate conditions
// hold, so in any deployed environment the path does not exist rather than
// existing and refusing. See routes/devRoutes.js and config.js.
if (DEV_IMPERSONATION_ENABLED) {
  // eslint-disable-next-line global-require
  app.use(require('./routes/devRoutes'));
  console.log('DEV_IMPERSONATION is ON — /api/dev/impersonate is reachable. Never enable this in a deployed environment.');
}

// ── Health check (used by external ping services to keep the server alive) ───
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
// In production (Render), self-apply the schema on boot so deploys that add
// tables/columns don't need a manual `npm run migrate`. Guarded to production so
// local runs (which may point at the live DB) never auto-alter it. Non-fatal:
// the server still starts if the sync fails, and we log it for the deploy logs.
async function start() {
  if (IS_PRODUCTION) {
    try {
      await db.migrate();
      console.log('Schema sync complete.');
    } catch (error) {
      console.error('Schema sync failed (starting anyway):', error);
    }
  }
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startKeepAlive(db);
  });
}

start();
