// --- src/config.ts ---

import os from "os";

const interfaces = os.networkInterfaces();

function parseNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsvEnv(name: string, fallback: string[]): string[] {
    const raw = process.env[name];
    if (!raw) return fallback;

    const values = raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return values.length > 0 ? values : fallback;
}

function parseRegexEnv(name: string, fallback: RegExp): RegExp {
    const raw = process.env[name];
    if (!raw) return fallback;

    try {
        return new RegExp(raw);
    } catch {
        console.warn(
            JSON.stringify({
                level: "WARN",
                message: "Invalid regex provided in environment",
                variable: name,
                value: raw,
            })
        );
        return fallback;
    }
}

// --- START: Logic for dynamically adding local origins ---
const baseAllowedOrigins = parseCsvEnv("ALLOWED_ORIGINS", [
    "https://dropsilk.xyz",
    "https://www.dropsilk.xyz",
    "https://dropsilk.vercel.app",
    "app://.",
]);

const ALLOWED_ORIGINS = new Set(baseAllowedOrigins);
const localPortArgPrefix = "--allow-local-port=";

process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith(localPortArgPrefix)) {
        const portStr = arg.substring(localPortArgPrefix.length);
        const port = parseInt(portStr, 10);

        if (!isNaN(port) && port > 0 && port < 65536) {
            const localOrigin1 = `http://localhost:${port}`;
            const localOrigin2 = `http://127.0.0.1:${port}`;

            ALLOWED_ORIGINS.add(localOrigin1);
            ALLOWED_ORIGINS.add(localOrigin2);

            // Use console.log here to avoid circular dependency with utils.ts
            console.log(
                JSON.stringify({
                    level: "INFO",
                    message: "Dynamically allowing local origins",
                    port,
                    origins: [localOrigin1, localOrigin2],
                })
            );

            // --- 192.168.x.x origins ---
            for (const name of Object.keys(interfaces)) {
                const ifaces = interfaces[name];
                if (!ifaces) continue;
                for (const iface of ifaces) {
                    const { address, family, internal } = iface;
                    if (
                        family === "IPv4" &&
                        !internal &&
                        address.startsWith("192.168.")
                    ) {
                        const localOrigin3 = `http://${address}:${port}`;
                        ALLOWED_ORIGINS.add(localOrigin3);
                        console.log(
                            JSON.stringify({
                                level: "INFO",
                                message: "Dynamically allowing local network origin",
                                port,
                                origin: localOrigin3,
                            })
                        );
                    }
                }
            }
        } else {
            console.warn(
                JSON.stringify({
                    level: "WARN",
                    message: "Invalid port number provided for local origin",
                    argument: arg,
                })
            );
        }
    }
});
// --- END: Logic for dynamically adding local origins ---

export interface Config {
    PORT: number;
    NODE_ENV: string;
    ALLOWED_ORIGINS: Set<string>;
    VERCEL_PREVIEW_ORIGIN_REGEX: RegExp;
    MAX_PAYLOAD: number;
    HEALTH_CHECK_INTERVAL: number;
    SHUTDOWN_TIMEOUT: number;
    LOG_ACCESS_KEY: string;
    MAX_LOG_BUFFER_SIZE: number;
    UPLOADTHING_TOKEN: string;
    CLOUDFLARE_TURN_TOKEN_ID: string;
    CLOUDFLARE_API_TOKEN: string;
    recaptchaSecretKey: string;
    contactEmail: string;
    HEARTBEAT_INTERVAL_MS: number;
    ROOM_TTL_MS: number;
    PREVIEW_RETENTION_MS: number;
    PREVIEW_CLEANUP_INTERVAL_MINUTES: number;
    ROOM_CLEANUP_INTERVAL_MINUTES: number;
    // --- Abuse mitigation ---
    TURN_RATE_LIMIT: number;
    TURN_RATE_WINDOW_MS: number;
    ROOM_CREATE_RATE_LIMIT: number;
    ROOM_CREATE_RATE_WINDOW_MS: number;
    // When true, /api/turn-credentials requires a valid roomCode+participantId.
    // Default off for backward compatibility with older clients that request
    // credentials without room context; enable once all clients send it.
    TURN_REQUIRE_PARTICIPANT: boolean;
    STATUS_ACCESS_KEY: string;
    // --- Nearby-device discovery ---
    NETWORK_DISCOVERY_MAX_GROUP: number;
    NETWORK_DISCOVERY_LEGACY_DEFAULT: boolean;
}

const config: Config = {
    PORT: Number(process.env.PORT) || 8080,
    NODE_ENV: process.env.NODE_ENV || "development",

    ALLOWED_ORIGINS: ALLOWED_ORIGINS,

    VERCEL_PREVIEW_ORIGIN_REGEX: parseRegexEnv(
        "VERCEL_PREVIEW_ORIGIN_REGEX",
        /^https:\/\/dropsilk-[a-zA-Z0-9]+-ahmed-arats-projects\.vercel\.app$/
    ),

    MAX_PAYLOAD: parseNumberEnv("MAX_PAYLOAD_BYTES", 1024 * 1024),
    HEALTH_CHECK_INTERVAL: parseNumberEnv("WS_HEALTH_CHECK_INTERVAL_MS", 30000),
    SHUTDOWN_TIMEOUT: parseNumberEnv("SHUTDOWN_TIMEOUT_MS", 10000),

    LOG_ACCESS_KEY:
        process.env.LOG_ACCESS_KEY || "change-this-secret-key-in-production",
    MAX_LOG_BUFFER_SIZE: parseNumberEnv("MAX_LOG_BUFFER_SIZE", 1000),

    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN || "",

    CLOUDFLARE_TURN_TOKEN_ID: process.env.CLOUDFLARE_TURN_TOKEN_ID || "",
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "",

    recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY || "",
    contactEmail: process.env.CONTACT_EMAIL || "",
    HEARTBEAT_INTERVAL_MS: parseNumberEnv("HEARTBEAT_INTERVAL_MS", 5 * 60 * 1000),
    ROOM_TTL_MS: parseNumberEnv("ROOM_TTL_MINUTES", 30) * 60 * 1000,
    PREVIEW_RETENTION_MS:
        parseNumberEnv("PREVIEW_RETENTION_HOURS", 24) * 60 * 60 * 1000,
    PREVIEW_CLEANUP_INTERVAL_MINUTES: parseNumberEnv(
        "PREVIEW_CLEANUP_INTERVAL_MINUTES",
        60
    ),
    ROOM_CLEANUP_INTERVAL_MINUTES: parseNumberEnv(
        "ROOM_CLEANUP_INTERVAL_MINUTES",
        5
    ),

    // Per-IP: 20 TURN credential requests / minute is generous for real use
    // (a client fetches once per peer connection) but stops scripted draining.
    TURN_RATE_LIMIT: parseNumberEnv("TURN_RATE_LIMIT", 20),
    TURN_RATE_WINDOW_MS: parseNumberEnv("TURN_RATE_WINDOW_MS", 60 * 1000),

    // Per-IP: 30 room creations / 5 minutes. Well above legitimate usage.
    ROOM_CREATE_RATE_LIMIT: parseNumberEnv("ROOM_CREATE_RATE_LIMIT", 30),
    ROOM_CREATE_RATE_WINDOW_MS: parseNumberEnv(
        "ROOM_CREATE_RATE_WINDOW_MS",
        5 * 60 * 1000
    ),

    TURN_REQUIRE_PARTICIPANT:
        String(process.env.TURN_REQUIRE_PARTICIPANT || "").toLowerCase() ===
        "true",

    STATUS_ACCESS_KEY: process.env.STATUS_ACCESS_KEY || "",

    // IP-derived discovery groups larger than this are suppressed entirely:
    // a "home network" never has this many strangers, so a big group signals
    // shared/CGNAT public IPs and is not advertised. Token-based groups (shared
    // PIN) are exempt because membership is intentional.
    NETWORK_DISCOVERY_MAX_GROUP: parseNumberEnv("NETWORK_DISCOVERY_MAX_GROUP", 8),

    // When true, clients that don't send `discoverable` are treated as
    // discoverable (the old always-on behaviour). Default false = privacy-safe.
    NETWORK_DISCOVERY_LEGACY_DEFAULT:
        String(process.env.NETWORK_DISCOVERY_LEGACY_DEFAULT || "").toLowerCase() ===
        "true",
};

export default config;
