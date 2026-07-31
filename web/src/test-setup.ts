// Vitest setup for the Node test environment. Polyfills the couple of browser
// APIs the core touches on completion paths (object URLs) so controller/receiver
// tests can run headless. Real browsers provide these natively.

if (typeof URL.createObjectURL !== "function") {
    let counter = 0;
    // Minimal stand-ins; the tests only assert that a URL string is produced.
    (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL =
        () => `blob:mock/${counter++}`;
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
        () => {};
}
