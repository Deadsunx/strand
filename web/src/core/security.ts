// Client-side heuristic for flagging received files that are executables/scripts
// so the UI can warn and refuse to auto-download them. Ported verbatim from the
// original src/js/utils/security.js. This is defense-in-depth UX, not a
// sandbox — the peer is trusted only as much as the user trusts them.

const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
    // Windows
    "exe", "msi", "com", "bat", "cmd", "vbs", "ps1",
    // macOS
    "dmg", "pkg", "app",
    // Linux
    "sh", "bin", "run", "appimage", "deb", "rpm",
    // Android
    "apk",
    // Java
    "jar",
    // Scripts
    "js", "jsx", "vbe", "wsf", "wsc",
]);

export function isExecutable(filename: string | null | undefined): boolean {
    if (!filename) return false;
    const parts = filename.trim().toLowerCase().split(".");
    if (parts.length < 2) return false;
    const ext = parts.pop() as string;
    return EXECUTABLE_EXTENSIONS.has(ext);
}
