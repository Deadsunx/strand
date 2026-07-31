// Builds the receive-sink factory for the production app: large incoming files
// (over the OPFS threshold) stream to the Origin Private File System when the
// user has opted in and the browser supports it, so a multi-GB receive doesn't
// exhaust tab memory. Everything else stays in memory.
//
// The routing decision and the sinks themselves live in the core
// (receiveSink.ts); this module only supplies the browser storage handle and
// reads the user setting.

import {
    MemoryReceiveSink,
    OpfsReceiveSink,
    shouldUseOpfs,
    type OpfsDirectory,
    type ReceiveSinkFactory,
} from "../core/index.ts";

const OPFS_SETTING_KEY = "dropsilk-use-opfs-buffer";

function opfsEnabled(): boolean {
    try {
        return localStorage.getItem(OPFS_SETTING_KEY) === "true";
    } catch {
        return false;
    }
}

function opfsSupported(): boolean {
    return (
        typeof navigator !== "undefined" &&
        typeof navigator.storage?.getDirectory === "function"
    );
}

export function createReceiveSinkFactory(): ReceiveSinkFactory {
    return async (meta) => {
        if (shouldUseOpfs(meta.size, { enabled: opfsEnabled(), supported: opfsSupported() })) {
            try {
                const directory = await navigator.storage.getDirectory();
                return await OpfsReceiveSink.open(
                    directory as unknown as OpfsDirectory,
                    meta.name
                );
            } catch {
                // OPFS setup failed (quota, locked handle) — fall back to memory.
                return new MemoryReceiveSink(meta.type);
            }
        }
        return new MemoryReceiveSink(meta.type);
    };
}
