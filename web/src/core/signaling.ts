// WebSocket signaling client. Ports the transport concerns of
// src/js/network/websocket.js (and the attach/queue behaviour) into a headless,
// event-emitting class. All UI/store/room-polling side-effects that the
// original mixed in here live in the app layer now; this class only speaks the
// wire protocol and surfaces typed events.

import { TypedEmitter } from "./emitter.ts";
import type {
    ClientToServerMessage,
    NetworkUser,
    RoomChannel,
    ServerToClientMessage,
    SignalPayload,
    SignalingPeer,
} from "./protocol.ts";

/** Minimal subset of the browser WebSocket used here (injectable for tests). */
export interface WebSocketLike {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: { data: unknown }) => void) | null;
    onclose: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

// Standard readyState values, so we don't depend on the global WebSocket object.
const WS_CONNECTING = 0;
const WS_OPEN = 1;

export type SignalingEvents = {
    open: void;
    close: void;
    error: { error: unknown };
    registered: { id: string };
    roomAttached: { flightCode: string; role: "host" | "guest"; peer: unknown };
    peerJoined: {
        flightCode: string;
        peer: SignalingPeer;
        connectionType: "lan" | "wan";
    };
    peerLeft: void;
    flightCreated: { flightCode: string };
    flightInvitation: { flightCode: string; fromName: string };
    networkUsers: { users: NetworkUser[] };
    signal: { data: SignalPayload };
    serverError: { message: string };
};

export interface RegisterDetailsOptions {
    name: string;
    discoverable?: boolean;
    networkToken?: string;
}

export interface AttachRoomOptions {
    roomCode: string;
    participantId: string;
    channel?: RoomChannel;
}

export interface SignalingClientOptions {
    url: string;
    createSocket?: WebSocketFactory;
}

export class SignalingClient extends TypedEmitter<SignalingEvents> {
    private readonly url: string;
    private readonly createSocket: WebSocketFactory;
    private socket: WebSocketLike | null = null;
    private outbox: string[] = [];
    private suppressClose = false;

    constructor(options: SignalingClientOptions) {
        super();
        this.url = options.url;
        this.createSocket =
            options.createSocket ??
            ((url) => new WebSocket(url) as unknown as WebSocketLike);
    }

    isConnected(): boolean {
        return this.socket?.readyState === WS_OPEN;
    }

    connect(): void {
        if (
            this.socket &&
            (this.socket.readyState === WS_OPEN ||
                this.socket.readyState === WS_CONNECTING)
        ) {
            return;
        }

        const socket = this.createSocket(this.url);
        this.socket = socket;
        socket.onopen = () => this.handleOpen();
        socket.onmessage = (ev) => this.handleMessage(ev.data);
        socket.onclose = () => this.handleClose();
        socket.onerror = (error) => this.emit("error", { error });
    }

    disconnect({ silent = false }: { silent?: boolean } = {}): void {
        this.suppressClose = silent;
        this.outbox = [];
        const socket = this.socket;
        if (
            socket &&
            (socket.readyState === WS_OPEN ||
                socket.readyState === WS_CONNECTING)
        ) {
            socket.close();
            return;
        }
        this.socket = null;
        this.suppressClose = false;
    }

    // --- Outbound messages -------------------------------------------------

    private send(message: ClientToServerMessage): void {
        const encoded = JSON.stringify(message);
        if (this.socket?.readyState === WS_OPEN) {
            this.socket.send(encoded);
        } else {
            // Queue until the socket opens (mirrors the original pendingAttach).
            this.outbox.push(encoded);
        }
    }

    registerDetails(options: RegisterDetailsOptions): void {
        this.send({
            type: "register-details",
            name: options.name,
            ...(options.discoverable !== undefined
                ? { discoverable: options.discoverable }
                : {}),
            ...(options.networkToken
                ? { networkToken: options.networkToken }
                : {}),
        });
    }

    attachRoom(options: AttachRoomOptions): void {
        this.send({
            type: "attach-room",
            roomCode: options.roomCode,
            participantId: options.participantId,
            ...(options.channel ? { channel: options.channel } : {}),
        });
    }

    createFlight(): void {
        this.send({ type: "create-flight" });
    }

    joinFlight(flightCode: string): void {
        this.send({ type: "join-flight", flightCode });
    }

    invite(inviteeId: string, flightCode: string): void {
        this.send({ type: "invite-to-flight", inviteeId, flightCode });
    }

    sendSignal(data: unknown): void {
        this.send({ type: "signal", data });
    }

    // --- Inbound handling --------------------------------------------------

    private handleOpen(): void {
        const socket = this.socket;
        if (socket) {
            const pending = this.outbox;
            this.outbox = [];
            for (const encoded of pending) socket.send(encoded);
        }
        this.emit("open", undefined);
    }

    private handleClose(): void {
        const wasSuppressed = this.suppressClose;
        this.suppressClose = false;
        this.socket = null;
        this.outbox = [];
        if (!wasSuppressed) {
            this.emit("close", undefined);
        }
    }

    private handleMessage(raw: unknown): void {
        let message: ServerToClientMessage;
        try {
            message = JSON.parse(String(raw)) as ServerToClientMessage;
        } catch {
            return;
        }

        switch (message.type) {
            case "registered":
                this.emit("registered", { id: message.id });
                break;
            case "room-attached":
                this.emit("roomAttached", {
                    flightCode: message.flightCode,
                    role: message.role,
                    peer: message.peer,
                });
                break;
            case "peer-joined":
                this.emit("peerJoined", {
                    flightCode: message.flightCode,
                    peer: message.peer,
                    connectionType: message.connectionType,
                });
                break;
            case "peer-left":
                this.emit("peerLeft", undefined);
                break;
            case "flight-created":
                this.emit("flightCreated", { flightCode: message.flightCode });
                break;
            case "flight-invitation":
                this.emit("flightInvitation", {
                    flightCode: message.flightCode,
                    fromName: message.fromName,
                });
                break;
            case "users-on-network-update":
                this.emit("networkUsers", { users: message.users });
                break;
            case "signal":
                this.emit("signal", { data: message.data });
                break;
            case "error":
                this.emit("serverError", { message: message.message });
                break;
        }
    }
}
