// Wire protocol definitions — the single source of truth for compatibility with
// the DropSilk backend (DropSilk_Backend/src/validation.ts) and with any older
// client sharing a room. These formats are FROZEN: the rebuilt client must
// interoperate with the unchanged backend, so do not rename fields or message
// `type` values here without a matching backend change.
//
// Two transports carry messages:
//   1. WebSocket signaling  — JSON envelopes with a discriminating `type`.
//   2. WebRTC data channel  — a small hand-rolled framing (see below).

// ---------------------------------------------------------------------------
// 1) WebSocket signaling
// ---------------------------------------------------------------------------

/** Optional channel a socket attaches to a room on. */
export type RoomChannel = "transfer" | "screen-share" | "chat";

/** Messages the client sends to the signaling server. */
export type ClientToServerMessage =
    | {
          type: "register-details";
          name: string;
          /** Opt-in to nearby-device discovery (backend defaults to off). */
          discoverable?: boolean;
          /** Shared discovery PIN; hashed server-side to form a private group. */
          networkToken?: string;
      }
    | { type: "create-flight" }
    | { type: "join-flight"; flightCode: string }
    | { type: "invite-to-flight"; inviteeId: string; flightCode: string }
    | {
          type: "attach-room";
          roomCode: string;
          participantId: string;
          channel?: RoomChannel;
      }
    | { type: "signal"; data: unknown };

/** A peer descriptor as broadcast by the server. */
export interface SignalingPeer {
    id: string;
    name: string;
}

/** A discoverable nearby user. */
export interface NetworkUser {
    id: string;
    name: string;
}

/** Messages the signaling server sends to the client. */
export type ServerToClientMessage =
    | { type: "registered"; id: string }
    | {
          type: "room-attached";
          flightCode: string;
          role: "host" | "guest";
          peer: unknown;
      }
    | {
          type: "peer-joined";
          flightCode: string;
          peer: SignalingPeer;
          connectionType: "lan" | "wan";
      }
    | { type: "peer-left" }
    | { type: "flight-created"; flightCode: string }
    | { type: "flight-invitation"; flightCode: string; fromName: string }
    | { type: "users-on-network-update"; users: NetworkUser[] }
    | { type: "signal"; data: SignalPayload }
    | { type: "error"; message: string };

/** Payload of a `signal` message: either an SDP or an ICE candidate. */
export interface SignalPayload {
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
}

// ---------------------------------------------------------------------------
// 2) WebRTC data-channel framing
// ---------------------------------------------------------------------------
//
// A single file transfer is a sequence of data-channel messages:
//   1. one JSON string: file metadata  {name, type, size}
//   2. N binary messages: the file's chunks, in order
//   3. one string: the literal "EOF"
//
// Interleaved JSON control messages (screen-share / chat wake, stream ended)
// share the string channel and are distinguished by a `type` field whose value
// is one of the control literals below. File metadata also carries a `type`
// field, but it holds the file's MIME type, so control literals MUST be checked
// first (matching the original receiver's ordering).

export const EOF_MARKER = "EOF";

export const CONTROL_TYPES = {
    streamEnded: "stream-ended",
    screenShareRequested: "screen-share-requested",
    chatRequested: "chat-requested",
} as const;

export type ControlType = (typeof CONTROL_TYPES)[keyof typeof CONTROL_TYPES];

const CONTROL_TYPE_VALUES: ReadonlySet<string> = new Set(
    Object.values(CONTROL_TYPES)
);

/** Metadata announcing the file that the following chunks belong to. */
export interface FileMetadata {
    name: string;
    /** MIME type (may be empty string). */
    type: string;
    size: number;
}

export type ControlMessage = { type: ControlType };

// Chat is a new-client extension carried over the file-transfer data channel as
// `{ type: "chat", text }`. It is NOT part of the original wire protocol: older
// clients decode it as (invalid) file metadata and safely ignore it, so this
// never corrupts transfers or interop. New clients render it as a message.
export const CHAT_TYPE = "chat";

/** Result of decoding one raw data-channel message. */
export type DataChannelFrame =
    | { kind: "control"; message: ControlMessage }
    | { kind: "metadata"; metadata: FileMetadata }
    | { kind: "chat"; text: string }
    | { kind: "eof" }
    | { kind: "chunk"; data: ArrayBuffer }
    | { kind: "unknown"; raw: unknown };

/** Serialize file metadata for the data channel. */
export function encodeFileMetadata(meta: FileMetadata): string {
    return JSON.stringify({ name: meta.name, type: meta.type, size: meta.size });
}

/** Serialize a control message for the data channel. */
export function encodeControl(type: ControlType): string {
    return JSON.stringify({ type });
}

/** Serialize a chat message for the data channel (new-client extension). */
export function encodeChat(text: string): string {
    return JSON.stringify({ type: CHAT_TYPE, text });
}

function isControlType(value: unknown): value is ControlType {
    return typeof value === "string" && CONTROL_TYPE_VALUES.has(value);
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
    if (data instanceof ArrayBuffer) return data;
    // Copy the exact view region into a standalone ArrayBuffer.
    return data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
    ) as ArrayBuffer;
}

/**
 * Decode one raw data-channel message into a structured frame.
 *
 * `data` is whatever `RTCDataChannel.onmessage` yields: a string, an
 * ArrayBuffer, or (with some binaryTypes) an ArrayBufferView. Blobs are not
 * expected because the channel uses `binaryType = "arraybuffer"`.
 */
export function decodeDataChannelFrame(
    data: string | ArrayBuffer | ArrayBufferView
): DataChannelFrame {
    if (typeof data === "string") {
        if (data === EOF_MARKER) {
            return { kind: "eof" };
        }

        if (data.startsWith("{")) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(data);
            } catch {
                return { kind: "unknown", raw: data };
            }

            if (parsed && typeof parsed === "object") {
                const obj = parsed as Record<string, unknown>;

                // Control messages first — their `type` is a known literal.
                if (isControlType(obj.type)) {
                    return { kind: "control", message: { type: obj.type } };
                }

                // Chat extension (new clients only).
                if (obj.type === CHAT_TYPE && typeof obj.text === "string") {
                    return { kind: "chat", text: obj.text };
                }

                // Otherwise treat as file metadata if it has the shape.
                if (
                    typeof obj.name === "string" &&
                    typeof obj.size === "number"
                ) {
                    return {
                        kind: "metadata",
                        metadata: {
                            name: obj.name,
                            type: typeof obj.type === "string" ? obj.type : "",
                            size: obj.size,
                        },
                    };
                }
            }

            return { kind: "unknown", raw: parsed };
        }

        return { kind: "unknown", raw: data };
    }

    return { kind: "chunk", data: toArrayBuffer(data) };
}
