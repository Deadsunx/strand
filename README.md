# Strand

Fast, private, peer-to-peer file sharing — files travel straight from one device
to another over WebRTC. No cloud storage, no size limits, end-to-end encrypted by
the browser's transport. Chat and screen sharing ride the same connection.

Strand is a rebuild of the GPL-3.0 [DropSilk](https://github.com/medy17/dropsilk):
a hardened backend plus a from-scratch React frontend built on a headless,
framework-agnostic transfer core. It stays wire-compatible with the original
backend protocol.

> **License:** GPL-3.0-or-later (derivative of DropSilk). Keep it GPL and mark
> your changes.

## Layout

| Folder | What it is |
|--------|------------|
| `web/` | React + Vite + TypeScript frontend. Headless transfer core in `src/core` (no React/DOM), React app on top. |
| `backend/` | Signaling backend — Bun + Hono + `ws` + Postgres (Kysely). |
| `docker-compose.yml` | Brings the whole stack up with one command. |
| `DEPLOY.md` | Production deploy guide (Vercel + Render). |

## Quick start (Docker — one command)

Requires Docker.

```bash
cp .env.example .env    # optional: change ports if 8080/8081/5432 are in use
docker compose up --build
```

Open **http://localhost:8080**. Create a flight in one tab, open the invite link
in another tab (or another device on the same network), and transfer.

- Two tabs/devices on the **same machine or LAN** connect directly (no TURN).
- **Cross-network** peers need TURN relay credentials — add `CLOUDFLARE_TURN_TOKEN_ID`
  and `CLOUDFLARE_API_TOKEN` to `.env` (see `DEPLOY.md`).

Stop with `docker compose down` (add `-v` to also wipe the database volume).

### Port conflicts

If a port is already taken (a local Postgres on 5432, Apache on 8080, …), set
`FRONTEND_PORT` / `BACKEND_PORT` / `POSTGRES_PORT` in `.env` and re-run. Changing
`BACKEND_PORT` requires a rebuild (the frontend bakes the backend URL at build).

## Local development (without Docker)

Two terminals. Requires [Bun](https://bun.sh), Node 20+, and Docker (for Postgres).

**Backend:**
```bash
cd backend
bun install
docker compose up -d postgres        # Postgres on localhost:5432
printf 'DATABASE_URL=postgres://postgres:postgres@localhost:5432/strand\nDATABASE_SSL=disable\nNODE_ENV=development\nPORT=8080\n' > .env
bun run scripts/migrate.ts
bun server.ts --allow-local-port=5173
```

**Frontend:**
```bash
cd web
npm install
npm run dev                          # http://localhost:5173
```

By default the dev frontend targets `http://localhost:8080` for the backend. To
point elsewhere, create `web/.env.local`:
```
VITE_API_BASE_URL=http://localhost:8090
VITE_WS_URL=ws://localhost:8090
```

## Tests

```bash
cd web && npm test          # core + controller (Vitest)
cd backend && bun test      # backend (Jest)
```

## Architecture (frontend)

The risky transport/transfer logic is a **headless core** (`web/src/core`) with no
React and no DOM — event-emitting, injectable, unit-tested in isolation:

- `signaling.ts` — WebSocket signaling client
- `peer.ts` — `RTCPeerConnection` + data channel, backpressure, screen-share tracks
- `sender.ts` / `receiver.ts` — chunked transfer, backpressure, OPFS routing, ETR
- `roomApi.ts` — typed REST client · `protocol.ts` — the frozen wire format

A `RoomController` (`src/app/roomController.ts`) wires the core into a Zustand
store; React components subscribe. File previews (`src/preview/`) are each a
lazy-loaded chunk, so heavy viewers (PDF, DOCX, spreadsheets, PSD, HEIC) never
touch the first-load bundle.

## Backend hardening (vs. upstream)

- Nearby-device discovery is **opt-in** and no longer groups strangers who share
  a public IP (CGNAT); optional shared PIN for private discovery groups.
- `/api/turn-credentials` is per-IP rate-limited (and can require an active room
  participant via `TURN_REQUIRE_PARTICIPANT`).
- Security headers, room-creation rate limiting, and `/api/status` no longer
  leaks process memory (gate full detail behind `STATUS_ACCESS_KEY`).

## Credits

Based on [DropSilk](https://github.com/medy17/dropsilk) by
[medy17](https://github.com/medy17), GPL-3.0. Strand keeps that license.
