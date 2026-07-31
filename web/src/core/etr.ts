// Estimated-time-remaining calculator. A faithful, typed port of the original
// src/js/transfer/etrCalculator.js — pure and side-effect free so it is trivial
// to unit test. `formatTimeRemaining` stays English-only here; the UI layer is
// responsible for i18n of the final string.

const SPEED_SAMPLE_COUNT = 10;
const RECALC_INTERVAL_SECONDS = 0.5;

export interface EtrCalculator {
    /** Feed a new cumulative byte offset; returns the smoothed speed (B/s) or null. */
    update(currentOffset: number): number | null;
    /** Seconds remaining given the total size, or null if not yet estimable. */
    getETR(totalSize: number, currentOffset: number): number | null;
    /** Current smoothed speed in bytes/sec, or null. */
    getAverageSpeed(): number | null;
    /** Reset for a new transfer. */
    reset(): void;
}

export function createEtrCalculator(now: () => number = Date.now): EtrCalculator {
    let lastSpeedCalcTime = now();
    let lastSpeedCalcOffset = 0;
    let speedSamples: number[] = [];

    const average = (): number | null => {
        if (speedSamples.length === 0) return null;
        return speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
    };

    return {
        update(currentOffset: number): number | null {
            const current = now();
            const elapsed = (current - lastSpeedCalcTime) / 1000;

            if (elapsed > RECALC_INTERVAL_SECONDS) {
                const bytes = currentOffset - lastSpeedCalcOffset;
                const speed = bytes / elapsed;
                if (Number.isFinite(speed) && speed > 0) {
                    speedSamples.push(speed);
                    if (speedSamples.length > SPEED_SAMPLE_COUNT) {
                        speedSamples.shift();
                    }
                }
                lastSpeedCalcTime = current;
                lastSpeedCalcOffset = currentOffset;
            }

            return average();
        },

        getETR(totalSize: number, currentOffset: number): number | null {
            const speed = average();
            if (!speed || speed <= 0) return null;
            return (totalSize - currentOffset) / speed;
        },

        getAverageSpeed: average,

        reset(): void {
            lastSpeedCalcTime = now();
            lastSpeedCalcOffset = 0;
            speedSamples = [];
        },
    };
}

/** Human-readable "time remaining" label, e.g. "~2m 30s" or "Almost done...". */
export function formatTimeRemaining(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    if (seconds < 5) return "Almost done...";
    if (seconds < 60) return `~${Math.round(seconds)}s`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `~${hours}h ${mins}m` : `~${hours}h`;
}
