// Wires the production RoomController from runtime config + the core modules.
// This is the one place that reads `import.meta.env` and `window.location`;
// everything downstream receives concrete, injected collaborators.

import {
    FileReceiver,
    FileSender,
    PeerConnection,
    RoomApi,
    SignalingClient,
    fetchIceServers,
    resolveApiBaseUrl,
    resolveWebSocketUrl,
    type SendTransport,
} from "../core/index.ts";
import { createAppStore, type AppStore } from "../store/store.ts";
import { RoomController } from "./roomController.ts";
import { generateRandomName } from "./identity.ts";
import { createReceiveSinkFactory } from "./receiveSinkFactory.ts";

export interface AppRuntime {
    store: AppStore;
    controller: RoomController;
    apiBaseUrl: string;
    wsUrl: string;
}

export function createRuntime(): AppRuntime {
    const env = {
        location: window.location,
        mode: import.meta.env.MODE,
        apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string | undefined,
        wsUrl: import.meta.env.VITE_WS_URL as string | undefined,
    };
    const apiBaseUrl = resolveApiBaseUrl(env);
    const wsUrl = resolveWebSocketUrl(env);

    const store = createAppStore(generateRandomName());
    const roomApi = new RoomApi({ baseUrl: apiBaseUrl });

    const controller = new RoomController({
        store,
        roomApi,
        createSignaling: () => new SignalingClient({ url: wsUrl }),
        createPeer: () =>
            new PeerConnection({
                iceServersProvider: () => {
                    const s = store.getState();
                    return fetchIceServers({
                        apiBaseUrl,
                        lanOnly: s.connectionType === "lan",
                        roomCode: s.roomCode ?? undefined,
                        participantId: s.participantId ?? undefined,
                    });
                },
            }),
        createSender: (transport: SendTransport) => new FileSender(transport),
        createReceiver: () => new FileReceiver(createReceiveSinkFactory()),
    });

    return { store, controller, apiBaseUrl, wsUrl };
}
