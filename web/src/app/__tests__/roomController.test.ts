import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoomController } from "../roomController.ts";
import { createAppStore, type AppStore } from "../../store/store.ts";
import {
    FileReceiver,
    FileSender,
    SignalingClient,
    TypedEmitter,
    decodeDataChannelFrame,
    encodeFileMetadata,
    EOF_MARKER,
    type PeerConnection,
    type PeerEvents,
    type RoomApi,
    type RoomSummary,
    type SendTransport,
    type WebSocketLike,
} from "../../core/index.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

// --- Fakes -----------------------------------------------------------------

class FakeSocket implements WebSocketLike {
    readyState = 0;
    sent: string[] = [];
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    send(data: string) {
        this.sent.push(data);
    }
    close() {
        this.readyState = 3;
        this.onclose?.(undefined);
    }
    open() {
        this.readyState = 1;
        this.onopen?.(undefined);
    }
    receive(message: unknown) {
        this.onmessage?.({ data: JSON.stringify(message) });
    }
    parsed() {
        return this.sent.map((s) => JSON.parse(s));
    }
}

/** Implements the PeerConnection surface the controller uses. */
class FakePeer extends TypedEmitter<PeerEvents> implements SendTransport {
    opened = false;
    sentData: Array<string | ArrayBuffer> = [];
    initializedAs: boolean | null = null;
    async initialize(isOfferer: boolean) {
        this.initializedAs = isOfferer;
    }
    async handleSignal() {}
    isOpen() {
        return this.opened;
    }
    buffered = 0;
    relayed: boolean | null = null;
    send(data: string | ArrayBuffer) {
        this.sentData.push(data);
    }
    bufferedAmount() {
        return this.buffered;
    }
    async isRelayed() {
        return this.relayed;
    }
    close() {
        this.opened = false;
    }
    openChannel() {
        this.opened = true;
        this.emit("open", undefined);
    }
    strings() {
        return this.sentData.filter((d): d is string => typeof d === "string");
    }
}

function summaryWithoutPeer(): RoomSummary {
    return {
        roomCode: "ABC123",
        status: "waiting",
        shouldConnect: false,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        self: {
            participantId: "host-1",
            role: "host",
            name: "Alice",
            ready: false,
            fileCount: 0,
            totalBytes: 0,
        },
        peer: null,
        screenShare: {
            activeParticipantId: null,
            requestedBySelf: false,
            requestedByPeer: false,
            isActive: false,
        },
        chat: { requestedBySelf: false, requestedByPeer: false, isActive: false },
    };
}

function summaryWithPeer(): RoomSummary {
    const s = summaryWithoutPeer();
    return {
        ...s,
        status: "paired",
        peer: {
            participantId: "guest-1",
            role: "guest",
            name: "Bob",
            ready: false,
            fileCount: 0,
            totalBytes: 0,
        },
    };
}

interface Harness {
    store: AppStore;
    controller: RoomController;
    socket: () => FakeSocket;
    peer: () => FakePeer;
    roomApi: {
        createRoom: ReturnType<typeof vi.fn>;
        joinRoom: ReturnType<typeof vi.fn>;
        getRoomStatus: ReturnType<typeof vi.fn>;
        markParticipantReady: ReturnType<typeof vi.fn>;
    };
    runPoll: () => void;
    fireTimers: () => void;
}

function makeHarness(firstSummary: RoomSummary): Harness {
    const store = createAppStore("Alice");
    let socket: FakeSocket;
    let peer: FakePeer;
    // All active fake intervals, keyed by handle in registration order. The
    // poll is registered first, so runPoll() fires the earliest live timer.
    const timers = new Map<number, () => void>();
    let nextHandle = 1;

    const roomApi = {
        createRoom: vi.fn(async () => firstSummary),
        joinRoom: vi.fn(async () => firstSummary),
        getRoomStatus: vi.fn(async () => firstSummary),
        markParticipantReady: vi.fn(async () => firstSummary),
    };

    const controller = new RoomController({
        store,
        roomApi: roomApi as unknown as RoomApi,
        createSignaling: () =>
            new SignalingClient({
                url: "ws://test",
                createSocket: () => {
                    socket = new FakeSocket();
                    return socket;
                },
            }),
        createPeer: () => {
            peer = new FakePeer();
            return peer as unknown as PeerConnection;
        },
        createSender: (transport: SendTransport) => new FileSender(transport),
        createReceiver: () => new FileReceiver(),
        setInterval: (fn) => {
            const handle = nextHandle++;
            timers.set(handle, fn);
            return handle;
        },
        clearInterval: (handle) => {
            timers.delete(handle);
        },
        now: () => 1000,
        inviteCooldownMs: 15000,
    });

    return {
        store,
        controller,
        socket: () => socket,
        peer: () => peer,
        roomApi,
        // Fire the earliest still-registered timer (the room poll).
        runPoll: () => {
            const first = [...timers.keys()][0];
            if (first !== undefined) timers.get(first)?.();
        },
        // Fire every registered timer once (snapshot so clears mid-fire are safe).
        fireTimers: () => {
            for (const fn of [...timers.values()]) fn();
        },
    };
}

// --- Tests -----------------------------------------------------------------

describe("RoomController", () => {
    let h: Harness;

    beforeEach(() => {
        h = makeHarness(summaryWithoutPeer());
    });

    it("applies the room summary and enters the flight screen on create", async () => {
        await h.controller.createRoom();
        const s = h.store.getState();
        expect(s.screen).toBe("flight");
        expect(s.roomCode).toBe("ABC123");
        expect(s.participantId).toBe("host-1");
        expect(s.isCreator).toBe(true);
        expect(h.roomApi.createRoom).toHaveBeenCalledWith("Alice");
    });

    it("connects signaling once a peer is present and registers + attaches on open", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();

        // Signaling connected; open the socket and inspect what was sent.
        expect(h.socket()).toBeDefined();
        h.socket().open();

        const msgs = h.socket().parsed();
        expect(msgs[0]).toMatchObject({ type: "register-details", name: "Alice" });
        expect(msgs[1]).toMatchObject({
            type: "attach-room",
            roomCode: "ABC123",
            participantId: "host-1",
        });
    });

    it("collapses a double-submit into a single join (join-flow race guard)", async () => {
        h = makeHarness(summaryWithPeer());
        // Fire two joins as fast as a double-click / Enter+click would.
        await Promise.all([
            h.controller.joinRoom("ABC123"),
            h.controller.joinRoom("ABC123"),
        ]);
        // Only one server mutation happened despite two calls.
        expect(h.roomApi.joinRoom).toHaveBeenCalledTimes(1);

        // A third join after we already hold a slot is also a no-op.
        await h.controller.joinRoom("ABC123");
        expect(h.roomApi.joinRoom).toHaveBeenCalledTimes(1);
    });

    it("ignores a duplicate create once a room is held", async () => {
        await h.controller.createRoom();
        await h.controller.createRoom();
        expect(h.roomApi.createRoom).toHaveBeenCalledTimes(1);
    });

    it("connects signaling on entering a flight (for discovery) even while alone", async () => {
        await h.controller.createRoom();
        // Signaling is up while waiting so nearby discovery + invites work.
        expect(h.socket()).toBeDefined();
        h.socket().open();
        expect(h.socket().parsed()[0]).toMatchObject({
            type: "register-details",
            name: "Alice",
        });
    });

    it("on peer-joined: sets peer, enables chat, and (as host) initializes the offerer", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();

        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });

        const s = h.store.getState();
        expect(s.connectedPeer).toEqual({ id: "guest-1", name: "Bob" });
        expect(s.connectionType).toBe("lan");
        expect(s.chatEnabled).toBe(true);
        expect(h.peer().initializedAs).toBe(true);
    });

    it("sends a queued file (metadata → chunks → EOF) once the channel opens", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });

        const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "note.txt", {
            type: "text/plain",
        });
        h.controller.enqueueFiles([file]);

        // Channel not open yet → nothing sent.
        expect(h.peer().sentData.length).toBe(0);

        h.peer().openChannel();
        await tick();
        await tick();

        const strings = h.peer().strings();
        expect(strings[0]).toBe(
            encodeFileMetadata({ name: "note.txt", type: "text/plain", size: 5 })
        );
        expect(strings).toContain(EOF_MARKER);

        const sent = h.store.getState().sendQueue[0];
        expect(sent.status).toBe("sent");
        expect(h.store.getState().totalBytesSent).toBe(5);
    });

    it("drains a multi-file queue, sending each file in turn", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });
        h.peer().openChannel();

        const f1 = new File([new Uint8Array([1, 2, 3])], "a.bin");
        const f2 = new File([new Uint8Array([4, 5, 6, 7])], "b.bin");
        h.controller.enqueueFiles([f1, f2]);

        // Allow the queue to drain across the deferred (microtask) pumps.
        for (let i = 0; i < 10; i++) await tick();

        const statuses = h.store.getState().sendQueue.map((s) => s.status);
        expect(statuses).toEqual(["sent", "sent"]);
        // Two EOF markers → two completed transfers on the wire.
        const eofs = h.peer().strings().filter((s) => s === EOF_MARKER).length;
        expect(eofs).toBe(2);
        expect(h.store.getState().totalBytesSent).toBe(7);
    });

    it("reassembles an incoming file from data-channel messages", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });
        h.peer().openChannel();

        const meta = { name: "in.bin", type: "", size: 3 };
        h.peer().emit("message", { data: encodeFileMetadata(meta) });
        await tick();
        h.peer().emit("message", { data: new Uint8Array([9, 8, 7]).buffer });
        await tick();
        h.peer().emit("message", { data: EOF_MARKER });
        await tick();

        const items = h.store.getState().receiveItems;
        expect(items).toHaveLength(1);
        expect(items[0].status).toBe("complete");
        expect(items[0].url).toMatch(/^blob:|^data:|.+/); // an object URL was created
        expect(h.store.getState().totalBytesReceived).toBe(3);
    });

    it("sends and echoes chat over the data channel", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });
        h.peer().openChannel();

        h.controller.sendChat("  hello  ");
        // Local echo stored trimmed.
        const mine = h.store.getState().chatMessages;
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({ from: "me", text: "hello" });

        // A chat frame was written to the channel and decodes back to the text.
        const chatFrame = h
            .peer()
            .strings()
            .map((s) => decodeDataChannelFrame(s))
            .find((f) => f.kind === "chat");
        expect(chatFrame).toEqual({ kind: "chat", text: "hello" });

        // Inbound chat from the peer is appended.
        h.peer().emit("message", {
            data: JSON.stringify({ type: "chat", text: "hi back" }),
        });
        await tick();
        const all = h.store.getState().chatMessages;
        expect(all[1]).toMatchObject({ from: "peer", text: "hi back" });
    });

    it("startDiscovery advertises on the home screen without attaching a room", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();

        const msgs = h.socket().parsed();
        expect(msgs[0]).toMatchObject({
            type: "register-details",
            name: "Alice",
            discoverable: true,
        });
        // No flight yet → nothing to attach.
        expect(msgs.some((m) => m.type === "attach-room")).toBe(false);
    });

    it("connectToUser (from home) creates a flight, attaches, and invites in one step", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();

        await h.controller.connectToUser("guest-1");

        const msgs = h.socket().parsed();
        expect(msgs.some((m) => m.type === "attach-room")).toBe(true);
        expect(msgs).toContainEqual(
            expect.objectContaining({
                type: "invite-to-flight",
                inviteeId: "guest-1",
                flightCode: "ABC123",
            })
        );
        // We now hold the flight and are on the flight screen.
        expect(h.store.getState().screen).toBe("flight");
        expect(h.store.getState().participantId).toBe("host-1");
    });

    it("stopDiscovery (presence mode) drops the socket and clears the network list", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();
        h.socket().receive({
            type: "users-on-network-update",
            users: [{ id: "guest-1", name: "Bob" }],
        });
        expect(h.store.getState().networkUsers).toHaveLength(1);

        h.controller.stopDiscovery();
        expect(h.store.getState().networkUsers).toHaveLength(0);
        // Socket was closed.
        expect(h.socket().readyState).toBe(3);
    });

    it("invite puts the user on cooldown, keeps the sticky status, and blocks re-invite", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();

        await h.controller.connectToUser("guest-1");
        expect(h.store.getState().invitedUserIds).toContain("guest-1");
        expect(h.store.getState().statusText).toBe(
            "Invite sent. Waiting for them to join…"
        );

        const inviteCount = () =>
            h.socket().parsed().filter((m) => m.type === "invite-to-flight")
                .length;
        expect(inviteCount()).toBe(1);

        // Re-inviting the same user while on cooldown sends nothing more.
        h.controller.inviteOrConnect("guest-1");
        expect(inviteCount()).toBe(1);

        // A room poll must not clobber the sticky "Invite sent…" status.
        h.runPoll();
        await tick();
        expect(h.store.getState().statusText).toBe(
            "Invite sent. Waiting for them to join…"
        );
    });

    it("clears the invite cooldown after the window elapses", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();

        await h.controller.connectToUser("guest-1");
        expect(h.store.getState().invitedUserIds).toContain("guest-1");

        h.fireTimers(); // cooldown expiry
        expect(h.store.getState().invitedUserIds).not.toContain("guest-1");
    });

    it("cancels a pending invitation when discovery is turned off", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();

        h.socket().receive({
            type: "flight-invitation",
            flightCode: "ZZZ999",
            fromName: "Bob",
        });
        expect(h.store.getState().incomingInvitation).not.toBeNull();

        // Opting out of discovery drops the socket the invite came on, so the
        // stale invitation is cleared rather than left dangling.
        h.controller.stopDiscovery();
        expect(h.store.getState().incomingInvitation).toBeNull();
    });

    it("restores the waiting status after an unanswered invite expires", async () => {
        h.store.getState().actions.setDiscovery({ discoverable: true });
        h.controller.startDiscovery();
        h.socket().open();

        await h.controller.connectToUser("guest-1");
        expect(h.store.getState().statusText).toBe(
            "Invite sent. Waiting for them to join…"
        );

        h.fireTimers(); // expire the cooldown (releases the status lock)
        await tick();
        h.runPoll(); // the next poll now restores the generic waiting text
        await tick();
        expect(h.store.getState().statusText).toBe(
            "Room created. Waiting for peer…"
        );
        expect(h.store.getState().invitedUserIds).not.toContain("guest-1");
    });

    it("auto-dismisses an incoming invitation after the window", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();

        h.socket().receive({
            type: "flight-invitation",
            flightCode: "ZZZ999",
            fromName: "Bob",
        });
        expect(h.store.getState().incomingInvitation).toMatchObject({
            flightCode: "ZZZ999",
            fromName: "Bob",
        });

        h.fireTimers(); // invitation auto-dismiss
        expect(h.store.getState().incomingInvitation).toBeNull();
    });

    it("reports send speed from bytes delivered on the wire, not just enqueued", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });
        h.peer().openChannel(); // starts metrics; snapshot = 0

        // 1 MB handed to the channel, but 400 KB still sitting in its buffer.
        h.store.getState().actions.addMetricsSent(1_000_000);
        h.peer().buffered = 400_000;

        h.fireTimers(); // metrics tick (1s window)
        // Delivered = 1_000_000 − 400_000 = 600_000, not the full 1_000_000.
        expect(h.store.getState().speedBps).toBe(600_000);
    });

    it("surfaces a relayed (TURN) path once the channel opens", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "wan",
        });
        h.peer().relayed = true;
        h.peer().openChannel();
        await tick(); // detectTransport awaits peer.isRelayed()

        expect(h.store.getState().relayed).toBe(true);
    });

    it("handles peer-left by clearing the connection and resuming", async () => {
        h = makeHarness(summaryWithPeer());
        await h.controller.createRoom();
        h.socket().open();
        h.socket().receive({
            type: "peer-joined",
            flightCode: "ABC123",
            peer: { id: "guest-1", name: "Bob" },
            connectionType: "lan",
        });
        h.peer().openChannel();
        expect(h.store.getState().dataChannelOpen).toBe(true);

        h.socket().receive({ type: "peer-left" });
        const s = h.store.getState();
        expect(s.connectedPeer).toBeNull();
        expect(s.dataChannelOpen).toBe(false);
        expect(s.chatEnabled).toBe(false);
    });
});
