// A "receive sink" is where incoming file chunks are written before the final
// Blob is assembled. There are two implementations:
//
//   - MemoryReceiveSink: accumulates ArrayBuffers and builds a Blob at the end.
//   - OpfsReceiveSink: streams chunks to the Origin Private File System so huge
//     transfers don't exhaust tab memory.
//
// The receiver depends only on the `ReceiveSink` interface and a factory, so it
// can be unit-tested with an in-memory sink and no browser APIs. Routing logic
// (`shouldUseOpfs`) is pure for the same reason.

import { OPFS_THRESHOLD } from "./config.ts";

import type { FileMetadata } from "./protocol.ts";

export interface ReceiveSink {
    /** Persist one chunk. Resolves false if the write failed (sink is dead). */
    write(chunk: ArrayBuffer): Promise<boolean>;
    /** Assemble and return the final Blob, or null on failure. */
    finalize(): Promise<Blob | null>;
    /** Release any resources without producing a Blob. */
    abort(): Promise<void>;
    readonly kind: "memory" | "opfs";
}

export class MemoryReceiveSink implements ReceiveSink {
    readonly kind = "memory" as const;
    private chunks: ArrayBuffer[] = [];

    constructor(private readonly mimeType: string) {}

    async write(chunk: ArrayBuffer): Promise<boolean> {
        this.chunks.push(chunk);
        return true;
    }

    async finalize(): Promise<Blob | null> {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.chunks = [];
        return blob;
    }

    async abort(): Promise<void> {
        this.chunks = [];
    }
}

/** Minimal shape of the OPFS APIs the sink needs (keeps typing lib-agnostic). */
export interface OpfsDirectory {
    removeEntry(name: string): Promise<void>;
    getFileHandle(
        name: string,
        options?: { create?: boolean }
    ): Promise<OpfsFileHandle>;
}
export interface OpfsFileHandle {
    createWritable(): Promise<OpfsWritable>;
    getFile(): Promise<Blob>;
}
export interface OpfsWritable {
    write(data: ArrayBuffer): Promise<void>;
    close(): Promise<void>;
}

export class OpfsReceiveSink implements ReceiveSink {
    readonly kind = "opfs" as const;
    private writable: OpfsWritable | null = null;
    private handle: OpfsFileHandle | null = null;

    private constructor() {}

    /** Create and open a sink backed by an OPFS file. */
    static async open(
        directory: OpfsDirectory,
        fileName: string
    ): Promise<OpfsReceiveSink> {
        const sink = new OpfsReceiveSink();
        // Best-effort clean slate; ignore if the entry is absent or locked.
        try {
            await directory.removeEntry(fileName);
        } catch {
            /* ignore */
        }
        sink.handle = await directory.getFileHandle(fileName, { create: true });
        sink.writable = await sink.handle.createWritable();
        return sink;
    }

    async write(chunk: ArrayBuffer): Promise<boolean> {
        if (!this.writable) return false;
        try {
            await this.writable.write(chunk);
            return true;
        } catch {
            this.writable = null;
            return false;
        }
    }

    async finalize(): Promise<Blob | null> {
        if (!this.writable || !this.handle) return null;
        try {
            await this.writable.close();
            return await this.handle.getFile();
        } catch {
            return null;
        } finally {
            this.writable = null;
            this.handle = null;
        }
    }

    async abort(): Promise<void> {
        try {
            await this.writable?.close();
        } catch {
            /* ignore */
        }
        this.writable = null;
        this.handle = null;
    }
}

export interface OpfsRoutingOptions {
    /** User setting: is OPFS buffering enabled? */
    enabled: boolean;
    /** Capability: does the environment expose `navigator.storage.getDirectory`? */
    supported: boolean;
}

/** Pure routing decision: should this file be streamed to OPFS? */
export function shouldUseOpfs(
    fileSize: number,
    options: OpfsRoutingOptions
): boolean {
    return options.enabled && options.supported && fileSize > OPFS_THRESHOLD;
}

export type ReceiveSinkFactory = (meta: FileMetadata) => Promise<ReceiveSink>;
