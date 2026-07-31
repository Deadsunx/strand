# Deploying Strand

Production is three pieces: a **Postgres** database, the **backend** (signaling +
room API), and the **frontend** (static React app). Below is a Vercel (frontend)
+ Render (backend + Postgres) setup, plus Cloudflare TURN for cross-network peers.

> These steps require your own Vercel / Render / Cloudflare accounts — run them
> yourself. Everything in the repo is already prepared for them.

---

## 1. Postgres

Create a Postgres instance (Render Postgres, Neon, Supabase, …) and copy its
connection string. You'll use it as `DATABASE_URL`. Managed providers require TLS
— leave `DATABASE_SSL` unset (the backend defaults to SSL for non-local hosts).

## 2. Backend → Render

The backend is a Bun app with a `Dockerfile`. On Render, create a **Web Service**
from `backend/` using the Docker runtime (the Dockerfile migrates the DB on
start, then launches the server). Render injects `PORT`, which the server honors.

Environment variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | your Postgres connection string |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | your frontend URL(s), comma-separated — e.g. `https://strand.vercel.app` |
| `CLOUDFLARE_TURN_TOKEN_ID` | (optional, for TURN — see §4) |
| `CLOUDFLARE_API_TOKEN` | (optional, for TURN) |
| `STATUS_ACCESS_KEY` | (optional) gate `/api/status` memory detail |
| `VERCEL_PREVIEW_ORIGIN_REGEX` | (optional) regex allowing Vercel preview URLs |

After it deploys, note the backend URL, e.g. `https://strand-backend.onrender.com`.

## 3. Frontend → Vercel

Import the repo into Vercel and set the **root directory** to `web`. Build command
`npm run build`, output `dist` (already in `web/vercel.json`).

Environment variables (build-time — Vite bakes them in):

| Key | Value |
|-----|-------|
| `VITE_API_BASE_URL` | `https://strand-backend.onrender.com` |
| `VITE_WS_URL` | `wss://strand-backend.onrender.com` |

**Before deploying, edit `web/vercel.json`** — the CSP `connect-src` currently
lists the original DropSilk backend. Replace it with your backend origin (both
`https://` and `wss://`), or the app can't reach signaling:

```
"connect-src 'self' https://strand-backend.onrender.com wss://strand-backend.onrender.com;"
```

Also update `web/src/core/config.ts` `DEFAULT_PRODUCTION_BACKEND` if you want the
non-env fallback to point at your backend. Then confirm the backend's
`ALLOWED_ORIGINS` includes the Vercel domain (re-deploy the backend if needed).

## 4. TURN (cross-network peers)

Same-network peers connect directly. Peers on different networks (especially
symmetric NAT) need a TURN relay. Strand uses **Cloudflare Calls TURN**:

1. Cloudflare dashboard → **Calls** → create a TURN app.
2. Copy the **Token ID** and **API Token**.
3. Set `CLOUDFLARE_TURN_TOKEN_ID` and `CLOUDFLARE_API_TOKEN` on the backend.

The backend mints short-lived credentials at `/api/turn-credentials` (per-IP
rate-limited). Set `TURN_REQUIRE_PARTICIPANT=true` to also require an active room
participant.

## 5. Verify the deploy

- Open the Vercel URL on two devices on **different** networks; create a flight
  on one, join on the other, send a file. (Cross-network needs §4.)
- The app is a PWA — you should get an install prompt; it works offline for the
  app shell.
- Check the frontend response headers include the CSP and `Cache-Control:
  immutable` on `/assets/*`, and that `/api/status` on the backend does **not**
  include a `memory` field (unless you pass `STATUS_ACCESS_KEY`).

## Notes

- **Wire compatibility:** Strand speaks the same protocol as the original DropSilk
  backend, so the frontend also runs against an existing DropSilk backend if you
  point `VITE_API_BASE_URL`/`VITE_WS_URL` at it.
- **Scaling:** the signaling server keeps room/socket state in one process (rooms
  are the source of truth in Postgres, sockets are disposable). The in-memory
  rate limiter is per-instance — move it to Redis before running multiple
  backend instances.
