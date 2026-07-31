// --- src/gossamer.ts ---
// Bridge for ESM @dropsilk/gossamer in CommonJS project

import path from "path";
import type { GossamerUserConfig } from "@dropsilk/gossamer";

type GossamerInstance = Awaited<typeof import("@dropsilk/gossamer")>["gossamer"];

let gossamer: GossamerInstance | null = null;
let isInitialized = false;

/**
 * Initialize Gossamer telemetry.
 * Must be called before any emit() calls.
 */
export async function initGossamer(): Promise<void> {
    if (isInitialized) return;

    const { gossamer: g, ConsolePrettyTransport } = await import(
        "@dropsilk/gossamer"
    );
    // Resolve config path relative to project root (works in tests, dev, and production)
    const configPath = path.resolve(process.cwd(), "gossamer.config.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(configPath) as GossamerUserConfig;

    await g.init(config, {
        transports: [
            new ConsolePrettyTransport({
                pretty: process.env.NODE_ENV !== "production",
            }),
        ],
        captureCrashes: true,
    });

    gossamer = g;
    isInitialized = true;
}

/**
 * Emit a telemetry event.
 * @param eventName - Event name (e.g., "flight:created")
 * @param payload - Event payload
 */
export function emit(eventName: string, payload: Record<string, unknown> = {}): void {
    if (!gossamer) {
        console.warn(`[gossamer] Emit before init: ${eventName}`);
        return;
    }
    gossamer.emit(eventName, payload);
}

/**
 * Emit an error event with standardized error payload.
 * @param eventName - Event name (e.g., "client:error")
 * @param error - The error object
 * @param additionalPayload - Additional context
 */
export function emitError(
    eventName: string,
    error: unknown,
    additionalPayload: Record<string, unknown> = {}
): void {
    if (!gossamer) {
        console.warn(`[gossamer] EmitError before init: ${eventName}`);
        return;
    }
    gossamer.emitError(eventName, error, additionalPayload);
}

/**
 * Flush all transports. Useful for graceful shutdown.
 */
export async function flush(): Promise<void> {
    if (gossamer) {
        await gossamer.flush();
    }
}
