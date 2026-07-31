import WebSocket, { WebSocketServer } from "ws";
import type { Server, IncomingMessage } from "http";
import { createHash } from "crypto";
import config from "./config";
import * as state from "./state";
import type { ClientMetadata, Flight } from "./state";
import { generateFlightCode, generateSessionId } from "./ids";
import { removeParticipantFromRoom, resolveRoomParticipant } from "./roomStore";
import {
    determineConnectionType,
    getClientIp,
    getNetworkGroup,
    isAllowedOrigin,
} from "./networking";
import { emit } from "./gossamer";
import {
    AttachRoomMessage,
    ClientMessage,
    InviteToFlightMessage,
    JoinFlightMessage,
    RegisterDetailsMessage,
    SignalMessage,
    clientMessageSchema,
    formatValidationIssues,
} from "./validation";

let wss: WebSocketServer | undefined;
let healthInterval: NodeJS.Timeout | undefined;
const screenShareFlights: Record<string, Flight> = {};
const chatFlights: Record<string, Flight> = {};
const knownMessageTypes = new Set([
    "register-details",
    "create-flight",
    "join-flight",
    "invite-to-flight",
    "attach-room",
    "signal",
]);

interface ExtendedWebSocket extends WebSocket {
    isAlive: boolean;
}

function getFlightRegistry(channel: ClientMetadata["channel"]): Record<string, Flight> {
    if (channel === "screen-share") {
        return screenShareFlights;
    }
    if (channel === "chat") {
        return chatFlights;
    }
    return state.flights;
}

async function attachDurableRoom(
    ws: WebSocket,
    meta: ClientMetadata,
    data: AttachRoomMessage
): Promise<void> {
    const roomParticipant = await resolveRoomParticipant(
        data.roomCode,
        data.participantId
    );

    if (!roomParticipant) {
        ws.send(
            JSON.stringify({ type: "error", message: "Room not found or expired" })
        );
        return;
    }

    const self = roomParticipant.self;
    const channel = data.channel ?? "transfer";
    meta.name = self.name;
    meta.flightCode = roomParticipant.roomCode;
    meta.participantId = self.participantId;
    meta.role = self.role;
    meta.channel = channel;
    state.clients.set(ws, meta);

    const flightRegistry = getFlightRegistry(channel);
    const existingFlight = flightRegistry[roomParticipant.roomCode] || {
        members: [],
        establishedAt: null,
    };

    existingFlight.members = existingFlight.members.filter((client) => {
        if (client === ws || client.readyState !== WebSocket.OPEN) {
            return false;
        }

        const clientMeta = state.clients.get(client);
        return Boolean(
            clientMeta && clientMeta.participantId !== self.participantId
        );
    });

    existingFlight.members.push(ws);
    flightRegistry[roomParticipant.roomCode] = existingFlight;

    ws.send(
        JSON.stringify({
            type: "room-attached",
            flightCode: roomParticipant.roomCode,
            role: self.role,
            peer: roomParticipant.peer,
        })
    );

    if (!roomParticipant.peer) {
        return;
    }

    const hostWs = existingFlight.members.find(
        (client) => state.clients.get(client)?.role === "host"
    );
    const guestWs = existingFlight.members.find(
        (client) => state.clients.get(client)?.role === "guest"
    );

    if (!hostWs || !guestWs) {
        return;
    }

    const hostMeta = state.clients.get(hostWs);
    const guestMeta = state.clients.get(guestWs);

    if (!hostMeta || !guestMeta) {
        return;
    }

    const connectionType = determineConnectionType(
        hostMeta.remoteIp,
        guestMeta.remoteIp
    );
    existingFlight.establishedAt = existingFlight.establishedAt || Date.now();

    hostWs.send(
        JSON.stringify({
            type: "peer-joined",
            flightCode: roomParticipant.roomCode,
            peer: { id: guestMeta.id, name: guestMeta.name },
            connectionType,
        })
    );
    guestWs.send(
        JSON.stringify({
            type: "peer-joined",
            flightCode: roomParticipant.roomCode,
            peer: { id: hostMeta.id, name: hostMeta.name },
            connectionType,
        })
    );

    if (channel === "transfer") {
        emit("flight:joined", {
            flightCode: roomParticipant.roomCode,
            joinerId: guestMeta.id,
            joinerName: guestMeta.name,
            ip: guestMeta.remoteIp,
            connectionType,
        });
    }
}

export function initializeSignaling(server: Server): WebSocketServer {
    wss = new WebSocketServer({
        server,
        verifyClient,
        perMessageDeflate: false,
        maxPayload: config.MAX_PAYLOAD,
        clientTracking: true,
    });

    wss.on("error", (error: Error) => {
        emit("client:error", {
            context: "WebSocket server error",
            error: error.message,
            stack: error.stack,
        });
    });

    wss.on("connection", handleConnection);

    startHealthChecks();

    emit("system:startup", { service: "Signaling Service" });
    return wss;
}

function verifyClient(
    info: { origin?: string; req: IncomingMessage },
    done: (result: boolean, code?: number, message?: string) => void
): void {
    const origin = info.req.headers.origin;

    if (config.NODE_ENV === "production") {
        if (origin && isAllowedOrigin(origin)) {
            done(true);
        } else {
            emit("client:error", {
                context: "Connection rejected (invalid origin)",
                origin,
                ip: getClientIp(info.req),
            });
            done(false, 403, "Forbidden: Invalid Origin");
        }
        return;
    }

    if ((origin && isAllowedOrigin(origin)) || !origin) {
        done(true);
    } else {
        emit("client:error", {
            context: "Connection rejected (development origin check)",
            origin,
            ip: getClientIp(info.req),
        });
        done(false, 403, "Forbidden: Invalid Origin");
    }
}

function handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const extWs = ws as ExtendedWebSocket;
    const clientId = generateSessionId();
    const cleanRemoteIp = getClientIp(req);

    const metadata: ClientMetadata = {
        id: clientId,
        name: "Anonymous",
        flightCode: null,
        participantId: null,
        role: null,
        channel: null,
        remoteIp: cleanRemoteIp,
        connectedAt: new Date().toISOString(),
        userAgent: (req.headers["user-agent"] as string) || "unknown",
        discoverable: config.NETWORK_DISCOVERY_LEGACY_DEFAULT,
        networkTokenHash: null,
    };

    state.clients.set(ws, metadata);
    state.connectionStats.totalConnections++;

    emit("client:connected", {
        clientId,
        ip: cleanRemoteIp,
        totalClients: state.clients.size,
    });

    extWs.isAlive = true;
    ws.on("pong", () => {
        extWs.isAlive = true;
    });

    ws.send(JSON.stringify({ type: "registered", id: clientId }));
    broadcastUsersOnSameNetwork();

    ws.on("message", (message: WebSocket.RawData) => {
        void handleMessage(ws, message);
    });
    ws.on("close", () => {
        void handleDisconnect(ws);
    });
    ws.on("error", (error: Error) =>
        emit("client:error", {
            clientId: metadata.id,
            error: error.message,
        })
    );
}

function parseClientMessage(
    message: WebSocket.RawData
): { data: ClientMessage } | { error: string; issues?: string[] } {
    const messageStr = message.toString();
    const raw = JSON.parse(messageStr) as Record<string, unknown>;

    if (typeof raw?.type !== "string") {
        return { error: "Invalid message format" };
    }

    if (!knownMessageTypes.has(raw.type)) {
        return { error: "Unknown message type" };
    }

    const result = clientMessageSchema.safeParse(raw);
    if (!result.success) {
        return {
            error: "Invalid message payload",
            issues: formatValidationIssues(result.error),
        };
    }

    return { data: result.data };
}

async function handleMessage(ws: WebSocket, message: WebSocket.RawData): Promise<void> {
    const meta = state.clients.get(ws);
    if (!meta) {
        return;
    }

    let data: ClientMessage;
    try {
        const messageStr = message.toString();
        if (messageStr.length > config.MAX_PAYLOAD) {
            emit("client:error", {
                clientId: meta.id,
                context: "Message too large",
                size: messageStr.length,
            });
            ws.send(
                JSON.stringify({ type: "error", message: "Message too large" })
            );
            return;
        }

        const parsed = parseClientMessage(message);
        if ("error" in parsed) {
            emit("client:error", {
                clientId: meta.id,
                context: parsed.error,
                issues: parsed.issues,
            });
            ws.send(JSON.stringify({ type: "error", message: parsed.error }));
            return;
        }

        data = parsed.data;
    } catch (error) {
        const err = error as Error;
        emit("client:error", {
            clientId: meta.id,
            context: "JSON parse error",
            error: err.message,
        });
        ws.send(
            JSON.stringify({
                type: "error",
                message: "Invalid message format",
            })
        );
        return;
    }

    try {
        switch (data.type) {
            case "attach-room":
                await attachDurableRoom(ws, meta, data);
                break;

            case "register-details":
                meta.name = data.name;
                // Discovery is opt-in: only advertise this client if it asks to
                // be discoverable (falls back to the legacy default otherwise).
                if (typeof data.discoverable === "boolean") {
                    meta.discoverable = data.discoverable;
                }
                meta.networkTokenHash = data.networkToken
                    ? hashNetworkToken(data.networkToken)
                    : null;
                state.clients.set(ws, meta);
                emit("client:registered_details", {
                    clientId: meta.id,
                    newName: meta.name,
                    discoverable: meta.discoverable,
                    scopedByToken: Boolean(meta.networkTokenHash),
                });
                broadcastUsersOnSameNetwork();
                break;

            case "create-flight":
                if (meta.flightCode) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Already in a flight",
                        })
                    );
                    return;
                }
                let flightCode = generateFlightCode();
                while (state.flights[flightCode]) {
                    flightCode = generateFlightCode();
                }
                state.flights[flightCode] = {
                    members: [ws],
                    establishedAt: null,
                };
                meta.flightCode = flightCode;
                meta.channel = "transfer";
                state.connectionStats.totalFlightsCreated++;

                emit("flight:created", {
                    flightCode,
                    creatorId: meta.id,
                    createdAt: Date.now(),
                });

                ws.send(JSON.stringify({ type: "flight-created", flightCode }));
                broadcastUsersOnSameNetwork();
                break;

            case "join-flight": {
                const joinData: JoinFlightMessage = data;
                if (meta.flightCode) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Already in a flight",
                        })
                    );
                    return;
                }
                const flight = state.flights[joinData.flightCode];
                if (!flight || flight.members.length >= 2) {
                    emit("flight:error", {
                        clientId: meta.id,
                        flightCode: joinData.flightCode,
                        error: !flight ? "not_found" : "flight_full",
                    });
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Flight not found or full",
                        })
                    );
                    return;
                }

                const creatorWs = flight.members[0];
                const creatorMeta = state.clients.get(creatorWs);
                const joinerMeta = meta;

                if (!creatorMeta || creatorWs.readyState !== WebSocket.OPEN) {
                    delete state.flights[joinData.flightCode];
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Flight creator disconnected",
                        })
                    );
                    return;
                }

                const connectionType = determineConnectionType(
                    creatorMeta.remoteIp,
                    joinerMeta.remoteIp
                );

                flight.members.push(ws);
                flight.establishedAt = Date.now();
                meta.flightCode = joinData.flightCode;
                meta.channel = "transfer";
                state.connectionStats.totalFlightsJoined++;

                emit("flight:joined", {
                    flightCode: joinData.flightCode,
                    joinerId: meta.id,
                    joinerName: meta.name,
                    ip: meta.remoteIp,
                    connectionType,
                });

                ws.send(
                    JSON.stringify({
                        type: "peer-joined",
                        flightCode: joinData.flightCode,
                        peer: { id: creatorMeta.id, name: creatorMeta.name },
                        connectionType,
                    })
                );
                creatorWs.send(
                    JSON.stringify({
                        type: "peer-joined",
                        flightCode: joinData.flightCode,
                        peer: { id: meta.id, name: meta.name },
                        connectionType,
                    })
                );

                broadcastUsersOnSameNetwork();
                break;
            }

            case "invite-to-flight": {
                const inviteData: InviteToFlightMessage = data;
                emit("flight:invitation", {
                    flightCode: inviteData.flightCode,
                    from: meta.id,
                    to: inviteData.inviteeId,
                });
                for (const [clientWs, clientMeta] of state.clients.entries()) {
                    if (
                        clientMeta.id === inviteData.inviteeId &&
                        clientWs.readyState === WebSocket.OPEN
                    ) {
                        clientWs.send(
                            JSON.stringify({
                                type: "flight-invitation",
                                flightCode: inviteData.flightCode,
                                fromName: meta.name,
                            })
                        );
                        break;
                    }
                }
                break;
            }

            case "signal": {
                const signalData: SignalMessage = data;
                const flightRegistry = getFlightRegistry(meta.channel);
                if (!meta.flightCode || !flightRegistry[meta.flightCode]) return;

                if (meta.channel === "transfer") {
                    emit("flight:signal", {
                        flightCode: meta.flightCode,
                        senderId: meta.id,
                    });
                }

                flightRegistry[meta.flightCode].members.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({ type: "signal", data: signalData.data })
                        );
                    }
                });
                break;
            }
        }
    } catch (error) {
        const err = error as Error;
        emit("client:error", {
            context: "Error in message switch",
            clientId: meta.id,
            messageType: data.type,
            error: err.message,
        });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Server error processing your request",
                })
            );
        }
    }
}

async function handleDisconnect(ws: WebSocket): Promise<void> {
    const meta = state.clients.get(ws);
    if (!meta) return;

    state.clients.delete(ws);
    state.connectionStats.totalDisconnections++;

    if (meta.channel === "transfer" && meta.flightCode && meta.participantId) {
        try {
            await removeParticipantFromRoom(meta.flightCode, meta.participantId);
        } catch (error) {
            const err = error as Error;
            emit("room:error", {
                context: "Failed to remove disconnected participant from room",
                roomCode: meta.flightCode,
                participantId: meta.participantId,
                error: err.message,
            });
        }
    }

    emit("client:disconnected", {
        clientId: meta.id,
        remainingClients: state.clients.size,
        flightCode: meta.flightCode,
    });

    const flightRegistry = getFlightRegistry(meta.channel);
    if (meta.flightCode && flightRegistry[meta.flightCode]) {
        const flightRef = flightRegistry[meta.flightCode];

        flightRef.members = flightRef.members.filter((c) => c !== ws);

        flightRef.members.forEach((client) => {
            if (client.readyState === WebSocket.OPEN)
                client.send(JSON.stringify({ type: "peer-left" }));
        });

        if (flightRef.members.length === 0) {
            if (meta.channel === "transfer") {
                emit("flight:ended", {
                    flightCode: meta.flightCode,
                    reason: "all_members_left",
                });
            }
            delete flightRegistry[meta.flightCode];
        }
    }
    broadcastUsersOnSameNetwork();
}

function hashNetworkToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/**
 * Computes the discovery grouping key for a client, or null if it must never
 * be grouped with anyone.
 *
 * - Clients that did not opt in (`discoverable`) are never advertised.
 * - A shared network token (PIN) forms an explicit, IP-independent group and is
 *   the safe way to discover across NATs without leaking to strangers.
 * - Without a token we fall back to the observed network group, but this is
 *   only trustworthy on genuinely private LANs. On shared public IPs (CGNAT,
 *   offices, campuses) many unrelated users collapse into one group, so
 *   oversized IP-based groups are suppressed by the caller.
 */
function getDiscoveryGroupKey(meta: state.ClientMetadata): string | null {
    if (!meta.discoverable) return null;
    if (meta.networkTokenHash) return `tok:${meta.networkTokenHash}`;
    return `ip:${getNetworkGroup(meta.remoteIp)}`;
}

function isInFullFlight(meta: state.ClientMetadata): boolean {
    return Boolean(
        meta.flightCode &&
            state.flights[meta.flightCode] &&
            state.flights[meta.flightCode].members.length === 2
    );
}

function broadcastUsersOnSameNetwork(): void {
    try {
        const membersByGroup: Record<
            string,
            { id: string; name: string; tokenScoped: boolean }[]
        > = {};

        for (const [ws, meta] of state.clients.entries()) {
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;
            if (meta.channel === "screen-share" || meta.channel === "chat") continue;
            if (isInFullFlight(meta)) continue;

            const groupingKey = getDiscoveryGroupKey(meta);
            if (!groupingKey) continue; // not discoverable → never advertised

            (membersByGroup[groupingKey] ??= []).push({
                id: meta.id,
                name: meta.name,
                tokenScoped: groupingKey.startsWith("tok:"),
            });
        }

        // Suppress oversized IP-derived groups: a real home LAN never has this
        // many peers, so a large group means shared/CGNAT public IPs. Explicit
        // token groups are exempt because membership is intentional.
        const suppressed = new Set<string>();
        for (const [key, members] of Object.entries(membersByGroup)) {
            if (
                !members[0]?.tokenScoped &&
                members.length > config.NETWORK_DISCOVERY_MAX_GROUP
            ) {
                suppressed.add(key);
                emit("discovery:group_suppressed", {
                    reason: "oversized_ip_group",
                    size: members.length,
                });
            }
        }

        for (const [ws, meta] of state.clients.entries()) {
            if (!meta || ws.readyState !== WebSocket.OPEN) continue;
            if (meta.channel === "screen-share" || meta.channel === "chat") continue;

            const groupingKey = isInFullFlight(meta)
                ? null
                : getDiscoveryGroupKey(meta);

            const usersOnNetwork =
                groupingKey && !suppressed.has(groupingKey)
                    ? (membersByGroup[groupingKey] ?? [])
                          .filter((client) => client.id !== meta.id)
                          .map(({ id, name }) => ({ id, name }))
                    : [];

            ws.send(
                JSON.stringify({
                    type: "users-on-network-update",
                    users: usersOnNetwork,
                })
            );
        }
    } catch (error) {
        const err = error as Error;
        emit("system:error", {
            context: "broadcastUsersOnSameNetwork",
            error: err.message,
        });
    }
}

function startHealthChecks(): void {
    if (!wss) return;

    healthInterval = setInterval(() => {
        wss!.clients.forEach((ws) => {
            const extWs = ws as ExtendedWebSocket;
            if (extWs.isAlive === false) {
                return ws.terminate();
            }
            extWs.isAlive = false;
            ws.ping();
        });
    }, config.HEALTH_CHECK_INTERVAL);
}

export function closeConnections(): void {
    emit("system:shutdown", {
        message: "Closing WebSocket connections",
    });
    if (healthInterval) {
        clearInterval(healthInterval);
    }
    if (wss) {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: "server-shutdown",
                        message: "Server is shutting down for maintenance.",
                    })
                );
                ws.close(1001, "Server shutdown");
            }
        });
    }
}
