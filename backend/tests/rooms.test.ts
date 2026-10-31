import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ParticipantModel, RoomModel } from '../src/models';
import { createRoom, hasDb, http, registerUser, startTestServer, type TestServer } from './helpers';

describe.skipIf(!hasDb)('rooms REST API (real MongoDB)', () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('requires authentication for every room endpoint', async () => {
    expect((await http(srv).post('/api/rooms', { name: 'Nope' })).status).toBe(401);
    expect((await http(srv).get('/api/rooms/mine')).status).toBe(401);
    expect((await http(srv).get('/api/rooms/ABCDEFGHJK')).status).toBe(401);
  });

  it('creates a room: unpredictable ID, creator becomes Host, playback initialised', async () => {
    const host = await registerUser(srv, 'Hostess');
    const res = await http(srv, host).post('/api/rooms', { name: '  Friday Watch Party  ' });
    expect(res.status).toBe(201);
    const { room, inviteUrl } = res.body;
    expect(room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(room.name).toBe('Friday Watch Party');
    expect(room.hostId).toBe(host.id);
    expect(inviteUrl).toBe(`http://localhost:5173/room/${room.roomId}`);
    expect(JSON.stringify(res.body)).not.toMatch(/_id|mongodb/i);

    const stored = await RoomModel.findOne({ roomId: room.roomId }).lean();
    expect(stored).toMatchObject({ status: 'OPEN', videoId: null, playing: false, position: 0, ownerId: host.id });
    const membership = await ParticipantModel.findOne({ roomId: room.roomId, userId: host.id }).lean();
    expect(membership).toMatchObject({ role: 'HOST', status: 'ACTIVE' });
  });

  it('generates distinct room IDs', async () => {
    const host = await registerUser(srv);
    const ids = new Set<string>();
    for (let i = 0; i < 15; i++) ids.add(await createRoom(srv, host, `Room ${i + 10}`));
    expect(ids.size).toBe(15);
  });

  it('validates the room name', async () => {
    const host = await registerUser(srv);
    for (const name of ['', ' ', 'a', 'x'.repeat(61), 42, null]) {
      const res = await http(srv, host).post('/api/rooms', { name });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('previews a room for any signed-in user and reports membership for the caller only', async () => {
    const host = await registerUser(srv, 'Hosty');
    const guest = await registerUser(srv, 'Guesty');
    const roomId = await createRoom(srv, host, 'Preview Room');

    const asHost = await http(srv, host).get(`/api/rooms/${roomId}`);
    expect(asHost.status).toBe(200);
    expect(asHost.body.room).toMatchObject({ name: 'Preview Room', hostName: 'Hosty', participantCount: 1, status: 'OPEN', removed: false });
    expect(asHost.body.room.membership).toEqual({ role: 'HOST' });

    const asGuest = await http(srv, guest).get(`/api/rooms/${roomId.toLowerCase()}`);
    expect(asGuest.status).toBe(200);
    expect(asGuest.body.room.membership).toBeNull();
  });

  it('answers 404 for a room that does not exist and 400 for a malformed code', async () => {
    const user = await registerUser(srv);
    const missing = await http(srv, user).get('/api/rooms/ZZZZZZZZZZ');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ROOM_NOT_FOUND');
    const malformed = await http(srv, user).get('/api/rooms/short');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    const injection = await http(srv, user).get('/api/rooms/' + encodeURIComponent('{"$ne":null}'));
    expect(injection.status).toBe(400);
  });

  it('lists only the caller\'s own rooms', async () => {
    const a = await registerUser(srv, 'Alice');
    const b = await registerUser(srv, 'Bob');
    const roomA = await createRoom(srv, a, 'Alice Room');
    await createRoom(srv, b, 'Bob Room');
    const res = await http(srv, a).get('/api/rooms/mine');
    expect(res.status).toBe(200);
    expect(res.body.rooms.map((r: { roomId: string }) => r.roomId)).toEqual([roomA]);
    expect(res.body.rooms[0]).toMatchObject({ role: 'HOST', name: 'Alice Room' });
  });

  it('reports DB_UNAVAILABLE-style readiness through /health and /health/ready', async () => {
    const live = await http(srv).get('/health');
    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');
    const ready = await http(srv).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: 'ready', database: 'up' });
  });
});
