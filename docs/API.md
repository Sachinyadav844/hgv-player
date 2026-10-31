# REST API

Base URL: the backend origin (in development the Vite proxy makes it the same origin as the frontend).

**Conventions**

- JSON bodies, max 10 KB.
- Session: HttpOnly cookie `hgv_session`, set by register/login.
- **Every non-GET request** must send `X-Requested-With: hgv-player`, and if an `Origin` header is present it must be in `CLIENT_ORIGIN`; otherwise `403 FORBIDDEN`.
- Errors: `{ "error": { "code": "...", "message": "...", "details": [ {"path","message"} ] } }`.
- Rate limits: auth endpoints 30 requests / 15 min / IP; room creation 30 / hour / IP; all of `/api` 300 / minute / IP. Exceeding returns `429 TOO_MANY_REQUESTS`.
- While MongoDB is not connected every `/api/*` route returns `503 DB_UNAVAILABLE`.

Error codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `ROOM_NOT_FOUND` 404, `EMAIL_TAKEN` 409, `INVALID_CREDENTIALS` 401, `TOO_MANY_REQUESTS` 429, `DB_UNAVAILABLE` 503, `INTERNAL` 500.

## Health (no auth, no CSRF header)

| Method & path | Response |
|---|---|
| `GET /health` | `200 {"status":"ok","uptimeSeconds":n}` - process is up |
| `GET /health/ready` | `200 {"status":"ready","database":"up",...}` or `503 {"status":"degraded","database":"down",...}` |
| `GET /api/health` | `307` redirect to `/health/ready` |

## Auth

### `POST /api/auth/register`
Auth: none. Body: `{ "name": 2-40 chars, "email": valid email (stored lower-case), "password": 8+ chars (max 72 bytes) with a letter and a number }`.
`201 {"user":{"id","name","email"}}` + session cookie. Errors: `400 VALIDATION_ERROR` (with `details`), `409 EMAIL_TAKEN`.

### `POST /api/auth/login`
Auth: none. Body: `{ "email", "password" }`. `200 {"user":{...}}` + cookie. Errors: `400`, `401 INVALID_CREDENTIALS` (same message for unknown email and wrong password), `429`.

### `POST /api/auth/logout`
Auth: optional. `204`, clears the cookie, and disconnects the user's live sockets.

### `GET /api/auth/me`
Auth: session. `200 {"user":{...}}`. Error: `401 UNAUTHENTICATED`.

### `PATCH /api/auth/me`
Auth: session. Body `{ "name" }`. `200 {"user":{...}}`. Errors: `400`, `401`.

### `POST /api/auth/password`
Auth: session. Body `{ "currentPassword", "newPassword" }`. `204`. Errors: `400`, `401 INVALID_CREDENTIALS` (wrong current password).

## Rooms (all require a session)

### `POST /api/rooms`
Body `{ "name": 2-60 chars }`. Creator becomes Host.
`201 {"room":{"roomId","name","hostId","status","createdAt"},"inviteUrl":"<CLIENT_ORIGIN>/room/<roomId>"}`. Errors: `400`, `401`, `429`.

### `GET /api/rooms/mine`
`200 {"rooms":[{"roomId","name","status","role","updatedAt"}]}` - only rooms where the caller is an active member.

### `GET /api/rooms/:roomId`
Preview before joining. `roomId` is case-insensitive, 10 characters.
`200 {"room":{"roomId","name","status","hostName","participantCount","createdAt","membership":{"role"}|null,"removed":boolean},"inviteUrl"}`.
Errors: `400 VALIDATION_ERROR` (malformed code), `401`, `404 ROOM_NOT_FOUND`.

Joining, playback, roles and requests are Socket.IO operations: see [REALTIME_EVENTS.md](REALTIME_EVENTS.md).
