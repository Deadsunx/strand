import {
    Kysely,
    Selectable,
    Transaction,
    sql,
} from "kysely";
import { Database, RoomsTable, getDb, withTransaction } from "./dbClient";
import config from "./config";
import { generateParticipantId, generateRoomCode } from "./ids";
import { nameSchema } from "./validation";
import { connectionStats } from "./state";

export type RoomParticipantRole = "host" | "guest";
export type RoomStatus = "waiting" | "paired" | "ready";

type RoomRecord = Selectable<RoomsTable>;
type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

export interface RoomParticipantSummary {
    participantId: string;
    role: RoomParticipantRole;
    name: string;
    ready: boolean;
    fileCount: number;
    totalBytes: number;
}

export interface RoomScreenShareSummary {
    activeParticipantId: string | null;
    requestedBySelf: boolean;
    requestedByPeer: boolean;
    isActive: boolean;
}

export interface RoomChatSummary {
    requestedBySelf: boolean;
    requestedByPeer: boolean;
    isActive: boolean;
}

export interface RoomSummary {
    roomCode: string;
    status: RoomStatus;
    shouldConnect: boolean;
    expiresAt: string;
    self: RoomParticipantSummary;
    peer: RoomParticipantSummary | null;
    screenShare: RoomScreenShareSummary;
    chat: RoomChatSummary;
}

function getExpiryDate(now: number = Date.now()): Date {
    return new Date(now + config.ROOM_TTL_MS);
}

function normalizeName(name: string): string {
    return nameSchema.parse(name);
}

function toIso(value: Date | string): string {
    return new Date(value).toISOString();
}

function toNumber(value: number | string | null | undefined): number {
    return Math.max(0, Number(value) || 0);
}

function resolveParticipantRole(
    room: RoomRecord,
    participantId: string
): RoomParticipantRole | null {
    if (room.host_participant_id === participantId) return "host";
    if (room.guest_participant_id === participantId) return "guest";
    return null;
}

function buildParticipantSummary(
    room: RoomRecord,
    role: RoomParticipantRole
): RoomParticipantSummary {
    if (role === "host") {
        return {
            participantId: room.host_participant_id,
            role: "host",
            name: room.host_name,
            ready: room.host_ready,
            fileCount: room.host_file_count,
            totalBytes: toNumber(room.host_total_bytes),
        };
    }

    return {
        participantId: room.guest_participant_id || "",
        role: "guest",
        name: room.guest_name || "Guest",
        ready: room.guest_ready,
        fileCount: room.guest_file_count,
        totalBytes: toNumber(room.guest_total_bytes),
    };
}

function buildSummary(room: RoomRecord, participantId: string): RoomSummary | null {
    const role = resolveParticipantRole(room, participantId);
    if (!role) return null;

    const self = buildParticipantSummary(room, role);
    const peer =
        role === "host"
            ? room.guest_participant_id
                ? buildParticipantSummary(room, "guest")
                : null
            : buildParticipantSummary(room, "host");

    const hasPeer = Boolean(room.guest_participant_id);
    const shouldConnect = hasPeer && (room.host_ready || room.guest_ready);
    const hostScreenShareActive = Boolean(room.host_screen_share_active);
    const guestScreenShareActive = Boolean(room.guest_screen_share_active);
    const hostChatActive = Boolean(room.host_chat_active);
    const guestChatActive = Boolean(room.guest_chat_active);
    const activeParticipantId = hostScreenShareActive
        ? room.host_participant_id
        : guestScreenShareActive
            ? room.guest_participant_id
            : null;
    const status: RoomStatus = !hasPeer
        ? "waiting"
        : shouldConnect
            ? "ready"
            : "paired";

    return {
        roomCode: room.room_code,
        status,
        shouldConnect,
        expiresAt: toIso(room.expires_at),
        self,
        peer,
        screenShare: {
            activeParticipantId,
            requestedBySelf:
                role === "host" ? hostScreenShareActive : guestScreenShareActive,
            requestedByPeer:
                role === "host" ? guestScreenShareActive : hostScreenShareActive,
            isActive: Boolean(activeParticipantId),
        },
        chat: {
            requestedBySelf: role === "host" ? hostChatActive : guestChatActive,
            requestedByPeer: role === "host" ? guestChatActive : hostChatActive,
            isActive: hostChatActive || guestChatActive,
        },
    };
}

async function fetchRoom(
    database: DatabaseExecutor,
    roomCode: string,
    lockForUpdate: boolean = false
): Promise<RoomRecord | null> {
    let query = database
        .selectFrom("rooms")
        .selectAll()
        .where("room_code", "=", roomCode)
        .where("expires_at", ">", sql<Date>`now()`);

    if (lockForUpdate) {
        query = query.forUpdate();
    }

    return (await query.executeTakeFirst()) ?? null;
}

async function extendRoom(
    database: DatabaseExecutor,
    roomCode: string,
    participantId?: string
): Promise<RoomRecord | null> {
    let query = database
        .updateTable("rooms")
        .set({
            updated_at: sql<Date>`now()`,
            expires_at: getExpiryDate(),
        })
        .where("room_code", "=", roomCode)
        .where("expires_at", ">", sql<Date>`now()`);

    if (participantId) {
        query = query.where((eb) =>
            eb.or([
                eb("host_participant_id", "=", participantId),
                eb("guest_participant_id", "=", participantId),
            ])
        );
    }

    return (await query.returningAll().executeTakeFirst()) ?? null;
}

export async function createRoom(hostName: string): Promise<RoomSummary> {
    const normalizedHostName = normalizeName(hostName);

    for (let attempt = 0; attempt < 10; attempt++) {
        const roomCode = generateRoomCode();
        const hostParticipantId = generateParticipantId();
        const now = new Date();
        const expiresAt = getExpiryDate(now.getTime());

        try {
            const room = await getDb()
                .insertInto("rooms")
                .values({
                    room_code: roomCode,
                    host_participant_id: hostParticipantId,
                    host_name: normalizedHostName,
                    guest_participant_id: null,
                    guest_name: null,
                    host_screen_share_active: false,
                    guest_screen_share_active: false,
                    host_chat_active: false,
                    guest_chat_active: false,
                    host_ready: false,
                    guest_ready: false,
                    host_file_count: 0,
                    guest_file_count: 0,
                    host_total_bytes: 0,
                    guest_total_bytes: 0,
                    created_at: now,
                    updated_at: now,
                    expires_at: expiresAt,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const summary = buildSummary(room, hostParticipantId);
            if (!summary) {
                throw new Error("Failed to create room");
            }
            // Track room-first (REST) creations so /api/status reflects real usage.
            // The legacy WebSocket create-flight path increments this separately.
            connectionStats.totalFlightsCreated++;
            return summary;
        } catch (error) {
            const err = error as { code?: string };
            if (err.code === "23505") {
                continue;
            }
            throw error;
        }
    }

    throw new Error("Failed to allocate unique room code");
}

export async function joinRoom(roomCode: string, guestName: string): Promise<RoomSummary> {
    const normalizedCode = roomCode.toUpperCase();
    const normalizedGuestName = normalizeName(guestName);

    return withTransaction(async (trx) => {
        const room = await fetchRoom(trx, normalizedCode, true);

        if (!room) {
            throw new Error("Room not found or expired");
        }
        if (room.guest_participant_id) {
            throw new Error("Room already has two participants");
        }

        const guestParticipantId = generateParticipantId();
        const updatedRoom = await trx
            .updateTable("rooms")
            .set({
                guest_participant_id: guestParticipantId,
                guest_name: normalizedGuestName,
                updated_at: sql<Date>`now()`,
                expires_at: getExpiryDate(),
            })
            .where("room_code", "=", normalizedCode)
            .returningAll()
            .executeTakeFirstOrThrow();

        const summary = buildSummary(updatedRoom, guestParticipantId);
        if (!summary) {
            throw new Error("Failed to join room");
        }
        // Track room-first (REST) joins so /api/status reflects real usage.
        connectionStats.totalFlightsJoined++;
        return summary;
    });
}

export async function getRoomSummary(
    roomCode: string,
    participantId: string
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();
    const extendedRoom = await extendRoom(getDb(), normalizedCode, participantId);
    return extendedRoom ? buildSummary(extendedRoom, participantId) : null;
}

export function touchParticipant(
    roomCode: string,
    participantId: string
): Promise<RoomSummary | null> {
    return getRoomSummary(roomCode, participantId);
}

export async function markParticipantReady(
    roomCode: string,
    participantId: string,
    payload: { fileCount?: number; totalBytes?: number } = {}
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();

    return withTransaction(async (trx) => {
        const room = await fetchRoom(trx, normalizedCode, true);
        if (!room) return null;

        const baseUpdate = {
            updated_at: sql<Date>`now()`,
            expires_at: getExpiryDate(),
        };

        let updatedRoom: RoomRecord | undefined;
        if (room.host_participant_id === participantId) {
            updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    ...baseUpdate,
                    host_ready: true,
                    host_file_count: toNumber(payload.fileCount),
                    host_total_bytes: toNumber(payload.totalBytes),
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirst();
        } else if (room.guest_participant_id === participantId) {
            updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    ...baseUpdate,
                    guest_ready: true,
                    guest_file_count: toNumber(payload.fileCount),
                    guest_total_bytes: toNumber(payload.totalBytes),
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirst();
        } else {
            return null;
        }

        return updatedRoom ? buildSummary(updatedRoom, participantId) : null;
    });
}

export async function setParticipantScreenShare(
    roomCode: string,
    participantId: string,
    active: boolean
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();
    const normalizedActive = Boolean(active);

    return withTransaction(async (trx) => {
        const room = await fetchRoom(trx, normalizedCode, true);
        if (!room) return null;

        const baseUpdate = {
            updated_at: sql<Date>`now()`,
            expires_at: getExpiryDate(),
        };

        let updatedRoom: RoomRecord | undefined;
        if (room.host_participant_id === participantId) {
            if (normalizedActive && room.guest_screen_share_active) {
                throw new Error("Peer is already screen sharing");
            }
            updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    ...baseUpdate,
                    host_screen_share_active: normalizedActive,
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirst();
        } else if (room.guest_participant_id === participantId) {
            if (normalizedActive && room.host_screen_share_active) {
                throw new Error("Peer is already screen sharing");
            }
            updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    ...baseUpdate,
                    guest_screen_share_active: normalizedActive,
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirst();
        } else {
            return null;
        }

        return updatedRoom ? buildSummary(updatedRoom, participantId) : null;
    });
}

export async function setParticipantChatActive(
    roomCode: string,
    participantId: string,
    active: boolean
): Promise<RoomSummary | null> {
    const normalizedCode = roomCode.toUpperCase();
    const normalizedActive = Boolean(active);

    return withTransaction(async (trx) => {
        const room = await fetchRoom(trx, normalizedCode, true);
        if (!room) return null;

        const baseUpdate = {
            updated_at: sql<Date>`now()`,
            expires_at: getExpiryDate(),
        };

        let updatedRoom: RoomRecord | undefined;
        if (room.host_participant_id === participantId) {
            updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    ...baseUpdate,
                    host_chat_active: normalizedActive,
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirst();
        } else if (room.guest_participant_id === participantId) {
            updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    ...baseUpdate,
                    guest_chat_active: normalizedActive,
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirst();
        } else {
            return null;
        }

        return updatedRoom ? buildSummary(updatedRoom, participantId) : null;
    });
}

export async function removeParticipantFromRoom(
    roomCode: string,
    participantId: string
): Promise<{
    removed: boolean;
    remainingParticipantId: string | null;
}> {
    const normalizedCode = roomCode.toUpperCase();

    return withTransaction(async (trx) => {
        const room = await fetchRoom(trx, normalizedCode, true);
        if (!room) {
            return { removed: false, remainingParticipantId: null };
        }

        if (room.guest_participant_id === participantId) {
            const updatedRoom = await trx
                .updateTable("rooms")
                .set({
                    guest_participant_id: null,
                    guest_name: null,
                    host_screen_share_active: false,
                    guest_screen_share_active: false,
                    host_chat_active: false,
                    guest_chat_active: false,
                    guest_ready: false,
                    guest_file_count: 0,
                    guest_total_bytes: 0,
                    updated_at: sql<Date>`now()`,
                    expires_at: getExpiryDate(),
                })
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirstOrThrow();

            return {
                removed: true,
                remainingParticipantId: updatedRoom.host_participant_id,
            };
        }

        if (room.host_participant_id === participantId) {
            if (!room.guest_participant_id) {
                await trx
                    .deleteFrom("rooms")
                    .where("room_code", "=", normalizedCode)
                    .execute();
                return { removed: true, remainingParticipantId: null };
            }

            const updatedRoom = await trx
                .updateTable("rooms")
                .set((eb) => ({
                    host_participant_id: sql<string>`${eb.ref("guest_participant_id")}`,
                    host_name: sql<string>`coalesce(${eb.ref("guest_name")}, ${eb.ref("host_name")})`,
                    host_screen_share_active: false,
                    host_chat_active: false,
                    host_ready: sql<boolean>`${eb.ref("guest_ready")}`,
                    host_file_count: sql<number>`${eb.ref("guest_file_count")}`,
                    host_total_bytes: sql<number>`${eb.ref("guest_total_bytes")}`,
                    guest_participant_id: null,
                    guest_name: null,
                    guest_screen_share_active: false,
                    guest_chat_active: false,
                    guest_ready: false,
                    guest_file_count: 0,
                    guest_total_bytes: 0,
                    updated_at: sql<Date>`now()`,
                    expires_at: getExpiryDate(),
                }))
                .where("room_code", "=", normalizedCode)
                .returningAll()
                .executeTakeFirstOrThrow();

            return {
                removed: true,
                remainingParticipantId: updatedRoom.host_participant_id,
            };
        }

        return { removed: false, remainingParticipantId: null };
    });
}

export async function resolveRoomParticipant(
    roomCode: string,
    participantId: string
): Promise<{
    roomCode: string;
    self: RoomParticipantSummary;
    peer: RoomParticipantSummary | null;
} | null> {
    const summary = await getRoomSummary(roomCode, participantId);
    if (!summary) return null;
    return {
        roomCode: summary.roomCode,
        self: summary.self,
        peer: summary.peer,
    };
}

export async function deleteExpiredRooms(): Promise<number> {
    const result = await getDb()
        .deleteFrom("rooms")
        .where("expires_at", "<=", sql<Date>`now()`)
        .executeTakeFirst();

    return Number(result.numDeletedRows || 0);
}
