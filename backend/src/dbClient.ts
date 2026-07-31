import {
    ColumnType,
    Generated,
    Kysely,
    PostgresDialect,
    Transaction,
} from "kysely";
import { Pool, QueryResult, QueryResultRow } from "pg";

export interface UploadedFilesTable {
    id: Generated<number>;
    file_key: string;
    file_url: string;
    file_name: string;
    uploaded_at: ColumnType<Date, never, never>;
}

export interface RoomsTable {
    room_code: string;
    host_participant_id: string;
    host_name: string;
    guest_participant_id: string | null;
    guest_name: string | null;
    host_screen_share_active: boolean;
    guest_screen_share_active: boolean;
    host_chat_active: boolean;
    guest_chat_active: boolean;
    host_ready: boolean;
    guest_ready: boolean;
    host_file_count: number;
    guest_file_count: number;
    host_total_bytes: ColumnType<number | string, number, number>;
    guest_total_bytes: ColumnType<number | string, number, number>;
    created_at: ColumnType<Date, Date, never>;
    updated_at: ColumnType<Date, Date, Date>;
    expires_at: ColumnType<Date, Date, Date>;
}

export interface Database {
    rooms: RoomsTable;
    uploaded_files: UploadedFilesTable;
}

type DatabaseTransaction = Transaction<Database>;

let pool: Pool | undefined;
let db: Kysely<Database> | undefined;
let dbInitialized = false;

function shouldUseSsl(connectionString: string): false | { rejectUnauthorized: false } {
    const explicitPreference = String(process.env.DATABASE_SSL || "").toLowerCase();
    if (["0", "false", "disable", "off"].includes(explicitPreference)) {
        return false;
    }
    if (["1", "true", "require", "on"].includes(explicitPreference)) {
        return { rejectUnauthorized: false };
    }

    try {
        const parsed = new URL(connectionString);
        const sslMode = parsed.searchParams.get("sslmode");
        if (sslMode === "disable") {
            return false;
        }

        const host = parsed.hostname.toLowerCase();
        if (["localhost", "127.0.0.1"].includes(host)) {
            return false;
        }
    } catch {
        // Fall back to SSL for hosted database providers.
    }

    return { rejectUnauthorized: false };
}

const earlyLog = (
    level: string,
    message: string,
    meta: Record<string, unknown> = {}
): void => {
    console.log(JSON.stringify({ level: level.toUpperCase(), message, ...meta }));
};

if (process.env.DATABASE_URL) {
    try {
        const connectionString = process.env.DATABASE_URL;
        pool = new Pool({
            connectionString,
            ssl: shouldUseSsl(connectionString),
        });
        db = new Kysely<Database>({
            dialect: new PostgresDialect({ pool }),
        });
        earlyLog("info", "Database pool and Kysely client created successfully.");
        dbInitialized = true;
    } catch (error) {
        const err = error as Error;
        earlyLog("error", "Failed to initialize database clients", {
            error: err.message,
        });
        process.exit(1);
    }
} else {
    earlyLog("error", "DATABASE_URL is required.");
    process.exit(1);
}

function getPool(): Pool {
    if (!pool) {
        throw new Error("Database is not available.");
    }
    return pool;
}

export function getDb(): Kysely<Database> {
    if (!db) {
        throw new Error("Database is not available.");
    }
    return db;
}

export async function initializeDatabase(): Promise<void> {
    const { emit } = await import("./gossamer");

    if (!dbInitialized) {
        throw new Error("Database failed to initialize.");
    }

    try {
        const schemaCheck = await getPool().query<{
            rooms_exists: string | null;
            uploaded_files_exists: string | null;
        }>(`
            SELECT
                to_regclass('public.rooms')::text AS rooms_exists,
                to_regclass('public.uploaded_files')::text AS uploaded_files_exists
        `);

        const schemaStatus = schemaCheck.rows[0];
        if (!schemaStatus?.rooms_exists || !schemaStatus?.uploaded_files_exists) {
            throw new Error(
                "Database schema is missing required tables. Run migrations before starting the app."
            );
        }

        emit("system:startup", { service: "Database", status: "ready" });
    } catch (err) {
        const error = err as Error;
        emit("system:error", { service: "Database", error: error.stack });
        process.exit(1);
    }
}

export function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
): Promise<QueryResult<T>> {
    return getPool().query<T>(text, params);
}

export async function withTransaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>
): Promise<T> {
    return getDb().transaction().execute(callback);
}

export function isDatabaseInitialized(): boolean {
    return dbInitialized;
}
