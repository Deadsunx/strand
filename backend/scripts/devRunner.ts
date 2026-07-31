import pc from "picocolors";
import { waitForDatabase } from "./dbTools";

const DEFAULT_SERVER_ARGS = [
    "--allow-local-port=5173",
    "--allow-local-port=4173",
];
const HOTKEY_FOOTER =
    `${pc.dim("[dev] Hotkeys:")} ${pc.cyan("h")} ${pc.dim("= reload server only,")} ${pc.yellow("r")} ${pc.dim("= full restart (db reset + migrate),")} ${pc.red("q")} ${pc.dim("= quit")}`;

type SpawnedProcess = ReturnType<typeof Bun.spawn>;
type RestartMode = "hot-reload" | "full-restart";

const projectRoot = process.cwd();
const serverArgs = [...DEFAULT_SERVER_ARGS, ...process.argv.slice(2)];

let serverProcess: SpawnedProcess | undefined;
let commandProcess: SpawnedProcess | undefined;
let isRestarting = false;
let isShuttingDown = false;
let hotkeysEnabled = false;
let footerVisible = false;
let dockerStarted = false;

function formatTag(colorize: (text: string) => string): string {
    return colorize("[dev]");
}

function log(message: string): void {
    writeLine(process.stdout, `${formatTag(pc.cyan)} ${message}`);
}

function logSuccess(message: string): void {
    writeLine(process.stdout, `${formatTag(pc.green)} ${message}`);
}

function logWarning(message: string): void {
    writeLine(process.stdout, `${formatTag(pc.yellow)} ${message}`);
}

function logError(message: string): void {
    writeLine(process.stderr, `${formatTag(pc.red)} ${message}`);
}

function hideFooter(): void {
    if (!footerVisible) {
        return;
    }

    process.stdout.write("\r\x1b[2K");
    footerVisible = false;
}

function showFooter(): void {
    if (!hotkeysEnabled || isShuttingDown || footerVisible) {
        return;
    }

    process.stdout.write(`\r\x1b[2K${HOTKEY_FOOTER}`);
    footerVisible = true;
}

function writeLine(target: NodeJS.WriteStream, message: string): void {
    hideFooter();
    target.write(message.endsWith("\n") ? message : `${message}\n`);
    showFooter();
}

function pipeOutput(
    stream: ReadableStream<Uint8Array> | null | undefined,
    target: NodeJS.WriteStream
): void {
    if (!stream) {
        return;
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const flush = (force: boolean): void => {
        const lastNewline = Math.max(buffer.lastIndexOf("\n"), buffer.lastIndexOf("\r"));
        if (!force && lastNewline < 0) {
            return;
        }

        let text = force ? buffer : buffer.slice(0, lastNewline + 1);
        buffer = force ? "" : buffer.slice(lastNewline + 1);

        if (!text) {
            return;
        }

        if (force && !text.endsWith("\n") && !text.endsWith("\r")) {
            text += "\n";
        }

        hideFooter();
        target.write(text);
        showFooter();
    };

    const pump = async (): Promise<void> => {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                buffer += decoder.decode();
                flush(true);
                return;
            }

            buffer += decoder.decode(value, { stream: true });
            flush(false);
        }
    };

    void pump();
}

function attachOutput(proc: SpawnedProcess): void {
    if (typeof proc.stdout !== "number") {
        pipeOutput(proc.stdout, process.stdout);
    }

    if (typeof proc.stderr !== "number") {
        pipeOutput(proc.stderr, process.stderr);
    }
}

async function runCommand(label: string, cmd: string[]): Promise<void> {
    log(label);

    const proc = Bun.spawn({
        cmd,
        cwd: projectRoot,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    commandProcess = proc;
    attachOutput(proc);

    try {
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
            throw new Error(`${cmd.join(" ")} exited with code ${exitCode}`);
        }
    } finally {
        if (commandProcess === proc) {
            commandProcess = undefined;
        }
    }
}

async function runFullBootstrap(): Promise<void> {
    await runCommand("Ensuring local Postgres is running...", ["bun", "run", "db:up"]);
    dockerStarted = true;

    log("Waiting for Postgres to be ready...");
    await waitForDatabase();

    await runCommand("Resetting local database schema...", [
        "bun",
        "run",
        "db:reset",
    ]);
    await runCommand("Applying migrations...", ["bun", "run", "migrate"]);
}

function attachServerExitHandler(proc: SpawnedProcess): void {
    void proc.exited.then((exitCode) => {
        if (serverProcess !== proc) {
            return;
        }

        serverProcess = undefined;

        if (isShuttingDown || isRestarting) {
            return;
        }

        log(
            `Server exited with code ${exitCode}. Press h to start it again or r for a full reset.`
        );
    });
}

async function startServer(): Promise<void> {
    log(`Starting server with ${pc.bold(serverArgs.join(" "))}...`);

    const proc = Bun.spawn({
        cmd: ["bun", "server.ts", ...serverArgs],
        cwd: projectRoot,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });

    serverProcess = proc;
    attachOutput(proc);
    attachServerExitHandler(proc);
}

async function stopServer(reason: string): Promise<void> {
    if (!serverProcess) {
        return;
    }

    const proc = serverProcess;
    serverProcess = undefined;

    log(`Stopping server (${reason})...`);
    proc.kill();
    await proc.exited;
}

async function stopCommand(reason: string): Promise<void> {
    if (!commandProcess) {
        return;
    }

    const proc = commandProcess;
    commandProcess = undefined;

    logWarning(`Stopping active command (${reason})...`);
    proc.kill();
    await proc.exited;
}

async function shutdownDatabase(): Promise<void> {
    if (!dockerStarted) {
        return;
    }

    try {
        await runCommand("Stopping local Postgres...", ["bun", "run", "db:down"]);
        logSuccess("Local Postgres stopped.");
    } catch (error) {
        const err = error as Error;
        logError(`Failed to stop local Postgres: ${err.message}`);
    } finally {
        dockerStarted = false;
    }
}

async function restart(mode: RestartMode): Promise<void> {
    if (isRestarting || isShuttingDown) {
        return;
    }

    isRestarting = true;

    try {
        await stopServer(mode);

        if (mode === "full-restart") {
            await runFullBootstrap();
        }

        await startServer();
        showFooter();
    } catch (error) {
        const err = error as Error;
        logError(`Restart failed: ${err.message}`);
    } finally {
        isRestarting = false;
    }
}

async function shutdown(exitCode: number): Promise<void> {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    restoreInput();

    try {
        await stopCommand("shutdown");
        await stopServer("shutdown");
        await shutdownDatabase();
    } finally {
        hideFooter();
        process.exit(exitCode);
    }
}

function restoreInput(): void {
    if (!hotkeysEnabled || !process.stdin.isTTY) {
        return;
    }

    hideFooter();
    process.stdin.setRawMode(false);
    process.stdin.pause();
}

function setupHotkeys(): void {
    if (!process.stdin.isTTY) {
        logWarning("TTY not detected; hotkeys are disabled.");
        return;
    }

    hotkeysEnabled = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (chunk: Buffer) => {
        const key = chunk.toString("utf8").toLowerCase();

        if (key === "\u0003") {
            void shutdown(0);
            return;
        }

        if (key === "h") {
            void restart("hot-reload");
            return;
        }

        if (key === "r") {
            void restart("full-restart");
            return;
        }

        if (key === "q") {
            void shutdown(0);
        }
    });
}

async function main(): Promise<void> {
    setupHotkeys();

    process.on("SIGINT", () => {
        void shutdown(0);
    });
    process.on("SIGTERM", () => {
        void shutdown(0);
    });
    process.on("exit", () => {
        restoreInput();
    });

    await runFullBootstrap();
    await startServer();
    showFooter();
}

main().catch((error: Error) => {
    restoreInput();
    logError(error.message);
    process.exit(1);
});
