import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, ChangeRequestModel, ParticipantModel, RoomModel } from '../src/models';
import {
  VIDEO_A,
  VIDEO_B,
  VIDEO_C,
  VIDEO_D,
  call,
  collect,
  connectSocket,
  createRoom,
  hasDb,
  http,
  join,
  nextEvent,
  rawSocket,
  registerUser,
  sleep,
  startExtraServer,
  startTestServer,
  type TestServer,
  type TestUser,
} from './helpers';

/** One room with a Host and a Participant, both connected and joined. */
async function setup(srv: TestServer) {
  const host = await registerUser(srv, 'Hostess');
  const guest = await registerUser(srv, 'Guesty');
  const roomId = await createRoom(srv, host);
  const hostSock = await connectSocket(srv, host);
  const guestSock = await connectSocket(srv, guest);
  const hostSnap = await join(hostSock, roomId);
  const joined = nextEvent(hostSock, 'user_joined');
  const guestSnap = await join(guestSock, roomId);
  await joined;
  return { host, guest, roomId, hostSock, guestSock, hostSnap, guestSnap };
}

async function loadVideo(sock: Socket, roomId: string, url = `https://youtu.be/${VIDEO_A}`) {
  const res = await call<any>(sock, 'change_video', { roomId, url });
  expect(res.ok).toBe(true);
  await sleep(80); // let the broadcast reach every socket before the test starts listening
  return res;
}

describe.skipIf(!hasDb)('real-time rooms (Socket.IO + real MongoDB)', () => {
  let srv: TestServer;
  const sockets: Socket[] = [];
  const track = <T extends Socket>(s: T) => (sockets.push(s), s);

  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
  });
  afterAll(async () => {
    await srv.manager.idle();
    await srv.stop();
  });

  async function room() {
    const ctx = await setup(srv);
    track(ctx.hostSock);
    track(ctx.guestSock);
    return ctx;
  }

  describe('connection and authentication', () => {
    it('rejects a socket with no session cookie', async () => {
      await expect(rawSocket(srv)).rejects.toThrow('UNAUTHENTICATED');
    });

    it('rejects a socket with an invalid session cookie', async () => {
      await expect(rawSocket(srv, { cookie: 'hgv_session=forged.token.value' })).rejects.toThrow('UNAUTHENTICATED');
    });

    it('rejects a WebSocket handshake from a foreign Origin even with a valid cookie', async () => {
      const user = await registerUser(srv);
      await expect(connectSocket(srv, user, { origin: 'https://evil.example' })).rejects.toBeTruthy();
    });

    it('accepts an authenticated socket and announces connection_status', async () => {
      const user = await registerUser(srv);
      const sock = track(await connectSocket(srv, user, { origin: 'http://localhost:5173' }));
      expect(sock.connected).toBe(true);
    });

    it('logging out disconnects the user\'s live sockets', async () => {
      const user = await registerUser(srv);
      const sock = track(await connectSocket(srv, user));
      const closed = new Promise((resolve) => sock.once('disconnect', resolve));
      await http(srv, user).post('/api/auth/logout');
      await closed;
      expect(sock.connected).toBe(false);
    });
  });

  describe('joining', () => {
    it('gives the creator the Host role and a participant list', async () => {
      const { hostSnap, host } = await room();
      expect(hostSnap.you).toEqual({ userId: host.id, role: 'HOST' });
      expect(hostSnap.room.hostId).toBe(host.id);
      expect(hostSnap.state).toMatchObject({ videoId: null, playing: false, position: 0 });
    });

    it('gives a joiner the Participant role and tells the room (user_joined)', async () => {
      const host = await registerUser(srv, 'Hostess');
      const guest = await registerUser(srv, 'Guesty');
      const roomId = await createRoom(srv, host);
      const hostSock = track(await connectSocket(srv, host));
      const guestSock = track(await connectSocket(srv, guest));
      await join(hostSock, roomId);
      const joined = nextEvent<any>(hostSock, 'user_joined');
      const snap = await join(guestSock, roomId);
      expect(snap.you.role).toBe('PARTICIPANT');
      expect(snap.participants.map((p: any) => [p.displayName, p.role])).toEqual([
        ['Hostess', 'HOST'],
        ['Guesty', 'PARTICIPANT'],
      ]);
      const event = await joined;
      expect(event.participant).toMatchObject({ userId: guest.id, displayName: 'Guesty', role: 'PARTICIPANT', online: true });
    });

    it('never leaks private account data in snapshots or events', async () => {
      const { hostSnap, guestSnap, guest } = await room();
      const text = JSON.stringify([hostSnap, guestSnap]);
      expect(text).not.toMatch(/passwordHash|password|@example\.com|hgv_session|jwt/i);
      expect(guestSnap.participants.find((p: any) => p.userId === guest.id)).not.toHaveProperty('email');
    });

    it('rejects an unknown room, a malformed code, a closed room', async () => {
      const user = await registerUser(srv);
      const sock = track(await connectSocket(srv, user));
      expect(await call(sock, 'join_room', { roomId: 'ZZZZZZZZZZ' })).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
      expect(await call(sock, 'join_room', { roomId: 'nope' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

      const host = await registerUser(srv);
      const roomId = await createRoom(srv, host);
      const hostSock = track(await connectSocket(srv, host));
      await join(hostSock, roomId);
      expect((await call(hostSock, 'close_room', { roomId })).ok).toBe(true);
      expect(await call(sock, 'join_room', { roomId })).toMatchObject({ ok: false, error: { code: 'ROOM_CLOSED' } });
    });

    it('is idempotent for a second tab of the same user (no duplicate participant)', async () => {
      const { host, roomId, hostSock } = await room();
      const tab2 = track(await connectSocket(srv, host));
      const snap = await join(tab2, roomId);
      expect(snap.participants.filter((p: any) => p.userId === host.id)).toHaveLength(1);
      expect(await ParticipantModel.countDocuments({ roomId, userId: host.id })).toBe(1);
      expect(hostSock.connected).toBe(true);
    });
  });

  describe('playback synchronisation', () => {
    it('change_video reaches every member with a server timestamp and bumped version', async () => {
      const { roomId, hostSock, guestSock, hostSnap } = await room();
      const onGuest = nextEvent<any>(guestSock, 'sync_state');
      const res = await loadVideo(hostSock, roomId, `https://www.youtube.com/watch?v=${VIDEO_A}&t=5`);
      const evt = await onGuest;
      expect(evt).toMatchObject({ roomId, cause: 'change_video', state: { videoId: VIDEO_A, playing: false, position: 0 } });
      expect(evt.state.version).toBe(hostSnap.state.version + 1);
      expect(typeof evt.serverTime).toBe('number');
      expect(res.data.state.version).toBe(evt.state.version);
    });

    it('play, seek and pause propagate and keep the authoritative state', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);

      let evt = nextEvent<any>(guestSock, 'sync_state', (p) => p.cause === 'play');
      expect((await call<any>(hostSock, 'play', { roomId, position: 12 })).ok).toBe(true);
      expect((await evt).state).toMatchObject({ playing: true, position: 12, videoId: VIDEO_A });

      evt = nextEvent<any>(guestSock, 'sync_state', (p) => p.cause === 'seek');
      await call(hostSock, 'seek', { roomId, position: 95.5 });
      expect((await evt)).toMatchObject({ cause: 'seek', state: { playing: true, position: 95.5 } });

      evt = nextEvent<any>(guestSock, 'sync_state', (p) => p.cause === 'pause');
      await call(hostSock, 'pause', { roomId, position: 100 });
      expect((await evt)).toMatchObject({ cause: 'pause', state: { playing: false, position: 100 } });
    });

    it('suppresses redundant commands instead of re-broadcasting them', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'pause', { roomId, position: 30 });
      await sleep(150);
      const seen = collect(guestSock, 'sync_state');
      const again = await call<any>(hostSock, 'pause', { roomId, position: 30.2 });
      const sameSeek = await call<any>(hostSock, 'seek', { roomId, position: 30.1 });
      await sleep(150);
      seen.stop();
      expect(again.data.changed).toBe(false);
      expect(sameSeek.data.changed).toBe(false);
      expect(seen.events).toHaveLength(0);
    });

    it('late joiners receive the current state, with elapsed time computable from the timestamp', async () => {
      const { roomId, hostSock } = await room();
      await loadVideo(hostSock, roomId, `https://youtu.be/${VIDEO_B}`);
      await call(hostSock, 'play', { roomId, position: 50 });
      await sleep(100);
      const late = await registerUser(srv, 'Late');
      const lateSock = track(await connectSocket(srv, late));
      const snap = await join(lateSock, roomId);
      expect(snap.state).toMatchObject({ videoId: VIDEO_B, playing: true, position: 50 });
      expect(snap.serverTime).toBeGreaterThan(snap.state.updatedAt);
    });

    it('broadcasts only inside the room (no cross-room leakage)', async () => {
      const a = await room();
      const b = await room();
      const leak = collect(b.guestSock, 'sync_state');
      const own = nextEvent(a.guestSock, 'sync_state');
      await loadVideo(a.hostSock, a.roomId);
      await own;
      await sleep(150);
      leak.stop();
      expect(leak.events).toHaveLength(0);
    });

    it('rejects invalid videos and leaves the state untouched', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await sleep(100);
      const seen = collect(guestSock, 'sync_state');
      for (const url of ['https://evil.com/watch?v=' + VIDEO_B, 'javascript:alert(1)', 'nope', '<iframe src=x>', 'https://youtu.be/short']) {
        expect(await call(hostSock, 'change_video', { roomId, url })).toMatchObject({ ok: false, error: { code: 'INVALID_VIDEO' } });
      }
      await sleep(100);
      seen.stop();
      expect(seen.events).toHaveLength(0);
    });

    it('refuses playback commands before any video is loaded', async () => {
      const { roomId, hostSock } = await room();
      expect(await call(hostSock, 'play', { roomId, position: 0 })).toMatchObject({ ok: false, error: { code: 'NO_VIDEO' } });
    });

    it('emits operation_rejected to the sender for refused actions', async () => {
      const { roomId, guestSock } = await room();
      const rejected = nextEvent<any>(guestSock, 'operation_rejected');
      await call(guestSock, 'play', { roomId, position: 1 });
      expect(await rejected).toMatchObject({ event: 'play', roomId, code: 'FORBIDDEN' });
    });
  });

  describe('role-based authorisation', () => {
    it('a Participant cannot play, pause, seek or change the video, and nothing changes', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'play', { roomId, position: 10 });
      const seen = collect(hostSock, 'sync_state');

      for (const [event, payload] of [
        ['play', { roomId, position: 99 }],
        ['pause', { roomId, position: 99 }],
        ['seek', { roomId, position: 99 }],
        ['change_video', { roomId, url: VIDEO_B }],
      ] as const) {
        expect(await call(guestSock, event, payload), event).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      }
      await sleep(150);
      seen.stop();
      expect(seen.events).toHaveLength(0);
      const stored = await RoomModel.findOne({ roomId }).lean();
      expect(stored).toMatchObject({ videoId: VIDEO_A });
    });

    it('a Participant cannot assign roles, remove people, transfer host, close the room or decide requests', async () => {
      const { roomId, host, guest, hostSock, guestSock } = await room();
      expect(await call(guestSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'remove_participant', { roomId, userId: host.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'transfer_host', { roomId, userId: guest.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'close_room', { roomId })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'approve_request', { roomId, requestId: 'whatever-id' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect((await RoomModel.findOne({ roomId }).lean())?.hostId).toBe(host.id);
      expect(hostSock.connected).toBe(true);
    });

    it('ignores client-supplied role or isHost claims (strict payloads)', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      expect(await call(guestSock, 'play', { roomId, position: 5, role: 'HOST', isHost: true })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(await call(guestSock, 'play', { roomId, position: 5, userId: 'someone-else' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    });

    it('Host promotes a Participant to Moderator; the change is broadcast and persisted', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      const hostSees = nextEvent<any>(hostSock, 'role_assigned');
      const guestSees = nextEvent<any>(guestSock, 'role_assigned');
      const res = await call<any>(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      expect(res).toMatchObject({ ok: true, data: { userId: guest.id, role: 'MODERATOR' } });
      expect(await hostSees).toMatchObject({ userId: guest.id, role: 'MODERATOR' });
      expect(await guestSees).toMatchObject({ userId: guest.id, role: 'MODERATOR' });
      expect(await ParticipantModel.findOne({ roomId, userId: guest.id }).lean()).toMatchObject({ role: 'MODERATOR' });
    });

    it('a Moderator can control playback and change the video, but cannot assign roles or remove people', async () => {
      const { roomId, host, guest, hostSock, guestSock } = await room();
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      await loadVideo(guestSock, roomId, `https://youtu.be/${VIDEO_C}`);
      const onHost = nextEvent<any>(hostSock, 'sync_state');
      expect((await call(guestSock, 'play', { roomId, position: 7 })).ok).toBe(true);
      expect((await onHost).state).toMatchObject({ playing: true, position: 7, videoId: VIDEO_C });

      expect(await call(guestSock, 'assign_role', { roomId, userId: host.id, role: 'PARTICIPANT' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'remove_participant', { roomId, userId: host.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'transfer_host', { roomId, userId: guest.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it('demoting a Moderator takes their playback permission away immediately', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      expect((await call(guestSock, 'play', { roomId, position: 1 })).ok).toBe(true);
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'PARTICIPANT' });
      expect(await call(guestSock, 'pause', { roomId, position: 2 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it('rejects invalid and duplicate role changes', async () => {
      const { roomId, host, guest, hostSock } = await room();
      expect(await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'HOST' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'ADMIN' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'PARTICIPANT' })).toMatchObject({ ok: false, error: { code: 'ROLE_UNCHANGED' } });
      expect(await call(hostSock, 'assign_role', { roomId, userId: host.id, role: 'MODERATOR' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(hostSock, 'assign_role', { roomId, userId: 'not-a-member', role: 'MODERATOR' })).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
      expect((await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' })).ok).toBe(true);
      expect(await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' })).toMatchObject({ ok: false, error: { code: 'ROLE_UNCHANGED' } });
    });

    it('transfer_host moves the Host role on the server and demotes the old host', async () => {
      const { roomId, host, guest, hostSock, guestSock } = await room();
      const evt = nextEvent<any>(guestSock, 'role_assigned', (p) => p.userId === guest.id);
      expect((await call(hostSock, 'transfer_host', { roomId, userId: guest.id })).ok).toBe(true);
      expect(await evt).toMatchObject({ role: 'HOST' });
      expect(await call(hostSock, 'remove_participant', { roomId, userId: guest.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect((await call(guestSock, 'assign_role', { roomId, userId: host.id, role: 'PARTICIPANT' })).ok).toBe(true);
      expect((await RoomModel.findOne({ roomId }).lean())?.hostId).toBe(guest.id);
    });
  });

  describe('participant removal', () => {
    it('removes the participant, tells them and the room, and blocks every further action', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });

      const toGuest = nextEvent<any>(guestSock, 'participant_removed');
      const toHost = nextEvent<any>(hostSock, 'participant_removed');
      expect((await call(hostSock, 'remove_participant', { roomId, userId: guest.id })).ok).toBe(true);
      expect(await toGuest).toMatchObject({ userId: guest.id });
      expect(await toHost).toMatchObject({ userId: guest.id });

      // The old socket is still connected, yet every action is refused - even as a former Moderator.
      const seen = collect(hostSock, 'sync_state');
      for (const [event, payload] of [
        ['play', { roomId, position: 5 }],
        ['pause', { roomId, position: 5 }],
        ['seek', { roomId, position: 5 }],
        ['change_video', { roomId, url: VIDEO_B }],
        ['request_change', { roomId, url: VIDEO_B }],
        ['list_requests', { roomId }],
      ] as const) {
        const res = await call<any>(guestSock, event, payload);
        expect(res.ok, event).toBe(false);
        expect(['REMOVED_FROM_ROOM', 'NOT_A_MEMBER'], event).toContain((res as any).error.code);
      }
      await sleep(100);
      seen.stop();
      expect(seen.events).toHaveLength(0);

      expect(await ParticipantModel.findOne({ roomId, userId: guest.id }).lean()).toMatchObject({ status: 'REMOVED' });
    });

    it('stops the removed user from receiving later room broadcasts', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'remove_participant', { roomId, userId: guest.id });
      const seen = collect(guestSock, 'sync_state');
      await call(hostSock, 'seek', { roomId, position: 40 });
      await sleep(150);
      seen.stop();
      expect(seen.events).toHaveLength(0);
    });

    it('prevents re-joining with the same account, including from a new connection', async () => {
      const { roomId, guest, hostSock } = await room();
      await call(hostSock, 'remove_participant', { roomId, userId: guest.id });
      const fresh = track(await connectSocket(srv, guest));
      expect(await call(fresh, 'join_room', { roomId })).toMatchObject({ ok: false, error: { code: 'REMOVED_FROM_ROOM' } });
      const preview = await http(srv, guest).get(`/api/rooms/${roomId}`);
      expect(preview.body.room.removed).toBe(true);
    });

    it('the Host cannot remove themselves; removing a non-member fails cleanly', async () => {
      const { roomId, host, hostSock } = await room();
      expect(await call(hostSock, 'remove_participant', { roomId, userId: host.id })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(hostSock, 'remove_participant', { roomId, userId: 'nobody' })).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    });
  });

  describe('change requests', () => {
    it('Participant submits; the Host is notified; approval changes the video for everyone', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);

      const created = nextEvent<any>(hostSock, 'request_created');
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: `https://youtu.be/${VIDEO_B}` });
      expect(sub).toMatchObject({ ok: true, data: { status: 'PENDING', videoId: VIDEO_B, requesterId: guest.id } });
      const { request } = await created;
      expect(request.requestId).toBe(sub.data.requestId);
      expect(await ChangeRequestModel.findOne({ requestId: request.requestId }).lean()).toMatchObject({ status: 'PENDING', payload: { videoId: VIDEO_B } });

      const sync = nextEvent<any>(guestSock, 'sync_state');
      const updated = nextEvent<any>(guestSock, 'request_updated');
      const approve = await call<any>(hostSock, 'approve_request', { roomId, requestId: request.requestId });
      expect(approve).toMatchObject({ ok: true, data: { status: 'APPROVED', decidedByName: 'Hostess' } });
      expect(await sync).toMatchObject({ cause: 'request_approved', state: { videoId: VIDEO_B, playing: false, position: 0 } });
      expect((await updated).request).toMatchObject({ status: 'APPROVED' });
      expect(await ChangeRequestModel.findOne({ requestId: request.requestId }).lean()).toMatchObject({ status: 'APPROVED' });
    });

    it('rejection keeps the current video and notifies the requester with the reason', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: VIDEO_B });
      const seen = collect(guestSock, 'sync_state');
      const updated = nextEvent<any>(guestSock, 'request_updated');
      const res = await call<any>(hostSock, 'reject_request', { roomId, requestId: sub.data.requestId, reason: 'Not tonight' });
      expect(res).toMatchObject({ ok: true, data: { status: 'REJECTED', rejectionReason: 'Not tonight' } });
      expect((await updated).request).toMatchObject({ status: 'REJECTED', rejectionReason: 'Not tonight' });
      await sleep(100);
      seen.stop();
      expect(seen.events).toHaveLength(0);
      expect((await RoomModel.findOne({ roomId }).lean())?.videoId).toBe(VIDEO_A);
    });

    it('a decided request cannot be decided again, either way', async () => {
      const { roomId, hostSock, guestSock } = await room();
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: VIDEO_B });
      const requestId = sub.data.requestId;
      expect((await call(hostSock, 'approve_request', { roomId, requestId })).ok).toBe(true);
      expect(await call(hostSock, 'approve_request', { roomId, requestId })).toMatchObject({ ok: false, error: { code: 'REQUEST_ALREADY_DECIDED' } });
      expect(await call(hostSock, 'reject_request', { roomId, requestId })).toMatchObject({ ok: false, error: { code: 'REQUEST_ALREADY_DECIDED' } });
      expect(await call(hostSock, 'approve_request', { roomId, requestId: '00000000-0000-0000-0000-000000000000' })).toMatchObject({ ok: false, error: { code: 'REQUEST_NOT_FOUND' } });
    });

    it('concurrent decisions: exactly one succeeds and the video changes once', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      const mod = await registerUser(srv, 'Mod');
      const modSock = track(await connectSocket(srv, mod));
      await join(modSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: (await ParticipantModel.findOne({ roomId, userId: { $ne: guest.id }, role: 'PARTICIPANT' }).lean())!.userId, role: 'MODERATOR' });
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: VIDEO_D });
      const syncs = collect(guestSock, 'sync_state');
      const results = await Promise.all([
        call(hostSock, 'approve_request', { roomId, requestId: sub.data.requestId }),
        call(modSock, 'approve_request', { roomId, requestId: sub.data.requestId }),
        call(hostSock, 'reject_request', { roomId, requestId: sub.data.requestId }),
      ]);
      await sleep(150);
      syncs.stop();
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && (r as any).error.code === 'REQUEST_ALREADY_DECIDED')).toHaveLength(2);
      expect(syncs.events.length).toBeLessThanOrEqual(1);
    });

    it('a Participant cannot approve, even their own request', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: VIDEO_B });
      expect(await call(guestSock, 'approve_request', { roomId, requestId: sub.data.requestId })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await call(guestSock, 'reject_request', { roomId, requestId: sub.data.requestId })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect((await RoomModel.findOne({ roomId }).lean())?.videoId).toBe(VIDEO_A);
      expect(await ChangeRequestModel.findOne({ requestId: sub.data.requestId }).lean()).toMatchObject({ status: 'PENDING' });
    });

    it('a Moderator can decide requests under the default policy', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      const other = await registerUser(srv, 'Other');
      const otherSock = track(await connectSocket(srv, other));
      await join(otherSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      const created = nextEvent<any>(guestSock, 'request_created');
      const sub = await call<any>(otherSock, 'request_change', { roomId, url: VIDEO_B });
      await created; // moderators are notified too
      expect(await call(guestSock, 'approve_request', { roomId, requestId: sub.data.requestId })).toMatchObject({ ok: true, data: { status: 'APPROVED', decidedBy: guest.id } });
    });

    it('with moderatorsCanDecideRequests=false, Moderators are refused (Host-only policy)', async () => {
      const strict = await startExtraServer({}, { moderatorsCanDecideRequests: false });
      try {
        const host = await registerUser(strict as unknown as TestServer, 'Host Two');
        const mod = await registerUser(strict as unknown as TestServer, 'Mod Two');
        const part = await registerUser(strict as unknown as TestServer, 'Part Two');
        const roomId = await createRoom(strict as unknown as TestServer, host);
        const [hs, ms, ps] = await Promise.all([host, mod, part].map((u) => connectSocket(strict as unknown as TestServer, u)));
        await join(hs!, roomId);
        await join(ms!, roomId);
        await join(ps!, roomId);
        await call(hs!, 'assign_role', { roomId, userId: mod.id, role: 'MODERATOR' });
        const sub = await call<any>(ps!, 'request_change', { roomId, url: VIDEO_B });
        expect(await call(ms!, 'approve_request', { roomId, requestId: sub.data.requestId })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
        expect((await call(hs!, 'approve_request', { roomId, requestId: sub.data.requestId })).ok).toBe(true);
        [hs, ms, ps].forEach((s) => s!.close());
      } finally {
        await strict.stop();
      }
    });

    it('validates requests: bad URL, currently playing video, duplicates, and the pending cap', async () => {
      const { roomId, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      expect(await call(guestSock, 'request_change', { roomId, url: 'https://evil.com/x' })).toMatchObject({ ok: false, error: { code: 'INVALID_VIDEO' } });
      expect(await call(guestSock, 'request_change', { roomId, url: VIDEO_A })).toMatchObject({ ok: false, error: { code: 'INVALID_VIDEO' } });
      expect((await call(guestSock, 'request_change', { roomId, url: VIDEO_B })).ok).toBe(true);
      expect(await call(guestSock, 'request_change', { roomId, url: VIDEO_B })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect((await call(guestSock, 'request_change', { roomId, url: VIDEO_C })).ok).toBe(true);
      expect((await call(guestSock, 'request_change', { roomId, url: VIDEO_D })).ok).toBe(true);
      expect(await call(guestSock, 'request_change', { roomId, url: 'abcdefghijk' })).toMatchObject({ ok: false, error: { code: 'TOO_MANY_REQUESTS' } });
    });

    it('Host and Moderator use change_video directly rather than requests', async () => {
      const { roomId, hostSock } = await room();
      expect(await call(hostSock, 'request_change', { roomId, url: VIDEO_B })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it('cancels pending requests when the requester leaves, and the Host sees it', async () => {
      const { roomId, hostSock, guestSock } = await room();
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: VIDEO_B });
      const updated = nextEvent<any>(hostSock, 'request_updated');
      expect((await call(guestSock, 'leave_room', { roomId })).ok).toBe(true);
      expect((await updated).request).toMatchObject({ requestId: sub.data.requestId, status: 'CANCELLED' });
      expect(await call(hostSock, 'approve_request', { roomId, requestId: sub.data.requestId })).toMatchObject({ ok: false, error: { code: 'REQUEST_ALREADY_DECIDED' } });
    });

    it('snapshots show Hosts all requests and Participants only their own', async () => {
      const { roomId, host, guest, hostSock, guestSock } = await room();
      const other = await registerUser(srv, 'Other');
      const otherSock = track(await connectSocket(srv, other));
      await join(otherSock, roomId);
      await call(guestSock, 'request_change', { roomId, url: VIDEO_B });
      await call(otherSock, 'request_change', { roomId, url: VIDEO_C });
      const asHost = await call<any>(hostSock, 'list_requests', { roomId });
      const asGuest = await call<any>(guestSock, 'list_requests', { roomId });
      expect(asHost.data).toHaveLength(2);
      expect(asGuest.data).toHaveLength(1);
      expect(asGuest.data[0].requesterId).toBe(guest.id);
      void host;
    });
  });

  describe('leaving, presence and reconnection', () => {
    it('leaving notifies the room and ends the membership', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      const left = nextEvent<any>(hostSock, 'user_left');
      expect((await call(guestSock, 'leave_room', { roomId })).ok).toBe(true);
      expect(await left).toMatchObject({ userId: guest.id, displayName: 'Guesty', reason: 'left' });
      expect(await ParticipantModel.findOne({ roomId, userId: guest.id }).lean()).toMatchObject({ status: 'LEFT' });
      expect(await call(guestSock, 'play', { roomId, position: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    });

    it('a participant who left can join again as a Participant', async () => {
      const { roomId, hostSock, guestSock, guest } = await room();
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      await call(guestSock, 'leave_room', { roomId });
      const snap = await join(guestSock, roomId);
      expect(snap.you.role).toBe('PARTICIPANT');
    });

    it('a dropped connection marks the participant offline; reconnecting restores presence, role and state', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      await call(hostSock, 'play', { roomId, position: 20 });

      const offline = nextEvent<any>(hostSock, 'presence_changed', (p) => p.userId === guest.id && p.online === false);
      guestSock.close();
      await offline;

      // While away, the room moves on.
      await call(hostSock, 'seek', { roomId, position: 200 });

      const online = nextEvent<any>(hostSock, 'presence_changed', (p) => p.userId === guest.id && p.online === true);
      const again = track(await connectSocket(srv, guest));
      const snap = await join(again, roomId);
      await online;
      expect(snap.you.role).toBe('MODERATOR');
      expect(snap.state).toMatchObject({ videoId: VIDEO_A, playing: true, position: 200 });
      expect(snap.participants.find((p: any) => p.userId === guest.id).online).toBe(true);
    });

    it('stays online until the last of a user\'s tabs disconnects', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      const tab2 = track(await connectSocket(srv, guest));
      await join(tab2, roomId);
      const seen = collect(hostSock, 'presence_changed');
      guestSock.close();
      await sleep(200);
      expect(seen.events.filter((e: any) => e.online === false)).toHaveLength(0);
      const offline = nextEvent<any>(hostSock, 'presence_changed', (p) => p.online === false);
      tab2.close();
      await offline;
      seen.stop();
    });

    it('Host leaving hands the room to a Moderator first, otherwise the longest-standing member', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      const third = await registerUser(srv, 'Third');
      const thirdSock = track(await connectSocket(srv, third));
      await join(thirdSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: third.id, role: 'MODERATOR' });
      const promoted = nextEvent<any>(guestSock, 'role_assigned', (p) => p.role === 'HOST');
      expect((await call(hostSock, 'leave_room', { roomId })).ok).toBe(true);
      expect(await promoted).toMatchObject({ userId: third.id, role: 'HOST' });
      expect((await RoomModel.findOne({ roomId }).lean())?.hostId).toBe(third.id);
      void guest;
    });

    it('the last member leaving as Host closes the room', async () => {
      const host = await registerUser(srv);
      const roomId = await createRoom(srv, host);
      const sock = track(await connectSocket(srv, host));
      await join(sock, roomId);
      expect((await call(sock, 'leave_room', { roomId })).ok).toBe(true);
      expect((await RoomModel.findOne({ roomId }).lean())?.status).toBe('CLOSED');
    });

    it('closing the room notifies everyone and refuses further actions', async () => {
      const { roomId, hostSock, guestSock } = await room();
      const closed = nextEvent<any>(guestSock, 'room_closed');
      expect((await call(hostSock, 'close_room', { roomId })).ok).toBe(true);
      expect(await closed).toMatchObject({ roomId, reason: 'closed_by_host' });
      expect(await call(hostSock, 'change_video', { roomId, url: VIDEO_B })).toMatchObject({ ok: false, error: { code: 'ROOM_CLOSED' } });
    });
  });

  describe('malformed and hostile input', () => {
    it.each([
      ['no payload', undefined],
      ['null', null],
      ['a string', 'ABCDEFGHJK'],
      ['an array', []],
      ['wrong roomId type', { roomId: 12345 }],
      ['prototype pollution attempt', JSON.parse('{"roomId":"ABCDEFGHJK","__proto__":{"role":"HOST"}}')],
    ])('join_room survives %s', async (_label, payload) => {
      const user = await registerUser(srv);
      const sock = track(await connectSocket(srv, user));
      const res = await call<any>(sock, 'join_room', payload);
      expect(res.ok).toBe(false);
      expect(sock.connected).toBe(true);
    });

    it.each([
      [-5],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      ['10'],
      [null],
      [1e12],
      [{ $gt: 0 }],
    ])('rejects position %j', async (position) => {
      const { roomId, hostSock } = await room();
      await loadVideo(hostSock, roomId);
      expect(await call(hostSock, 'seek', { roomId, position })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    });

    it('rejects oversized URLs and unknown rooms without crashing the server', async () => {
      const { roomId, hostSock } = await room();
      expect(await call(hostSock, 'change_video', { roomId, url: 'a'.repeat(5000) })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
      expect(await call(hostSock, 'play', { roomId: 'ZZZZZZZZZZ', position: 1 })).toMatchObject({ ok: false, error: { code: 'ROOM_NOT_FOUND' } });
      expect((await call(hostSock, 'change_video', { roomId, url: VIDEO_A })).ok).toBe(true);
    });

    it('a user who never joined cannot act in a room they know the code for', async () => {
      const { roomId, hostSock } = await room();
      await loadVideo(hostSock, roomId);
      const stranger = await registerUser(srv, 'Stranger');
      const sock = track(await connectSocket(srv, stranger));
      for (const [event, payload] of [
        ['play', { roomId, position: 1 }],
        ['change_video', { roomId, url: VIDEO_B }],
        ['request_change', { roomId, url: VIDEO_B }],
        ['assign_role', { roomId, userId: stranger.id, role: 'MODERATOR' }],
        ['leave_room', { roomId }],
      ] as const) {
        expect(await call(sock, event, payload), event).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
      }
    });

    it('rate-limits a flooding connection', async () => {
      const limited = await startExtraServer({ socketEventsPerSecond: 5 });
      try {
        const user = await registerUser(limited as unknown as TestServer);
        const sock = await connectSocket(limited as unknown as TestServer, user);
        const results = await Promise.all(Array.from({ length: 12 }, () => call<any>(sock, 'join_room', { roomId: 'ZZZZZZZZZZ' })));
        sock.close();
        expect(results.some((r) => !r.ok && r.error.code === 'TOO_MANY_REQUESTS')).toBe(true);
      } finally {
        await limited.stop();
      }
    });
  });

  describe('persistence and restart', () => {
    it('persists accepted state transitions to MongoDB without writing on every tick', async () => {
      const { roomId, hostSock } = await room();
      await loadVideo(hostSock, roomId, `https://youtu.be/${VIDEO_B}`);
      await call(hostSock, 'play', { roomId, position: 33 });
      await call(hostSock, 'seek', { roomId, position: 61 });
      await srv.manager.idle();
      const stored = await RoomModel.findOne({ roomId }).lean();
      expect(stored).toMatchObject({ videoId: VIDEO_B, playing: true, position: 61, version: 3 });
    });

    it('never lets an older version overwrite a newer one', async () => {
      const { roomId, hostSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'play', { roomId, position: 10 });
      await srv.manager.idle();
      const before = await RoomModel.findOne({ roomId }).lean();
      const stale = await RoomModel.updateOne({ roomId, version: { $lt: 1 } }, { $set: { position: 9999 } });
      expect(stale.modifiedCount).toBe(0);
      expect((await RoomModel.findOne({ roomId }).lean())?.position).toBe(before?.position);
    });

    it('restores a room after a server restart: video and position kept, playback safely paused', async () => {
      const { roomId, host, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId, `https://youtu.be/${VIDEO_C}`);
      await call(hostSock, 'play', { roomId, position: 77 });
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      await srv.manager.idle();
      hostSock.close();
      guestSock.close();

      const restarted = await startExtraServer(); // fresh process-equivalent: empty memory, same database
      try {
        const sock = await connectSocket(restarted as unknown as TestServer, host);
        const snap = await join(sock, roomId);
        expect(snap.you.role).toBe('HOST');
        expect(snap.state).toMatchObject({ videoId: VIDEO_C, playing: false, position: 77 });
        expect(snap.state.version).toBe(2);
        expect(snap.participants.find((p: any) => p.userId === guest.id).role).toBe('MODERATOR');
        // A removed user stays removed after restart.
        const sock2 = await connectSocket(restarted as unknown as TestServer, guest);
        await join(sock2, roomId);
        expect((await call(sock, 'remove_participant', { roomId, userId: guest.id })).ok).toBe(true);
        sock.close();
        sock2.close();
      } finally {
        await restarted.stop();
      }
      const again = await startExtraServer();
      try {
        const sock = await connectSocket(again as unknown as TestServer, guest);
        expect(await call(sock, 'join_room', { roomId })).toMatchObject({ ok: false, error: { code: 'REMOVED_FROM_ROOM' } });
        sock.close();
      } finally {
        await again.stop();
      }
    });

    it('records administrative actions in the audit log', async () => {
      const { roomId, guest, hostSock, guestSock } = await room();
      await loadVideo(hostSock, roomId);
      await call(hostSock, 'assign_role', { roomId, userId: guest.id, role: 'MODERATOR' });
      const sub = await call<any>(guestSock, 'request_change', { roomId, url: VIDEO_B }).catch(() => null);
      void sub;
      await call(hostSock, 'remove_participant', { roomId, userId: guest.id });
      await srv.manager.idle();
      const actions = (await AuditLogModel.find({ roomId }).sort({ createdAt: 1 }).lean()).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['ROOM_CREATED', 'VIDEO_CHANGED', 'ROLE_ASSIGNED', 'PARTICIPANT_REMOVED']));
    });

    it('sweeps idle rooms and stale participants', async () => {
      const host = await registerUser(srv);
      const roomId = await createRoom(srv, host);
      const old = new Date(Date.now() - 72 * 3600 * 1000);
      await RoomModel.collection.updateOne({ roomId }, { $set: { updatedAt: old } });
      await ParticipantModel.collection.updateOne({ roomId }, { $set: { lastSeenAt: old } });
      const result = await srv.manager.sweep(48);
      expect(result.roomsClosed).toBeGreaterThanOrEqual(1);
      expect(result.participantsExpired).toBeGreaterThanOrEqual(1);
      expect((await RoomModel.findOne({ roomId }).lean())?.status).toBe('CLOSED');
    });
  });
});

export type { TestUser };
