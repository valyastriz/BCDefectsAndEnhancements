const { Server } = require('socket.io');
const { CLIENT_ORIGINS } = require('./config');
const { verifyRealtimeToken } = require('./helpers/realtimeToken');
const { boardAudienceFor } = require('./helpers/reportVisibility');

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
    // A room of one, so a live update about a report request can reach the person
    // who filed it without going to every board watcher. Only signed-in sockets
    // have one, which is the same condition that makes a report request visible
    // at all.
    if (user?.id != null) socket.join(publicUserRoom(user.id));
  });

  return io;
}

const publicUserRoom = (userId) => `public-user:${Number(userId)}`;

function emitAdminNotification(event, payload) {
  if (!io) return;
  io.to('admins').emit('admin:notification', {
    event,
    payload,
    at: new Date().toISOString(),
  });
}

/**
 * Tell the board something changed.
 *
 * `audience` narrows who hears it. A report request goes ONLY to the socket of
 * the person who filed it — the board room is every visitor, signed in or not,
 * and broadcasting a report request there would hand it to everybody live even
 * though GET /api/public/submissions refuses it. A row with an audience and
 * nobody to send it to is simply not emitted; the change is still there on the
 * next load, for the one person entitled to see it.
 */
function emitPublicUpdate(payload, { onlyReporterUserId = null, nobody = false } = {}) {
  if (!io) return;
  // Nobody may see it, so nobody is told. Not the same as "no audience given",
  // which means the whole board — conflating the two is how a private row would
  // have gone out to every watcher.
  if (nobody) return;
  const room = onlyReporterUserId != null
    ? publicUserRoom(onlyReporterUserId)
    : 'public-watchers';
  io.to(room).emit('public:update', {
    payload,
    at: new Date().toISOString(),
  });
}

// The audience for a row, from the row itself, so no caller has to remember the
// rule — and it is the SAME rule the board's REST routes filter on, not a copy.
const publicAudienceFor = boardAudienceFor;

module.exports = {
  initSocket,
  emitAdminNotification,
  emitPublicUpdate,
  publicAudienceFor,
};
