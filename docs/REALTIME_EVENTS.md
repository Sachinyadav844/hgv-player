# Real-time events (Socket.IO)

Types: `shared/src/protocol.ts`. Payload validation: `shared/src/schemas.ts` (`socketSchemas`, all `.strict()`: unknown fields are rejected, so clients cannot smuggle `role`, `isHost` or `userId`).

## Connection

- Connect to the backend origin with `withCredentials: true`. The `hgv_session` cookie authenticates the handshake.
- Refused with `connect_error` message `UNAUTHENTICATED` (no/invalid cookie) or `DB_UNAVAILABLE`; foreign `Origin` headers are rejected.
- Message size limit 10 KB; each connection may send at most 30 events/second (`TOO_MANY_REQUESTS` otherwise).
- On connect the server emits `connection_status`.

## Acknowledgements

Every client event takes an acknowledgement callback receiving `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Refusals are also pushed to the sender as `operation_rejected`.

Error codes seen on events: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_A_MEMBER`, `REMOVED_FROM_ROOM`, `ROOM_NOT_FOUND`, `ROOM_CLOSED`, `FORBIDDEN`, `INVALID_VIDEO`, `NO_VIDEO`, `ROLE_UNCHANGED`, `REQUEST_NOT_FOUND`, `REQUEST_ALREADY_DECIDED`, `CONFLICT`, `TOO_MANY_REQUESTS`, `DB_UNAVAILABLE`.

`roomId` in every payload: 10 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (case-insensitive).

## Client → server

| Event | Payload | Permission | Ack data / notes |
|---|---|---|---|
| `join_room` | `{roomId}` | any authenticated user; not removed; room open | `RoomSnapshot`. Creates a Participant membership if new. Safe to repeat (reconnects, other tabs). |
| `leave_room` | `{roomId}` | member | `null`. Broadcasts `user_left`. Host leaving passes host on (or closes the room if empty). |
| `play` | `{roomId, position}` | Host, Moderator | `{state, changed}`. `position` seconds, 0..604800. `NO_VIDEO` if nothing loaded. |
| `pause` | `{roomId, position}` | Host, Moderator | `{state, changed}` |
| `seek` | `{roomId, position}` | Host, Moderator | `{state, changed}` |
| `change_video` | `{roomId, url}` | Host, Moderator | `{state, changed:true}`. `url` is a YouTube watch/youtu.be/embed link or an 11-char video ID. Result is paused at 0:00. |
| `assign_role` | `{roomId, userId, role:'MODERATOR'\|'PARTICIPANT'}` | Host only | `ParticipantDTO`. Not for yourself; `ROLE_UNCHANGED` if already that role; `HOST` is not assignable (use `transfer_host`). |
| `remove_participant` | `{roomId, userId}` | Host only | `null`. Removed user can never rejoin that room. Not yourself. |
| `transfer_host` | `{roomId, userId}` | Host only | `null`. Old host becomes Moderator. |
| `request_change` | `{roomId, url}` | Participant | `RequestDTO` (status `PENDING`). Max 3 pending per user, no duplicates, not the current video. Hosts/Moderators get `FORBIDDEN` (they use `change_video`). |
| `approve_request` | `{roomId, requestId}` | Host; Moderator if server policy allows (default yes) | `RequestDTO`. Switches the room video. |
| `reject_request` | `{roomId, requestId, reason?}` | same as approve | `RequestDTO`. Room video unchanged. `reason` ≤ 200 chars. |
| `list_requests` | `{roomId}` | member | `RequestDTO[]`: approvers see all (latest 50), others only their own (latest 10). |
| `close_room` | `{roomId}` | Host only | `null`. Everyone gets `room_closed`. |

`RoomSnapshot`: `{room, you:{userId,role}, participants:ParticipantDTO[], requests, state:PlaybackState, serverTime}`.
`PlaybackState`: `{videoId|null, playing, position, updatedAt, version}` (`updatedAt` = server ms epoch at which `position` was valid).

## Server → client

| Event | Payload | Sent to |
|---|---|---|
| `sync_state` | `{roomId, state, serverTime, cause:'play'\|'pause'\|'seek'\|'change_video'\|'request_approved', byUserId}` | whole room |
| `user_joined` | `{roomId, participant}` | whole room (new members only) |
| `user_left` | `{roomId, userId, displayName, reason:'left'}` | whole room |
| `presence_changed` | `{roomId, userId, online}` | whole room (when a user's first socket connects / last disconnects) |
| `role_assigned` | `{roomId, userId, role, byUserId}` | whole room (also used for host changes) |
| `participant_removed` | `{roomId, userId, displayName, byUserId}` | the removed user first, then the rest of the room |
| `request_created` | `{roomId, request}` | approvers + the requester only |
| `request_updated` | `{roomId, request}` | approvers + the requester only |
| `operation_rejected` | `{event, roomId\|null, code, message}` | the sender only |
| `room_closed` | `{roomId, reason:'closed_by_host'\|'host_left'}` | whole room |
| `connection_status` | `{status:'connected', userId, serverTime}` | the connecting socket |

## Broadcast scope and privacy

Events go only to the room's channel (`room:{id}`) or to one user's channel inside a room (`room:{id}:user:{uid}`); removed users are taken off both channels. Payloads contain display names, roles and IDs only: no emails, password hashes or tokens.

## Ordering and reconnection

Each room processes mutating events one at a time (per-room lock), so `version` increases strictly. Clients drop `sync_state` messages whose `version` is not newer than the one they hold. After a reconnect the client re-sends `join_room` and replaces its state with the returned snapshot.
