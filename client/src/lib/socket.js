import { io } from 'socket.io-client';
import { api } from './api';

// Connect Socket.IO directly to the backend rather than same-origin. Same-origin
// would route through the Vercel proxy, which can't carry WebSocket upgrades — so
// the connection degrades to perpetual HTTP long-polling, billing a flood of
// Vercel requests. Going direct to Render gives a real WebSocket (one persistent
// connection, ~zero ongoing requests) and keeps all of it off Vercel.
//
// Override with VITE_SOCKET_URL; default to same-origin in dev (Vite proxies it
// to the local server) and to the Render backend in production.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL
  ?? (import.meta.env.PROD ? 'https://bcdefectsandenhancements.onrender.com' : '');

let socket;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      // The frontend's session cookie isn't sent on a cross-origin connection,
      // so admins authenticate with a short-lived signed token fetched from the
      // same-origin API. Runs on every (re)connect for a fresh token; public
      // watchers get a 401 and connect anonymously.
      auth: (cb) => {
        api.getRealtimeToken()
          .then((data) => cb(data?.token ? { token: data.token } : {}))
          .catch(() => cb({}));
      },
    });
  }

  return socket;
}

// Force a fresh handshake. The server decides the socket's role (admins room,
// ticket presence handlers) only at connect time, so call this after login or
// logout — otherwise an anonymous socket keeps missing admin events after
// login, and a logged-out admin keeps receiving them.
export function resetSocket() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}
