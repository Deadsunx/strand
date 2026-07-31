// File sender: streams a file's metadata + chunks + EOF over an abstract
// transport, honouring data-channel backpressure. The original client
// (src/js/transfer/fileSender.js) fused this with a Web Worker, the DOM, and the
// global store; here it depends only on two small interfaces so it is fully
// unit-testable and portable.

import { TypedEmitter } from "./emitter.ts";
import { HIGH_WATER_MARK } from "./config.ts";
import { EOF_MARKER, encodeFileMetadata, type FileMetadata } from "./protocol.ts";

/** The write side of a data channel, abstracted for testing. */
export interface SendTransport {
    send(data: string | ArrayBuffer): void;
    /** Bytes currently queued in the channel but not yet sent on the wire. */
    bufferedAmount(): number;
}

/** Pull-based source of file chunks. `read()` resolves null when exhausted. */
export interface ChunkReader {
    read(): Promise<ArrayBuffer | null>;
}

export type SenderEvents = {
    progress: { meta: FileMetadata; sent: number; total: number };
    fileComplete: { meta: FileMetadata; sent: number };
    error: { meta: FileMetadata; error: Error };
};

export interface FileSenderOptions {
    highWaterMark?: number;
}

/**
 * Reads a Blob/File in fixed-size slices. Portable: works anywhere `Blob` and
 * `Blob.prototype.arrayBuffer` exist (browsers and Node 18+), so the sender can
 * be exercised end-to-end in tests without a Worker.
 */
export class BlobChunkReader implements ChunkReader {
    private offset = 0;
    constructor(
        private readonly blob: Blob,
        private readonly chunkSize: number
    ) {}

    async read(): Promise<ArrayBuffer | null> {
        if (this.offset >= this.blob.size) return null;
        const end = Math.min(this.offset + this.chunkSize, this.blob.size);
        const slice = this.blob.slice(this.offset, end);
        this.offset = end;
        return await slice.arrayBuffer();
    }
}

/** Yields pre-computed chunks from an array (used in tests). */
export class ArrayChunkReader implements ChunkReader {
    private index = 0;
    constructor(private readonly chunks: ArrayBuffer[]) {}

    async read(): Promise<ArrayBuffer | null> {
        if (this.index >= this.chunks.length) return null;
        return this.chunks[this.index++];
    }
}

export class FileSender extends TypedEmitter<SenderEvents> {
    private readonly highWaterMark: number;
    private drainWaiters: Array<() => void> = [];
    private cancelled = false;
    private sending = false;

    constructor(
        private readonly transport: SendTransport,
        options: FileSenderOptions = {}
    ) {
        super();
        this.highWaterMark = options.highWaterMark ?? HIGH_WATER_MARK;
    }

    /** Call when the channel drains (e.g. from `onbufferedamountlow`). */
    notifyDrain(): void {
        const waiters = this.drainWaiters;
        this.drainWaiters = [];
        for (const resolve of waiters) resolve();
    }

    /** Abort an in-flight send; the current `send()` promise resolves early. */
    cancel(): void {
        this.cancelled = true;
        this.notifyDrain();
    }

    private waitForCapacity(): Promise<void> {
        if (
            this.cancelled ||
            this.transport.bufferedAmount() <= this.highWaterMark
        ) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => this.drainWaiters.push(resolve));
    }

    /** True while a `send()` is in flight. */
    isSending(): boolean {
        return this.sending;
    }

    /**
     * Send one file. Resolves once EOF has been queued (or the send was
     * cancelled). Backpressure: never queues a chunk while the transport buffer
     * sits above the high-water mark.
     *
     * Only one transfer may run at a time: a single data channel carries one
     * file's metadata + chunks + EOF as an ordered stream, so two concurrent
     * sends would interleave chunks and corrupt both files. Calling `send()`
     * while another is in flight rejects rather than silently corrupting; the
     * caller (a transfer queue) is responsible for serializing.
     */
    async send(meta: FileMetadata, reader: ChunkReader): Promise<void> {
        if (this.sending) {
            throw new Error(
                "FileSender is already sending a file; serialize transfers before calling send()."
            );
        }
        this.sending = true;
        this.cancelled = false;
        try {
            this.transport.send(encodeFileMetadata(meta));

            let sent = 0;
            for (;;) {
                await this.waitForCapacity();
                if (this.cancelled) return;

                const chunk = await reader.read();
                if (chunk === null) break;

                this.transport.send(chunk);
                sent += chunk.byteLength;
                this.emit("progress", { meta, sent, total: meta.size });
            }

            if (this.cancelled) return;
            this.transport.send(EOF_MARKER);
            this.emit("fileComplete", { meta, sent });
        } catch (error) {
            this.emit("error", { meta, error: error as Error });
            throw error;
        } finally {
            this.sending = false;
            this.drainWaiters = [];
        }
    }
}
