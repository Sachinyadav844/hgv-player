import type { Role } from './permissions';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'NOT_A_MEMBER'
  | 'REMOVED_FROM_ROOM'
  | 'INVALID_VIDEO'
  | 'NO_VIDEO'
  | 'REQUEST_NOT_FOUND'
  | 'REQUEST_ALREADY_DECIDED'
  | 'ROLE_UNCHANGED'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'DB_UNAVAILABLE'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface PlaybackState {
  videoId: string | null;
  playing: boolean;
  /** Playback position in seconds at `updatedAt` (server clock). */
  position: number;
  /** Server timestamp (ms since epoch) at which `position` was valid. */
  updatedAt: number;
  /** Monotonic per-room counter. Clients ignore states with a version they already passed. */
  version: number;
}

export type RoomStatus = 'OPEN' | 'CLOSED';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export interface RoomDTO {
  roomId: string;
  name: string;
  hostId: string;
  status: RoomStatus;
  createdAt: string;
}

export interface ParticipantDTO {
  userId: string;
  displayName: string;
  role: Role;
  online: boolean;
  joinedAt: string;
}

export interface RequestDTO {
  requestId: string;
  roomId: string;
  type: 'VIDEO_CHANGE';
  videoId: string;
  requesterId: string;
  requesterName: string;
  status: RequestStatus;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface RoomSnapshot {
  room: RoomDTO;
  you: { userId: string; role: Role };
  participants: ParticipantDTO[];
  requests: RequestDTO[];
  state: PlaybackState;
  serverTime: number;
}

export interface RoomPreview {
  roomId: string;
  name: string;
  status: RoomStatus;
  hostName: string | null;
  participantCount: number;
  createdAt: string;
  /** Present when the caller is an active member. */
  membership: { role: Role } | null;
  /** True when the caller was removed from this room and cannot rejoin. */
  removed: boolean;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  status: RoomStatus;
  role: Role;
  updatedAt: string;
}

export type Ack<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export type SyncCause =
  | 'play'
  | 'pause'
  | 'seek'
  | 'change_video'
  | 'request_approved';

export interface RoomIdPayload {
  roomId: string;
}
export interface PositionPayload extends RoomIdPayload {
  position: number;
}
export interface ChangeVideoPayload extends RoomIdPayload {
  url: string;
}
export interface AssignRolePayload extends RoomIdPayload {
  userId: string;
  role: 'MODERATOR' | 'PARTICIPANT';
}
export interface TargetUserPayload extends RoomIdPayload {
  userId: string;
}
export interface RequestIdPayload extends RoomIdPayload {
  requestId: string;
}
export interface RejectRequestPayload extends RequestIdPayload {
  reason?: string;
}

export interface PlaybackAck {
  state: PlaybackState;
  changed: boolean;
}

export interface ClientToServerEvents {
  join_room(p: RoomIdPayload, ack: (r: Ack<RoomSnapshot>) => void): void;
  leave_room(p: RoomIdPayload, ack: (r: Ack<null>) => void): void;
  play(p: PositionPayload, ack: (r: Ack<PlaybackAck>) => void): void;
  pause(p: PositionPayload, ack: (r: Ack<PlaybackAck>) => void): void;
  seek(p: PositionPayload, ack: (r: Ack<PlaybackAck>) => void): void;
  change_video(p: ChangeVideoPayload, ack: (r: Ack<PlaybackAck>) => void): void;
  assign_role(p: AssignRolePayload, ack: (r: Ack<ParticipantDTO>) => void): void;
  remove_participant(p: TargetUserPayload, ack: (r: Ack<null>) => void): void;
  transfer_host(p: TargetUserPayload, ack: (r: Ack<null>) => void): void;
  request_change(p: ChangeVideoPayload, ack: (r: Ack<RequestDTO>) => void): void;
  approve_request(p: RequestIdPayload, ack: (r: Ack<RequestDTO>) => void): void;
  reject_request(p: RejectRequestPayload, ack: (r: Ack<RequestDTO>) => void): void;
  list_requests(p: RoomIdPayload, ack: (r: Ack<RequestDTO[]>) => void): void;
  close_room(p: RoomIdPayload, ack: (r: Ack<null>) => void): void;
}

export interface ServerToClientEvents {
  sync_state(p: {
    roomId: string;
    state: PlaybackState;
    serverTime: number;
    cause: SyncCause;
    byUserId: string | null;
  }): void;
  user_joined(p: { roomId: string; participant: ParticipantDTO }): void;
  user_left(p: { roomId: string; userId: string; displayName: string; reason: 'left' }): void;
  presence_changed(p: { roomId: string; userId: string; online: boolean }): void;
  role_assigned(p: { roomId: string; userId: string; role: Role; byUserId: string }): void;
  participant_removed(p: {
    roomId: string;
    userId: string;
    displayName: string;
    byUserId: string;
  }): void;
  request_created(p: { roomId: string; request: RequestDTO }): void;
  request_updated(p: { roomId: string; request: RequestDTO }): void;
  operation_rejected(p: {
    event: string;
    roomId: string | null;
    code: ErrorCode;
    message: string;
  }): void;
  room_closed(p: { roomId: string; reason: 'closed_by_host' | 'host_left' }): void;
  connection_status(p: { status: 'connected'; userId: string; serverTime: number }): void;
}

export const CLIENT_EVENT_NAMES = [
  'join_room',
  'leave_room',
  'play',
  'pause',
  'seek',
  'change_video',
  'assign_role',
  'remove_participant',
  'transfer_host',
  'request_change',
  'approve_request',
  'reject_request',
  'list_requests',
  'close_room',
] as const;

export const SERVER_EVENT_NAMES = [
  'sync_state',
  'user_joined',
  'user_left',
  'presence_changed',
  'role_assigned',
  'participant_removed',
  'request_created',
  'request_updated',
  'operation_rejected',
  'room_closed',
  'connection_status',
] as const;

/** Expected playback position (seconds) at `now`, given the authoritative state. */
export function expectedPosition(state: PlaybackState, serverNow: number): number {
  if (!state.playing) return state.position;
  return state.position + Math.max(0, serverNow - state.updatedAt) / 1000;
}
