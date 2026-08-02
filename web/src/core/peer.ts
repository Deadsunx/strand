// WebRTC peer-connection wrapper. Ports the transport core of
// src/js/network/webrtc.js with every ui/* import removed; instead it emits
// typed events the app subscribes to. It implements `SendTransport`, so a
// FileSender can drive it directly.
//
// Media acquisition for screen sharing (getDisplayMedia + per-browser audio
// heuristics) is intentionally NOT here — that browser-specific logic lands in
// M4. This module owns the connection, the data channel, signaling glue,
// backpressure, and track (re)negotiation.

import { TypedEmitter } from "./emitter.ts";
import { HIGH_WATER_MARK } from "./config.ts";
import type { SignalPayload } from "./protocol.ts";
import type { SendTransport } from "./sender.ts";

/** Supplies ICE servers; return [] for LAN-only (skip external STUN/TURN). */
export type IceServersProvider = () => Promise<RTCIceServer[]>;

export type PeerConnectionFactory = (
    config: RTCConfiguration
) => RTCPeerConnection;

export type PeerEvents = {
    /** Outbound SDP/ICE to relay over signaling. */
    signal: { data: SignalPayload };
    /** Data channel opened; transfers may begin. */
    open: void;
    /** Data channel closed. */
    close: void;
    /** Raw data-channel message; feed to a FileReceiver. */
    message: { data: string | ArrayBuffer };
    /** Buffer drained below threshold; feed to FileSender.notifyDrain(). */
    drain: void;
    connectionStateChange: { state: RTCPeerConnectionState };
    remoteTrack: { streams: readonly MediaStream[]; track: MediaStreamTrack };
    error: { context: string; error: Error };
};

export interface PeerConnectionOptions {
    iceServersProvider: IceServersProvider;
    highWaterMark?: number;
    createPeerConnection?: PeerConnectionFactory;
}

export class PeerConnection
    extends TypedEmitter<PeerEvents>
    implements SendTransport
{
    private pc: RTCPeerConnection | null = null;
    private channel: RTCDataChannel | null = null;
    // ICE candidates that arrived before the remote description was set.
    private pendingCandidates: RTCIceCandidateInit[] = [];
    private readonly highWaterMark: number;
    private readonly createPc: PeerConnectionFactory;

    constructor(private readonly options: PeerConnectionOptions) {
        super();
        this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
        this.createPc =
            options.createPeerConnection ??
            ((config) => new RTCPeerConnection(config));
    }

    isOpen(): boolean {
        return this.channel?.readyState === "open";
    }

    /** Current RTCPeerConnection state, or null if not initialized. */
    connectionState(): RTCPeerConnectionState | null {
        return this.pc?.connectionState ?? null;
    }

    /** Create the peer connection. The offerer opens the data channel. */
    async initialize(isOfferer: boolean): Promise<void> {
        if (this.pc) return;

        const iceServers = await this.options.iceServersProvider();
        const pc = this.createPc({ iceServers });
        this.pc = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.emit("signal", { data: { candidate: event.candidate } });
            }
        };
        pc.onconnectionstatechange = () => {
            this.emit("connectionStateChange", { state: pc.connectionState });
        };
        pc.ontrack = (event) => {
            this.emit("remoteTrack", {
                streams: event.streams,
                track: event.track,
            });
        };

        if (isOfferer) {
            const channel = pc.createDataChannel("fileTransfer");
            this.attachChannel(channel);
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.emit("signal", { data: { sdp: pc.localDescription! } });
            } catch (error) {
                this.emit("error", {
                    context: "createOffer",
                    error: error as Error,
                });
            }
        } else {
            pc.ondatachannel = (event) => this.attachChannel(event.channel);
        }
    }

    private attachChannel(channel: RTCDataChannel): void {
        channel.binaryType = "arraybuffer";
        channel.bufferedAmountLowThreshold = Math.floor(this.highWaterMark / 2);
        channel.onopen = () => this.emit("open", undefined);
        channel.onclose = () => this.emit("close", undefined);
        channel.onerror = (error) =>
            this.emit("error", {
                context: "dataChannel",
                error: (error as unknown as { error?: Error })?.error ??
                    new Error("data channel error"),
            });
        channel.onbufferedamountlow = () => this.emit("drain", undefined);
        channel.onmessage = (event) =>
            this.emit("message", { data: event.data });
        this.channel = channel;
    }

    /** Handle an inbound SDP/ICE signal. */
    async handleSignal(payload: SignalPayload, isOfferer: boolean): Promise<void> {
        if (!this.pc) {
            await this.initialize(isOfferer);
        }
        const pc = this.pc;
        if (!pc) return;

        try {
            if (payload.sdp) {
                await pc.setRemoteDescription(
                    new RTCSessionDescription(payload.sdp)
                );
                // The remote description is set — flush any ICE candidates that
                // raced ahead of it. Dropping these (as addIceCandidate would if
                // called too early) causes slow/stuck connects on high-latency
                // links where signaling arrives out of order.
                for (const candidate of this.pendingCandidates) {
                    await pc
                        .addIceCandidate(new RTCIceCandidate(candidate))
                        .catch(() => {});
                }
                this.pendingCandidates = [];

                if (payload.sdp.type === "offer") {
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    this.emit("signal", { data: { sdp: pc.localDescription! } });
                }
            } else if (payload.candidate) {
                if (pc.remoteDescription) {
                    await pc.addIceCandidate(
                        new RTCIceCandidate(payload.candidate)
                    );
                } else {
                    // SDP hasn't arrived yet — hold the candidate until it does.
                    this.pendingCandidates.push(payload.candidate);
                }
            }
        } catch (error) {
            this.emit("error", { context: "handleSignal", error: error as Error });
        }
    }

    // --- SendTransport ------------------------------------------------------

    send(data: string | ArrayBuffer): void {
        if (this.channel?.readyState === "open") {
            this.channel.send(data as ArrayBuffer);
        }
    }

    bufferedAmount(): number {
        return this.channel?.bufferedAmount ?? 0;
    }

    /**
     * Whether the active ICE candidate pair runs through a TURN relay. A relay
     * hop is slower and bandwidth-limited versus a direct path, so this is the
     * first thing to check when a WAN transfer is slow. Returns null if it
     * can't be determined. Read-only diagnostic.
     */
    async isRelayed(): Promise<boolean | null> {
        const pc = this.pc;
        if (!pc) return null;
        try {
            const stats = await pc.getStats();

            // Find the nominated/selected candidate pair.
            let selectedPairId: string | undefined;
            stats.forEach((report) => {
                if (report.type === "transport") {
                    selectedPairId =
                        (report as { selectedCandidatePairId?: string })
                            .selectedCandidatePairId ?? selectedPairId;
                }
            });
            let pair: RTCIceCandidatePairStats | undefined;
            stats.forEach((report) => {
                if (report.type !== "candidate-pair") return;
                const p = report as RTCIceCandidatePairStats & {
                    nominated?: boolean;
                };
                if (selectedPairId) {
                    if (p.id === selectedPairId) pair = p;
                } else if (p.nominated && p.state === "succeeded") {
                    pair = p;
                }
            });
            if (!pair) return null;

            // Either endpoint being a relay candidate means the path is relayed.
            let relayed = false;
            stats.forEach((report) => {
                const isEndpoint =
                    (report.type === "local-candidate" &&
                        report.id === pair!.localCandidateId) ||
                    (report.type === "remote-candidate" &&
                        report.id === pair!.remoteCandidateId);
                if (
                    isEndpoint &&
                    (report as { candidateType?: string }).candidateType ===
                        "relay"
                ) {
                    relayed = true;
                }
            });
            return relayed;
        } catch {
            return null;
        }
    }

    // --- Track (re)negotiation for screen share ----------------------------

    /** Add all of a stream's tracks and renegotiate once. Returns the senders. */
    async addMediaStream(stream: MediaStream): Promise<RTCRtpSender[]> {
        if (!this.pc) return [];
        const pc = this.pc;
        const senders = stream.getTracks().map((track) => pc.addTrack(track, stream));
        await this.renegotiate();
        return senders;
    }

    /** Remove previously added senders and renegotiate once. */
    async removeSenders(senders: readonly RTCRtpSender[]): Promise<void> {
        if (!this.pc || senders.length === 0) return;
        for (const sender of senders) {
            try {
                this.pc.removeTrack(sender);
            } catch {
                /* sender already gone */
            }
        }
        await this.renegotiate();
    }

    private async renegotiate(): Promise<void> {
        if (!this.pc) return;
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            this.emit("signal", { data: { sdp: this.pc.localDescription! } });
        } catch (error) {
            this.emit("error", {
                context: "renegotiate",
                error: error as Error,
            });
        }
    }

    close(): void {
        try {
            this.channel?.close();
        } catch {
            /* ignore */
        }
        try {
            this.pc?.close();
        } catch {
            /* ignore */
        }
        this.channel = null;
        this.pc = null;
        this.pendingCandidates = [];
    }
}
