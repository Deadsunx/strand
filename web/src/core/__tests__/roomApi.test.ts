import { describe, it, expect, vi } from "vitest";
import { RoomApi } from "../roomApi.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => body,
    };
}

describe("RoomApi", () => {
    it("POSTs to /api/rooms with the name and returns the summary", async () => {
        const summary = { roomCode: "ABC123", status: "waiting" };
        const fetchImpl = vi.fn(
            async (_url: string, _init?: RequestInit) => jsonResponse(summary)
        );
        const api = new RoomApi({ baseUrl: "https://api.test/", fetch: fetchImpl });

        const result = await api.createRoom("Alice");

        expect(result).toEqual(summary);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe("https://api.test/api/rooms"); // trailing slash trimmed
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string)).toEqual({ name: "Alice" });
        expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
            "application/json"
        );
    });

    it("URL-encodes the room code and participant id when polling status", async () => {
        const fetchImpl = vi.fn(
            async (_url: string, _init?: RequestInit) =>
                jsonResponse({ roomCode: "A B" })
        );
        const api = new RoomApi({ baseUrl: "https://api.test", fetch: fetchImpl });
        await api.getRoomStatus("A B", "p/1");
        expect(fetchImpl.mock.calls[0][0]).toBe(
            "https://api.test/api/rooms/A%20B?participantId=p%2F1"
        );
    });

    it("throws with the server-provided error message on non-2xx", async () => {
        const fetchImpl = vi.fn(async () =>
            jsonResponse({ error: "Room already has two participants" }, false, 400)
        );
        const api = new RoomApi({ baseUrl: "https://api.test", fetch: fetchImpl });
        await expect(api.joinRoom("ABC123", "Bob")).rejects.toThrow(
            "Room already has two participants"
        );
    });

    it("falls back to an HTTP status message when no error body is present", async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 503,
            json: async () => {
                throw new Error("no body");
            },
        }));
        const api = new RoomApi({ baseUrl: "https://api.test", fetch: fetchImpl });
        await expect(api.createRoom("Alice")).rejects.toThrow("HTTP 503");
    });
});
