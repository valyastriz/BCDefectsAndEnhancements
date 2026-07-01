const { Server } = require('socket.io');
const { CLIENT_ORIGINS } = require('./config');
const { verifyRealtimeToken } = require('./helpers/realtimeToken');

let io = null;

// ── Ticket presence (advisory soft-lock) ──────────────────────────────────────
// submissionId(string) -> Map<socketId, { username, openedAt, lastActivityAt }>.
// The "holder" of a ticket is the earliest opener still connected (Map preserves
// insertion order). State is in-memory and ephemeral: it auto-clears on disconnect,
// which is exactly what we want for "they closed the tab / walked away".
const ticketPresence = new Map();

function presenceHolder(submissionId) {
  const viewers = ticketPresence.get(String(submissionId));
  if (!viewers || viewers.size === 0) return null;
  const [socketId, info] = viewers.entries().next().value;
  return { socketId, ...info };
}

function broadcastPresence(submissionId) {
  if (!io) return;
  const viewers = ticketPresence.get(String(submissionId));
  io.to('admins').emit('ticket:presence', {
    submissionId: Number(submissionId),
    holder: presenceHolder(submissionId),
    viewerCount: viewers ? viewers.size : 0,
  });
}

function enterTicket(socket, submissionId) {
  const key = String(submissionId);
  if (!ticketPresence.has(key)) ticketPresence.set(key, new Map());
  const viewers = ticketPresence.get(key);
  const now = new Date().toISOString();
  const existing = viewers.get(socket.id);
  if (existing) {
    existing.lastActivityAt = now;
  } else {
    viewers.set(socket.id, {
      username: socket.data.username || 'An admin',
      openedAt: now,
      lastActivityAt: now,
    });
  }
  broadcastPresence(key);
}

function touchTicket(socket, submissionId) {
  const entry = ticketPresence.get(String(submissionId))?.get(socket.id);
  if (!entry) return;
  entry.lastActivityAt = new Date().toISOString();
  broadcastPresence(submissionId);
}

function leaveTicket(socket, submissionId) {
  const key = String(submissionId);
  const viewers = ticketPresence.get(key);
  if (viewers && viewers.delete(socket.id)) {
    if (viewers.size === 0) ticketPresence.delete(key);
    broadcastPresence(key);
  }
}

function leaveAllTickets(socket) {
  for (const [key, viewers] of ticketPresence.entries()) {
    if (viewers.delete(socket.id)) {
      if (viewers.size === 0) ticketPresence.delete(key);
      broadcastPresence(key);
    }
  }
}

function initSocket(server, sessionMiddleware) {
  io = new Server(server, {
    cors: {
      origin: CLIENT_ORIGINS,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    // Prefer a signed handshake token (direct cross-origin connection, where the
    // frontend's session cookie isn't sent). Fall back to the session cookie for
    // same-origin / local-dev connections.
    const tokenUser = verifyRealtimeToken(socket.handshake?.auth?.token);
    if (tokenUser) {
      socket.data.user = tokenUser;
      return next();
    }
    sessionMiddleware(socket.request, {}, (err) => {
      if (err) {
        console.error('Socket session lookup failed:', err.message || err);
        socket.data.user = null;
        return next();
      }
      socket.data.user = socket.request?.session?.user || null;
      next();
    });
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.data.username = user?.username || null;
    if (user?.role === 'admin') {
      socket.join('admins');
      socket.on('ticket:enter', ({ submissionId } = {}) => {
        if (submissionId != null) enterTicket(socket, submissionId);
      });
      socket.on('ticket:activity', ({ submissionId } = {}) => {
        if (submissionId != null) touchTicket(socket, submissionId);
      });
      socket.on('ticket:leave', ({ submissionId } = {}) => {
        if (submissionId != null) leaveTicket(socket, submissionId);
      });
      socket.on('disconnect', () => leaveAllTickets(socket));
    }
    socket.join('public-watchers');
  });

  return io;
}

function emitAdminNotification(event, payload) {
  if (!io) return;
  io.to('admins').emit('admin:notification', {
    event,
    payload,
    at: new Date().toISOString(),
  });
}

function emitPublicUpdate(payload) {
  if (!io) return;
  io.to('public-watchers').emit('public:update', {
    payload,
    at: new Date().toISOString(),
  });
}

module.exports = {
  initSocket,
  emitAdminNotification,
  emitPublicUpdate,
};
