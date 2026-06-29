const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { PORT, IS_PRODUCTION, uploadsRoot } = require('./config');
const { corsMiddleware } = require('./middleware/cors');
const { createSessionMiddleware } = require('./middleware/session');
const { csrfProtection } = require('./middleware/csrf');
const { errorHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./socket');
const { startKeepAlive } = require('./keepAlive');
const db = require('../db');

// ── Route modules ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const metaRoutes = require('./routes/metaRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const publicRoutes = require('./routes/publicRoutes');
const adminSubmissionRoutes = require('./routes/adminSubmissionRoutes');
const adminViewPreferenceRoutes = require('./routes/adminViewPreferenceRoutes');
const attachmentRoutes = require('./routes/attachmentRoutes');
const importRoutes = require('./routes/importRoutes');
const easyvistaRoutes = require('./routes/easyvistaRoutes');

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
app.use(metaRoutes);
app.use(submissionRoutes);
app.use(publicRoutes);
app.use(adminSubmissionRoutes);
app.use(adminViewPreferenceRoutes);
app.use(attachmentRoutes);
app.use(importRoutes);
app.use(easyvistaRoutes);

// ── Health check (used by external ping services to keep the server alive) ───
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startKeepAlive(db);
});
