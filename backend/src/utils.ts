import type { Server } from "http";
import config from "./config";
import { getCleanIp, getLocalIpForDisplay, isPrivateIP } from "./networking";

export const getCleanIPv4 = getCleanIp;
export { getLocalIpForDisplay, isPrivateIP };

export function setupGracefulShutdown(
    server: Server,
    closeWsConnectionsCallback?: () => void
): void {
    const shutdown = async (): Promise<void> => {
        const { emit, flush } = await import("./gossamer");

        emit("system:shutdown", { message: "Initiating graceful shutdown..." });

        if (typeof closeWsConnectionsCallback === "function") {
            closeWsConnectionsCallback();
        }

        await flush();

        server.close(() => {
            process.exit(0);
        });

        setTimeout(() => {
            process.exit(1);
        }, config.SHUTDOWN_TIMEOUT);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}
