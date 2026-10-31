import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@hgv/shared';
import { API_URL } from './api';

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** One connection per open room page. The session cookie authenticates the handshake. */
export function createRoomSocket(): RoomSocket {
  const options = {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 5000,
  };
  return API_URL ? io(API_URL, options) : io(options);
}
