import * as db from "./dbClient";
import { emit } from "./gossamer";
import { deleteExpiredRooms } from "./roomStore";

let roomCleanupInterval: NodeJS.Timeout | undefined;

export async function runRoomCleanup(): Promise<void> {
    if (!db.isDatabaseInitialized()) {
        emit("room_cleanup:skipped", {
            reason: "DB not initialized",
        });
        return;
    }

    try {
        const deletedCount = await deleteExpiredRooms();
        emit("room_cleanup:complete", {
            deletedCount,
        });
    } catch (error) {
        const err = error as Error;
        emit("room_cleanup:error", {
            error: err.message,
            stack: err.stack,
        });
    }
}

export function startRoomCleanupService(intervalMinutes: number = 5): void {
    if (!db.isDatabaseInitialized()) {
        emit("room_cleanup:skipped", {
            reason: "Cleanup service disabled (DB not initialised/disabled).",
        });
        return;
    }

    emit("system:startup", {
        service: "Room Cleanup Service",
        interval: intervalMinutes,
    });

    void runRoomCleanup();
    roomCleanupInterval = setInterval(() => {
        void runRoomCleanup();
    }, intervalMinutes * 60 * 1000);
}

export function stopRoomCleanupService(): void {
    if (roomCleanupInterval) {
        clearInterval(roomCleanupInterval);
        roomCleanupInterval = undefined;
    }
}
