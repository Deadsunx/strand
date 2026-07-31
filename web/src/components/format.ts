export function formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(
        units.length - 1,
        Math.floor(Math.log(bytes) / Math.log(1024))
    );
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec <= 0) return "0 KB/s";
    return `${formatBytes(bytesPerSec)}/s`;
}

export function percent(part: number, whole: number): number {
    if (whole <= 0) return 0;
    return Math.min(100, Math.round((part / whole) * 100));
}
