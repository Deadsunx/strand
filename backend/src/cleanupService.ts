// --- src/cleanupService.ts ---

import { UTApi } from "uploadthing/server";
import * as db from "./dbClient";
import config from "./config";
import { emit } from "./gossamer";

// We initialize UTApi here.
const utapi = new UTApi();

interface FileRecord {
    file_key: string;
}

export async function runCleanup(): Promise<void> {
    // If the database is not initialized, we can't do anything.
    if (!db.isDatabaseInitialized()) {
        emit("cleanup:skipped", {
            reason: "DB not initialized",
        });
        return;
    }

    try {
        const cutOffDate = new Date(Date.now() - config.PREVIEW_RETENTION_MS);

        // 1. Find old file keys in OUR database
        const selectQuery = `SELECT file_key FROM uploaded_files WHERE uploaded_at <= $1`;
        const { rows: filesToDelete } = await db.query<FileRecord>(selectQuery, [
            cutOffDate,
        ]);

        if (filesToDelete.length === 0) {
            emit("cleanup:complete", {
                count: 0,
                message: "No files to clean",
            });
            return;
        }

        const fileKeys = filesToDelete.map((file: FileRecord) => file.file_key);
        emit("cleanup:start", {
            count: fileKeys.length,
            keys: fileKeys,
        });

        // 2. Delete the files from UploadThing
        const deleteResult = await utapi.deleteFiles(fileKeys);

        if (!deleteResult.success) {
            emit("cleanup:error", {
                context: "UploadThing Deletion Failed",
                result: deleteResult,
            });
            return;
        }

        // 3. Delete the records from OUR database
        const deleteQuery = `DELETE FROM uploaded_files WHERE file_key = ANY($1::text[])`;
        const deleteDbResult = await db.query(deleteQuery, [fileKeys]);

        emit("cleanup:complete", {
            deletedCount: deleteDbResult.rowCount,
        });
    } catch (error) {
        const err = error as Error;
        emit("cleanup:error", {
            error: err.message,
            stack: err.stack,
        });
    }
}

export function startCleanupService(
    intervalMinutes: number = config.PREVIEW_CLEANUP_INTERVAL_MINUTES
): void {
    if (!db.isDatabaseInitialized()) {
        emit("cleanup:skipped", {
            reason: "Cleanup service disabled (DB not initialised/disabled).",
        });
        return;
    }

    // We log/emit that the schedule is active
    emit("system:startup", {
        service: "Cleanup Service",
        interval: intervalMinutes,
    });

    runCleanup();
    setInterval(runCleanup, intervalMinutes * 60 * 1000);
}
