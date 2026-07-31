import { describe, it, expect, vi } from "vitest";
import {
    FileSender,
    ArrayChunkReader,
    BlobChunkReader,
    type SendTransport,
} from "../sender.ts";
import { EOF_MARKER, decodeDataChannelFrame } from "../protocol.ts";
import type { FileMetadata } from "../protocol.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Fake data channel: records everything sent and models a growing buffer. */
class FakeTransport implements SendTransport {
    sent: Array<string | ArrayBuffer> = [];
    buffered = 0;
    send(data: string | ArrayBuffer): void {
        this.sent.push(data);
        if (typeof data !== "string") this.buffered += data.byteLength;
    }
    bufferedAmount(): number {
        return this.buffered;
    }
    /** Simulate the wire draining and notify the sender. */
    drain(sender: FileSender): void {
        this.buffered = 0;
        sender.notifyDrain();
    }
    chunks(): ArrayBuffer[] {
        return this.sent.filter(
            (m): m is ArrayBuffer => typeof m !== "string"
        );
    }
    strings(): string[] {
        return this.sent.filter((m): m is string => typeof m === "string");
    }
}

const meta: FileMetadata = { name: "f.bin", type: "", size: 240 };
const makeChunks = (count: number, size: number) =>
    Array.from({ length: count }, (_, i) =>
        new Uint8Array(size).fill(i + 1).buffer
    );

describe("FileSender backpressure", () => {
    it("stops queuing chunks while buffered amount exceeds the high-water mark", async () => {
        const transport = new FakeTransport();
        const sender = new FileSender(transport, { highWaterMark: 100 });
        const reader = new ArrayChunkReader(makeChunks(4, 60));

        const done = sender.send(meta, reader);
        await tick();

        // metadata + two 60-byte chunks (buffer now 120 > 100) then it blocks.
        expect(transport.strings()[0]).toBe(JSON.stringify(meta));
        expect(transport.chunks().length).toBe(2);
        expect(transport.strings()).not.toContain(EOF_MARKER);

        // Drain once → sends the remaining two chunks, then blocks again.
        transport.drain(sender);
        await tick();
        expect(transport.chunks().length).toBe(4);
        expect(transport.strings()).not.toContain(EOF_MARKER);

        // Drain again → reader is exhausted, EOF is queued, send resolves.
        transport.drain(sender);
        await done;
        expect(transport.strings()).toContain(EOF_MARKER);
    });

    it("preserves chunk order and frames metadata first, EOF last", async () => {
        const transport = new FakeTransport();
        const sender = new FileSender(transport, { highWaterMark: 10_000 });
        const chunks = makeChunks(3, 10);
        await sender.send(meta, new ArrayChunkReader(chunks));

        expect(transport.sent[0]).toBe(JSON.stringify(meta));
        expect(transport.sent[transport.sent.length - 1]).toBe(EOF_MARKER);

        const decodedChunks = transport
            .chunks()
            .map((c) => new Uint8Array(c)[0]);
        expect(decodedChunks).toEqual([1, 2, 3]);
    });

    it("emits progress events with a monotonic cumulative byte count", async () => {
        const transport = new FakeTransport();
        const sender = new FileSender(transport, { highWaterMark: 10_000 });
        const progress = vi.fn();
        sender.on("progress", progress);

        await sender.send(meta, new ArrayChunkReader(makeChunks(3, 10)));

        const sentValues = progress.mock.calls.map((c) => c[0].sent);
        expect(sentValues).toEqual([10, 20, 30]);
    });

    it("streams a real Blob end-to-end via BlobChunkReader", async () => {
        const transport = new FakeTransport();
        const sender = new FileSender(transport, { highWaterMark: 10_000 });
        const payload = new Uint8Array([10, 20, 30, 40, 50]);
        const blob = new Blob([payload]);
        const blobMeta: FileMetadata = {
            name: "b.bin",
            type: "",
            size: blob.size,
        };

        await sender.send(blobMeta, new BlobChunkReader(blob, 2));

        // 5 bytes / 2-byte chunks → 3 chunks (2 + 2 + 1).
        expect(transport.chunks().length).toBe(3);
        const reassembled = new Uint8Array(
            transport.chunks().reduce((acc, c) => acc + c.byteLength, 0)
        );
        let offset = 0;
        for (const c of transport.chunks()) {
            reassembled.set(new Uint8Array(c), offset);
            offset += c.byteLength;
        }
        expect(reassembled).toEqual(payload);
    });

    it("rejects a concurrent send while one is in flight (W2: no interleaving)", async () => {
        const transport = new FakeTransport();
        transport.buffered = 200; // above the mark → first send blocks immediately
        const sender = new FileSender(transport, { highWaterMark: 100 });

        const first = sender.send(meta, new ArrayChunkReader(makeChunks(2, 60)));
        await tick();
        expect(sender.isSending()).toBe(true);

        // A second send must reject rather than interleave onto the same channel.
        await expect(
            sender.send(
                { name: "b.bin", type: "", size: 60 },
                new ArrayChunkReader(makeChunks(1, 60))
            )
        ).rejects.toThrow(/already sending/i);

        // The first transfer is untouched and completes once drained.
        transport.drain(sender);
        await tick();
        transport.drain(sender);
        await first;
        expect(sender.isSending()).toBe(false);
        expect(transport.strings()).toContain(EOF_MARKER);

        // Only one metadata frame was ever queued (the second was rejected).
        const metadataFrames = transport
            .strings()
            .filter((s) => s.startsWith("{"));
        expect(metadataFrames).toEqual([JSON.stringify(meta)]);
    });

    it("can send a second file after the first fully completes", async () => {
        const transport = new FakeTransport();
        const sender = new FileSender(transport, { highWaterMark: 10_000 });
        await sender.send(meta, new ArrayChunkReader(makeChunks(1, 10)));
        // Reusable after completion.
        await sender.send(
            { name: "b.bin", type: "", size: 10 },
            new ArrayChunkReader(makeChunks(1, 10))
        );
        expect(sender.isSending()).toBe(false);
        expect(transport.strings().filter((s) => s === EOF_MARKER).length).toBe(2);
    });

    it("stops early when cancelled and never sends EOF", async () => {
        const transport = new FakeTransport();
        const sender = new FileSender(transport, { highWaterMark: 100 });
        const done = sender.send(meta, new ArrayChunkReader(makeChunks(4, 60)));
        await tick(); // sent 2 chunks, now blocked

        sender.cancel();
        await done;
        expect(transport.strings()).not.toContain(EOF_MARKER);

        // Sanity: at least one frame decodes as a chunk.
        expect(decodeDataChannelFrame(transport.chunks()[0]).kind).toBe("chunk");
    });
});
