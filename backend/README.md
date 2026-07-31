<div align="center">
  <img src="https://raw.githubusercontent.com/medy17/dropsilk/refs/heads/main/frontend/public/logo.webp" alt="DropSilk Logo" width="100" />
  <h1>DropSilk - Backend Signaling Server</h1>
  <p>
    The lightweight, signaling and API server for the <a href="https://github.com/medy17/dropsilk">DropSilk</a> project.
  </p>

  <div>
    <img src="https://img.shields.io/badge/bun-282a36?style=for-the-badge&logo=bun&logoColor=fbf0df" alt="Bun runtime"/>
    <img src="https://img.shields.io/github/license/medy17/dropsilk_backend?style=for-the-badge" alt="License"/>
  </div>
</div>

## Overview

This repository contains the backend service for DropSilk. Its primary role
is to act as a WebRTC signaling server, also known as a "rendezvous" or
"matchmaking" service. It uses WebSockets to help two DropSilk clients find
each other and exchange the necessary metadata to establish a direct,
peer-to-peer connection. To maximize connection success rates, even for users
behind restrictive firewalls, the server can also provide temporary STUN/TURN
credentials from Cloudflare.

Crucially, this server does not handle any file transfers. All files and
screen-sharing data are sent directly between the connected peers, ensuring
privacy and speed.

Additionally, this server provides a small set of HTTP endpoints for health
checks, statistics, durable room management, and a secure proxy for the
UploadThing API, which facilitates previews for some complex, non-client
side render-able files.

The server stores both room state and preview upload metadata in PostgreSQL and
runs a background cleanup service that periodically removes stale preview files
from UploadThing and prunes their database records. This keeps storage lean and
prevents orphaned files. 

### Core Features

-   WebSocket-based real-time signaling: Manages client connections,
    disconnections, and the exchange of WebRTC session descriptions (SDP) and
    ICE candidates.
-   Flight management: Handles the creation of unique, temporary "flight codes"
    and allows peers to join these flights.
-   Peer discovery & LAN/WAN detection: Intelligently groups users on the same
    network (by public IP or private subnet) and informs the clients if a
    faster LAN connection is possible.
-   Comprehensive Telemetry & Story Logging: An event-driven system logs
    events in real-time. It also constructs "Flight
    Stories" which are complete narratives of a peer-to-peer session from creation to
    termination for deeper insights when debugging.
-   HTTP API endpoints:
    -   `GET /`: Health check.
    -   `GET /stats`: Real-time server statistics.
    -   `GET /logs`: A secure, key-protected endpoint to view recent in-memory
        server logs for debugging.
    -   `GET /keep-alive`: Lightweight ping endpoint. Useful for services that sleep dormant instances.
    -   `GET /api/turn-credentials`: Securely provides clients with temporary STUN/TURN
        server credentials from Cloudflare to improve peer-to-peer connection success rates (NAT traversal).
    -   Room endpoints under `/api/rooms`: create rooms, join rooms, fetch room
        summaries, and update participant readiness or screen-share state.
-   Secure upload endpoint: Provides a route (`/api/uploadthing`) that securely
    handles authentication and requests for the UploadThing service, used for
    generating file previews on the frontend.
-   Robust security & CORS: Implements strict origin validation to ensure only
    trusted frontend clients can connect. Includes support for Vercel preview
    deployments.
-   Graceful shutdown: Ensures clean termination of connections and processes
    when the server is stopped or restarted.
-   In-memory logging: Keeps a running buffer of the most recent log events,
    accessible via the `/logs` endpoint for easy debugging without writing to
    disk.
-   Durable room storage in PostgreSQL: Rooms, participants, readiness, and
    screen-share state are persisted in Postgres.
-   Background room cleanup: Expired rooms are pruned by a periodic cleanup
    worker instead of on every room request.
-   Automated preview cleanup service: Periodically deletes old preview files
    from UploadThing and removes their associated database records. By default,
    files older than 24 hours are considered stale. The job runs once at
    startup and then on a schedule (every 60 minutes in this repo's default
    `server.ts`).

## API & Signaling Protocol

The server communicates with clients primarily over WebSockets using a
simple JSON-based protocol.

### WebSocket Messages (Client ↔ Server)

| Type                      | Direction | Description                                                                                                       |
|:--------------------------|:----------|:------------------------------------------------------------------------------------------------------------------|
| `registered`              | S → C     | Sent by the server to a new client, providing their unique session ID.                                            |
| `register-details`        | C → S     | Client sends its generated name to the server.                                                                    |
| `users-on-network-update` | S → C     | Server sends a list of other available users on the same network.                                                 |
| `create-flight`           | C → S     | Client requests the server to create a new private session ("flight").                                            |
| `flight-created`          | S → C     | Server responds with the unique 6-character flight code.                                                          |
| `join-flight`             | C → S     | Client requests to join an existing flight using a code.                                                          |
| `peer-joined`             | S → C     | Server notifies both peers a connection is established, including peer info and connection type (`lan` or `wan`). |
| `peer-left`               | S → C     | Server notifies a client that their peer has disconnected.                                                        |
| `invite-to-flight`        | C → S     | A client in a flight invites another user on the network to join.                                                 |
| `flight-invitation`       | S → C     | Server forwards the invitation to the target user.                                                                |
| `signal`                  | C ↔ S ↔ C | WebRTC signaling data (SDP/ICE) to be forwarded to its peer.                                                      |
| `error`                   | S → C     | Server sends an error message (e.g., "Flight not found").                                                         |

### HTTP Endpoints

| Method | Path                    | Description                                                                  |
|:-------|:------------------------|:-----------------------------------------------------------------------------|
| GET    | `/`                     | Basic health check endpoint. Returns a simple text response.                 |
| GET    | `/stats`                | Returns a JSON object with server statistics (uptime, memory, connections).  |
| GET    | `/logs?key=...`         | Returns plain text dump of recent in-memory logs. Requires `LOG_ACCESS_KEY`. |
| GET    | `/keep-alive`           | Lightweight ping endpoint for uptime checks.                                 |
| GET    | `/api/turn-credentials` | Provides temporary STUN/TURN credentials from Cloudflare for NAT traversal.  |
| POST   | `/api/uploadthing`      | Handles file upload requests for UploadThing (preview flow).                 |

## Workflow: File Previews and Automated Cleanup

The preview-and-cleanup flow works like this:

1.  A client initiates a preview upload via the frontend, which calls the
    backend `/api/uploadthing` route.
2.  The backend authenticates with UploadThing using `UPLOADTHING_TOKEN`. On
    successful upload, `onUploadComplete` is called.
3.  The backend stores room state in Postgres (`rooms` table) and preview
    upload metadata in Postgres (`uploaded_files` table), including `file_key`,
    `file_url`, `file_name`, and a timestamp. The preview URL stored there uses
    UploadThing's `ufsUrl`.
4.  The cleanup service runs:
    -   It finds rows where `uploaded_at` is older than 24 hours.
    -   It calls UploadThing to delete those files (by their keys).
    -   Only if UploadThing deletion succeeds, it removes the corresponding rows
        from the database.
    -   If UploadThing deletion fails, it logs the failure and skips DB deletion
        for those keys to avoid dangling references to files that still exist.
5.  This job runs once on startup and then at a fixed interval (60 minutes by
    default). The retention window and schedule can be adjusted
    in your environment variables.

Operational notes:

-   If the database is not initialised or `DATABASE_URL` is missing, the server 
    will immediately crash. You must set this.
-   The application does not create tables on startup. You must run migrations
    explicitly before booting the app. This does not apply to the dev server
    script (`bun run dev`), which drops all tables and reapplies migrations to
    provide a fresh copy on every boot.
-   This cleanup is meant for preview files and short-lived assets. Adjust
    the retention to fit your needs.

## Tech Stack

-   Runtime: Bun
-   Language: TypeScript
-   Server: Built-in `http` module
-   WebSockets: `ws` library
-   NAT Traversal: Cloudflare STUN/TURN
-   File previews: UploadThing Server SDK
-   Database: PostgreSQL (via `pg`)
-   Docker: Dev Server PostgreSQL instance.
-   Testing: Jest with ts-jest

## Getting Started (Local Development)

To run the signaling server locally, follow these steps.

### Prerequisites

-   Bun
-   Docker (required for PostgreSQL)
-   PostgreSQL (required for local dev and production durable state)

### Installation & Setup

1.  Clone the repository:
    ```bash
    git clone https://github.com/medy17/DropSilk_Backend.git
    cd DropSilk_Backend
    ```

2.  Install dependencies:
    ```bash
    bun install
    ```

3.  Set up environment variables:
    Create a `.env` file in the root of the project. This is where you'll store
    your secrets and configuration.

    ```env
    # .env

    # Required for the PPTX preview feature. Get this from UploadThing.
    UPLOADTHING_TOKEN="eyJhcGl...="

    # A secret key to protect the /logs endpoint.
    LOG_ACCESS_KEY="a-very-secret-and-random-string-for-logs"

    # Optional for robust P2P connections behind restrictive firewalls (NAT).
    # Get these from your Cloudflare dashboard under "TURN".
    CLOUDFLARE_TURN_TOKEN_ID="YOUR_CLOUDFLARE_TURN_TOKEN_ID"
    CLOUDFLARE_API_TOKEN="YOUR_CLOUDFLARE_API_TOKEN_WITH_RTC_PERMS"

    # Required for local dev and production. Standard Postgres connection string:
    # postgres://USER:PASSWORD@HOST:PORT/DBNAME
    DATABASE_URL="postgres://postgres:postgres@localhost:5432/dropsilk"

    # Optional override. Leave unset for Neon/hosted Postgres.
    # Set to "false" for plain local Postgres if needed.
    DATABASE_SSL="false"

    # Allowed origins and preview URL pattern. This is an example only.
    # If you self-host, make sure the regex matches your URLs.
    ALLOWED_ORIGINS="https://dropsilk.xyz,https://www.dropsilk.xyz,https://dropsilk.vercel.app,app://."
    VERCEL_PREVIEW_ORIGIN_REGEX="^https://dropsilk-[a-zA-Z0-9]+-ahmed-arats-projects\\.vercel\\.app$"

    # WebSocket / runtime tuning. Sane defaults exist so these are optional.
    MAX_PAYLOAD_BYTES=1048576
    WS_HEALTH_CHECK_INTERVAL_MS=30000
    SHUTDOWN_TIMEOUT_MS=10000
    HEARTBEAT_INTERVAL_MS=300000
    MAX_LOG_BUFFER_SIZE=1000

    # Room and cleanup tuning. Sane defaults exist so these are optional.
    ROOM_TTL_MINUTES=30
    ROOM_CLEANUP_INTERVAL_MINUTES=5
    PREVIEW_RETENTION_HOURS=24
    PREVIEW_CLEANUP_INTERVAL_MINUTES=60

    # In production, set this to your public server URL. In dev you can leave
    # it unset; the backend will fall back to http://localhost:8080.
    PUBLIC_SERVER_URL="http://localhost:8080"
    ```

    Notes:
    -   Run `bun run migrate` before starting the server for the first time
        so the required tables exist.
    -   `UPLOADTHING_TOKEN` must be provided under that exact env var name.
        `UPLOADTHING_SECRET` is not read by the current code.
    -   **If Cloudflare variables are not set, TURN functionality will be disabled.** It is
        highly recommended that you set these up for higher connection success rates.

### Running the Server

1.  Quick start for local development:
    ```bash
    bun install
    docker compose up -d postgres
    bun run dev
    ```
    This starts local Postgres, resets the local database, reapplies
    migrations, and runs the backend with the local frontend ports already
    allowed.

    While `bun run dev` is running in an interactive terminal, you can use:
    -   `h` to reload only the backend process without resetting the database.
    -   `r` to perform a full dev restart (`db:reset` + `migrate` + server restart).
    -   `q` or `Ctrl+C` to quit the dev runner and stop the local Docker Postgres container.

2.  Manual local startup:
    Start local Postgres:
    ```bash
    docker compose up -d postgres
    ```

    Apply migrations:
    ```bash
    bun run migrate
    ```

    Start the server:
    ```bash
    bun server.ts
    ```
    By default, the server will run on `http://localhost:8080`.

3.  Running with the frontend manually:
    When running the
    [DropSilk Frontend](https://github.com/medy17/dropsilk) locally (typically
    on port `5173`), allow the backend to accept that origin:
    ```bash
    bun server.ts --allow-local-port=5173
    ```
    The server will then accept WebSocket connections from
    `http://localhost:5173` and `http://127.0.0.1:5173`.

4.  Running in production:
    ```bash
    bun run start
    ```
    This runs the server with Bun, which is the primary runtime for this repo.

5.  For a clean local reset:
    ```bash
    bun run db:reset
    bun run migrate
    ```
    `bun run dev` does this reset-and-migrate flow automatically before
    starting the server.

### Testing

The project uses [Jest](https://jestjs.io/) for unit and integration testing.
Tests cover all API endpoints, WebSocket signaling flows, and the
telemetry system, ensuring that correct events are emitted for each action.

To run the tests:
```bash
bun run test
```

### Cleanup Service Configuration

No extra setup is required: the cleanup service starts with the application,
runs once immediately, and then on a fixed schedule. If you need to tweak the defaults,
set your preferred values as environment variables.

-   Preview retention window: Controlled by `PREVIEW_RETENTION_HOURS`.
    Default: `24`.
-   Preview cleanup schedule: Controlled by
    `PREVIEW_CLEANUP_INTERVAL_MINUTES`. Default: `60`.
-   Room expiration window: Controlled by `ROOM_TTL_MINUTES`.
    Default: `30`.
-   Room cleanup schedule: Controlled by `ROOM_CLEANUP_INTERVAL_MINUTES`.
    Default: `5`.
-   Server heartbeat interval: Controlled by `HEARTBEAT_INTERVAL_MS`.
    Default: `300000`.

Advanced notes:

-   The cleanup service uses UploadThing's API to delete files. If that API
    call fails, database records are not removed, ensuring consistency with
    what's actually stored remotely.
-   The server requires a valid `DATABASE_URL`. If it is missing or the schema
    has not been migrated, startup fails fast.
-   If required tables are missing, startup fails fast and tells you to run
    migrations.

## Deployment

This server is designed to be lightweight, making it easy to
deploy on platforms like Render or any service that supports Bun.
In a typical setup, the frontend runs on Vercel, this backend runs on a
separate backend host, and only the backend connects to PostgreSQL.

### Required Environment Variables for Production

Set these in your hosting provider's dashboard:

-   `NODE_ENV`: Set to `production`.
-   `UPLOADTHING_TOKEN`: Your secret key from the UploadThing service.
-   `LOG_ACCESS_KEY`: Your chosen secret key for accessing the logs.
-   `PUBLIC_SERVER_URL`: The public URL of your deployed server
    (e.g., `https://your-app-name.onrender.com`). Required for UploadThing's
    callback to function correctly.
-   `DATABASE_URL`: PostgreSQL connection string. Required to persist room
    state, preview metadata, and enable the automated cleanup service.
-   `DATABASE_SSL`: Optional override for SSL negotiation. Leave unset for Neon.
    Use `false` for plain local Docker/Postgres if needed.
-   `CLOUDFLARE_TURN_TOKEN_ID`: (Highly Recommended) Your TURN Token ID from the Cloudflare dashboard.
-   `CLOUDFLARE_API_TOKEN`: (Highly Recommended) A Cloudflare API token with "RTC" read permissions.
     This ensures maximum connection success for users behind firewalls.

### Origin Security and Previews

-   Allowed origins are strictly enforced in production via a static allow-list
    and a regex for Vercel preview URLs.
-   For local development, use `--allow-local-port=PORT` to dynamically allow
    `http://localhost:PORT` and `http://127.0.0.1:PORT`.

## Monitoring and Logs

-   `/logs?key=...` returns the most recent in-memory log lines. Use your
    `LOG_ACCESS_KEY` to access it.
-   The server produces structured JSON logs for all key events. Look for
    `FLIGHT STORY COMPLETE` log entries, which contain a detailed JSON object
    summarizing an entire peer-to-peer session, including participants,
    duration, and key statistics.
-   The cleanup service logs each run, including:
    -   Whether DB is available.
    -   How many files were found for deletion.
    -   Success/failure of UploadThing deletions.
    -   How many DB records were pruned.

## License

This project is licensed under the GPLv3. See the `LICENSE` file for more
information.
