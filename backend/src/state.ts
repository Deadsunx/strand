// --- src/state.ts ---
// Manages the in-memory state of the application.

import type WebSocket from "ws";

/** Metadata stored for each connected WebSocket client */
export interface ClientMetadata {
    id: string;
    name: string;
    flightCode: string | null;
    participantId: string | null;
    role: "host" | "guest" | null;
    channel: "transfer" | "screen-share" | "chat" | null;
    remoteIp: string;
    connectedAt: string;
    userAgent: string;
    /** Whether this client opted in to appearing in nearby-device discovery. */
    discoverable: boolean;
    /** Hashed shared discovery token ("network PIN"), or null if not provided. */
    networkTokenHash: string | null;
}

/** Represents an active flight session between clients */
export interface Flight {
    members: WebSocket[];
    establishedAt: number | null;
}

/** Aggregate connection statistics */
export interface ConnectionStats {
    totalConnections: number;
    totalDisconnections: number;
    totalFlightsCreated: number;
    totalFlightsJoined: number;
    startTime: number;
}

/** Map of WebSocket connections to their metadata */
export const clients = new Map<WebSocket, ClientMetadata>();

/** Record of active flights by flight code */
export const flights: Record<string, Flight> = {};

/** Aggregate connection statistics */
export const connectionStats: ConnectionStats = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalFlightsCreated: 0,
    totalFlightsJoined: 0,
    startTime: Date.now(),
};
