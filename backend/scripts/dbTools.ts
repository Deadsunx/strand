import path from "path";
import { Client, type ClientConfig } from "pg";

function resolveSsl(connectionString: string): false | { rejectUnauthorized: false } {
    const explicitPreference = String(process.env.DATABASE_SSL || "").toLowerCase();
    if (["0", "false", "disable", "off"].includes(explicitPreference)) {
        return false;
    }
    if (["1", "true", "require", "on"].includes(explicitPreference)) {
        return { rejectUnauthorized: false };
    }

    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get("sslmode");
    if (sslMode === "disable") {
        return false;
    }

    if (["localhost", "127.0.0.1"].includes(parsed.hostname.toLowerCase())) {
        return false;
    }

    return { rejectUnauthorized: false };
}

export function getDatabaseConfig(): ClientConfig {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required.");
    }

    return {
        connectionString,
        ssl: resolveSsl(connectionString),
    };
}

export function getMigrationsDirectory(): string {
    return path.join(process.cwd(), "migrations");
}

export function getMigrationDatabaseConfig(): {
    user: string;
    password: string;
    host: string;
    port: number;
    database: string;
} {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required.");
    }

    const parsed = new URL(connectionString);
    const database = parsed.pathname.replace(/^\//, "");

    return {
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        host: parsed.hostname,
        port: Number(parsed.port || 5432),
        database,
    };
}

export async function withClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client(getDatabaseConfig());
    await client.connect();

    try {
        return await callback(client);
    } finally {
        await client.end();
    }
}

export function assertLocalDatabaseUrl(): void {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required.");
    }

    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (!isLocalHost && process.env.ALLOW_REMOTE_DB_RESET !== "true") {
        throw new Error(
            "Refusing to reset a non-local database. Set ALLOW_REMOTE_DB_RESET=true to override."
        );
    }
}

export async function waitForDatabase(maxAttempts = 30, intervalMs = 1000): Promise<void> {
    const config = getDatabaseConfig();
    let attempts = 0;

    while (attempts < maxAttempts) {
        const client = new Client(config);
        try {
            await client.connect();
            await client.query("SELECT 1");
            await client.end();
            return;
        } catch (error) {
            attempts++;
            await client.end().catch(() => {});
            if (attempts >= maxAttempts) {
                throw new Error(`Database not ready after ${maxAttempts} attempts: ${(error as Error).message}`);
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }
}
