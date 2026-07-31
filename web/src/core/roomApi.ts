// Typed REST client for the room API. Ports src/js/network/roomApi.js. The
// response shapes mirror DropSilk_Backend/src/roomStore.ts (RoomSummary et al.)
// and must stay in sync with it. `fetch` and the base URL are injected so this
// is testable and environment-agnostic.

export type RoomParticipantRole = "host" | "guest";
export type RoomStatus = "waiting" | "paired" | "ready";

export interface RoomParticipantSummary {
    participantId: string;
    role: RoomParticipantRole;
    name: string;
    ready: boolean;
    fileCount: number;
    totalBytes: number;
}

export interface RoomScreenShareSummary {
    activeParticipantId: string | null;
    requestedBySelf: boolean;
    requestedByPeer: boolean;
    isActive: boolean;
}

export interface RoomChatSummary {
    requestedBySelf: boolean;
    requestedByPeer: boolean;
    isActive: boolean;
}

export interface RoomSummary {
    roomCode: string;
    status: RoomStatus;
    shouldConnect: boolean;
    expiresAt: string;
    self: RoomParticipantSummary;
    peer: RoomParticipantSummary | null;
    screenShare: RoomScreenShareSummary;
    chat: RoomChatSummary;
}

export interface ReadyPayload {
    fileCount: number;
    totalBytes: number;
}

type FetchLike = (
    input: string,
    init?: RequestInit
) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;

export interface RoomApiOptions {
    baseUrl: string;
    fetch?: FetchLike;
}

export class RoomApi {
    private readonly baseUrl: string;
    private readonly fetchImpl: FetchLike;

    constructor(options: RoomApiOptions) {
        this.baseUrl = options.baseUrl.replace(/\/$/, "");
        // Native fetch throws "Illegal invocation" if called with a `this` other
        // than the global object, so bind it when falling back to the default.
        this.fetchImpl =
            options.fetch ??
            (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
    }

    private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            ...init,
            headers: {
                "Content-Type": "application/json",
                ...(init.headers ?? {}),
            },
        });

        let data: unknown = {};
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {
            const message =
                (data as { error?: string })?.error ?? `HTTP ${response.status}`;
            throw new Error(message);
        }
        return data as T;
    }

    createRoom(name: string): Promise<RoomSummary> {
        return this.request<RoomSummary>("/api/rooms", {
            method: "POST",
            body: JSON.stringify({ name }),
        });
    }

    joinRoom(roomCode: string, name: string): Promise<RoomSummary> {
        return this.request<RoomSummary>(
            `/api/rooms/${encodeURIComponent(roomCode)}/join`,
            { method: "POST", body: JSON.stringify({ name }) }
        );
    }

    getRoomStatus(roomCode: string, participantId: string): Promise<RoomSummary> {
        return this.request<RoomSummary>(
            `/api/rooms/${encodeURIComponent(roomCode)}?participantId=${encodeURIComponent(
                participantId
            )}`
        );
    }

    markParticipantReady(
        roomCode: string,
        participantId: string,
        payload: ReadyPayload
    ): Promise<RoomSummary> {
        return this.request<RoomSummary>(
            `/api/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(
                participantId
            )}/ready`,
            { method: "POST", body: JSON.stringify(payload) }
        );
    }

    setParticipantScreenShare(
        roomCode: string,
        participantId: string,
        active: boolean
    ): Promise<RoomSummary> {
        return this.request<RoomSummary>(
            `/api/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(
                participantId
            )}/screen-share`,
            { method: "POST", body: JSON.stringify({ active }) }
        );
    }

    setParticipantChatActive(
        roomCode: string,
        participantId: string,
        active: boolean
    ): Promise<RoomSummary> {
        return this.request<RoomSummary>(
            `/api/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(
                participantId
            )}/chat`,
            { method: "POST", body: JSON.stringify({ active }) }
        );
    }
}
