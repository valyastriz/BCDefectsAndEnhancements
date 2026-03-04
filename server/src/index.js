const http = require('http');
const express = require('express');
const { PORT, IS_PRODUCTION, uploadsRoot } = require('./config');
const { corsMiddleware } = require('./middleware/cors');
const { createSessionMiddleware } = require('./middleware/session');
const { errorHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./socket');

// ── Route modules ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const metaRoutes = require('./routes/metaRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const publicRoutes = require('./routes/publicRoutes');
const adminSubmissionRoutes = require('./routes/adminSubmissionRoutes');
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
app.use(corsMiddleware());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use('/uploads', express.static(uploadsRoot));

// ── Socket.io ────────────────────────────────────────────────────────────────
initSocket(server, sessionMiddleware);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use(authRoutes);
app.use(metaRoutes);
app.use(submissionRoutes);
app.use(publicRoutes);
app.use(adminSubmissionRoutes);
app.use(attachmentRoutes);
app.use(importRoutes);
app.use(easyvistaRoutes);

// ── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
