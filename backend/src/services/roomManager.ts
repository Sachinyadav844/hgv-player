import {
  can,
  parseYouTubeInput,
  expectedPosition,
  LIMITS,
  type Action,
  type ClientToServerEvents,
  type ParticipantDTO,
  type PermissionPolicy,
  type PlaybackAck,
  type PlaybackState,
  type RequestDTO,
  type Role,
  type RoomDTO,
  type RoomPreview,
  type RoomSnapshot,
  type RoomStatus,
  type RoomSummary,
  type ServerToClientEvents,
  type SyncCause,
} from '@hgv/shared';
import {
  AuditLogModel,
  ChangeRequestModel,
  ParticipantModel,
  RoomModel,
  type AuditAction,
  type ChangeRequestDoc,
  type RoomDoc,
} from '../models';
import { AppError, isDuplicateKeyError } from '../utils/errors';
import { generateRoomId, newRequestId } from '../utils/ids';
import { log } from '../utils/logger';
import type { AuthUser } from './authService';

/**
 * How the manager talks to connected clients. The Socket.IO layer implements it; keeping it as
 * an interface means all permission and state logic lives here, independent of the transport.
 */
export interface Gateway {
  toRoom<E extends keyof ServerToClientEvents>(
    roomId: string,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
  toUser<E extends keyof ServerToClientEvents>(
    roomId: string,
    userId: string,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
  /** Takes every socket of this user out of the room's broadcast channels. */
  evictUser(roomId: string, userId: string): void;
  /** Takes every socket out of the room's broadcast channels. */
  evictAll(roomId: string): void;
}

export interface RoomManagerOptions {
  policy: PermissionPolicy;
  maxPendingRequestsPerUser?: number;
  now?: () => number;
}

interface Member {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: Date;
}

const RUNTIME_IDLE_MS = 15 * 60 * 1000;
const ROLE_RANK: Record<Role, number> = { HOST: 0, MODERATOR: 1, PARTICIPANT: 2 };

/**
 * In-memory working copy of one room. It is the authority for membership and playback while the
 * server runs; MongoDB holds the durable copy that is written on every accepted state change.
 *
 * All mutations go through `exclusive()`, which serialises them per room. That gives every
 * room a single, consistent ordering of events and removes check-then-act races (for example two
 * moderators deciding the same request at once).
 */
class Runtime {
  readonly members = new Map<string, Member>();
  readonly banned = new Set<string>();
  readonly pending = new Map<string, ChangeRequestDoc>();
  readonly online = new Map<string, Set<string>>();
  lastActivity = Date.now();
  busy = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    readonly roomId: string,
    public name: string,
    public ownerId: string,
    public hostId: string,
    public status: RoomStatus,
    readonly createdAt: Date,
    public state: PlaybackState,
  ) {}

  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.busy += 1;
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.busy -= 1;
    });
  }
}

export class RoomManager {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly loading = new Map<string, Promise<Runtime | null>>();
  private readonly pendingWrites = new Set<Promise<unknown>>();
  private readonly now: () => number;
  private readonly maxPending: number;

  constructor(
    private readonly gateway: Gateway,
    private readonly opts: RoomManagerOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.maxPending = opts.maxPendingRequestsPerUser ?? LIMITS.maxPendingRequestsPerUser;
  }

  /** Resolves once all background database writes started so far have finished. */
  async idle(): Promise<void> {
    while (this.pendingWrites.size > 0) await Promise.all([...this.pendingWrites]);
  }

  // ---------------------------------------------------------------- rooms: REST-facing

  async createRoom(user: AuthUser, name: string): Promise<RoomDTO> {
    let room: RoomDoc | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      try {
        const created = await RoomModel.create({
          roomId: generateRoomId(),
          name,
          ownerId: user.id,
          hostId: user.id,
          status: 'OPEN',
          videoId: null,
          playing: false,
          position: 0,
          positionUpdatedAt: new Date(),
          version: 0,
        });
        room = created.toObject() as RoomDoc;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err; // room-ID collision: try a new ID
      }
    }
    if (!room) throw new AppError('INTERNAL', 'Could not allocate a room code. Please try again.');

    try {
      const now = new Date();
      await ParticipantModel.create({
        roomId: room.roomId,
        userId: user.id,
        displayName: user.name,
        role: 'HOST',
        status: 'ACTIVE',
        joinedAt: now,
        lastSeenAt: now,
      });
    } catch (err) {
      await RoomModel.deleteOne({ roomId: room.roomId }).catch(() => undefined);
      throw err;
    }
    this.audit(room.roomId, user.id, 'ROOM_CREATED', null, { name });
    return {
      roomId: room.roomId,
      name: room.name,
      hostId: room.hostId,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
    };
  }

  async preview(roomId: string, userId: string): Promise<RoomPreview> {
    const room = await RoomModel.findOne({ roomId }).lean();
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'No room exists with that code.');
    const [participantCount, host, mine] = await Promise.all([
      ParticipantModel.countDocuments({ roomId, status: 'ACTIVE' }),
      ParticipantModel.findOne({ roomId, role: 'HOST', status: 'ACTIVE' }).lean(),
      ParticipantModel.findOne({ roomId, userId }).lean(),
    ]);
    return {
      roomId: room.roomId,
      name: room.name,
      status: room.status,
      hostName: host?.displayName ?? null,
      participantCount,
      createdAt: room.createdAt.toISOString(),
      membership: mine?.status === 'ACTIVE' ? { role: mine.role } : null,
      removed: mine?.status === 'REMOVED',
    };
  }

  async roomsForUser(userId: string): Promise<RoomSummary[]> {
    const memberships = await ParticipantModel.find({ userId, status: 'ACTIVE' }).lean();
    if (memberships.length === 0) return [];
    const rooms = await RoomModel.find({
      roomId: { $in: memberships.map((m) => m.roomId) },
      status: 'OPEN',
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    const roleByRoom = new Map(memberships.map((m) => [m.roomId, m.role]));
    return rooms.map((r) => ({
      roomId: r.roomId,
      name: r.name,
      status: r.status,
      role: roleByRoom.get(r.roomId) ?? 'PARTICIPANT',
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- runtime loading

  private async load(roomId: string): Promise<Runtime> {
    const existing = this.runtimes.get(roomId);
    if (existing) return existing;
    let promise = this.loading.get(roomId);
    if (!promise) {
      promise = this.hydrate(roomId).finally(() => this.loading.delete(roomId));
      this.loading.set(roomId, promise);
    }
    const rt = await promise;
    if (!rt) throw new AppError('ROOM_NOT_FOUND', 'No room exists with that code.');
    return rt;
  }

  private async hydrate(roomId: string): Promise<Runtime | null> {
    const room = await RoomModel.findOne({ roomId }).lean();
    if (!room) return null;
    const [participants, pending] = await Promise.all([
      ParticipantModel.find({ roomId }).lean(),
      ChangeRequestModel.find({ roomId, status: 'PENDING' }).sort({ createdAt: 1 }).lean(),
    ]);

    const now = this.now();
    // After a restart the room comes back paused at the last persisted position: the server
    // cannot know how long it was down, so it never pretends playback kept running.
    const state: PlaybackState = {
      videoId: room.videoId,
      playing: false,
      position: room.position,
      updatedAt: now,
      version: room.version,
    };
    const rt = new Runtime(room.roomId, room.name, room.ownerId, room.hostId, room.status, room.createdAt, state);
    for (const p of participants) {
      if (p.status === 'ACTIVE') {
        rt.members.set(p.userId, {
          userId: p.userId,
          displayName: p.displayName,
          role: p.role,
          joinedAt: p.joinedAt,
        });
      } else if (p.status === 'REMOVED') {
        rt.banned.add(p.userId);
      }
    }
    for (const r of pending) rt.pending.set(r.requestId, r as ChangeRequestDoc);

    // Defensive repair: an open room must always have exactly one Host.
    if (rt.status === 'OPEN') {
      const hosts = [...rt.members.values()].filter((m) => m.role === 'HOST');
      if (rt.members.size === 0) {
        rt.status = 'CLOSED';
        await RoomModel.updateOne({ roomId }, { $set: { status: 'CLOSED', closedAt: new Date() } });
      } else if (hosts.length === 0) {
        const successor = this.pickSuccessor(rt, null);
        if (successor) await this.promote(rt, successor);
      } else {
        rt.hostId = hosts[0]!.userId;
      }
    }
    this.runtimes.set(roomId, rt);
    return rt;
  }

  // ---------------------------------------------------------------- joining and leaving

  async join(user: AuthUser, roomId: string, socketId: string, attach: () => void): Promise<RoomSnapshot> {
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      if (rt.status === 'CLOSED') throw new AppError('ROOM_CLOSED', 'This room has been closed.');
      if (rt.banned.has(user.id)) {
        throw new AppError('REMOVED_FROM_ROOM', 'You were removed from this room by the host.');
      }

      let member = rt.members.get(user.id);
      let isNew = false;
      const now = new Date();
      if (!member) {
        member = { userId: user.id, displayName: user.name, role: 'PARTICIPANT', joinedAt: now };
        await this.upsertParticipant(rt.roomId, member, 'ACTIVE');
        rt.members.set(user.id, member);
        isNew = true;
      } else if (member.displayName !== user.name) {
        member.displayName = user.name;
        this.track(
          ParticipantModel.updateOne({ roomId, userId: user.id }, { $set: { displayName: user.name } }),
        );
      }

      // The socket joins the broadcast channels inside the lock, after membership is final and
      // before the snapshot is taken, so no event can fall into the gap between the two.
      attach();
      const firstSocket = this.markOnline(rt, user.id, socketId);
      rt.lastActivity = this.now();
      this.track(ParticipantModel.updateOne({ roomId, userId: user.id }, { $set: { lastSeenAt: now } }));

      if (isNew) {
        this.gateway.toRoom(roomId, 'user_joined', {
          roomId,
          participant: this.toParticipantDTO(rt, member),
        });
      } else if (firstSocket) {
        this.gateway.toRoom(roomId, 'presence_changed', { roomId, userId: user.id, online: true });
      }
      return this.snapshotFor(rt, user.id);
    });
  }

  /** Called when a socket that had joined this room disconnects. */
  async disconnect(userId: string, roomId: string, socketId: string): Promise<void> {
    const rt = this.runtimes.get(roomId);
    if (!rt) return;
    await rt.exclusive(async () => {
      const sockets = rt.online.get(userId);
      if (!sockets) return;
      sockets.delete(socketId);
      if (sockets.size > 0) return;
      rt.online.delete(userId);
      rt.lastActivity = this.now();
      if (rt.members.has(userId)) {
        this.gateway.toRoom(roomId, 'presence_changed', { roomId, userId, online: false });
        this.track(
          ParticipantModel.updateOne({ roomId, userId }, { $set: { lastSeenAt: new Date() } }),
        );
      }
    });
  }

  async leave(user: AuthUser, roomId: string): Promise<void> {
    const rt = await this.load(roomId);
    await rt.exclusive(async () => {
      const member = this.authorize(rt, user.id);
      await this.deactivate(rt, member, 'LEFT');
      this.gateway.toRoom(roomId, 'user_left', {
        roomId,
        userId: member.userId,
        displayName: member.displayName,
        reason: 'left',
      });
      this.gateway.evictUser(roomId, member.userId);
      rt.online.delete(member.userId);

      if (member.role === 'HOST') {
        const successor = this.pickSuccessor(rt, member.userId);
        if (successor) {
          await this.promote(rt, successor);
          this.gateway.toRoom(roomId, 'role_assigned', {
            roomId,
            userId: successor.userId,
            role: 'HOST',
            byUserId: member.userId,
          });
          this.audit(roomId, member.userId, 'HOST_TRANSFERRED', successor.userId, { reason: 'host_left' });
        } else {
          await this.closeInternal(rt, member.userId, 'host_left');
        }
      }
    });
  }

  // ---------------------------------------------------------------- playback

  async playback(
    user: AuthUser,
    roomId: string,
    action: 'play' | 'pause' | 'seek',
    position: number,
  ): Promise<PlaybackAck> {
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      this.authorize(rt, user.id, 'playback:control');
      if (!rt.state.videoId) throw new AppError('NO_VIDEO', 'Load a video before controlling playback.');
      const state = rt.state;
      const expected = expectedPosition(state, this.now());

      let patch: Partial<Pick<PlaybackState, 'playing' | 'position'>> | null = null;
      if (action === 'play') {
        // Already playing at (nearly) this position: nothing to broadcast.
        if (!(state.playing && Math.abs(expected - position) < 1)) patch = { playing: true, position };
      } else if (action === 'pause') {
        if (!(!state.playing && Math.abs(state.position - position) < 0.5)) {
          patch = { playing: false, position };
        }
      } else if (Math.abs(expected - position) >= 0.5) {
        patch = { position };
      }

      if (!patch) return { state, changed: false };
      return { state: this.commit(rt, patch, user.id, action), changed: true };
    });
  }

  async changeVideo(user: AuthUser, roomId: string, url: string): Promise<PlaybackAck> {
    const videoId = parseYouTubeInput(url);
    if (!videoId) throw new AppError('INVALID_VIDEO', 'Enter a valid YouTube link or video ID.');
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      this.authorize(rt, user.id, 'video:change');
      const state = this.commit(rt, { videoId, playing: false, position: 0 }, user.id, 'change_video');
      this.audit(roomId, user.id, 'VIDEO_CHANGED', null, { videoId });
      return { state, changed: true };
    });
  }

  // ---------------------------------------------------------------- roles and members

  async assignRole(
    user: AuthUser,
    roomId: string,
    targetId: string,
    role: 'MODERATOR' | 'PARTICIPANT',
  ): Promise<ParticipantDTO> {
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      this.authorize(rt, user.id, 'role:assign');
      if (targetId === user.id) {
        throw new AppError('FORBIDDEN', 'The Host cannot change their own role. Transfer host instead.');
      }
      const target = rt.members.get(targetId);
      if (!target) throw new AppError('NOT_A_MEMBER', 'That person is not in this room.');
      if (target.role === role) {
        throw new AppError('ROLE_UNCHANGED', `${target.displayName} is already a ${role.toLowerCase()}.`);
      }
      const previous = target.role;
      target.role = role;
      await ParticipantModel.updateOne({ roomId, userId: targetId }, { $set: { role } });
      this.audit(roomId, user.id, 'ROLE_ASSIGNED', targetId, { from: previous, to: role });
      this.gateway.toRoom(roomId, 'role_assigned', { roomId, userId: targetId, role, byUserId: user.id });
      return this.toParticipantDTO(rt, target);
    });
  }

  async removeParticipant(user: AuthUser, roomId: string, targetId: string): Promise<void> {
    const rt = await this.load(roomId);
    await rt.exclusive(async () => {
      this.authorize(rt, user.id, 'participant:remove');
      if (targetId === user.id) {
        throw new AppError('FORBIDDEN', 'The Host cannot remove themselves. Leave the room instead.');
      }
      const target = rt.members.get(targetId);
      if (!target) throw new AppError('NOT_A_MEMBER', 'That person is not in this room.');

      await this.deactivate(rt, target, 'REMOVED');
      this.audit(roomId, user.id, 'PARTICIPANT_REMOVED', targetId, { displayName: target.displayName });
      const payload = { roomId, userId: targetId, displayName: target.displayName, byUserId: user.id };
      // Tell the removed user first, then cut their sockets off the room's channels.
      this.gateway.toUser(roomId, targetId, 'participant_removed', payload);
      this.gateway.evictUser(roomId, targetId);
      rt.online.delete(targetId);
      this.gateway.toRoom(roomId, 'participant_removed', payload);
    });
  }

  async transferHost(user: AuthUser, roomId: string, targetId: string): Promise<void> {
    const rt = await this.load(roomId);
    await rt.exclusive(async () => {
      const current = this.authorize(rt, user.id, 'host:transfer');
      if (targetId === user.id) throw new AppError('ROLE_UNCHANGED', 'You are already the host.');
      const target = rt.members.get(targetId);
      if (!target) throw new AppError('NOT_A_MEMBER', 'That person is not in this room.');
      current.role = 'MODERATOR';
      await ParticipantModel.updateOne({ roomId, userId: current.userId }, { $set: { role: 'MODERATOR' } });
      await this.promote(rt, target);
      this.audit(roomId, user.id, 'HOST_TRANSFERRED', targetId, {});
      this.gateway.toRoom(roomId, 'role_assigned', { roomId, userId: user.id, role: 'MODERATOR', byUserId: user.id });
      this.gateway.toRoom(roomId, 'role_assigned', { roomId, userId: targetId, role: 'HOST', byUserId: user.id });
    });
  }

  async closeRoom(user: AuthUser, roomId: string): Promise<void> {
    const rt = await this.load(roomId);
    await rt.exclusive(async () => {
      this.authorize(rt, user.id, 'room:close');
      await this.closeInternal(rt, user.id, 'closed_by_host');
    });
  }

  // ---------------------------------------------------------------- change requests

  async requestChange(user: AuthUser, roomId: string, url: string): Promise<RequestDTO> {
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      const member = this.authorize(rt, user.id, 'request:create');
      const videoId = parseYouTubeInput(url);
      if (!videoId) throw new AppError('INVALID_VIDEO', 'Enter a valid YouTube link or video ID.');
      if (rt.state.videoId === videoId) {
        throw new AppError('INVALID_VIDEO', 'That video is already playing in this room.');
      }
      const mine = [...rt.pending.values()].filter((r) => r.requesterId === user.id);
      if (mine.length >= this.maxPending) {
        throw new AppError(
          'TOO_MANY_REQUESTS',
          `You already have ${this.maxPending} pending requests. Wait for a decision first.`,
        );
      }
      if (mine.some((r) => r.payload.videoId === videoId)) {
        throw new AppError('CONFLICT', 'You already requested that video.');
      }

      const created = await ChangeRequestModel.create({
        requestId: newRequestId(),
        roomId,
        requesterId: user.id,
        requesterName: member.displayName,
        type: 'VIDEO_CHANGE',
        payload: { videoId },
        status: 'PENDING',
      });
      const doc = created.toObject() as ChangeRequestDoc;
      rt.pending.set(doc.requestId, doc);
      const dto = this.toRequestDTO(doc);
      this.notifyRequest(rt, 'request_created', dto);
      return dto;
    });
  }

  async decideRequest(
    user: AuthUser,
    roomId: string,
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason?: string,
  ): Promise<RequestDTO> {
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      // Permissions are re-checked here, at decision time, not when the request was created.
      this.authorize(rt, user.id, 'request:decide');
      if (!rt.pending.has(requestId)) {
        const known = await ChangeRequestModel.exists({ requestId, roomId });
        throw known
          ? new AppError('REQUEST_ALREADY_DECIDED', 'This request has already been handled.')
          : new AppError('REQUEST_NOT_FOUND', 'That request does not exist.');
      }
      // The conditional update is the atomic guard: only one decision can ever win.
      const updated = await ChangeRequestModel.findOneAndUpdate(
        { requestId, roomId, status: 'PENDING' },
        {
          $set: {
            status: decision,
            decidedBy: user.id,
            decidedByName: user.name,
            decidedAt: new Date(),
            rejectionReason: decision === 'REJECTED' ? (reason?.trim() || null) : null,
          },
        },
        { returnDocument: 'after' },
      ).lean();
      rt.pending.delete(requestId);
      if (!updated) throw new AppError('REQUEST_ALREADY_DECIDED', 'This request has already been handled.');

      if (decision === 'APPROVED') {
        this.commit(
          rt,
          { videoId: updated.payload.videoId, playing: false, position: 0 },
          user.id,
          'request_approved',
        );
        this.audit(roomId, user.id, 'REQUEST_APPROVED', updated.requesterId, {
          requestId,
          videoId: updated.payload.videoId,
        });
      } else {
        this.audit(roomId, user.id, 'REQUEST_REJECTED', updated.requesterId, { requestId });
      }
      const dto = this.toRequestDTO(updated as ChangeRequestDoc);
      this.notifyRequest(rt, 'request_updated', dto);
      return dto;
    });
  }

  async listRequests(user: AuthUser, roomId: string): Promise<RequestDTO[]> {
    const rt = await this.load(roomId);
    return rt.exclusive(async () => {
      const member = this.authorize(rt, user.id);
      return this.requestsFor(rt, member);
    });
  }

  // ---------------------------------------------------------------- housekeeping

  /** Drops idle in-memory rooms and closes rooms nobody has touched for `idleHours`. */
  async sweep(idleHours: number): Promise<{ runtimesDropped: number; roomsClosed: number; participantsExpired: number }> {
    const now = this.now();
    let runtimesDropped = 0;
    for (const [roomId, rt] of this.runtimes) {
      if (rt.online.size === 0 && rt.busy === 0 && now - rt.lastActivity > RUNTIME_IDLE_MS) {
        this.runtimes.delete(roomId);
        runtimesDropped += 1;
      }
    }
    const cutoff = new Date(now - idleHours * 3600 * 1000);
    const active = [...this.runtimes.keys()];
    const rooms = await RoomModel.updateMany(
      { status: 'OPEN', updatedAt: { $lt: cutoff }, roomId: { $nin: active } },
      { $set: { status: 'CLOSED', closedAt: new Date() } },
    );
    const participants = await ParticipantModel.updateMany(
      { status: 'ACTIVE', lastSeenAt: { $lt: cutoff }, roomId: { $nin: active } },
      { $set: { status: 'LEFT' } },
    );
    return {
      runtimesDropped,
      roomsClosed: rooms.modifiedCount,
      participantsExpired: participants.modifiedCount,
    };
  }

  // ---------------------------------------------------------------- internals

  /**
   * The single authorization gate. Every sensitive operation calls this inside the room lock, so
   * identity (authenticated user), membership, room state and role are all checked against the
   * server's own records on every call. Nothing is taken from the client payload.
   */
  private authorize(rt: Runtime, userId: string, action?: Action): Member {
    if (rt.banned.has(userId)) {
      throw new AppError('REMOVED_FROM_ROOM', 'You were removed from this room by the host.');
    }
    const member = rt.members.get(userId);
    if (!member) throw new AppError('NOT_A_MEMBER', 'You are not a member of this room.');
    if (rt.status !== 'OPEN') throw new AppError('ROOM_CLOSED', 'This room has been closed.');
    if (action && !can(member.role, action, this.opts.policy)) {
      throw new AppError('FORBIDDEN', `Your role (${member.role.toLowerCase()}) is not allowed to do that.`);
    }
    return member;
  }

  private commit(
    rt: Runtime,
    patch: Partial<Pick<PlaybackState, 'videoId' | 'playing' | 'position'>>,
    byUserId: string,
    cause: SyncCause,
  ): PlaybackState {
    const now = this.now();
    const next: PlaybackState = { ...rt.state, ...patch, updatedAt: now, version: rt.state.version + 1 };
    rt.state = next;
    rt.lastActivity = now;
    // Persist the transition (not every tick). The version guard stops an older write from
    // overwriting a newer one if two writes are ever reordered.
    this.track(
      RoomModel.updateOne(
        { roomId: rt.roomId, version: { $lt: next.version } },
        {
          $set: {
            videoId: next.videoId,
            playing: next.playing,
            position: next.position,
            positionUpdatedAt: new Date(next.updatedAt),
            version: next.version,
          },
        },
      ),
    );
    this.gateway.toRoom(rt.roomId, 'sync_state', {
      roomId: rt.roomId,
      state: next,
      serverTime: now,
      cause,
      byUserId,
    });
    return next;
  }

  private markOnline(rt: Runtime, userId: string, socketId: string): boolean {
    let set = rt.online.get(userId);
    const first = !set || set.size === 0;
    if (!set) {
      set = new Set();
      rt.online.set(userId, set);
    }
    set.add(socketId);
    return first;
  }

  private async upsertParticipant(roomId: string, member: Member, status: 'ACTIVE' | 'LEFT' | 'REMOVED') {
    const doc = {
      displayName: member.displayName,
      role: member.role,
      status,
      joinedAt: member.joinedAt,
      lastSeenAt: new Date(),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await ParticipantModel.updateOne({ roomId, userId: member.userId }, { $set: doc }, { upsert: true });
        return;
      } catch (err) {
        if (!isDuplicateKeyError(err) || attempt === 1) throw err;
      }
    }
  }

  /** Ends a membership (left or removed) and cancels the person's pending requests. */
  private async deactivate(rt: Runtime, member: Member, status: 'LEFT' | 'REMOVED'): Promise<void> {
    await ParticipantModel.updateOne(
      { roomId: rt.roomId, userId: member.userId },
      { $set: { status, lastSeenAt: new Date() } },
    );
    rt.members.delete(member.userId);
    if (status === 'REMOVED') rt.banned.add(member.userId);
    await this.cancelPendingFor(rt, member.userId);
  }

  private async cancelPendingFor(rt: Runtime, userId: string): Promise<void> {
    const mine = [...rt.pending.values()].filter((r) => r.requesterId === userId);
    for (const req of mine) {
      rt.pending.delete(req.requestId);
      const updated = await ChangeRequestModel.findOneAndUpdate(
        { requestId: req.requestId, status: 'PENDING' },
        { $set: { status: 'CANCELLED', decidedAt: new Date() } },
        { returnDocument: 'after' },
      ).lean();
      if (updated) {
        const dto = this.toRequestDTO(updated as ChangeRequestDoc);
        for (const m of this.approvers(rt)) {
          this.gateway.toUser(rt.roomId, m.userId, 'request_updated', { roomId: rt.roomId, request: dto });
        }
      }
    }
  }

  private pickSuccessor(rt: Runtime, excludeId: string | null): Member | null {
    const candidates = [...rt.members.values()].filter((m) => m.userId !== excludeId);
    candidates.sort((a, b) => {
      const byRole = ROLE_RANK[a.role] - ROLE_RANK[b.role];
      if (byRole !== 0) return byRole;
      const byOnline = Number(rt.online.has(b.userId)) - Number(rt.online.has(a.userId));
      if (byOnline !== 0) return byOnline;
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    });
    return candidates[0] ?? null;
  }

  private async promote(rt: Runtime, member: Member): Promise<void> {
    member.role = 'HOST';
    rt.hostId = member.userId;
    await ParticipantModel.updateOne({ roomId: rt.roomId, userId: member.userId }, { $set: { role: 'HOST' } });
    await RoomModel.updateOne({ roomId: rt.roomId }, { $set: { hostId: member.userId } });
  }

  private async closeInternal(rt: Runtime, byUserId: string, reason: 'closed_by_host' | 'host_left') {
    rt.status = 'CLOSED';
    await RoomModel.updateOne({ roomId: rt.roomId }, { $set: { status: 'CLOSED', closedAt: new Date() } });
    for (const req of [...rt.pending.values()]) {
      rt.pending.delete(req.requestId);
      this.track(
        ChangeRequestModel.updateOne(
          { requestId: req.requestId, status: 'PENDING' },
          { $set: { status: 'CANCELLED', decidedAt: new Date() } },
        ),
      );
    }
    this.audit(rt.roomId, byUserId, 'ROOM_CLOSED', null, { reason });
    this.gateway.toRoom(rt.roomId, 'room_closed', { roomId: rt.roomId, reason });
    this.gateway.evictAll(rt.roomId);
    rt.online.clear();
  }

  private approvers(rt: Runtime): Member[] {
    return [...rt.members.values()].filter((m) => can(m.role, 'request:decide', this.opts.policy));
  }

  private notifyRequest(rt: Runtime, event: 'request_created' | 'request_updated', dto: RequestDTO) {
    const recipients = new Set<string>(this.approvers(rt).map((m) => m.userId));
    if (rt.members.has(dto.requesterId)) recipients.add(dto.requesterId);
    for (const userId of recipients) {
      this.gateway.toUser(rt.roomId, userId, event, { roomId: rt.roomId, request: dto });
    }
  }

  private async requestsFor(rt: Runtime, member: Member): Promise<RequestDTO[]> {
    const canDecide = can(member.role, 'request:decide', this.opts.policy);
    const docs = await ChangeRequestModel.find(
      canDecide ? { roomId: rt.roomId } : { roomId: rt.roomId, requesterId: member.userId },
    )
      .sort({ createdAt: -1 })
      .limit(canDecide ? LIMITS.maxRequestsReturned : 10)
      .lean();
    return docs.map((d) => this.toRequestDTO(d as ChangeRequestDoc));
  }

  private async snapshotFor(rt: Runtime, userId: string): Promise<RoomSnapshot> {
    const member = rt.members.get(userId)!;
    const now = this.now();
    return {
      room: this.toRoomDTO(rt),
      you: { userId, role: member.role },
      participants: [...rt.members.values()]
        .sort(
          (a, b) =>
            ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.joinedAt.getTime() - b.joinedAt.getTime(),
        )
        .map((m) => this.toParticipantDTO(rt, m)),
      requests: await this.requestsFor(rt, member),
      state: rt.state,
      serverTime: now,
    };
  }

  private toRoomDTO(rt: Runtime): RoomDTO {
    return {
      roomId: rt.roomId,
      name: rt.name,
      hostId: rt.hostId,
      status: rt.status,
      createdAt: rt.createdAt.toISOString(),
    };
  }

  private toParticipantDTO(rt: Runtime, m: Member): ParticipantDTO {
    return {
      userId: m.userId,
      displayName: m.displayName,
      role: m.role,
      online: (rt.online.get(m.userId)?.size ?? 0) > 0,
      joinedAt: m.joinedAt.toISOString(),
    };
  }

  private toRequestDTO(d: ChangeRequestDoc): RequestDTO {
    return {
      requestId: d.requestId,
      roomId: d.roomId,
      type: d.type,
      videoId: d.payload.videoId,
      requesterId: d.requesterId,
      requesterName: d.requesterName,
      status: d.status,
      decidedBy: d.decidedBy,
      decidedByName: d.decidedByName,
      decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt.toISOString(),
    };
  }

  private audit(roomId: string, actorId: string, action: AuditAction, targetId: string | null, meta: Record<string, unknown>) {
    this.track(AuditLogModel.create({ roomId, actorId, action, targetId, meta }));
  }

  private track(op: PromiseLike<unknown>): void {
    const tracked: Promise<unknown> = Promise.resolve(op)
      .catch((err) => log.warn(`Background database write failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => this.pendingWrites.delete(tracked));
    this.pendingWrites.add(tracked);
  }
}

export type { ClientToServerEvents };
