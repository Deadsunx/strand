// Application state, as a vanilla Zustand store. It's created with
// `createStore` (not the React `create`) so the non-React RoomController can
// read and write it directly; React components subscribe via the hooks in
// hooks/useStore.ts. State groups mirror the original client's state.js.

import { createStore } from "zustand/vanilla";
import type {
    NetworkUser,
    RoomParticipantSummary,
    RoomStatus,
    SignalingPeer,
} from "../core/index.ts";

export type ConnectionType = "lan" | "wan";
export type Screen = "home" | "flight";

export type SendStatus = "queued" | "sending" | "sent" | "error";
export interface SendItem {
    id: string;
    file: File;
    name: string;
    size: number;
    status: SendStatus;
    sent: number;
    etr: string;
}

export type ReceiveStatus = "receiving" | "complete" | "error";
export interface ReceiveItem {
    id: string;
    name: string;
    size: number;
    type: string;
    received: number;
    status: ReceiveStatus;
    executable: boolean;
    /** Object URL for the completed blob (for download). */
    url: string | null;
    etr: string;
}

export interface ChatMessage {
    id: string;
    from: "me" | "peer";
    text: string;
    ts: number;
}

export interface AppState {
    // --- identity ---
    myId: string | null;
    myName: string;
    discoverable: boolean;
    networkToken: string | null;

    // --- room / connection ---
    screen: Screen;
    roomCode: string | null;
    participantId: string | null;
    role: "host" | "guest" | null;
    isCreator: boolean;
    roomStatus: RoomStatus | "idle";
    /** Peer as reported by the REST room summary (lobby presence). */
    roomPeer: RoomParticipantSummary | null;
    /** Peer as reported by the signaling channel (live connection). */
    connectedPeer: SignalingPeer | null;
    connectionType: ConnectionType;
    dataChannelOpen: boolean;
    /** Peer joined but the secure channel hasn't opened within the grace window. */
    connectionStalled: boolean;
    statusText: string;
    networkUsers: NetworkUser[];

    // --- transfer ---
    sendQueue: SendItem[];
    receiveItems: ReceiveItem[];

    // --- metrics ---
    totalBytesSent: number;
    totalBytesReceived: number;
    speedBps: number;

    // --- chat ---
    chatMessages: ChatMessage[];
    chatEnabled: boolean;

    // --- screen share ---
    screenSharing: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;

    // --- voice ---
    micActive: boolean;

    // --- misc ui ---
    lastError: string | null;
    incomingInvitation: { flightCode: string; fromName: string } | null;

    actions: AppActions;
}

export interface AppActions {
    setMyId: (id: string) => void;
    setMyName: (name: string) => void;
    setDiscovery: (opts: { discoverable?: boolean; networkToken?: string | null }) => void;

    goHome: () => void;
    enterFlight: (roomCode: string) => void;
    applyRoom: (room: {
        roomCode: string;
        participantId: string;
        role: "host" | "guest";
        isCreator: boolean;
        status: RoomStatus;
        peer: RoomParticipantSummary | null;
    }) => void;
    setStatusText: (text: string) => void;
    setConnectedPeer: (peer: SignalingPeer | null, connectionType?: ConnectionType) => void;
    setDataChannelOpen: (open: boolean) => void;
    setConnectionStalled: (stalled: boolean) => void;
    setNetworkUsers: (users: NetworkUser[]) => void;
    setIncomingInvitation: (
        invitation: { flightCode: string; fromName: string } | null
    ) => void;

    enqueueFiles: (files: File[]) => SendItem[];
    updateSendItem: (id: string, patch: Partial<SendItem>) => void;
    removeSendItem: (id: string) => void;

    addReceiveItem: (item: ReceiveItem) => void;
    updateReceiveItem: (id: string, patch: Partial<ReceiveItem>) => void;

    addMetricsSent: (bytes: number) => void;
    addMetricsReceived: (bytes: number) => void;
    setSpeed: (bps: number) => void;

    setChatEnabled: (enabled: boolean) => void;
    addChatMessage: (message: ChatMessage) => void;

    setScreenSharing: (sharing: boolean) => void;
    setLocalStream: (stream: MediaStream | null) => void;
    setRemoteStream: (stream: MediaStream | null) => void;
    setMicActive: (active: boolean) => void;

    setError: (message: string | null) => void;
    resetRoom: () => void;
}

const initialCoreState: Omit<AppState, "actions" | "myName" | "myId" | "discoverable" | "networkToken"> = {
    screen: "home",
    roomCode: null,
    participantId: null,
    role: null,
    isCreator: false,
    roomStatus: "idle",
    roomPeer: null,
    connectedPeer: null,
    connectionType: "wan",
    dataChannelOpen: false,
    connectionStalled: false,
    statusText: "",
    networkUsers: [],
    sendQueue: [],
    receiveItems: [],
    totalBytesSent: 0,
    totalBytesReceived: 0,
    speedBps: 0,
    chatMessages: [],
    chatEnabled: false,
    screenSharing: false,
    localStream: null,
    remoteStream: null,
    micActive: false,
    lastError: null,
    incomingInvitation: null,
};

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${idCounter++}`;

export function createAppStore(initialName: string) {
    return createStore<AppState>((set, get) => ({
        myId: null,
        myName: initialName,
        discoverable: false,
        networkToken: null,
        ...initialCoreState,

        actions: {
            setMyId: (id) => set({ myId: id }),
            setMyName: (name) => set({ myName: name }),
            setDiscovery: ({ discoverable, networkToken }) =>
                set((s) => ({
                    discoverable: discoverable ?? s.discoverable,
                    networkToken:
                        networkToken === undefined ? s.networkToken : networkToken,
                })),

            goHome: () => set({ screen: "home" }),
            enterFlight: (roomCode) => set({ screen: "flight", roomCode }),

            applyRoom: (room) =>
                set({
                    screen: "flight",
                    roomCode: room.roomCode,
                    participantId: room.participantId,
                    role: room.role,
                    isCreator: room.isCreator,
                    roomStatus: room.status,
                    roomPeer: room.peer,
                }),

            setStatusText: (text) => set({ statusText: text }),

            setConnectedPeer: (peer, connectionType) =>
                set((s) => ({
                    connectedPeer: peer,
                    connectionType: connectionType ?? s.connectionType,
                })),

            setDataChannelOpen: (open) => set({ dataChannelOpen: open }),
            setConnectionStalled: (stalled) => set({ connectionStalled: stalled }),
            setNetworkUsers: (users) => set({ networkUsers: users }),
            setIncomingInvitation: (invitation) =>
                set({ incomingInvitation: invitation }),

            enqueueFiles: (files) => {
                const items: SendItem[] = files.map((file) => ({
                    id: nextId("send"),
                    file,
                    name: file.name,
                    size: file.size,
                    status: "queued",
                    sent: 0,
                    etr: "",
                }));
                set((s) => ({ sendQueue: [...s.sendQueue, ...items] }));
                return items;
            },

            updateSendItem: (id, patch) =>
                set((s) => ({
                    sendQueue: s.sendQueue.map((item) =>
                        item.id === id ? { ...item, ...patch } : item
                    ),
                })),

            removeSendItem: (id) =>
                set((s) => ({
                    sendQueue: s.sendQueue.filter((item) => item.id !== id),
                })),

            addReceiveItem: (item) =>
                set((s) => ({ receiveItems: [...s.receiveItems, item] })),

            updateReceiveItem: (id, patch) =>
                set((s) => ({
                    receiveItems: s.receiveItems.map((item) =>
                        item.id === id ? { ...item, ...patch } : item
                    ),
                })),

            addMetricsSent: (bytes) =>
                set((s) => ({ totalBytesSent: s.totalBytesSent + bytes })),
            addMetricsReceived: (bytes) =>
                set((s) => ({ totalBytesReceived: s.totalBytesReceived + bytes })),
            setSpeed: (bps) => set({ speedBps: bps }),

            setChatEnabled: (enabled) => set({ chatEnabled: enabled }),
            addChatMessage: (message) =>
                set((s) => ({ chatMessages: [...s.chatMessages, message] })),

            setScreenSharing: (sharing) => set({ screenSharing: sharing }),
            setLocalStream: (stream) => set({ localStream: stream }),
            setRemoteStream: (stream) => set({ remoteStream: stream }),
            setMicActive: (active) => set({ micActive: active }),

            setError: (message) => set({ lastError: message }),

            resetRoom: () => {
                // Preserve identity + discovery prefs; reset everything else.
                const { myId, myName, discoverable, networkToken } = get();
                set({
                    myId,
                    myName,
                    discoverable,
                    networkToken,
                    ...initialCoreState,
                });
            },
        },
    }));
}

export type AppStore = ReturnType<typeof createAppStore>;
export { nextId };
