// File receiver: consumes raw data-channel messages, reassembles files, and
// emits typed events. Ported from src/js/transfer/fileReceiver.js with all DOM,
// toast, i18n, preview, and audio side-effects removed — those belong to the UI
// layer, which subscribes to the events below.
//
// Chunk storage is delegated to a ReceiveSink (memory or OPFS), chosen per file
// by an injected factory, so routing and assembly are unit-testable.

import { TypedEmitter } from "./emitter.ts";
import {
    decodeDataChannelFrame,
    type ControlType,
    type FileMetadata,
} from "./protocol.ts";
import {
    MemoryReceiveSink,
    type ReceiveSink,
    type ReceiveSinkFactory,
} from "./receiveSink.ts";
import { isExecutable } from "./security.ts";

export interface ReceivedFile {
    meta: FileMetadata;
    blob: Blob;
    /** True if the filename looks like an executable/script. */
    executable: boolean;
}

export type ReceiverEvents = {
    fileStart: { meta: FileMetadata; sink: ReceiveSink["kind"] };
    progress: { meta: FileMetadata; received: number; total: number };
    fileComplete: ReceivedFile;
    control: { type: ControlType };
    chat: { text: string };
    error: { context: string; error: Error };
};

/** Default factory: everything goes to memory. The app overrides this to add
 *  OPFS routing for large files (which needs browser storage APIs). */
const memoryOnlyFactory: ReceiveSinkFactory = async (meta) =>
    new MemoryReceiveSink(meta.type);

export class FileReceiver extends TypedEmitter<ReceiverEvents> {
    private meta: FileMetadata | null = null;
    private sink: ReceiveSink | null = null;
    private received = 0;

    constructor(
        private readonly sinkFactory: ReceiveSinkFactory = memoryOnlyFactory
    ) {
        super();
    }

    /** Feed one raw data-channel message. */
    async handleMessage(
        data: string | ArrayBuffer | ArrayBufferView
    ): Promise<void> {
        const frame = decodeDataChannelFrame(data);

        switch (frame.kind) {
            case "control":
                this.emit("control", { type: frame.message.type });
                return;

            case "chat":
                this.emit("chat", { text: frame.text });
                return;

            case "metadata":
                await this.beginFile(frame.metadata);
                return;

            case "chunk":
                await this.handleChunk(frame.data);
                return;

            case "eof":
                await this.completeFile();
                return;

            case "unknown":
                // Ignore silently, matching the original client's tolerance for
                // stray messages.
                return;
        }
    }

    private async beginFile(meta: FileMetadata): Promise<void> {
        // If a previous transfer was mid-flight, drop it.
        if (this.sink) {
            await this.sink.abort();
        }
        this.meta = meta;
        this.received = 0;
        try {
            this.sink = await this.sinkFactory(meta);
        } catch (error) {
            this.sink = null;
            this.meta = null;
            this.emit("error", { context: "openSink", error: error as Error });
            return;
        }
        this.emit("fileStart", { meta, sink: this.sink.kind });
    }

    private async handleChunk(data: ArrayBuffer): Promise<void> {
        if (!this.meta || !this.sink) return; // chunk before metadata; ignore

        // Never trust the sender to stop at the size it declared. Without this
        // guard a peer could declare `size: 1` (which also keeps the transfer in
        // the in-memory sink, bypassing OPFS routing) and then stream unbounded
        // chunks until the tab runs out of memory. Refuse the overflow and drop
        // the transfer.
        if (this.received + data.byteLength > this.meta.size) {
            const meta = this.meta;
            await this.discardActiveTransfer();
            this.emit("error", {
                context: "sizeOverflow",
                error: new Error(
                    `Peer sent more data than the declared ${meta.size} bytes for "${meta.name}"`
                ),
            });
            return;
        }

        const ok = await this.sink.write(data);
        if (!ok) {
            await this.discardActiveTransfer();
            this.emit("error", {
                context: "sinkWrite",
                error: new Error("Failed to persist received chunk"),
            });
            return;
        }

        this.received += data.byteLength;
        this.emit("progress", {
            meta: this.meta,
            received: this.received,
            total: this.meta.size,
        });
    }

    /** Tear down the in-flight sink and clear transfer state. */
    private async discardActiveTransfer(): Promise<void> {
        const sink = this.sink;
        this.sink = null;
        this.meta = null;
        this.received = 0;
        if (sink) await sink.abort();
    }

    private async completeFile(): Promise<void> {
        if (!this.meta || !this.sink) return;
        const meta = this.meta;
        const sink = this.sink;
        this.meta = null;
        this.sink = null;

        const blob = await sink.finalize();
        if (!blob) {
            this.emit("error", {
                context: "finalize",
                error: new Error("Failed to finalize received file"),
            });
            return;
        }

        this.emit("fileComplete", {
            meta,
            blob,
            executable: isExecutable(meta.name),
        });
    }

    /** Discard any in-flight transfer state. */
    async reset(): Promise<void> {
        if (this.sink) await this.sink.abort();
        this.meta = null;
        this.sink = null;
        this.received = 0;
    }
}
