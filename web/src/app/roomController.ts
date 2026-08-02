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
    /** Grace period before a "disconnected" peer connection is treated as gone. */
    disconnectGraceMs?: number;
    /** How long to wait for the data channel to open before flagging a stall. */
    connectionStallMs?: number;
    /** How long an invite is "in flight": re-invite blocked, and the invitee's
     *  toast auto-dismisses after the same window so both sides stay in sync. */
    inviteCooldownMs?: number;
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
            | "disconnectGraceMs"
            | "connectionStallMs"
            | "inviteCooldownMs"
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
    // Whether we've sent attach-room for the current room on the live socket.
    // Tracked separately from signalingInitiated because the socket can open in
    // "presence" mode (home screen, no room yet) and attach later.
    private attached = false;
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

    // Voice
    private micStream: MediaStream | null = null;
    private micSenders: RTCRtpSender[] = [];

    // All inbound media tracks (screen video/audio + voice), accumulated so
    // screen share and voice can be active at the same time.
    private remoteTracks = new Set<MediaStreamTrack>();

    // Grace timer for a transient "disconnected" connection state.
    private disconnectTimer: number | null = null;
    // Watchdog: fires if the data channel doesn't open soon after the peer joins.
    private stallTimer: number | null = null;

    // Per-invitee cooldown timers: blocks re-inviting the same user until the
    // window elapses (matches how long their invitation toast stays up).
    private inviteCooldownTimers = new Map<string, number>();
    // Auto-dismiss timer for an incoming invitation on the invitee's side.
    private invitationTimer: number | null = null;

    constructor(deps: RoomControllerDeps) {
        this.deps = {
            createChunkReader: (file) =>
                new BlobChunkReader(file, DEFAULT_CHUNK_SIZE),
            pollIntervalMs: 1500,
            metricsIntervalMs: 1000,
            disconnectGraceMs: 8000,
            connectionStallMs: 20000,
            inviteCooldownMs: 15000,
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
        this.clearDisconnectGrace();
        this.clearStallWatchdog();
        this.clearAllInviteCooldowns();
        this.clearInvitationTimeout();
        this.teardownMedia();
        this.signaling?.disconnect({ silent: true });
        this.sender?.cancel();
        this.peer?.close();
        void this.receiver?.reset();
        this.signaling = null;
        this.peer = null;
        this.sender = null;
        this.receiver = null;
        this.signalingInitiated = false;
        this.attached = false;
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
        // Don't clobber the "Invite sent…" message with the generic waiting
        // text while an invite is still outstanding. Once every invite expires
        // (or the peer joins), the lock releases and the next poll restores the
        // real status — so a never-answered invite no longer sticks forever.
        if (
            !this.deps.store.getState().dataChannelOpen &&
            !this.hasOutstandingInvite()
        ) {
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
        // If the socket was already open in presence mode when this room was
        // created, it hasn't attached yet — do it now.
        this.ensureAttached();
    }

    /** Send attach-room once, when we hold a room and the socket is live. */
    private ensureAttached(): void {
        const { roomCode, participantId } = this.deps.store.getState();
        if (
            this.signaling?.isConnected() &&
            roomCode &&
            participantId &&
            !this.attached
        ) {
            this.signaling.attachRoom({ roomCode, participantId });
            this.attached = true;
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
        const receiver = this.deps.createReceiver();
        this.signaling = signaling;
        this.receiver = receiver;

        this.wireSignaling(signaling);
        this.wireReceiver(receiver);
        // The peer/sender are built on peer-joined (below), so there's exactly
        // one peer per pairing and no early offer can land on a throwaway one.

        signaling.connect();
    }

    /** (Re)create the peer connection + sender and wire them. Called on every
     *  peer-joined, so a retry starts from a clean, symmetric handshake. */
    private buildPeerStack(): void {
        this.peer?.close();
        const peer = this.deps.createPeer();
        this.peer = peer;
        this.wirePeer(peer);
        this.sender = this.deps.createSender(peer);
        this.wireSender(this.sender);
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
            // Attaches only if we already hold a room; in presence mode (home
            // screen) there's nothing to attach until a flight is created.
            this.ensureAttached();
        });

        signaling.on("registered", ({ id }) => this.actions.setMyId(id));

        signaling.on("peerJoined", ({ peer, connectionType }) => {
            this.clearAllInviteCooldowns();
            this.actions.setConnectedPeer(peer, connectionType);
            this.actions.setChatEnabled(true);
            this.stopPolling();
            // Fresh peer for a clean negotiation — makes re-attach (retry)
            // symmetric: both sides rebuild and renegotiate from scratch.
            this.buildPeerStack();
            if (store.getState().isCreator) {
                void this.peer?.initialize(true);
            }
            this.startStallWatchdog();
        });

        signaling.on("signal", ({ data }) => {
            void this.peer?.handleSignal(data, store.getState().isCreator);
        });

        signaling.on("networkUsers", ({ users }) =>
            this.actions.setNetworkUsers(users)
        );

        signaling.on("flightInvitation", (invitation) => {
            this.actions.setIncomingInvitation({
                ...invitation,
                expiresAt: this.deps.now() + this.deps.inviteCooldownMs,
            });
            this.startInvitationTimeout();
        });

        signaling.on("peerLeft", () => this.handlePeerLeft());
        signaling.on("serverError", ({ message }) =>
            this.actions.setError(message)
        );
        signaling.on("close", () => this.handleSignalingClosed());
    }

    private wirePeer(peer: PeerConnection): void {
        peer.on("signal", ({ data }) => this.signaling?.sendSignal(data));
        peer.on("open", () => {
            this.clearStallWatchdog();
            this.actions.setConnectionStalled(false);
            this.actions.setDataChannelOpen(true);
            this.actions.setStatusText("Connected");
            this.stopPolling();
            this.startMetrics();
            void this.detectTransport();
            this.pumpSendQueue();
        });
        peer.on("close", () => this.handlePeerLeft());
        peer.on("drain", () => this.sender?.notifyDrain());
        peer.on("message", ({ data }) => {
            void this.receiver?.handleMessage(data);
        });
        peer.on("remoteTrack", ({ track }) => this.addRemoteTrack(track));
        peer.on("connectionStateChange", ({ state }) => {
            if (state === "failed" || state === "closed") {
                // Terminal — the connection is gone.
                this.clearDisconnectGrace();
                this.handlePeerLeft();
            } else if (state === "disconnected") {
                // Often transient (e.g. a blip during renegotiation when voice
                // or screen share starts, or brief packet loss on a long-haul
                // link). Give it a chance to recover before declaring the peer
                // gone — WebRTC can transition disconnected → connected.
                this.startDisconnectGrace();
            } else if (state === "connected") {
                this.clearDisconnectGrace();
            }
        });
    }

    private startDisconnectGrace(): void {
        if (this.disconnectTimer !== null) return;
        this.disconnectTimer = this.deps.setInterval(() => {
            this.clearDisconnectGrace();
            // Still not recovered after the grace window → treat as left.
            if (!this.peer || this.peer.connectionState() !== "connected") {
                this.handlePeerLeft();
            }
        }, this.deps.disconnectGraceMs);
    }

    private clearDisconnectGrace(): void {
        if (this.disconnectTimer !== null) {
            this.deps.clearInterval(this.disconnectTimer);
            this.disconnectTimer = null;
        }
    }

    private startStallWatchdog(): void {
        this.clearStallWatchdog();
        this.actions.setConnectionStalled(false);
        this.stallTimer = this.deps.setInterval(() => {
            this.clearStallWatchdog();
            if (!this.deps.store.getState().dataChannelOpen) {
                // Handshake didn't complete — surface a manual retry.
                this.actions.setConnectionStalled(true);
            }
        }, this.deps.connectionStallMs);
    }

    private clearStallWatchdog(): void {
        if (this.stallTimer !== null) {
            this.deps.clearInterval(this.stallTimer);
            this.stallTimer = null;
        }
    }

    /** User-triggered retry of a stalled handshake: re-attach the room so the
     *  server re-pairs both sides, which rebuilds the peers and renegotiates. */
    retryConnection(): void {
        const { roomCode, participantId } = this.deps.store.getState();
        this.actions.setConnectionStalled(false);
        this.actions.setStatusText("Reconnecting…");
        if (this.signaling && roomCode && participantId) {
            this.signaling.attachRoom({ roomCode, participantId });
        } else {
            // No live signaling to re-attach — do a full rejoin.
            this.connectSignaling();
        }
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
                // Peer stopped screen sharing — drop their video tracks but keep
                // any voice audio flowing.
                for (const track of this.remoteTracks) {
                    if (track.kind === "video") this.remoteTracks.delete(track);
                }
                this.refreshRemoteMedia();
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

    // --- Inbound media (screen video/audio + voice) ------------------------

    private addRemoteTrack(track: MediaStreamTrack): void {
        this.remoteTracks.add(track);
        track.addEventListener("ended", () => {
            this.remoteTracks.delete(track);
            this.refreshRemoteMedia();
        });
        this.refreshRemoteMedia();
    }

    /** Rebuild the remote MediaStream from live tracks (new ref → re-render). */
    private refreshRemoteMedia(): void {
        const live = [...this.remoteTracks].filter(
            (t) => t.readyState === "live"
        );
        this.actions.setRemoteStream(live.length ? new MediaStream(live) : null);
    }

    private remoteHasVideo(): boolean {
        return [...this.remoteTracks].some(
            (t) => t.kind === "video" && t.readyState === "live"
        );
    }

    // --- Screen share ------------------------------------------------------

    async startScreenShare(withSystemAudio = true): Promise<void> {
        // One screen-sharer at a time: refuse if we're already sharing or the
        // peer is sending video. Voice audio does not count.
        if (
            !this.peer?.isOpen() ||
            this.deps.store.getState().screenSharing ||
            this.remoteHasVideo()
        ) {
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

    // --- Voice chat --------------------------------------------------------

    async startVoice(): Promise<void> {
        if (!this.peer?.isOpen() || this.deps.store.getState().micActive) return;

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
                video: false,
            });
        } catch {
            this.actions.setError("Microphone access was blocked.");
            return;
        }

        this.micStream = stream;
        this.actions.setMicActive(true);
        this.micSenders = await this.peer.addMediaStream(stream);
    }

    async stopVoice(): Promise<void> {
        if (this.micStream) {
            for (const track of this.micStream.getTracks()) track.stop();
        }
        if (this.peer && this.micSenders.length > 0) {
            await this.peer.removeSenders(this.micSenders);
        }
        this.micSenders = [];
        this.micStream = null;
        this.actions.setMicActive(false);
    }

    /** Stop all local media and clear inbound media state. */
    private teardownMedia(): void {
        for (const stream of [this.localScreenStream, this.micStream]) {
            if (stream) for (const track of stream.getTracks()) track.stop();
        }
        this.localScreenStream = null;
        this.micStream = null;
        this.screenSenders = [];
        this.micSenders = [];
        this.remoteTracks.clear();
        this.actions.setLocalStream(null);
        this.actions.setRemoteStream(null);
        this.actions.setScreenSharing(false);
        this.actions.setMicActive(false);
    }

    // --- Nearby presence (home screen) -------------------------------------

    /** Open the presence socket so we register and receive the network list
     *  even before entering a flight. Idempotent — safe to call repeatedly. */
    startDiscovery(): void {
        if (!this.signaling) {
            this.connectSignaling();
        } else {
            this.refreshRegistration();
        }
    }

    /** Stop advertising. In presence-only mode (no flight yet) drop the socket
     *  entirely; if we already hold a flight, just re-register as hidden so the
     *  live connection is preserved. */
    stopDiscovery(): void {
        if (this.alreadyInRoom()) {
            this.refreshRegistration();
            return;
        }
        this.actions.setNetworkUsers([]);
        // Going offline cancels any invitation we were showing: it arrived on
        // the socket we're about to drop, so its Join/countdown would be stale.
        this.clearInvitationTimeout();
        this.actions.setIncomingInvitation(null);
        this.signaling?.disconnect({ silent: true });
        this.signaling = null;
        this.receiver = null;
        this.signalingInitiated = false;
    }

    /** Re-send our advertised details after name / discoverable / PIN change. */
    refreshRegistration(): void {
        if (!this.signaling?.isConnected()) return;
        const s = this.deps.store.getState();
        this.signaling.registerDetails({
            name: s.myName,
            discoverable: s.discoverable,
            networkToken: s.networkToken ?? undefined,
        });
    }

    // --- Nearby-device invitations -----------------------------------------

    /** One tap from a discovered name: create our flight if we don't have one,
     *  then invite that user into it. They just accept the toast — no code,
     *  and neither side has to manually create a flight first. */
    async connectToUser(inviteeId: string): Promise<void> {
        if (this.isOnInviteCooldown(inviteeId)) return;
        if (!this.alreadyInRoom()) {
            await this.createRoom();
        }
        this.ensureAttached();
        this.sendInvite(inviteeId);
    }

    /** Context-aware action for the network list: invite into the current
     *  flight if we're in one, otherwise spin one up and invite in one step. */
    inviteOrConnect(inviteeId: string): void {
        if (this.alreadyInRoom()) {
            this.invite(inviteeId);
        } else {
            void this.connectToUser(inviteeId);
        }
    }

    /** Invite a discovered nearby user into this flight. */
    invite(inviteeId: string): void {
        this.sendInvite(inviteeId);
    }

    /** Send an invite (if not on cooldown) and start the cooldown. Returns
     *  whether the invite actually went out. */
    private sendInvite(inviteeId: string): boolean {
        const { roomCode } = this.deps.store.getState();
        if (!this.signaling || !roomCode) return false;
        if (this.isOnInviteCooldown(inviteeId)) return false;
        this.signaling.invite(inviteeId, roomCode);
        this.startInviteCooldown(inviteeId);
        this.actions.setStatusText("Invite sent. Waiting for them to join…");
        return true;
    }

    private isOnInviteCooldown(inviteeId: string): boolean {
        return this.inviteCooldownTimers.has(inviteeId);
    }

    /** True while any invite is still within its cooldown window. Used to hold
     *  the "Invite sent…" status until the last invite expires or is answered. */
    private hasOutstandingInvite(): boolean {
        return this.inviteCooldownTimers.size > 0;
    }

    private startInviteCooldown(inviteeId: string): void {
        if (this.inviteCooldownTimers.has(inviteeId)) return;
        this.actions.addInvitedUser(inviteeId);
        const handle = this.deps.setInterval(() => {
            this.clearInviteCooldown(inviteeId);
        }, this.deps.inviteCooldownMs);
        this.inviteCooldownTimers.set(inviteeId, handle);
    }

    private clearInviteCooldown(inviteeId: string): void {
        const handle = this.inviteCooldownTimers.get(inviteeId);
        if (handle !== undefined) {
            this.deps.clearInterval(handle);
            this.inviteCooldownTimers.delete(inviteeId);
        }
        this.actions.removeInvitedUser(inviteeId);
    }

    private clearAllInviteCooldowns(): void {
        for (const inviteeId of [...this.inviteCooldownTimers.keys()]) {
            this.clearInviteCooldown(inviteeId);
        }
    }

    /** Auto-dismiss the incoming invitation after the cooldown window, so it
     *  vanishes on the invitee's side around when the inviter can retry. */
    private startInvitationTimeout(): void {
        this.clearInvitationTimeout();
        this.invitationTimer = this.deps.setInterval(() => {
            this.clearInvitationTimeout();
            this.actions.setIncomingInvitation(null);
        }, this.deps.inviteCooldownMs);
    }

    private clearInvitationTimeout(): void {
        if (this.invitationTimer !== null) {
            this.deps.clearInterval(this.invitationTimer);
            this.invitationTimer = null;
        }
    }

    /** Accept an incoming invitation: leave the current flight, join theirs. */
    async acceptInvitation(flightCode: string): Promise<void> {
        this.clearInvitationTimeout();
        this.actions.setIncomingInvitation(null);
        this.leave();
        await this.joinRoom(flightCode);
    }

    dismissInvitation(): void {
        this.clearInvitationTimeout();
        this.actions.setIncomingInvitation(null);
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

    /** Cumulative bytes actually delivered on the wire. Sent bytes are counted
     *  at enqueue time, so subtracting whatever still sits in the channel buffer
     *  yields true throughput. Without this the rate reads as bursts to 0 and
     *  back as the buffer fills then drains (the "beam" effect). */
    private deliveredBytes(): number {
        const s = this.deps.store.getState();
        const buffered = this.peer?.bufferedAmount() ?? 0;
        const sentOnWire = Math.max(0, s.totalBytesSent - buffered);
        return sentOnWire + s.totalBytesReceived;
    }

    /** Detect whether the live path is relayed (TURN) and surface it, so a slow
     *  WAN transfer is explainable at a glance. Best-effort, read-only. */
    private async detectTransport(): Promise<void> {
        try {
            const relayed = await this.peer?.isRelayed();
            if (relayed !== null && relayed !== undefined) {
                this.actions.setRelayed(relayed);
            }
        } catch {
            /* diagnostic only */
        }
    }

    private startMetrics(): void {
        this.stopMetrics();
        this.metricsSnapshot = this.deliveredBytes();
        const windowSec = this.deps.metricsIntervalMs / 1000;
        this.metricsHandle = this.deps.setInterval(() => {
            const total = this.deliveredBytes();
            this.actions.setSpeed(
                Math.max(0, (total - this.metricsSnapshot) / windowSec)
            );
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
        this.clearDisconnectGrace();
        this.clearStallWatchdog();
        this.clearAllInviteCooldowns();
        this.actions.setConnectionStalled(false);
        const state = this.deps.store.getState();
        if (!state.connectedPeer && !state.roomPeer) return;

        this.actions.setConnectedPeer(null);
        this.actions.setDataChannelOpen(false);
        this.actions.setChatEnabled(false);
        this.actions.setStatusText("Peer disconnected. Waiting…");
        this.stopMetrics();
        this.teardownMedia();
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
