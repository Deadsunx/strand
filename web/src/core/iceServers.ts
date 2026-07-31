// Fetches ICE (STUN/TURN) servers from the backend. Ports getIceServers() from
// src/js/network/webrtc.js. Two behavioural updates for the hardened backend:
//   - LAN connections skip external servers entirely (unchanged).
//   - When the backend enforces participant-bound TURN (TURN_REQUIRE_PARTICIPANT),
//     the caller can pass roomCode + participantId, which are sent as query
//     params. They're harmless when the backend doesn't require them.

export interface IceServersRequest {
    apiBaseUrl: string;
    /** Skip the network round-trip and return [] for LAN-only connections. */
    lanOnly?: boolean;
    roomCode?: string;
    participantId?: string;
    fetch?: typeof fetch;
}

const PUBLIC_STUN_FALLBACK: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
];

export async function fetchIceServers(
    request: IceServersRequest
): Promise<RTCIceServer[]> {
    if (request.lanOnly) return [];

    const fetchImpl = request.fetch ?? fetch;
    const params = new URLSearchParams();
    if (request.roomCode) params.set("roomCode", request.roomCode);
    if (request.participantId) params.set("participantId", request.participantId);
    const query = params.toString();
    const url = `${request.apiBaseUrl.replace(/\/$/, "")}/api/turn-credentials${
        query ? `?${query}` : ""
    }`;

    try {
        const response = await fetchImpl(url);
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }
        const data = (await response.json()) as { iceServers?: RTCIceServer[] };
        if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
            throw new Error("No ICE servers returned");
        }
        return data.iceServers;
    } catch {
        // Fall back to public STUN so LAN/simple-NAT cases still connect.
        return PUBLIC_STUN_FALLBACK;
    }
}
