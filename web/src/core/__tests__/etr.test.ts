import { describe, it, expect } from "vitest";
import { createEtrCalculator, formatTimeRemaining } from "../etr.ts";

describe("createEtrCalculator", () => {
    it("returns null until a speed sample is available", () => {
        let t = 1000;
        const etr = createEtrCalculator(() => t);
        // First update, no elapsed time > 0.5s window yet.
        expect(etr.update(0)).toBeNull();
        expect(etr.getETR(1000, 0)).toBeNull();
    });

    it("computes a smoothed speed and ETR from steady progress", () => {
        let t = 0;
        const etr = createEtrCalculator(() => t);
        etr.reset();

        // Advance 1s and report 1,000,000 bytes → 1 MB/s.
        t = 1000;
        const speed = etr.update(1_000_000);
        expect(speed).not.toBeNull();
        expect(speed).toBeCloseTo(1_000_000, -3);

        // 4 MB left at 1 MB/s ≈ 4s remaining.
        const remaining = etr.getETR(5_000_000, 1_000_000);
        expect(remaining).toBeCloseTo(4, 1);
    });

    it("ignores non-positive deltas", () => {
        let t = 0;
        const etr = createEtrCalculator(() => t);
        etr.reset();
        t = 1000;
        expect(etr.update(0)).toBeNull(); // zero bytes moved → no sample
    });
});

describe("formatTimeRemaining", () => {
    it("formats boundaries the way the original client did", () => {
        expect(formatTimeRemaining(-1)).toBe("");
        expect(formatTimeRemaining(NaN)).toBe("");
        expect(formatTimeRemaining(2)).toBe("Almost done...");
        expect(formatTimeRemaining(30)).toBe("~30s");
        expect(formatTimeRemaining(90)).toBe("~1m 30s");
        expect(formatTimeRemaining(120)).toBe("~2m");
        expect(formatTimeRemaining(3660)).toBe("~1h 1m");
        expect(formatTimeRemaining(3600)).toBe("~1h");
    });
});
