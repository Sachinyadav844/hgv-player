# HGV Player architecture

Written for an engineering student reading the code for the first time.

## Overview

```
┌────────────────────────── Browser ──────────────────────────┐
│ React pages ─ hooks ─ services                                │
│   useRoom()            one Socket.IO connection per room      │
│   useYouTubePlayer()   drives the YouTube IFrame player       │
└───────────────┬──────────────────────────┬───────────────────┘
        REST + cookie                Socket.IO + cookie
┌───────────────▼──────────────────────────▼───────────────────┐
│ Express app                    Socket.IO gateway              │
│  helmet, CORS, CSRF, limits     auth middleware, rate budget  │
│  routes: auth, rooms, health    handlers -> RoomManager       │
│                    ┌─────────────────────────┐                │
│                    │ RoomManager              │                │
│                    │  per-room runtime + lock │                │
│                    │  RBAC, playback, requests│                │
│                    └───────────┬─────────────┘                │
└────────────────────────────────┼──────────────────────────────┘
                              Mongoose
                           ┌─────▼─────┐
                           │  MongoDB   │
                           └───────────┘
```

Three npm workspaces: `shared` (code both sides import), `server`, `client`.

## Frontend architecture

- `main.tsx` mounts providers: `ErrorBoundary > Router > ToastProvider > AuthProvider > App`.
- `AuthContext` loads the session (`GET /api/auth/me`) and exposes login/register/logout.
- `ProtectedRoute` redirects anonymous visitors to `/login?next=...`; `next` is validated by `safeNext` (same-site paths only, prevents open redirects). If the server is unreachable it shows a retry state instead of a redirect.
- `RoomPage` first calls `GET /api/rooms/:id` so it can show not-found / closed / removed / "Join?" screens before opening a socket. Then `WatchRoom` mounts.
- `useRoom(roomId)` owns the socket. Listeners are registered once per mount and removed in cleanup; on every `connect` (including reconnects) it re-emits `join_room` and replaces local state with the fresh snapshot. It ignores `sync_state` whose `version` is not newer than what it already has.
- `useYouTubePlayer` wraps the official IFrame API (see Playback synchronization).
- `shared/permissions.can()` decides which controls are shown. This is a usability aid only.

## Backend architecture

- `config/env.ts` validates configuration and reports every problem at once; secrets are never logged.
- `config/db.ts` connects to MongoDB in the background with exponential backoff, builds indexes, and exposes `isDbReady()`. The HTTP server starts regardless: `/health` = process up, `/health/ready` = database up, `/api/*` answers `503 DB_UNAVAILABLE` until connected. A missing `MONGODB_URI` is a configuration error and exits immediately with a clear message.
- `middleware/security.ts`: CSRF check, DB guard, auth guard, rate limiters, error handler (no stack traces to clients).
- `routes/`: thin HTTP layer. `services/authService.ts`: passwords and tokens. `services/roomManager.ts`: all room logic. `sockets/index.ts`: Socket.IO glue.
- `RoomManager` talks to clients through a small `Gateway` interface, so permission and state logic is independent of Socket.IO.

## Authentication

Passwords are hashed with bcrypt (cost 12). A login sets `hgv_session`, an HttpOnly JWT (HS256, 7 days) that the server verifies and then loads the account behind it on every request, so a disabled or deleted account stops working immediately. Unknown email and wrong password produce the same error and take the same time (a dummy bcrypt comparison). Secrets live only in server environment variables; nothing is kept in `localStorage`.

CSRF: cookies are sent automatically by browsers, so state-changing requests must carry `X-Requested-With: hgv-player` (a custom header cannot be sent cross-site without a CORS preflight, which only allow-listed origins pass) and any `Origin` header must be allow-listed. Socket.IO's `allowRequest` rejects foreign origins on the WebSocket handshake.

## MongoDB data model

| Collection | Purpose | Key fields | Indexes |
|---|---|---|---|
| `users` | Accounts | name, email (lower-cased), passwordHash, status, lastLoginAt | unique `email` |
| `rooms` | Room metadata and last saved playback | roomId (public code), name, ownerId, hostId, status, videoId, playing, position, positionUpdatedAt, version | unique `roomId`; `status+updatedAt`; `ownerId+createdAt` |
| `participants` | Membership, one per (room, user) | roomId, userId, displayName, role, status (ACTIVE/LEFT/REMOVED), joinedAt, lastSeenAt | unique `roomId+userId`; `roomId+status`; `userId+status`; `status+lastSeenAt` |
| `changerequests` | Video change requests | requestId, roomId, requesterId, payload.videoId, status, decidedBy, decidedAt, rejectionReason | unique `requestId`; `roomId+status+createdAt`; `roomId+requesterId+createdAt` |
| `auditlogs` | Admin action trail | roomId, actorId, action, targetId, meta | `roomId+createdAt` |

Identity is the user ID, never a socket ID. `REMOVED` participant documents double as the room's ban list. Duplicate keys (email, roomId) are caught and turned into clean errors.

## Room management

- Room codes: 10 symbols from a 32-character alphabet (no I/O/0/1) via `crypto.randomInt` (about 50 bits). Collisions are retried.
- Lifecycle: `OPEN` → `CLOSED` (host closes, last host leaves, or idle sweep after 48 h).
- Host leaves: the Host role passes to the first Moderator, else the longest-standing member, preferring those online; if nobody is left the room closes. Host merely **disconnecting** (tab closed, network loss) changes nothing: they stay Host and can return.
- Participants who disconnect stay members (shown "Offline") so reconnects keep their role. A sweeper marks participants unseen for 48 h as left and closes idle rooms, so stale records do not live forever.

## Socket.IO connection flow

1. Handshake: origin allow-list, cookie → JWT → user. Failure → `connect_error: UNAUTHENTICATED`.
2. Server joins the socket to `user:{id}` and emits `connection_status`.
3. Client emits `join_room`. Inside the room's lock the server verifies room/ban status, creates or reuses membership, attaches the socket to channels `room:{id}` and `room:{id}:user:{uid}`, and returns a snapshot (room, you, participants, requests, playback state, serverTime).
4. Every later event is validated with Zod (`.strict()`), rate-budgeted (30/s per connection), and authorized again by `RoomManager.authorize()`.

## Playback synchronization and server-authoritative state

The server holds, per room, `{videoId, playing, position, updatedAt (server ms), version}`. `position` is valid at `updatedAt`; while playing, the current position is `position + (now - updatedAt)`. Accepted changes bump `version`, are broadcast as `sync_state`, and are persisted (not on every tick, only on accepted transitions, with a version guard so an older write can never overwrite a newer one).

Client side (`useYouTubePlayer.reconcile`, run on every state change and every 2 s):

1. Estimate the server clock (`offset` measured from the `join_room` round trip).
2. Compute the target position. If the video differs, load it (`loadVideoById` if playing, `cueVideoById` if paused so a paused room never starts by itself).
3. Seek only if |drift| exceeds 2 s (playing) or 0.75 s (paused), the player is not buffering, and ≥ 3 s passed since the last seek. This prevents seek storms.
4. Make the player's play/pause match the room. If the browser refuses to autoplay, show a "Join playback" button; the click is the user gesture browsers require.
5. If the video ends while the room is "playing", the controller's client reports a pause at the end instead of restarting the video.

Server-side redundancy suppression: a `play`/`pause`/`seek` that would not change the state (within 1 s / 0.5 s) is acknowledged with `changed:false` and not broadcast.

## Role-based access control

One function, `can(role, action, policy)`, in `shared/permissions.ts`. `RoomManager.authorize(rt, userId, action)` is the only gate and is called inside the room lock for every sensitive operation: it checks removal/ban, membership, room open, then the permission. Nothing about identity or role comes from the client. A removed user's still-connected socket is rejected on the next event because membership is looked up in server state each time.

## Change request workflow

Participant `request_change` → URL parsed to a video ID → checks (not the playing video, ≤ 3 pending, no duplicate) → stored `PENDING` → `request_created` to approvers and the requester. Approve/reject re-checks the decider's permission, then uses an atomic conditional update (`status:'PENDING'`) so exactly one decision wins even under concurrency; approval switches the room's video and broadcasts `sync_state`. A requester who leaves or is removed has pending requests set to `CANCELLED`.

## Error handling

Errors carry stable codes (`ErrorCode` in `shared/protocol.ts`). REST returns `{error:{code,message,details?}}`; sockets acknowledge `{ok:false,error}` and also emit `operation_rejected`. Unknown errors become `INTERNAL` with a generic message; database outages become `DB_UNAVAILABLE`. The UI shows inline field errors, toasts, empty states, a reconnection banner and an error boundary.

## Deployment architecture

```
 Static host (frontend/dist) ──► user's browser ──HTTPS + WSS──► Node web service ──► MongoDB Atlas
```

The backend is a single Node process (`npm start`). It needs `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, `NODE_ENV=production`, and handles SIGTERM gracefully.

## Known scalability limitations

Live room state (members, online sockets, playback) is in one process's memory, and Socket.IO uses its in-memory adapter. Two instances would each hold their own copy of a room and would not see each other's events. Scaling out would need the Socket.IO Redis adapter plus moving room state to Redis or sticky routing per room. This is not implemented and not load tested; do not assume support for thousands of concurrent users.
