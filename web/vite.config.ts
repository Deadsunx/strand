/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    test: {
        // The headless core is environment-agnostic; its tests run under Node.
        // Node 18+ provides Blob, WebSocket-less code paths, etc. UI tests added
        // in M3 will opt into jsdom per-file via a `// @vitest-environment jsdom`
        // pragma or a separate project.
        environment: "node",
        globals: true,
        setupFiles: ["./src/test-setup.ts"],
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
});
