const { Server } = require('socket.io');
const { CLIENT_ORIGINS } = require('./config');

let io = null;

function initSocket(server, sessionMiddleware) {
  io = new Server(server, {
    cors: {
      origin: CLIENT_ORIGINS,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  io.on('connection', (socket) => {
    const role = socket.request?.session?.user?.role;
    if (role === 'admin') {
      socket.join('admins');
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
