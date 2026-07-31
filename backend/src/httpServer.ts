import http from "http";
import fs from "fs/promises";
import path from "path";

import { createAdaptorServer, type HttpBindings } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import config from "./config";
import * as state from "./state";
import {
    createRoom,
    getRoomSummary,
    joinRoom,
    markParticipantReady,
    resolveRoomParticipant,
    setParticipantChatActive,
    setParticipantScreenShare,
} from "./roomStore";
import { getLocalIpForDisplay, isAllowedOrigin, getClientIp } from "./networking";
import { createRateLimiter } from "./rateLimiter";
import { handleUploadThingWebRequest } from "./uploadthingHandler";
import { getRequestEmailResponse } from "./emailService";
import { emit } from "./gossamer";
import {
    createRoomBodySchema,
    joinRoomBodySchema,
    participantReadyBodySchema,
    participantToggleBodySchema,
    requestEmailBodySchema,
    roomCodeParamSchema,
    roomParticipantParamSchema,
    roomSummaryQuerySchema,
    zValidator,
} from "./validation";

const PORT_TO_USE = Number(process.env.PORT) || config.PORT;

function roomNotFound(c: Context): Response {
    return c.json(
        { error: "Room not found or participant is not part of it." },
        404
    );
}

function roomRequestError(c: Context, error: unknown): Response {
    const err = error as Error;
    emit("room:error", {
        error: err.message,
        method: c.req.method,
        path: c.req.path,
    });
    return c.json({ error: err.message || "Invalid room request." }, 400);
}

function allowConfiguredOrigin(origin: string): string | null {
    return origin && isAllowedOrigin(origin) ? origin : null;
}

function allowAnyOrigin(origin: string): string | null {
    return origin || null;
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
}

const roomCors = cors({
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    origin: allowConfiguredOrigin,
});

const turnCors = cors({
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "OPTIONS"],
    origin: allowConfiguredOrigin,
});

const emailCors = cors({
    allowHeaders: ["Content-Type"],
    allowMethods: ["POST", "OPTIONS"],
    origin: allowConfiguredOrigin,
});

const uploadCors = cors({
    allowHeaders: ["*"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
    origin: allowAnyOrigin,
});

type AppBindings = { Bindings: HttpBindings };

export const app = new Hono<AppBindings>();
const rooms = new Hono<AppBindings>();

// Security headers on every response. This is an API/signaling server (it does
// not serve the app's HTML), so the CSP is deliberately locked down: it serves
// JSON and a favicon, nothing that needs to load scripts or frame content.
app.use(
    "*",
    secureHeaders({
        contentSecurityPolicy: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
            formAction: ["'none'"],
        },
        xFrameOptions: "DENY",
        xContentTypeOptions: "nosniff",
        referrerPolicy: "no-referrer",
        crossOriginResourcePolicy: false, // CORS already governs cross-origin reads
        permissionsPolicy: {
            camera: [],
            microphone: [],
            geolocation: [],
            payment: [],
            usb: [],
        },
    })
);

// Per-IP abuse limiters. TURN credentials and room creation are the two
// unauthenticated, resource-consuming endpoints, so each gets its own window.
const turnRateLimiter = createRateLimiter({
    name: "turn-credentials",
    limit: config.TURN_RATE_LIMIT,
    windowMs: config.TURN_RATE_WINDOW_MS,
});
const roomCreateRateLimiter = createRateLimiter({
    name: "room-create",
    limit: config.ROOM_CREATE_RATE_LIMIT,
    windowMs: config.ROOM_CREATE_RATE_WINDOW_MS,
});

app.onError((error, c) => {
    emit("http:error", {
        context: "Global Request Handler",
        error: error.message,
        url: c.req.url,
    });
    return c.text("Internal Server Error", 500);
});

app.notFound((c) => c.text("Not Found", 404));

rooms.use("*", roomCors);
rooms.post("/", roomCreateRateLimiter, zValidator("json", createRoomBodySchema), async (c) => {
    try {
        const body = c.req.valid("json");
        return c.json(await createRoom(body.name), 201);
    } catch (error) {
        return roomRequestError(c, error);
    }
});
rooms.get(
    "/:roomCode",
    zValidator("param", roomCodeParamSchema),
    zValidator("query", roomSummaryQuerySchema),
    async (c) => {
        const params = c.req.valid("param");
        const query = c.req.valid("query");
        const summary = await getRoomSummary(params.roomCode, query.participantId);
        return summary ? c.json(summary) : roomNotFound(c);
    }
);
rooms.post(
    "/:roomCode/join",
    zValidator("param", roomCodeParamSchema),
    zValidator("json", joinRoomBodySchema),
    async (c) => {
        try {
            const params = c.req.valid("param");
            const body = c.req.valid("json");
            return c.json(await joinRoom(params.roomCode, body.name));
        } catch (error) {
            return roomRequestError(c, error);
        }
    }
);
rooms.post(
    "/:roomCode/participants/:participantId/ready",
    zValidator("param", roomParticipantParamSchema),
    zValidator("json", participantReadyBodySchema),
    async (c) => {
        try {
            const params = c.req.valid("param");
            const body = c.req.valid("json");
            const summary = await markParticipantReady(
                params.roomCode,
                params.participantId,
                body
            );
            return summary ? c.json(summary) : roomNotFound(c);
        } catch (error) {
            return roomRequestError(c, error);
        }
    }
);
rooms.post(
    "/:roomCode/participants/:participantId/screen-share",
    zValidator("param", roomParticipantParamSchema),
    zValidator("json", participantToggleBodySchema),
    async (c) => {
        try {
            const params = c.req.valid("param");
            const body = c.req.valid("json");
            const summary = await setParticipantScreenShare(
                params.roomCode,
                params.participantId,
                body.active
            );
            return summary ? c.json(summary) : roomNotFound(c);
        } catch (error) {
            return roomRequestError(c, error);
        }
    }
);
rooms.post(
    "/:roomCode/participants/:participantId/chat",
    zValidator("param", roomParticipantParamSchema),
    zValidator("json", participantToggleBodySchema),
    async (c) => {
        try {
            const params = c.req.valid("param");
            const body = c.req.valid("json");
            const summary = await setParticipantChatActive(
                params.roomCode,
                params.participantId,
                body.active
            );
            return summary ? c.json(summary) : roomNotFound(c);
        } catch (error) {
            return roomRequestError(c, error);
        }
    }
);
rooms.all("*", (c) => c.json({ error: "Room endpoint not found." }, 404));

app.route("/api/rooms", rooms);

app.use("/api/turn-credentials", turnCors);
app.use("/api/turn-credentials", turnRateLimiter);
app.use("/request-email", emailCors);
app.use("/api/uploadthing", uploadCors);
app.use("/api/uploadthing/*", uploadCors);
app.use("/api/status", roomCors);

app.all("/api/uploadthing", (c) => handleUploadThingWebRequest(c.req.raw));
app.all("/api/uploadthing/*", (c) => handleUploadThingWebRequest(c.req.raw));

app.post("/request-email", zValidator("json", requestEmailBodySchema), async (c) =>
    getRequestEmailResponse(c.req.valid("json"))
);

app.get("/api/turn-credentials", async (c) => {
    if (!config.CLOUDFLARE_TURN_TOKEN_ID || !config.CLOUDFLARE_API_TOKEN) {
        emit("turn:error", {
            message: "TURN credentials request failed: Not configured",
        });
        return c.json(
            { error: "TURN service is not configured on the server." },
            501
        );
    }

    // Optionally bind credential issuance to an active room participant. This is
    // off by default so existing clients (which request credentials without room
    // context) keep working; enable via TURN_REQUIRE_PARTICIPANT once every
    // client sends roomCode + participantId. Rate limiting (above) applies
    // regardless and is the primary defence against relay-bandwidth abuse.
    if (config.TURN_REQUIRE_PARTICIPANT) {
        const roomCode = c.req.query("roomCode");
        const participantId = c.req.query("participantId");
        if (!roomCode || !participantId) {
            return c.json(
                { error: "roomCode and participantId are required." },
                400
            );
        }

        let participant = null;
        try {
            participant = await resolveRoomParticipant(roomCode, participantId);
        } catch (error) {
            emit("turn:error", {
                context: "Participant lookup failed",
                error: (error as Error).message,
            });
            return c.json({ error: "Could not verify room participant." }, 500);
        }

        if (!participant) {
            emit("turn:error", {
                context: "Rejected unbound TURN request",
                clientIp: getClientIp(c.env.incoming),
            });
            return c.json(
                { error: "Not an active participant in this room." },
                403
            );
        }
    }

    try {
        const response = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${config.CLOUDFLARE_TURN_TOKEN_ID}/credentials/generate-ice-servers`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ ttl: 3600 }),
            }
        );

        if (!response.ok) {
            const errorBody = await response.text();
            emit("turn:error", {
                context: "Cloudflare API Error",
                status: response.status,
                body: errorBody,
            });
            throw new Error(
                `Cloudflare API responded with status ${response.status}`
            );
        }

        const data = (await response.json()) as { iceServers?: unknown[] };
        emit("turn:credentials_issued", {
            clientIp: getClientIp(c.env.incoming),
        });

        if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
            emit("turn:error", {
                context: "Invalid Cloudflare Response",
                responseData: data,
            });
            throw new Error("Invalid response format from Cloudflare");
        }

        return c.json(data);
    } catch (error) {
        emit("turn:error", {
            context: "Fetch Loop",
            error: (error as Error).message,
        });
        return c.json({ error: "Could not fetch TURN credentials." }, 500);
    }
});

app.get("/favicon.ico", async (c) => {
    try {
        return new Response(
            await fs.readFile(path.join(__dirname, "..", "public", "favicon.ico")),
            {
                headers: { "Content-Type": "image/x-icon" },
                status: 200,
            }
        );
    } catch {
        return c.body(null, 404);
    }
});

// Full detail (memory internals) is only exposed when a STATUS_ACCESS_KEY is
// configured and the caller supplies it. Otherwise the public shape omits
// process memory/RSS so it can't be used for recon.
function hasStatusAccess(c: Context<AppBindings>): boolean {
    if (!config.STATUS_ACCESS_KEY) return false;
    const provided =
        c.req.header("x-status-key") || c.req.query("key") || "";
    return provided === config.STATUS_ACCESS_KEY;
}

app.get("/api/status", (c) => {
    const uptimeSeconds = process.uptime();
    const includeInternals = hasStatusAccess(c);
    const memory = includeInternals ? process.memoryUsage() : null;

    return c.json({
        ...(memory
            ? {
                  memory: {
                      heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
                      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
                      rssMB: Math.round(memory.rss / 1024 / 1024),
                  },
              }
            : {}),
        services: {
            signaling: {
                activeFlights: Object.keys(state.flights).length,
                status: "operational",
            },
            turn: {
                status:
                    config.CLOUDFLARE_TURN_TOKEN_ID && config.CLOUDFLARE_API_TOKEN
                        ? "operational"
                        : "not_configured",
            },
            websocket: {
                activeConnections: state.clients.size,
                status: "operational",
            },
        },
        stats: {
            totalConnections: state.connectionStats.totalConnections,
            totalDisconnections: state.connectionStats.totalDisconnections,
            totalFlightsCreated: state.connectionStats.totalFlightsCreated,
            totalFlightsJoined: state.connectionStats.totalFlightsJoined,
        },
        status: "operational",
        timestamp: new Date().toISOString(),
        uptime: uptimeSeconds,
        uptimeFormatted: formatUptime(uptimeSeconds),
        version: process.env.npm_package_version || "unknown",
    });
});

app.get("/", (c) =>
    c.text("Server is alive and waiting for WebSocket connections.")
);
app.get("/keep-alive", (c) => c.text("OK"));
app.get("/stats", (c) =>
    c.json({
        activeConnections: state.clients.size,
        activeFlights: Object.keys(state.flights).length,
        // Process memory is only exposed to holders of the status access key.
        ...(hasStatusAccess(c) ? { memory: process.memoryUsage() } : {}),
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    })
);

export const server = createAdaptorServer({
    fetch: app.fetch,
    autoCleanupIncoming: true,
    overrideGlobalObjects: false,
}) as http.Server;

server.on("error", (error: NodeJS.ErrnoException) => {
    emit("http:error", {
        context: "Critical Server Error",
        error: error.message,
        code: error.code,
    });
    if (error.code === "EADDRINUSE") {
        emit("system:shutdown", {
            reason: `Port ${PORT_TO_USE} in use`,
        });
        process.exit(1);
    }
});

export function startServer(): void {
    server.listen(PORT_TO_USE, "0.0.0.0", () => {
        emit("system:startup", {
            port: PORT_TO_USE,
            environment: config.NODE_ENV,
            localIp: getLocalIpForDisplay(),
        });
    });
}
