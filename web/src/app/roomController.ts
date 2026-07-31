// RoomController: the non-React orchestrator. It owns the core instances
// (RoomApi, SignalingClient, PeerConnection, FileSender, FileReceiver) and
// drives the room lifecycle, translating core events into store mutations.
// This is where the logic that the original client spread across roomSession.js
// and websocket.js lives — minus every DOM/toast/audio side-effect, which the
// React layer derives from store state instead.
//
// All collaborators are injected via `deps`, so the whole controller is
// unit-testable with fakes (see app/__tests__/roomController.test.ts).

import {
    BlobChunkReader,
    CONTROL_TYPES,
    DEFAULT_CHUNK_SIZE,
    createEtrCalculator,
    encodeChat,
    encodeControl,
    formatTimeRemaining,
    type ChunkReader,
    type FileReceiver,
    type FileSender,
    type PeerConnection,
    type RoomApi,
    type RoomSummary,
    type SignalingClient,
    type SendTransport,
} from "../core/index.ts";
import { captureScreen } from "./screenShare.ts";
import type { AppStore, SendItem } from "../store/store.ts";
import { nextId } from "../store/store.ts";

export interface RoomControllerDeps {
    store: AppStore;
    roomApi: RoomApi;
    createSignaling: () => SignalingClient;
    createPeer: () => PeerConnection;
    createSender: (transport: SendTransport) => FileSender;
    createReceiver: () => FileReceiver;
    /** Produces a chunk reader for a file (BlobChunkReader in production). */
    createChunkReader?: (file: File) => ChunkReader;
    pollIntervalMs?: number;
    metricsIntervalMs?: number;
    setInterval?: (fn: () => void, ms: number) => number;
    clearInterval?: (handle: number) => void;
    now?: () => number;
}

// Auto-download a received file when the user enabled it — but never for
// executables (safety), and only up to the configured size cap.
function maybeAutoDownload(
    name: string,
    url: string,
    size: number,
    executable: boolean
): void {
    if (executable) return;
    try {
        if (localStorage.getItem("dropsilk-auto-download") !== "true") return;
        const maxMb = parseFloat(
            localStorage.getItem("dropsilk-auto-download-max-size") || "100"
        );
        if (size > maxMb * 1024 * 1024) return;
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch {
        /* auto-download is best-effort */
    }
}

function statusTextFor(summary: RoomSummary): string {
    if (!summary.peer) return "Room created. Waiting for peer…";
    if (summary.shouldConnect) return "Peer connected. Opening secure channel…";
    return "Peer joined. Connecting…";
}

export class RoomController {
    private readonly deps: Required<
        Pick<
            RoomControllerDeps,
            | "createChunkReader"
            | "pollIntervalMs"
            | "metricsIntervalMs"
            | "setInterval"
            | "clearInterval"
            | "now"
        >
    > &
        RoomControllerDeps;

    private signaling: SignalingClient | null = null;
    private peer: PeerConnection | null = null;
    private sender: FileSender | null = null;
    private receiver: FileReceiver | null = null;

    private signalingInitiated = false;
    // Guards create/join so a double-submit (double-click, Enter+click, or a
    // StrictMode remount) can't fire two room mutations and trip the server's
    // "Room already has two participants" path.
    private mutatingRoom = false;
    private pollHandle: number | null = null;
    private metricsHandle: number | null = null;
    private metricsSnapshot = 0;

    // Progress deltas: core events report cumulative bytes per file.
    private lastSenderSent = 0;
    private lastReceiverGot = 0;
    private sendEtr = createEtrCalculator();
    private recvEtr = createEtrCalculator();
    private currentReceiveId: string | null = null;

    // Screen share
    private localScreenStream: MediaStream | null = null;
    private screenSenders: RTCRtpSender[] = [];

    constructor(deps: RoomControllerDeps) {
        this.deps = {
            createChunkReader: (file) =>
                new BlobChunkReader(file, DEFAULT_CHUNK_SIZE),
            pollIntervalMs: 1500,
            metricsIntervalMs: 1000,
            setInterval: (fn, ms) =>
                globalThis.setInterval(fn, ms) as unknown as number,
            clearInterval: (h) => globalThis.clearInterval(h),
            now: () => Date.now(),
            ...deps,
        };
    }

    private get actions() {
        return this.deps.store.getState().actions;
    }

    // --- Public room lifecycle --------------------------------------------

    /** True once we hold a room slot, so create/join become no-ops. */
    private alreadyInRoom(): boolean {
        return this.deps.store.getState().participantId !== null;
    }

    async createRoom(): Promise<void> {
        if (this.mutatingRoom || this.alreadyInRoom()) return;
        this.mutatingRoom = true;
        const name = this.deps.store.getState().myName;
        try {
            const summary = await this.deps.roomApi.createRoom(name);
            this.applyRoomSummary(summary);
            this.startPolling();
        } catch (error) {
            this.actions.setError((error as Error).message);
            throw error;
        } finally {
            this.mutatingRoom = false;
        }
    }

    async joinRoom(roomCode: string): Promise<void> {
        if (this.mutatingRoom || this.alreadyInRoom()) return;
        this.mutatingRoom = true;
        const name = this.deps.store.getState().myName;
        try {
            const summary = await this.deps.roomApi.joinRoom(roomCode, name);
            this.applyRoomSummary(summary);
            this.startPolling();
        } catch (error) {
            this.actions.setError((error as Error).message);
            throw error;
        } finally {
            this.mutatingRoom = false;
        }
    }

    leave(): void {
        this.stopPolling();
        this.stopMetrics();
        this.teardownScreenShare();
        this.signaling?.disconnect({ silent: true });
        this.sender?.cancel();
        this.peer?.close();
        void this.receiver?.reset();
        this.signaling = null;
        this.peer = null;
        this.sender = null;
        this.receiver = null;
        this.signalingInitiated = false;
        this.mutatingRoom = false;
        this.actions.resetRoom();
    }

    // --- Room summary + polling -------------------------------------------

    private applyRoomSummary(summary: RoomSummary): void {
        this.actions.applyRoom({
            roomCode: summary.roomCode,
            participantId: summary.self.participantId,
            role: summary.self.role,
            isCreator: summary.self.role === "host",
            status: summary.status,
            peer: summary.peer,
        });
        if (!this.deps.store.getState().dataChannelOpen) {
            this.actions.setStatusText(statusTextFor(summary));
        }

        // Connect signaling as soon as we're in a flight (even alone). This
        // powers nearby-device discovery and invites while waiting, and means
        // both clients are already attached when the peer arrives, so the
        // server pairs them immediately. (Lazy-connecting to save a socket is a
        // later optimization.)
        if (!this.signalingInitiated) {
            this.connectSignaling();
        }
    }

    private async syncRoomStatus(): Promise<void> {
        const { roomCode, participantId } = this.deps.store.getState();
        if (!roomCode || !participantId) return;
        try {
            const summary = await this.deps.roomApi.getRoomStatus(
                roomCode,
                participantId
            );
            this.applyRoomSummary(summary);
        } catch (error) {
            this.actions.setError((error as Error).message);
        }
    }

    private startPolling(): void {
        this.stopPolling();
        void this.syncRoomStatus();
        this.pollHandle = this.deps.setInterval(() => {
            void this.syncRoomStatus();
        }, this.deps.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this.pollHandle !== null) {
            this.deps.clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
    }

    /** Report selected-file counts to the peer (shown in their lobby view). */
    async markReady(files: File[]): Promise<void> {
        const { roomCode, participantId } = this.deps.store.getState();
        if (!roomCode || !participantId || files.length === 0) return;
        try {
            const summary = await this.deps.roomApi.markParticipantReady(
                roomCode,
                participantId,
                {
                    fileCount: files.length,
                    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
                }
            );
            this.applyRoomSummary(summary);
        } catch (error) {
            this.actions.setError((error as Error).message);
        }
    }

    // --- Signaling + peer wiring ------------------------------------------

    private connectSignaling(): void {
        if (this.signaling) return;
        this.signalingInitiated = true;

        const signaling = this.deps.createSignaling();
        const peer = this.deps.createPeer();
        const receiver = this.deps.createReceiver();
        const sender = this.deps.createSender(peer);
        this.signaling = signaling;
        this.peer = peer;
        this.receiver = receiver;
        this.sender = sender;

        this.wireSignaling(signaling);
        this.wirePeer(peer);
        this.wireReceiver(receiver);
        this.wireSender(sender);

        signaling.connect();
    }

    private wireSignaling(signaling: SignalingClient): void {
        const { store } = this.deps;

        signaling.on("open", () => {
            const state = store.getState();
            signaling.registerDetails({
                name: state.myName,
                discoverable: state.discoverable,
                networkToken: state.networkToken ?? undefined,
            });
            if (state.roomCode && state.participantId) {
                signaling.attachRoom({
                    roomCode: state.roomCode,
                    participantId: state.participantId,
                });
            }
        });

        signaling.on("registered", ({ id }) => this.actions.setMyId(id));

        signaling.on("peerJoined", ({ peer, connectionType }) => {
            this.actions.setConnectedPeer(peer, connectionType);
            this.actions.setChatEnabled(true);
            this.stopPolling();
            if (store.getState().isCreator) {
                void this.peer?.initialize(true);
            }
        });

        signaling.on("signal", ({ data }) => {
            void this.peer?.handleSignal(data, store.getState().isCreator);
        });

        signaling.on("networkUsers", ({ users }) =>
            this.actions.setNetworkUsers(users)
        );

        signaling.on("flightInvitation", (invitation) =>
            this.actions.setIncomingInvitation(invitation)
        );

        signaling.on("peerLeft", () => this.handlePeerLeft());
        signaling.on("serverError", ({ message }) =>
            this.actions.setError(message)
        );
        signaling.on("close", () => this.handleSignalingClosed());
    }

    private wirePeer(peer: PeerConnection): void {
        peer.on("signal", ({ data }) => this.signaling?.sendSignal(data));
        peer.on("open", () => {
            this.actions.setDataChannelOpen(true);
            this.actions.setStatusText("Connected");
            this.stopPolling();
            this.startMetrics();
            this.pumpSendQueue();
        });
        peer.on("close", () => this.handlePeerLeft());
        peer.on("drain", () => this.sender?.notifyDrain());
        peer.on("message", ({ data }) => {
            void this.receiver?.handleMessage(data);
        });
        peer.on("remoteTrack", ({ streams }) => {
            if (streams[0]) this.actions.setRemoteStream(streams[0]);
        });
        peer.on("connectionStateChange", ({ state }) => {
            if (["failed", "closed", "disconnected"].includes(state)) {
                this.handlePeerLeft();
            }
        });
    }

    private wireReceiver(receiver: FileReceiver): void {
        receiver.on("fileStart", ({ meta }) => {
            const id = nextId("recv");
            this.currentReceiveId = id;
            this.lastReceiverGot = 0;
            this.recvEtr.reset();
            this.actions.addReceiveItem({
                id,
                name: meta.name,
                size: meta.size,
                type: meta.type,
                received: 0,
                status: "receiving",
                executable: false,
                url: null,
                etr: "",
            });
        });

        receiver.on("progress", ({ received, total }) => {
            if (!this.currentReceiveId) return;
            const delta = received - this.lastReceiverGot;
            this.lastReceiverGot = received;
            if (delta > 0) this.actions.addMetricsReceived(delta);
            this.recvEtr.update(received);
            this.actions.updateReceiveItem(this.currentReceiveId, {
                received,
                etr: formatTimeRemaining(this.recvEtr.getETR(total, received) ?? -1),
            });
        });

        receiver.on("fileComplete", ({ meta, blob, executable }) => {
            if (!this.currentReceiveId) return;
            const url = URL.createObjectURL(blob);
            this.actions.updateReceiveItem(this.currentReceiveId, {
                received: meta.size,
                status: "complete",
                executable,
                url,
                etr: "",
            });
            this.currentReceiveId = null;
            maybeAutoDownload(meta.name, url, blob.size, executable);
        });

        receiver.on("chat", ({ text }) => {
            this.actions.addChatMessage({
                id: nextId("chat"),
                from: "peer",
                text,
                ts: this.deps.now(),
            });
        });

        receiver.on("control", ({ type }) => {
            if (type === CONTROL_TYPES.streamEnded) {
                this.actions.setRemoteStream(null);
            }
        });

        receiver.on("error", ({ context, error }) => {
            this.actions.setError(`${context}: ${error.message}`);
        });
    }

    private wireSender(sender: FileSender): void {
        sender.on("progress", ({ sent }) => {
            const active = this.activeSendItem();
            if (!active) return;
            const delta = sent - this.lastSenderSent;
            this.lastSenderSent = sent;
            if (delta > 0) this.actions.addMetricsSent(delta);
            this.sendEtr.update(sent);
            this.actions.updateSendItem(active.id, {
                sent,
                etr: formatTimeRemaining(
                    this.sendEtr.getETR(active.size, sent) ?? -1
                ),
            });
        });

        sender.on("fileComplete", () => {
            const active = this.activeSendItem();
            if (active) {
                this.actions.updateSendItem(active.id, {
                    status: "sent",
                    sent: active.size,
                    etr: "",
                });
            }
            // Defer: FileSender emits fileComplete before its `finally` clears the
            // in-flight flag, so pumping synchronously would be refused by the
            // one-transfer-at-a-time guard. A microtask runs once it's idle.
            queueMicrotask(() => this.pumpSendQueue());
        });

        sender.on("error", () => {
            const active = this.activeSendItem();
            if (active) {
                this.actions.updateSendItem(active.id, { status: "error" });
            }
            queueMicrotask(() => this.pumpSendQueue());
        });
    }

    // --- Transfers + chat --------------------------------------------------

    enqueueFiles(files: File[]): void {
        this.actions.enqueueFiles(files);
        void this.markReady(files);
        this.pumpSendQueue();
    }

    private activeSendItem(): SendItem | undefined {
        return this.deps.store
            .getState()
            .sendQueue.find((item) => item.status === "sending");
    }

    private pumpSendQueue(): void {
        if (!this.peer?.isOpen() || !this.sender || this.sender.isSending()) {
            return;
        }
        const next = this.deps.store
            .getState()
            .sendQueue.find((item) => item.status === "queued");
        if (!next) return;

        this.actions.updateSendItem(next.id, { status: "sending", sent: 0 });
        this.lastSenderSent = 0;
        this.sendEtr.reset();

        const reader = this.deps.createChunkReader(next.file);
        void this.sender
            .send(
                { name: next.name, type: next.file.type, size: next.size },
                reader
            )
            .catch(() => {
                /* surfaced via the sender 'error' event */
            });
    }

    // --- Screen share ------------------------------------------------------

    async startScreenShare(withSystemAudio = true): Promise<void> {
        const state = this.deps.store.getState();
        // One sharer at a time: refuse if we're already sharing or the peer is.
        if (!this.peer?.isOpen() || state.screenSharing || state.remoteStream) {
            return;
        }

        const stream = await captureScreen(withSystemAudio);
        if (!stream) return; // user cancelled the picker

        this.localScreenStream = stream;
        this.actions.setLocalStream(stream);
        this.actions.setScreenSharing(true);
        this.screenSenders = await this.peer.addMediaStream(stream);

        // If the user stops sharing via the browser's own control, clean up.
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.onended = () => {
                void this.stopScreenShare();
            };
        }
    }

    async stopScreenShare(notifyPeer = true): Promise<void> {
        const stream = this.localScreenStream;
        if (stream) {
            for (const track of stream.getTracks()) track.stop();
        }
        if (this.peer && this.screenSenders.length > 0) {
            await this.peer.removeSenders(this.screenSenders);
        }
        this.screenSenders = [];
        this.localScreenStream = null;
        this.actions.setLocalStream(null);
        this.actions.setScreenSharing(false);
        if (notifyPeer && this.peer?.isOpen()) {
            this.peer.send(encodeControl(CONTROL_TYPES.streamEnded));
        }
    }

    private teardownScreenShare(): void {
        if (this.localScreenStream) {
            for (const track of this.localScreenStream.getTracks()) track.stop();
        }
        this.localScreenStream = null;
        this.screenSenders = [];
        this.actions.setLocalStream(null);
        this.actions.setRemoteStream(null);
        this.actions.setScreenSharing(false);
    }

    /** Invite a discovered nearby user into this flight. */
    invite(inviteeId: string): void {
        const { roomCode } = this.deps.store.getState();
        if (!this.signaling || !roomCode) return;
        this.signaling.invite(inviteeId, roomCode);
    }

    sendChat(text: string): void {
        const trimmed = text.trim();
        if (!trimmed || !this.peer?.isOpen()) return;
        this.peer.send(encodeChat(trimmed));
        this.actions.addChatMessage({
            id: nextId("chat"),
            from: "me",
            text: trimmed,
            ts: this.deps.now(),
        });
    }

    // --- Metrics -----------------------------------------------------------

    private startMetrics(): void {
        this.stopMetrics();
        this.metricsSnapshot =
            this.deps.store.getState().totalBytesSent +
            this.deps.store.getState().totalBytesReceived;
        const windowSec = this.deps.metricsIntervalMs / 1000;
        this.metricsHandle = this.deps.setInterval(() => {
            const s = this.deps.store.getState();
            const total = s.totalBytesSent + s.totalBytesReceived;
            this.actions.setSpeed((total - this.metricsSnapshot) / windowSec);
            this.metricsSnapshot = total;
        }, this.deps.metricsIntervalMs);
    }

    private stopMetrics(): void {
        if (this.metricsHandle !== null) {
            this.deps.clearInterval(this.metricsHandle);
            this.metricsHandle = null;
        }
        this.actions.setSpeed(0);
    }

    // --- Peer loss ---------------------------------------------------------

    private handlePeerLeft(): void {
        const state = this.deps.store.getState();
        if (!state.connectedPeer && !state.roomPeer) return;

        this.actions.setConnectedPeer(null);
        this.actions.setDataChannelOpen(false);
        this.actions.setChatEnabled(false);
        this.actions.setStatusText("Peer disconnected. Waiting…");
        this.stopMetrics();
        this.teardownScreenShare();
        this.peer?.close();
        this.peer = null;
        void this.receiver?.reset();

        // Re-create the peer/sender lazily on the next connection.
        if (this.signaling && this.peer === null) {
            const peer = this.deps.createPeer();
            this.peer = peer;
            this.wirePeer(peer);
            this.sender = this.deps.createSender(peer);
            this.wireSender(this.sender);
        }
        this.startPolling();
    }

    private handleSignalingClosed(): void {
        const state = this.deps.store.getState();
        this.signalingInitiated = false;
        this.signaling = null;
        if (state.roomCode && state.participantId && state.screen === "flight") {
            // Still in a room; resume polling so we can re-attach.
            this.startPolling();
        }
    }
}
