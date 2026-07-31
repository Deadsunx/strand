import { describe, it, expect, vi } from "vitest";
import { SignalingClient, type WebSocketLike } from "../signaling.ts";

/** A controllable fake WebSocket implementing the injected interface. */
class FakeSocket implements WebSocketLike {
    readyState = 0; // CONNECTING
    sent: string[] = [];
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;

    send(data: string): void {
        this.sent.push(data);
    }
    close(): void {
        this.readyState = 3; // CLOSED
        this.onclose?.(undefined);
    }
    open(): void {
        this.readyState = 1; // OPEN
        this.onopen?.(undefined);
    }
    receive(message: unknown): void {
        this.onmessage?.({ data: JSON.stringify(message) });
    }
}

function makeClient() {
    let socket!: FakeSocket;
    const client = new SignalingClient({
        url: "ws://test",
        createSocket: () => {
            socket = new FakeSocket();
            return socket;
        },
    });
    client.connect();
    return { client, socket: () => socket };
}

describe("SignalingClient outbound queueing", () => {
    it("queues messages sent before open and flushes them on open", () => {
        const { client, socket } = makeClient();
        // Not open yet — these should be buffered, not sent.
        client.registerDetails({
            name: "Alice",
            discoverable: true,
            networkToken: "pin",
        });
        client.attachRoom({ roomCode: "ABC123", participantId: "p1" });
        expect(socket().sent).toEqual([]);

        socket().open();

        expect(socket().sent).toHaveLength(2);
        const register = JSON.parse(socket().sent[0]);
        expect(register).toEqual({
            type: "register-details",
            name: "Alice",
            discoverable: true,
            networkToken: "pin",
        });
        const attach = JSON.parse(socket().sent[1]);
        expect(attach).toEqual({
            type: "attach-room",
            roomCode: "ABC123",
            participantId: "p1",
        });
    });

    it("omits optional discovery fields when not provided", () => {
        const { client, socket } = makeClient();
        socket().open();
        client.registerDetails({ name: "Bob" });
        expect(JSON.parse(socket().sent[0])).toEqual({
            type: "register-details",
            name: "Bob",
        });
    });
});

describe("SignalingClient inbound events", () => {
    it("maps server messages to typed events", () => {
        const { client, socket } = makeClient();
        socket().open();

        const registered = vi.fn();
        const peerJoined = vi.fn();
        const networkUsers = vi.fn();
        const serverError = vi.fn();
        client.on("registered", registered);
        client.on("peerJoined", peerJoined);
        client.on("networkUsers", networkUsers);
        client.on("serverError", serverError);

        socket().receive({ type: "registered", id: "abc" });
        socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "p2", name: "Bob" },
            connectionType: "lan",
        });
        socket().receive({
            type: "users-on-network-update",
            users: [{ id: "p3", name: "Carol" }],
        });
        socket().receive({ type: "error", message: "boom" });

        expect(registered).toHaveBeenCalledWith({ id: "abc" });
        expect(peerJoined).toHaveBeenCalledWith({
            flightCode: "ABC123",
            peer: { id: "p2", name: "Bob" },
            connectionType: "lan",
        });
        expect(networkUsers).toHaveBeenCalledWith({
            users: [{ id: "p3", name: "Carol" }],
        });
        expect(serverError).toHaveBeenCalledWith({ message: "boom" });
    });

    it("does not emit close when disconnected silently", () => {
        const { client, socket } = makeClient();
        socket().open();
        const close = vi.fn();
        client.on("close", close);
        client.disconnect({ silent: true });
        expect(close).not.toHaveBeenCalled();
    });
});
