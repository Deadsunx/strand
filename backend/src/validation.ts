import type { ValidationTargets } from "hono";
import { zValidator as baseZodValidator } from "@hono/zod-validator";
import { z } from "zod";

const MAX_NAME_LENGTH = 50;
const MAX_ID_LENGTH = 64;
const SIX_CHAR_CODE_LENGTH = 6;

export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
export const participantIdSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);
export const roomCodeSchema = z
    .string()
    .trim()
    .length(SIX_CHAR_CODE_LENGTH)
    .transform((value) => value.toUpperCase());
export const flightCodeSchema = roomCodeSchema;

export const roomCodeParamSchema = z.object({
    roomCode: roomCodeSchema,
});

export const roomParticipantParamSchema = z.object({
    roomCode: roomCodeSchema,
    participantId: participantIdSchema,
});

export const roomSummaryQuerySchema = z.object({
    participantId: participantIdSchema,
});

export const createRoomBodySchema = z.object({
    name: nameSchema,
});

export const joinRoomBodySchema = createRoomBodySchema;

export const participantReadyBodySchema = z.object({
    fileCount: z.coerce.number().int().nonnegative().default(0),
    totalBytes: z.coerce.number().nonnegative().default(0),
});

export const participantToggleBodySchema = z.object({
    active: z.boolean(),
});

export const requestEmailBodySchema = z.object({
    token: z.string().trim().min(1),
});

const MAX_NETWORK_TOKEN_LENGTH = 128;

export const registerDetailsMessageSchema = z.object({
    type: z.literal("register-details"),
    name: nameSchema,
    // Opt-in to appearing in the "users on your network" list. Absent/false
    // means this client is never advertised to others (privacy-safe default).
    discoverable: z.boolean().optional(),
    // Optional shared secret ("network PIN"). When two clients present the same
    // token they are grouped together for discovery regardless of IP, and are
    // NOT grouped with strangers who happen to share their public IP (e.g. on
    // carrier-grade NAT). Hashed server-side; never stored in the clear.
    networkToken: z.string().trim().min(1).max(MAX_NETWORK_TOKEN_LENGTH).optional(),
});

export const createFlightMessageSchema = z.object({
    type: z.literal("create-flight"),
});

export const joinFlightMessageSchema = z.object({
    type: z.literal("join-flight"),
    flightCode: flightCodeSchema,
});

export const inviteToFlightMessageSchema = z.object({
    type: z.literal("invite-to-flight"),
    inviteeId: participantIdSchema,
    flightCode: flightCodeSchema,
});

export const signalMessageSchema = z.object({
    type: z.literal("signal"),
    data: z.unknown(),
});

export const attachRoomMessageSchema = z.object({
    type: z.literal("attach-room"),
    roomCode: roomCodeSchema,
    participantId: participantIdSchema,
    channel: z.enum(["transfer", "screen-share", "chat"]).optional(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
    registerDetailsMessageSchema,
    createFlightMessageSchema,
    joinFlightMessageSchema,
    inviteToFlightMessageSchema,
    attachRoomMessageSchema,
    signalMessageSchema,
]);

export type RegisterDetailsMessage = z.infer<typeof registerDetailsMessageSchema>;
export type JoinFlightMessage = z.infer<typeof joinFlightMessageSchema>;
export type InviteToFlightMessage = z.infer<typeof inviteToFlightMessageSchema>;
export type SignalMessage = z.infer<typeof signalMessageSchema>;
export type AttachRoomMessage = z.infer<typeof attachRoomMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function formatValidationIssues(error: {
    issues: Array<{ path: Array<PropertyKey>; message: string }>;
}): string[] {
    return error.issues.map((issue) => {
        const path =
            issue.path.length > 0
                ? issue.path.map((part) => String(part)).join(".")
                : "request";
        return `${path}: ${issue.message}`;
    });
}

export const zValidator = <
    T extends z.ZodSchema,
    Target extends keyof ValidationTargets,
>(
    target: Target,
    schema: T
) =>
    baseZodValidator(target, schema, (result, c) => {
        if (!result.success) {
            return c.json(
                {
                    error: "Invalid request",
                    issues: formatValidationIssues(result.error),
                },
                400
            );
        }
    });
