import { describe, it, expect } from "vitest";
import {
    decodeDataChannelFrame,
    encodeFileMetadata,
    encodeControl,
    CONTROL_TYPES,
    EOF_MARKER,
} from "../protocol.ts";

describe("data-channel framing", () => {
    it("decodes the EOF marker", () => {
        expect(decodeDataChannelFrame(EOF_MARKER)).toEqual({ kind: "eof" });
    });

    it("decodes file metadata", () => {
        const raw = encodeFileMetadata({
            name: "photo.png",
            type: "image/png",
            size: 1234,
        });
        expect(decodeDataChannelFrame(raw)).toEqual({
            kind: "metadata",
            metadata: { name: "photo.png", type: "image/png", size: 1234 },
        });
    });

    it("treats metadata with a missing MIME type as an empty string", () => {
        const raw = JSON.stringify({ name: "f.bin", size: 10 });
        const frame = decodeDataChannelFrame(raw);
        expect(frame).toEqual({
            kind: "metadata",
            metadata: { name: "f.bin", type: "", size: 10 },
        });
    });

    it("decodes each control message and prefers control over metadata shape", () => {
        for (const type of Object.values(CONTROL_TYPES)) {
            expect(decodeDataChannelFrame(encodeControl(type))).toEqual({
                kind: "control",
                message: { type },
            });
        }
        // A control message never has name/size, so there's no ambiguity, but a
        // crafted object with a control `type` AND file-ish fields must still be
        // read as control (control literals are checked first).
        const tricky = JSON.stringify({
            type: CONTROL_TYPES.streamEnded,
            name: "x",
            size: 5,
        });
        expect(decodeDataChannelFrame(tricky)).toEqual({
            kind: "control",
            message: { type: CONTROL_TYPES.streamEnded },
        });
    });

    it("decodes binary chunks from ArrayBuffer and typed-array views", () => {
        const buf = new Uint8Array([1, 2, 3, 4]).buffer;
        const frame = decodeDataChannelFrame(buf);
        expect(frame.kind).toBe("chunk");
        if (frame.kind === "chunk") {
            expect(new Uint8Array(frame.data)).toEqual(
                new Uint8Array([1, 2, 3, 4])
            );
        }

        // A view with a non-zero byteOffset must be copied exactly.
        const backing = new Uint8Array([9, 1, 2, 3, 9]);
        const view = new Uint8Array(backing.buffer, 1, 3); // [1,2,3]
        const viewFrame = decodeDataChannelFrame(view);
        expect(viewFrame.kind).toBe("chunk");
        if (viewFrame.kind === "chunk") {
            expect(new Uint8Array(viewFrame.data)).toEqual(
                new Uint8Array([1, 2, 3])
            );
        }
    });

    it("classifies malformed or unrelated strings as unknown", () => {
        expect(decodeDataChannelFrame("not json")).toEqual({
            kind: "unknown",
            raw: "not json",
        });
        expect(decodeDataChannelFrame("{bad json")).toEqual({
            kind: "unknown",
            raw: "{bad json",
        });
    });
});
