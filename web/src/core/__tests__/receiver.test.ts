import { describe, it, expect, vi } from "vitest";
import { FileReceiver } from "../receiver.ts";
import {
    MemoryReceiveSink,
    shouldUseOpfs,
    type ReceiveSink,
    type ReceiveSinkFactory,
} from "../receiveSink.ts";
import {
    encodeControl,
    encodeFileMetadata,
    CONTROL_TYPES,
    EOF_MARKER,
    OPFS_THRESHOLD,
    type FileMetadata,
} from "../index.ts";

const meta: FileMetadata = { name: "hello.txt", type: "text/plain", size: 5 };

async function feed(
    receiver: FileReceiver,
    frames: Array<string | ArrayBuffer>
): Promise<void> {
    for (const f of frames) {
        await receiver.handleMessage(f);
    }
}

describe("FileReceiver reassembly (memory)", () => {
    it("reassembles chunks into a Blob and reports completion", async () => {
        const receiver = new FileReceiver();
        const complete = vi.fn();
        const started = vi.fn();
        receiver.on("fileComplete", complete);
        receiver.on("fileStart", started);

        const c1 = new Uint8Array([104, 101]).buffer; // "he"
        const c2 = new Uint8Array([108, 108, 111]).buffer; // "llo"
        await feed(receiver, [encodeFileMetadata(meta), c1, c2, EOF_MARKER]);

        expect(started).toHaveBeenCalledWith({ meta, sink: "memory" });
        expect(complete).toHaveBeenCalledTimes(1);

        const received = complete.mock.calls[0][0];
        expect(received.executable).toBe(false);
        expect(await received.blob.text()).toBe("hello");
    });

    it("emits progress with a cumulative received count", async () => {
        const receiver = new FileReceiver();
        const progress = vi.fn();
        receiver.on("progress", progress);

        await feed(receiver, [
            encodeFileMetadata(meta),
            new Uint8Array([1, 2]).buffer,
            new Uint8Array([3, 4, 5]).buffer,
            EOF_MARKER,
        ]);

        expect(progress.mock.calls.map((c) => c[0].received)).toEqual([2, 5]);
    });

    it("flags executable filenames", async () => {
        const receiver = new FileReceiver();
        const complete = vi.fn();
        receiver.on("fileComplete", complete);
        const exeMeta: FileMetadata = {
            name: "setup.exe",
            type: "",
            size: 1,
        };
        await feed(receiver, [
            encodeFileMetadata(exeMeta),
            new Uint8Array([1]).buffer,
            EOF_MARKER,
        ]);
        expect(complete.mock.calls[0][0].executable).toBe(true);
    });

    it("surfaces control messages instead of treating them as files", async () => {
        const receiver = new FileReceiver();
        const control = vi.fn();
        const start = vi.fn();
        receiver.on("control", control);
        receiver.on("fileStart", start);

        await receiver.handleMessage(encodeControl(CONTROL_TYPES.streamEnded));
        expect(control).toHaveBeenCalledWith({
            type: CONTROL_TYPES.streamEnded,
        });
        expect(start).not.toHaveBeenCalled();
    });

    it("ignores chunks that arrive before any metadata", async () => {
        const receiver = new FileReceiver();
        const complete = vi.fn();
        receiver.on("fileComplete", complete);
        await receiver.handleMessage(new Uint8Array([1, 2, 3]).buffer);
        await receiver.handleMessage(EOF_MARKER);
        expect(complete).not.toHaveBeenCalled();
    });

    it("rejects a transfer that exceeds the declared size (W1: OOM guard)", async () => {
        // Sink records writes so we can prove the overflow chunk was never
        // persisted and that abort() was called.
        const writes: number[] = [];
        let aborted = false;
        const sink: ReceiveSink = {
            kind: "memory",
            async write(chunk) {
                writes.push(chunk.byteLength);
                return true;
            },
            async finalize() {
                return new Blob();
            },
            async abort() {
                aborted = true;
            },
        };
        const receiver = new FileReceiver(async () => sink);
        const errors: Array<{ context: string }> = [];
        const complete = vi.fn();
        receiver.on("error", (e) => errors.push(e));
        receiver.on("fileComplete", complete);

        const tiny: FileMetadata = { name: "lie.bin", type: "", size: 2 };
        await receiver.handleMessage(encodeFileMetadata(tiny));
        await receiver.handleMessage(new Uint8Array(2).buffer); // fills declared size
        await receiver.handleMessage(new Uint8Array(1000).buffer); // overflow

        expect(errors.map((e) => e.context)).toContain("sizeOverflow");
        expect(writes).toEqual([2]); // the 1000-byte overflow chunk was refused
        expect(aborted).toBe(true);

        // EOF after a discarded transfer must not complete anything.
        await receiver.handleMessage(EOF_MARKER);
        expect(complete).not.toHaveBeenCalled();
    });

    it("recovers and accepts a valid transfer after an overflow", async () => {
        const receiver = new FileReceiver();
        const complete = vi.fn();
        receiver.on("fileComplete", complete);

        const tiny: FileMetadata = { name: "lie.bin", type: "", size: 1 };
        await receiver.handleMessage(encodeFileMetadata(tiny));
        await receiver.handleMessage(new Uint8Array(50).buffer); // overflow → discard

        // A fresh, well-formed transfer still works.
        await feed(receiver, [
            encodeFileMetadata(meta),
            new Uint8Array([104, 101, 108, 108, 111]).buffer,
            EOF_MARKER,
        ]);
        expect(complete).toHaveBeenCalledTimes(1);
        expect(await complete.mock.calls[0][0].blob.text()).toBe("hello");
    });
});

describe("shouldUseOpfs routing", () => {
    it("only routes to OPFS when enabled, supported, and over the threshold", () => {
        const big = OPFS_THRESHOLD + 1;
        const small = OPFS_THRESHOLD - 1;
        expect(shouldUseOpfs(big, { enabled: true, supported: true })).toBe(true);
        expect(shouldUseOpfs(big, { enabled: false, supported: true })).toBe(false);
        expect(shouldUseOpfs(big, { enabled: true, supported: false })).toBe(false);
        expect(shouldUseOpfs(small, { enabled: true, supported: true })).toBe(false);
    });
});

describe("FileReceiver with an OPFS-style sink", () => {
    it("uses the injected sink and reports its kind", async () => {
        const writes: ArrayBuffer[] = [];
        let finalized = false;

        const fakeOpfsSink: ReceiveSink = {
            kind: "opfs",
            async write(chunk) {
                writes.push(chunk);
                return true;
            },
            async finalize() {
                finalized = true;
                return new Blob(writes);
            },
            async abort() {},
        };

        const factory: ReceiveSinkFactory = vi.fn(async () => fakeOpfsSink);
        const receiver = new FileReceiver(factory);
        const start = vi.fn();
        receiver.on("fileStart", start);

        await feed(receiver, [
            encodeFileMetadata(meta),
            new Uint8Array([1, 2, 3]).buffer,
            EOF_MARKER,
        ]);

        expect(factory).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledWith({ meta, sink: "opfs" });
        expect(writes.length).toBe(1);
        expect(finalized).toBe(true);
    });

    it("MemoryReceiveSink assembles chunks with the declared MIME type", async () => {
        const sink = new MemoryReceiveSink("application/octet-stream");
        await sink.write(new Uint8Array([1, 2]).buffer);
        await sink.write(new Uint8Array([3]).buffer);
        const blob = await sink.finalize();
        expect(blob).not.toBeNull();
        expect(blob!.type).toBe("application/octet-stream");
        expect(blob!.size).toBe(3);
    });
});
