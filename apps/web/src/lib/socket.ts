import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';
import { forceUpdate } from './app-update';

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io({
      autoConnect: true,
      reconnection: true,
      auth: (cb) => cb({ token: getToken(), version: __APP_VERSION__ }),
    });
    socketInstance.on('client-outdated', () => { void forceUpdate(); });
  }
  return socketInstance;
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
