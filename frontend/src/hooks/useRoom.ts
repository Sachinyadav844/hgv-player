import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Ack,
  ErrorCode,
  ParticipantDTO,
  PlaybackAck,
  PlaybackState,
  RequestDTO,
  Role,
  RoomDTO,
} from '@hgv/shared';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import { createRoomSocket, type RoomSocket } from '../services/socket';

export type Phase = 'connecting' | 'joining' | 'ready' | 'failed' | 'removed' | 'closed' | 'left';
export type Connection = 'connected' | 'reconnecting' | 'offline';

export interface RoomFailure {
  code: ErrorCode | 'NETWORK';
  message: string;
}

const ROLE_ORDER: Record<Role, number> = { HOST: 0, MODERATOR: 1, PARTICIPANT: 2 };
const sortParticipants = (list: ParticipantDTO[]) =>
  [...list].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.localeCompare(b.joinedAt),
  );

function upsertRequest(list: RequestDTO[], next: RequestDTO): RequestDTO[] {
  const i = list.findIndex((r) => r.requestId === next.requestId);
  if (i === -1) return [next, ...list];
  const copy = list.slice();
  copy[i] = next;
  return copy;
}

/**
 * Owns the Socket.IO connection for one room and mirrors the server's authoritative state into
 * React state. Listeners are registered exactly once per mount and removed on cleanup, and the
 * room is re-joined on every (re)connect so a dropped connection always resyncs from a fresh
 * snapshot.
 */
export function useRoom(roomId: string) {
  const { expire } = useAuth();
  const socketRef = useRef<RoomSocket | null>(null);
  const offsetRef = useRef(0);
  const versionRef = useRef(-1);
  const meRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [failure, setFailure] = useState<RoomFailure | null>(null);
  const [connection, setConnection] = useState<Connection>('reconnecting');
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [me, setMe] = useState<{ userId: string; role: Role } | null>(null);
  const [participants, setParticipants] = useState<ParticipantDTO[]>([]);
  const [requests, setRequests] = useState<RequestDTO[]>([]);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);

  /** Current time on the server's clock, estimated from the round trip made when joining. */
  const getServerNow = useCallback(() => Date.now() + offsetRef.current, []);

  const send = useCallback(
    <T,>(event: string, payload: object = {}): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(new ApiError('NETWORK', 'You are offline. Reconnecting to the room...'));
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (socket as any)
          .timeout(8000)
          .emit(event, { roomId, ...payload }, (err: Error | null, res?: Ack<T>) => {
            if (err || !res) {
              reject(new ApiError('NETWORK', 'The server did not respond in time. Try again.'));
            } else if (res.ok) {
              resolve(res.data);
            } else {
              reject(new ApiError(res.error.code, res.error.message));
            }
          });
      }),
    [roomId],
  );

  const refreshRequests = useCallback(() => {
    send<RequestDTO[]>('list_requests')
      .then(setRequests)
      .catch(() => undefined);
  }, [send]);

  useEffect(() => {
    const socket = createRoomSocket();
    socketRef.current = socket;
    let disposed = false;

    const joinRoom = () => {
      setPhase((p) => (p === 'ready' ? p : 'joining'));
      const sentAt = Date.now();
      socket.emit('join_room', { roomId }, (res) => {
        if (disposed) return;
        if (!res.ok) {
          const code = res.error.code;
          setFailure({ code, message: res.error.message });
          setPhase(code === 'REMOVED_FROM_ROOM' ? 'removed' : code === 'ROOM_CLOSED' ? 'closed' : 'failed');
          return;
        }
        const snap = res.data;
        offsetRef.current = snap.serverTime - (sentAt + Date.now()) / 2;
        versionRef.current = snap.state.version;
        meRef.current = snap.you.userId;
        setRoom(snap.room);
        setMe(snap.you);
        setParticipants(sortParticipants(snap.participants));
        setRequests(snap.requests);
        setPlayback(snap.state);
        setFailure(null);
        setConnection('connected');
        setPhase('ready');
      });
    };

    socket.on('connect', () => {
      setConnection('connected');
      joinRoom();
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      setConnection('reconnecting');
    });
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    socket.io.on('reconnect_failed', () => setConnection('offline'));
    socket.on('connect_error', (err) => {
      if (err.message === 'UNAUTHENTICATED') {
        setFailure({ code: 'UNAUTHENTICATED', message: 'Your session has expired. Sign in again to rejoin the room.' });
        setPhase('failed');
        socket.disconnect();
        expire();
      } else {
        setConnection(socket.active ? 'reconnecting' : 'offline');
      }
    });

    socket.on('sync_state', (p) => {
      if (p.roomId !== roomId || p.state.version <= versionRef.current) return; // stale or duplicate
      versionRef.current = p.state.version;
      setPlayback(p.state);
    });
    socket.on('user_joined', (p) => {
      if (p.roomId !== roomId) return;
      setParticipants((list) =>
        sortParticipants([...list.filter((x) => x.userId !== p.participant.userId), p.participant]),
      );
    });
    socket.on('user_left', (p) => {
      if (p.roomId !== roomId) return;
      setParticipants((list) => list.filter((x) => x.userId !== p.userId));
    });
    socket.on('presence_changed', (p) => {
      if (p.roomId !== roomId) return;
      setParticipants((list) => list.map((x) => (x.userId === p.userId ? { ...x, online: p.online } : x)));
    });
    socket.on('role_assigned', (p) => {
      if (p.roomId !== roomId) return;
      setParticipants((list) =>
        sortParticipants(list.map((x) => (x.userId === p.userId ? { ...x, role: p.role } : x))),
      );
      if (p.role === 'HOST') setRoom((r) => (r ? { ...r, hostId: p.userId } : r));
      if (p.userId === meRef.current) {
        setMe({ userId: p.userId, role: p.role });
        // Permissions to see and decide requests just changed: reload them.
        socket.emit('list_requests', { roomId }, (res) => {
          if (res.ok) setRequests(res.data);
        });
      }
    });
    socket.on('participant_removed', (p) => {
      if (p.roomId !== roomId) return;
      if (p.userId === meRef.current) {
        setFailure({ code: 'REMOVED_FROM_ROOM', message: 'The host removed you from this room.' });
        setPhase('removed');
        socket.disconnect();
      } else {
        setParticipants((list) => list.filter((x) => x.userId !== p.userId));
      }
    });
    const onRequest = (p: { roomId: string; request: RequestDTO }) => {
      if (p.roomId === roomId) setRequests((list) => upsertRequest(list, p.request));
    };
    socket.on('request_created', onRequest);
    socket.on('request_updated', onRequest);
    socket.on('room_closed', (p) => {
      if (p.roomId !== roomId) return;
      setFailure({
        code: 'ROOM_CLOSED',
        message: p.reason === 'host_left' ? 'The host left and the room was closed.' : 'The host closed this room.',
      });
      setPhase('closed');
      socket.disconnect();
    });
    socket.on('operation_rejected', (p) => {
      // Callers already show the error from the acknowledgement; keep a trace for debugging.
      console.debug('[hgv] operation rejected', p.event, p.code);
    });

    return () => {
      disposed = true;
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, expire]);

  const play = useCallback((position: number) => send<PlaybackAck>('play', { position }), [send]);
  const pause = useCallback((position: number) => send<PlaybackAck>('pause', { position }), [send]);
  const seek = useCallback((position: number) => send<PlaybackAck>('seek', { position }), [send]);
  const changeVideo = useCallback((url: string) => send<PlaybackAck>('change_video', { url }), [send]);
  const requestChange = useCallback((url: string) => send<RequestDTO>('request_change', { url }), [send]);
  const approve = useCallback((requestId: string) => send<RequestDTO>('approve_request', { requestId }), [send]);
  const reject = useCallback(
    (requestId: string, reason?: string) => send<RequestDTO>('reject_request', { requestId, reason }),
    [send],
  );
  const assignRole = useCallback(
    (userId: string, role: 'MODERATOR' | 'PARTICIPANT') => send<ParticipantDTO>('assign_role', { userId, role }),
    [send],
  );
  const removeParticipant = useCallback((userId: string) => send<null>('remove_participant', { userId }), [send]);
  const transferHost = useCallback((userId: string) => send<null>('transfer_host', { userId }), [send]);
  const closeRoom = useCallback(() => send<null>('close_room'), [send]);
  const leave = useCallback(async () => {
    await send<null>('leave_room');
    setPhase('left');
    socketRef.current?.disconnect();
  }, [send]);

  return {
    phase,
    failure,
    connection,
    room,
    me,
    participants,
    requests,
    playback,
    getServerNow,
    refreshRequests,
    play,
    pause,
    seek,
    changeVideo,
    requestChange,
    approve,
    reject,
    assignRole,
    removeParticipant,
    transferHost,
    closeRoom,
    leave,
  };
}

export type RoomState = ReturnType<typeof useRoom>;
