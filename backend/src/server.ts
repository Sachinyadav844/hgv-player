import { createServer } from 'node:http';
import type { Config } from './config/env';
import { createApp } from './app';
import { AuthService } from './services/authService';
import { RoomManager } from './services/roomManager';
import { SocketGateway, attachSockets } from './sockets';
import { LIMITS } from '@hgv/shared';
import { log } from './utils/logger';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** Wires the Express app, Socket.IO and the room manager together. Does not start listening. */
export function buildServer(config: Config) {
  const gateway = new SocketGateway();
  const manager = new RoomManager(gateway, {
    policy: config.policy,
    maxPendingRequestsPerUser: LIMITS.maxPendingRequestsPerUser,
  });
  const auth = new AuthService(config);
  const app = createApp({ config, auth, manager, onLogout: (id) => gateway.disconnectUser(id) });
  const httpServer = createServer(app);
  const io = attachSockets(httpServer, { config, auth, manager, gateway });

  const sweeper = setInterval(() => {
    manager
      .sweep(config.idleRoomHours)
      .then((r) => {
        if (r.roomsClosed || r.participantsExpired) log.info(`Sweep: ${JSON.stringify(r)}`);
      })
      .catch((err) => log.warn('Sweep failed', err));
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  async function close(): Promise<void> {
    clearInterval(sweeper);
    await manager.idle().catch(() => undefined);
    // io.close() also closes the underlying HTTP server.
    await io.close();
  }

  return { app, httpServer, io, manager, auth, close };
}
