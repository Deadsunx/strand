import { describe, it, expect, vi } from "vitest";
import { TypedEmitter } from "../emitter.ts";

type Events = { ping: number; pong: string };

describe("TypedEmitter", () => {
    it("delivers payloads to subscribers and supports unsubscribe", () => {
        const emitter = new TypedEmitter<Events>();
        const listener = vi.fn();
        const off = emitter.on("ping", listener);

        emitter.emit("ping", 1);
        emitter.emit("ping", 2);
        off();
        emitter.emit("ping", 3);

        expect(listener.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    });

    it("once() fires exactly one time", () => {
        const emitter = new TypedEmitter<Events>();
        const listener = vi.fn();
        emitter.once("pong", listener);
        emitter.emit("pong", "a");
        emitter.emit("pong", "b");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith("a");
    });

    it("tolerates a listener unsubscribing during emission", () => {
        const emitter = new TypedEmitter<Events>();
        const calls: number[] = [];
        const off = emitter.on("ping", () => {
            calls.push(1);
            off(); // remove self mid-emit
        });
        emitter.on("ping", () => calls.push(2));
        emitter.emit("ping", 0);
        emitter.emit("ping", 0);
        // First emit: both run. Second emit: only the second listener remains.
        expect(calls).toEqual([1, 2, 2]);
    });

    it("removeAll() clears every listener", () => {
        const emitter = new TypedEmitter<Events>();
        const a = vi.fn();
        emitter.on("ping", a);
        emitter.removeAll();
        emitter.emit("ping", 1);
        expect(a).not.toHaveBeenCalled();
    });
});
