import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { parseCookie } from 'cookie';
import type { ZodType } from 'zod';
import {
  roomIdSchema,
  socketSchemas,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@hgv/shared';
import type { Config } from '../config/env';
import { SESSION_COOKIE } from '../middleware/security';
import type { AuthService, AuthUser } from '../services/authService';
import type { Gateway, RoomManager } from '../services/roomManager';
import { AppError, toAppError } from '../utils/errors';
import { log } from '../utils/logger';

interface SocketData {
  user: AuthUser;
  sessionExpiresAt: number;
}

type HgvServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type HgvSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const roomChannel = (roomId: string) => `room:${roomId}`;
const roomUserChannel = (roomId: string, userId: string) => `room:${roomId}:user:${userId}`;
const userChannel = (userId: string) => `user:${userId}`;

/** Bridges the transport-independent RoomManager to Socket.IO channels. */
export class SocketGateway implements Gateway {
  private io: HgvServer | null = null;

  bind(io: HgvServer) {
    this.io = io;
  }

  toRoom: Gateway['toRoom'] = (roomId, event, payload) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.io?.to(roomChannel(roomId)) as any)?.emit(event, payload);
  };

  toUser: Gateway['toUser'] = (roomId, userId, event, payload) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.io?.to(roomUserChannel(roomId, userId)) as any)?.emit(event, payload);
  };

  evictUser(roomId: string, userId: string) {
    this.io?.in(roomUserChannel(roomId, userId)).socketsLeave([roomChannel(roomId), roomUserChannel(roomId, userId)]);
  }

  evictAll(roomId: string) {
    this.io?.in(roomChannel(roomId)).socketsLeave(roomChannel(roomId));
  }

  disconnectUser(userId: string) {
    this.io?.in(userChannel(userId)).disconnectSockets(true);
  }
}

/** Fixed one-second window limiter, one per connection. */
class EventBudget {
  private windowStart = Date.now();
  private count = 0;
  constructor(private readonly perSecond: number) {}
  take(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.perSecond;
  }
}

interface SocketDeps {
  config: Config;
  auth: AuthService;
  manager: RoomManager;
  gateway: SocketGateway;
}

export function attachSockets(httpServer: HttpServer, { config, auth, manager, gateway }: SocketDeps): HgvServer {
  const io: HgvServer = new Server(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true },
    maxHttpBufferSize: 10_000,
    // Browsers always send Origin on WebSocket handshakes: refuse unknown origins so a hostile
    // page cannot open a socket using the visitor's cookie. Non-browser clients send none.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (origin && !config.clientOrigins.includes(origin)) return callback('Origin not allowed', false);
      callback(null, true);
    },
  });
  gateway.bind(io);

  // Authenticate every connection from the session cookie before any event can be sent.
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.request.headers.cookie ?? '');
      const session = await auth.authenticateToken(cookies[SESSION_COOKIE]);
      if (!session) return next(new Error('UNAUTHENTICATED'));
      socket.data.user = session.user;
      socket.data.sessionExpiresAt = session.expiresAt;
      next();
    } catch (err) {
      next(new Error(toAppError(err).code));
    }
  });

  io.on('connection', (socket: HgvSocket) => {
    const user = socket.data.user;
    const joined = new Set<string>();
    const budget = new EventBudget(config.socketEventsPerSecond);
    void socket.join(userChannel(user.id));
    socket.emit('connection_status', { status: 'connected', userId: user.id, serverTime: Date.now() });

    // Each handler is registered exactly once per connection, so reconnects cannot stack listeners.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (event: keyof ClientToServerEvents, schema: ZodType, run: (payload: any) => Promise<unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (socket as any).on(event, async (raw: unknown, ack?: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: Ack<unknown>) => void) : () => undefined;
        try {
          if (Date.now() > socket.data.sessionExpiresAt) {
            throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
          }
          if (!budget.take()) throw new AppError('TOO_MANY_REQUESTS', 'You are sending events too quickly.');
          const parsed = schema.safeParse(raw);
          if (!parsed.success) {
            throw new AppError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid payload');
          }
          const data = await run(parsed.data);
          reply({ ok: true, data: data ?? null });
        } catch (err) {
          const e = toAppError(err);
          const rawRoom = (raw as { roomId?: unknown } | null)?.roomId;
          const roomId = typeof rawRoom === 'string' && roomIdSchema.safeParse(rawRoom).success ? rawRoom.toUpperCase() : null;
          socket.emit('operation_rejected', { event, roomId, code: e.code, message: e.message });
          reply({ ok: false, error: { code: e.code, message: e.message } });
          if (e.code === 'UNAUTHENTICATED') socket.disconnect(true);
        }
      });
    };

    on('join_room', socketSchemas.roomId, async ({ roomId }) =>
      manager.join(user, roomId, socket.id, () => {
        void socket.join(roomChannel(roomId));
        void socket.join(roomUserChannel(roomId, user.id));
        joined.add(roomId);
      }),
    );
    on('leave_room', socketSchemas.roomId, async ({ roomId }) => {
      await manager.leave(user, roomId);
      joined.delete(roomId);
    });
    for (const action of ['play', 'pause', 'seek'] as const) {
      on(action, socketSchemas.position, ({ roomId, position }) =>
        manager.playback(user, roomId, action, position),
      );
    }
    on('change_video', socketSchemas.changeVideo, ({ roomId, url }) => manager.changeVideo(user, roomId, url));
    on('assign_role', socketSchemas.assignRole, ({ roomId, userId, role }) =>
      manager.assignRole(user, roomId, userId, role),
    );
    on('remove_participant', socketSchemas.targetUser, async ({ roomId, userId }) => {
      await manager.removeParticipant(user, roomId, userId);
    });
    on('transfer_host', socketSchemas.targetUser, async ({ roomId, userId }) => {
      await manager.transferHost(user, roomId, userId);
    });
    on('request_change', socketSchemas.changeVideo, ({ roomId, url }) => manager.requestChange(user, roomId, url));
    on('approve_request', socketSchemas.requestId, ({ roomId, requestId }) =>
      manager.decideRequest(user, roomId, requestId, 'APPROVED'),
    );
    on('reject_request', socketSchemas.rejectRequest, ({ roomId, requestId, reason }) =>
      manager.decideRequest(user, roomId, requestId, 'REJECTED', reason),
    );
    on('list_requests', socketSchemas.roomId, ({ roomId }) => manager.listRequests(user, roomId));
    on('close_room', socketSchemas.roomId, async ({ roomId }) => {
      await manager.closeRoom(user, roomId);
    });

    socket.on('disconnect', () => {
      for (const roomId of joined) {
        manager.disconnect(user.id, roomId, socket.id).catch((err) => log.warn('disconnect cleanup failed', err));
      }
    });
  });

  return io;
}
