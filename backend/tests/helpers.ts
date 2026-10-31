import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { DEFAULT_POLICY, type Ack, type PermissionPolicy } from '@hgv/shared';
import type { Config } from '../src/config/env';
import { connectOnce } from '../src/config/db';
import { buildServer } from '../src/server';

/**
 * Database tests need a real MongoDB. They only ever run against TEST_MONGODB_URI, always in a
 * freshly named throwaway database (hgv_test_*) that is dropped afterwards - never production data.
 * Without TEST_MONGODB_URI they are skipped and reported as such.
 */
export const TEST_URI = process.env.TEST_MONGODB_URI;
export const hasDb = Boolean(TEST_URI);
const TEST_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS ?? '')
  .split(',')
  .map((server) => server.trim())
  .filter(Boolean);

export function testDatabaseName(existingName?: string): string {
  if (existingName === undefined) return `hgv_test_${randomBytes(6).toString('hex')}`;
  if (!/^hgv_test_[a-f0-9]{12}$/i.test(existingName)) {
    throw new Error('Refusing to run database tests on a non-test database.');
  }
  return existingName;
}

export const CSRF = { 'X-Requested-With': 'hgv-player' };
export const ORIGIN = 'http://localhost:5173';
export const VIDEO_A = 'dQw4w9WgXcQ';
export const VIDEO_B = '9bZkp7q19f0';
export const VIDEO_C = 'jNQXAC9IVRw';
export const VIDEO_D = 'kJQP7kiw5Fk';

export function testConfig(overrides: Partial<Config> = {}, policy: Partial<PermissionPolicy> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    mongoUri: 'unused',
    mongoDnsServers: [],
    jwtSecret: 'test-secret-test-secret-test-secret-1234',
    clientOrigins: [ORIGIN],
    clientOrigin: ORIGIN,
    cookieSecure: false,
    cookieSameSite: 'lax',
    trustProxy: 0,
    bcryptCost: 4,
    sessionTtlSeconds: 3600,
    idleRoomHours: 48,
    policy: { ...DEFAULT_POLICY, ...policy },
    rateLimit: {
      authWindowMs: 60_000,
      authMax: 1000,
      apiWindowMs: 60_000,
      apiMax: 100_000,
      createRoomWindowMs: 60_000,
      createRoomMax: 1000,
    },
    socketEventsPerSecond: 1000,
    ...overrides,
  };
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

export async function startTestServer(overrides: Partial<Config> = {}, policy: Partial<PermissionPolicy> = {}) {
  if (!TEST_URI) throw new Error('TEST_MONGODB_URI is not set');
  const readyState = mongoose.connection.readyState;
  if (readyState !== 0 && readyState !== 1) {
    throw new Error('Refusing to run database tests while MongoDB is connecting or disconnecting.');
  }
  const dbName = testDatabaseName(readyState === 1 ? mongoose.connection.name : undefined);
  if (readyState === 0) {
    await connectOnce({ uri: TEST_URI, dbName, dnsServers: TEST_DNS_SERVERS });
  }
  if (mongoose.connection.readyState !== 1 || mongoose.connection.name !== dbName) {
    await mongoose.disconnect();
    throw new Error('MongoDB did not connect to the isolated test database.');
  }
  const config = testConfig(overrides, policy);
  const server = buildServer(config);
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const port = (server.httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  return {
    ...server,
    config,
    url,
    dbName,
    async stop() {
      try {
        await server.close();
        if (mongoose.connection.readyState !== 1 || mongoose.connection.name !== dbName) {
          throw new Error('Refusing to clean up a database other than the isolated test database.');
        }
        await mongoose.connection.dropDatabase();
      } finally {
        await mongoose.disconnect();
      }
    },
  };
}

/**
 * A second server instance (own RoomManager, own in-memory state) on the already-open test
 * database. Used to prove that state survives a restart and to test alternative configuration.
 */
export async function startExtraServer(overrides: Partial<Config> = {}, policy: Partial<PermissionPolicy> = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Refusing to start a test server without an active isolated test database.');
  }
  const dbName = testDatabaseName(mongoose.connection.name);
  const config = testConfig(overrides, policy);
  const server = buildServer(config);
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const port = (server.httpServer.address() as AddressInfo).port;
  return { ...server, config, url: `http://127.0.0.1:${port}`, dbName, stop: () => server.close() };
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}${counter}.${randomBytes(3).toString('hex')}@example.com`;
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  cookie: string;
  password: string;
}

export async function registerUser(srv: TestServer, name = 'Test User', password = 'password123'): Promise<TestUser> {
  const email = uniqueEmail();
  const res = await fetch(`${srv.url}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...CSRF },
    body: JSON.stringify({ name, email, password }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, name, email, cookie, password };
}

/** Authenticated HTTP helper that sends the session cookie and the CSRF header. */
export function http(srv: TestServer, user?: TestUser) {
  const agent = request(srv.httpServer);
  const headers: Record<string, string> = { ...CSRF };
  if (user) headers.Cookie = user.cookie;
  return {
    get: (path: string) => agent.get(path).set(headers),
    post: (path: string, body?: object) => agent.post(path).set(headers).send(body),
    patch: (path: string, body?: object) => agent.patch(path).set(headers).send(body),
  };
}

export async function createRoom(srv: TestServer, host: TestUser, name = 'Movie Night'): Promise<string> {
  const res = await http(srv, host).post('/api/rooms', { name });
  if (res.status !== 201) throw new Error(`create room failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.room.roomId as string;
}

export function connectSocket(srv: TestServer, user: TestUser, extraHeaders: Record<string, string> = {}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(srv.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { cookie: user.cookie, ...extraHeaders },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

export function rawSocket(srv: TestServer, extraHeaders: Record<string, string> = {}): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(srv.url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

/** Emits an event and resolves with the server's acknowledgement. */
export function call<T = any>(socket: Socket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
    socket.emit(event, payload, (res: Ack<T>) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

/** Resolves with the next matching event. Register BEFORE triggering the action. */
export function nextEvent<T = any>(socket: Socket, event: string, match?: (p: T) => boolean, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (match && !match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Collects events for a window and returns them (use to assert that nothing arrived). */
export function collect<T = any>(socket: Socket, event: string): { events: T[]; stop: () => void } {
  const events: T[] = [];
  const handler = (p: T) => events.push(p);
  socket.on(event, handler);
  return { events, stop: () => socket.off(event, handler) };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function join(socket: Socket, roomId: string) {
  const res = await call<any>(socket, 'join_room', { roomId });
  if (!res.ok) throw new Error(`join failed: ${res.error.code}`);
  return res.data;
}
