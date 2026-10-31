# HGV Player

A real-time YouTube watch party platform. People join a room, watch the same YouTube video, and every player plays, pauses and seeks together. A host decides who controls playback.

> HGV Player is an independent project and is not affiliated with YouTube. Videos play through YouTube's official IFrame Player API.

Live URL: `<not deployed yet - add your URL here after deployment>`

## 1. Problem statement

Watching a video "together" over a call means everyone counting "3, 2, 1, press play" and drifting apart after the first pause. HGV Player keeps one authoritative playback state on the server and makes every viewer's player follow it, with role-based control over who may change it.

## 2. Core features

- Accounts: register, log in, log out, change name and password (HttpOnly cookie session).
- Rooms: create a room (creator becomes Host), join by room code or invite link, leave, close.
- Synchronized playback: play, pause, seek and change video reach everyone through the server; late joiners and reconnecting viewers resync from a snapshot.
- Roles enforced on the server: Host, Moderator, Participant.
- Change requests: participants suggest a video, the Host (and Moderators, by default) approve or reject.
- Participant management: presence, role assignment, host transfer, removal (removed users cannot rejoin).
- Responsive, YouTube-inspired UI with loading, error, empty and reconnection states.

## 3. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router, lucide-react, Socket.IO client, YouTube IFrame Player API |
| Backend | Node.js 22.22.2+, 24.15+, or 26+, Express 5, TypeScript, Socket.IO 4, Zod |
| Database | MongoDB with Mongoose 9 |
| Auth | bcryptjs password hashes, JWT in an HttpOnly cookie |
| Security | helmet, CORS allow-list, CSRF header + Origin check, express-rate-limit, request size limits |
| Tests | Vitest, Supertest, socket.io-client, React Testing Library, Playwright (E2E script) |

No Docker files are used anywhere in this project.

## 4. Architecture overview

```
 Browser (React)                      Server (Node)                         MongoDB
 ┌──────────────┐  REST (cookie)   ┌────────────────────┐   Mongoose    ┌───────────┐
 │ pages, hooks │ ───────────────► │ Express routes     │ ────────────► │ users     │
 │ YouTube      │                  │  auth / rooms      │               │ rooms     │
 │ IFrame player│  Socket.IO       │ Socket.IO gateway  │               │ participants
 │ (controls    │ ◄──────────────► │  RoomManager       │               │ changerequests
 │  disabled)   │  (cookie auth)   │  (authoritative    │               │ auditlogs │
 └──────────────┘                  │   state + RBAC)    │               └───────────┘
                                   └────────────────────┘
```

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 5. Folder structure

```
hgv-player/
├── frontend/          React app (pages, components, hooks, services, tests)
├── backend/           Express + Socket.IO (config, models, routes, services, sockets, tests)
├── shared/            Types, permission matrix, YouTube URL parsing, Zod schemas (used by both)
├── scripts/e2e.mjs    Two-browser end-to-end script (Playwright)
├── docs/              ARCHITECTURE, API, REALTIME_EVENTS, IMPLEMENTATION_REPORT
└── README.md
```

## 6. Authentication flow

1. `POST /api/auth/register` or `/login` validates input, hashes/verifies the password with bcrypt, and sets an HttpOnly `hgv_session` cookie holding a signed JWT (7 days).
2. The browser sends the cookie on every request (`credentials: 'include'`). State-changing requests also need the header `X-Requested-With: hgv-player` and, if an `Origin` is present, it must be allow-listed (CSRF defence).
3. The Socket.IO handshake reads the same cookie; unauthenticated or foreign-origin connections are refused.
4. `POST /api/auth/logout` clears the cookie and disconnects that user's live sockets.

## 7. Room creation and joining

- `POST /api/rooms` creates the room with a 10-character CSPRNG code and a Host membership.
- Visiting `/room/CODE` (invite link or typed code) first calls `GET /api/rooms/:id` to show not-found, closed, removed or "Join this room?" screens.
- Joining happens over the socket (`join_room`): the server creates a Participant membership and returns a full snapshot.

## 8. Real-time synchronization flow

Client action → validated socket event → server checks identity, membership, role and payload → server updates the authoritative state (version + timestamp) → broadcast `sync_state` → each client computes the expected position (`position + elapsed server time` while playing), loads the video if needed, and seeks only if drift exceeds a threshold (2 s playing / 0.75 s paused, at most one reconcile seek per 3 s).

Viewers cannot desync themselves: the YouTube controls are disabled and covered; all controls are the app's own and go through the server.

## 9. Role-based authorization

| Action | Host | Moderator | Participant |
|---|:-:|:-:|:-:|
| Play / pause / seek | yes | yes | no |
| Change video directly | yes | yes | no |
| Submit video request | no (uses direct change) | no | yes |
| Approve / reject requests | yes | yes (server policy, default on) | no |
| Assign roles | yes | no | no |
| Remove participants | yes | no | no |
| Transfer host / close room | yes | no | no |

The matrix lives in `shared/src/permissions.ts` and is enforced in `backend/src/services/roomManager.ts` on every action. The frontend only uses it to hide controls.

## 10. Database models

`User`, `Room`, `Participant`, `ChangeRequest`, `AuditLog` - see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#mongodb-data-model) for fields and indexes.

## 11. Socket.IO events and REST API

- [docs/REALTIME_EVENTS.md](docs/REALTIME_EVENTS.md)
- [docs/API.md](docs/API.md)

## 12. Prerequisites

- Node.js 22.22.2+, 24.15+, or 26+ and npm 10+ (required by the current dependency engines)
- A MongoDB database you control: local MongoDB Community Server, or a free MongoDB Atlas cluster
- A modern browser

## 13. Installation

```bash
cd hgv-player
npm install            # installs all three workspaces
```

## 14. Environment variables

Backend (`backend/.env`, copy from `backend/.env.example`):

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB connection string. **Put your URL here.** Server-side only. |
| `MONGODB_DNS_SERVERS` | no | Comma-separated DNS server IPs for Node.js MongoDB SRV lookups if OS DNS is unavailable. Overrides OS DNS for all lookups in this backend process; use only resolvers permitted by your network/deployment policy. |
| `JWT_SECRET` | yes | 32+ random characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLIENT_ORIGIN` | yes in production | Public URL(s) of the frontend, comma-separated, no trailing slash. Dev default `http://localhost:5173` |
| `PORT` | no | Default `4000` |
| `NODE_ENV` | no | `development` or `production` |
| `COOKIE_SAMESITE`, `COOKIE_SECURE`, `TRUST_PROXY`, `BCRYPT_COST` | no | See `backend/.env.example` |

Database-backed backend tests need a separate `TEST_MONGODB_URI` in `backend/.env.test`
(copy `backend/.env.test.example`). The test runner generates a fresh `hgv_test_*` database and
drops only that database afterward. Never set it to the production `hgv_player_db` connection;
the tests do not fall back to `MONGODB_URI`.

Frontend (`frontend/.env.local` for local development or the hosting dashboard for production): `VITE_API_URL` = public backend URL without a trailing slash (empty in development so Vite proxies `/api`, `/health`, and `/socket.io` to `http://localhost:4000`).

`MONGODB_URI` and `JWT_SECRET` are never read by the frontend. Never commit `.env` files (they are git-ignored).

## 15. Local development

```bash
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
# Edit backend\.env and set MONGODB_URI and JWT_SECRET before starting the backend.
npm run dev                             # starts backend (4000) and frontend (5173) together
```

Open http://localhost:5173. Or in two terminals: `npm run dev:backend` and `npm run dev:frontend`.

MongoDB setup: either install MongoDB Community Server and use `mongodb://127.0.0.1:27017/hgv_player_db`, or create a MongoDB Atlas cluster, allow only the backend's verified outbound IP, and use an application database user with `readWrite` on `hgv_player_db` only. Do not assign administrative roles to the application user.

In development the Vite server proxies `/api`, `/health`, and `/socket.io` to the backend, so the browser sees one origin.

## 16. Build and start

```bash
npm run build        # backend -> backend/dist, frontend -> frontend/dist
npm start            # runs the built server (needs the env vars)
```

## 17. Tests

```bash
npm run typecheck
npm test                                   # shared + backend + frontend
```

Database tests need a real MongoDB and **only ever run in a throw-away `hgv_test_*` database, never your app database**. For remote MongoDB, use a separate test account with access limited to test data; a different database name by itself does not isolate credentials. Do not use production credentials:

```bash
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017' # disposable test server only
npm test
```

Without `TEST_MONGODB_URI` the database-backed backend tests are skipped (the rest still run). End-to-end needs the backend + frontend running, a real disposable MongoDB test database, and Chromium. Install the browser once with:

```bash
npm exec -- playwright install chromium
$env:E2E_BASE_URL = 'http://localhost:5173'
npm run e2e
```

## 18. Deployment preparation

Details in [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md#s-deployment-instructions). Summary for Render:

1. Backend: Web Service, repository root (leave Render's Root Directory blank), build `npm ci && npm run build -w backend`, start `npm run start -w backend`. Set `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN=https://<your-frontend>`, and `TRUST_PROXY=1`. Health check path `/health/ready`.
2. Frontend: Static Site, repository root, build `npm ci && npm run build -w frontend`, publish `frontend/dist`, env `VITE_API_URL=https://<your-backend>` (no trailing slash). Add a rewrite `/*` → `/index.html`.
3. Atlas: allow only the backend's verified static outbound IP address(es). If the host does not provide stable egress, configure a trusted static-egress gateway or choose a host that does; never use `0.0.0.0/0`.
4. Verify: open the site, register, create a room, join from a second browser, and confirm sync.

Create both Render services first to obtain their URLs. Set `VITE_API_URL` to the backend URL before the frontend build, and set `CLIENT_ORIGIN` to the frontend URL before the backend's first start; update and redeploy if either URL changes.

Production cookies default to `SameSite=None; Secure` (frontend and backend on different domains). Use HTTPS for both.

## 19. Troubleshooting

| Symptom | Fix |
|---|---|
| Server exits with "Invalid server configuration" | Create `backend/.env` from the example and fill `MONGODB_URI` and `JWT_SECRET` |
| "MongoDB connection failed ... Retrying" | Check the URI, that MongoDB is running, and Atlas network access / credentials |
| API returns 503 `DB_UNAVAILABLE` | Database not connected yet; `GET /health/ready` shows the state |
| Login works but room says "session expired" in production | Cookie settings: both sites need HTTPS, `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `CLIENT_ORIGIN` must exactly match the frontend URL |
| Socket won't connect in production | `VITE_API_URL` must be the backend URL; `CLIENT_ORIGIN` must match the page's origin |
| Video shows "cannot be played here" | The video owner disabled embedding, or it is private |
| "Join playback" overlay appears | The browser blocked autoplay; one click starts playback in sync |
| Tests skipped | Set `TEST_MONGODB_URI` |

## 20. Known limitations

- Single server instance: live room state is in memory. Running several instances would split rooms. Redis pub/sub is not implemented.
- Sync is "good enough", not frame-exact: network latency, buffering and YouTube behaviour limit precision (a few hundred ms to seconds).
- Browsers may block autoplay; users then click once.
- After a server restart a room resumes paused at its last saved position.
- No email verification, password reset, OAuth, chat or payments.
- The UI assumes the default permission policy (Moderators may decide requests); if you change the policy on the server the UI still shows those buttons but the server will refuse them.

## 21. Current implementation status

See [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md). Current type checks, builds, and non-database tests pass; database-backed tests were skipped because an isolated `TEST_MONGODB_URI` is not configured. This run verified a read-only ping to the configured MongoDB database, but did not verify the Atlas allowlist or user roles. Playwright E2E, real YouTube playback, and production deployment have not been verified.
