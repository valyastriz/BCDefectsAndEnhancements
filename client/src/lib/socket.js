import { io } from 'socket.io-client';

let socket;

export function getSocket() {
  if (!socket) {
    socket = io(import.meta.env.VITE_SOCKET_URL || '', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }

  return socket;
}
