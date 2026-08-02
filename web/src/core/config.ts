// Runtime configuration for the transfer core. Ports the URL-resolution logic
// from the original frontend (src/js/config.js) but takes its inputs as an
// explicit environment object so it can be unit-tested without a real browser.

/** Flow-control + chunking constants (unchanged from the original client). */
// Data-channel send-buffer ceiling. The sender keeps the channel filled up to
// this level and pauses above it, resuming when it drains past half (see
// PeerConnection's bufferedAmountLowThreshold). It must exceed the link's
// bandwidth-delay product, or a high-latency relayed / cross-continent link
// can't stay saturated and throughput collapses. 8 MB covers roughly a 300 ms
// round trip at ~200 Mbit/s, while staying well under Chrome's 16 MB hard
// send-buffer limit.
export const HIGH_WATER_MARK = 8 * 1024 * 1024; // 8 MB
export const OPFS_THRESHOLD = 256 * 1024 * 1024; // route >256 MB receives to OPFS
export const DEFAULT_CHUNK_SIZE = 262144; // 256 KB

/** The subset of `window.location` the URL resolvers need. */
export interface LocationLike {
    hostname: string;
    port: string;
    protocol: string;
}

export interface ResolveUrlEnv {
    location: LocationLike;
    /** import.meta.env.MODE ("production" in builds, "development" in dev). */
    mode: string;
    /** import.meta.env.VITE_API_BASE_URL, if configured. */
    apiBaseUrl?: string;
    /** import.meta.env.VITE_WS_URL, if configured (explicit signaling endpoint). */
    wsUrl?: string;
    /** Production backend origin used when no override applies. */
    productionBackend?: string;
}

const DEFAULT_PRODUCTION_BACKEND = "strand-qicz.onrender.com";

function isPreviewMode(location: LocationLike): boolean {
    return (
        location.port === "4173" ||
        (location.hostname === "localhost" && location.port !== "5173")
    );
}

/**
 * Rewrites a loopback host in a configured URL to the page's host, so that a
 * dev build opened from another LAN device still reaches the local backend.
 * Mirrors `normalizeConfiguredUrl` in the original config.js.
 */
function normalizeConfiguredUrl(rawUrl: string, location: LocationLike): string {
    try {
        const parsed = new URL(rawUrl);
        const isLoopbackHost =
            parsed.hostname === "localhost" ||
            parsed.hostname === "127.0.0.1" ||
            parsed.hostname === "0.0.0.0";
        const isLanPage =
            location.hostname !== "localhost" &&
            location.hostname !== "127.0.0.1";
        if (isLoopbackHost && isLanPage) {
            parsed.hostname = location.hostname;
            return parsed.toString().replace(/\/$/, "");
        }
    } catch {
        return rawUrl;
    }
    return rawUrl;
}

export function resolveWebSocketUrl(env: ResolveUrlEnv): string {
    // An explicit override always wins (used for local dev on a custom port).
    if (env.wsUrl) return normalizeConfiguredUrl(env.wsUrl, env.location);

    const backend = env.productionBackend ?? DEFAULT_PRODUCTION_BACKEND;
    const { location } = env;

    if (env.mode === "production" && !isPreviewMode(location)) {
        return `wss://${backend}`;
    }
    if (location.protocol !== "https:") {
        return `ws://${location.hostname}:8080`;
    }
    return `wss://${backend}`;
}

export function resolveApiBaseUrl(env: ResolveUrlEnv): string {
    const backend = env.productionBackend ?? DEFAULT_PRODUCTION_BACKEND;
    const { location } = env;

    if (env.apiBaseUrl) {
        return normalizeConfiguredUrl(env.apiBaseUrl, location);
    }
    if (env.mode === "production" && !isPreviewMode(location)) {
        return `https://${backend}`;
    }
    if (location.protocol !== "https:") {
        return `http://${location.hostname}:8080`;
    }
    return `https://${backend}`;
}
