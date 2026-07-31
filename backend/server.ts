// --- server.ts (Root Directory) ---

import "dotenv/config";

// Imports point to ./src/ because this file is in the root
import { server, startServer } from "./src/httpServer";
import { initializeSignaling, closeConnections } from "./src/signalingService";
import { setupGracefulShutdown } from "./src/utils";
import { initializeDatabase } from "./src/dbClient";
import * as state from "./src/state";
import { startCleanupService } from "./src/cleanupService";
import { startRoomCleanupService, stopRoomCleanupService } from "./src/roomCleanupService";
import config from "./src/config";

// --- GOSSAMER TELEMETRY ---
import { initGossamer, emit } from "./src/gossamer";

async function startApp(): Promise<void> {
    // 1. Initialize Gossamer Telemetry FIRST
    // This ensures that when other services start up, the listeners are ready.
    await initGossamer();

    // 2. Conditionally initialize the database
    await initializeDatabase();

    // 3. Initialize the WebSocket signaling service
    initializeSignaling(server);

    // 4. Start the HTTP server
    startServer();

    // 5. Set up graceful shutdown
    setupGracefulShutdown(server, () => {
        stopRoomCleanupService();
        closeConnections();
    });

    // 6. Start the server heartbeat
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const stats = {
            activeConnections: state.clients.size,
            activeFlights: Object.keys(state.flights).length,
            uptimeSeconds: Math.floor(process.uptime()),
            memoryRssMb: Math.round(memoryUsage.rss / 1024 / 1024),
            memoryHeapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            memoryHeapUsedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        };

        // Emit heartbeat event
        emit("system:heartbeat", stats);
    }, config.HEARTBEAT_INTERVAL_MS);

    // 7. Start the cleanup service
    startCleanupService(config.PREVIEW_CLEANUP_INTERVAL_MINUTES);
    startRoomCleanupService(config.ROOM_CLEANUP_INTERVAL_MINUTES);
}

startApp().catch((error: Error) => {
    // Failsafe logging
    console.error(
        JSON.stringify({
            level: "ERROR",
            message: "Failed to start application",
            error: error.message,
            stack: error.stack,
        })
    );
    process.exit(1);
});
