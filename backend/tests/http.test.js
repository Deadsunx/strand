// --- tests/http.test.js ---
const request = require("supertest");

// Mock Gossamer emit
const mockEmit = jest.fn();
jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

jest.mock("../src/config", () => ({
    __esModule: true,
    default: {
        PORT: 0,
        NODE_ENV: "test",
        ALLOWED_ORIGINS: new Set(["http://localhost"]),
        VERCEL_PREVIEW_ORIGIN_REGEX: /^https:\/\/.*\.vercel\.app$/,
        CLOUDFLARE_TURN_TOKEN_ID: "fake-id",
        CLOUDFLARE_API_TOKEN: "fake-token",
        // Abuse mitigation knobs. TURN limit kept low so the test can trip it.
        TURN_RATE_LIMIT: 3,
        TURN_RATE_WINDOW_MS: 60 * 1000,
        ROOM_CREATE_RATE_LIMIT: 30,
        ROOM_CREATE_RATE_WINDOW_MS: 5 * 60 * 1000,
        TURN_REQUIRE_PARTICIPANT: false,
        STATUS_ACCESS_KEY: "",
    },
}));

jest.mock("../src/uploadthingHandler", () => ({
    handleUploadThingWebRequest: () =>
        Promise.resolve(
            new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        ),
    handleUploadThingRequest: (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
    },
}));

jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: () => false,
    query: jest.fn(),
}));

const { server } = require("../src/httpServer");

describe("HTTP Server Endpoints", () => {
    beforeEach(() => {
        mockEmit.mockClear();
    });

    afterAll((done) => {
        if (server.listening) {
            server.close(done);
        } else {
            done();
        }
    });

    test("GET /api/turn-credentials should emit turn:error on upstream API failure", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: false,
                status: 500,
                text: () => Promise.resolve("Cloudflare Down"),
            }),
        );

        const res = await request(server).get("/api/turn-credentials");
        expect(res.statusCode).toEqual(500);
        expect(res.body).toHaveProperty("error");

        expect(mockEmit).toHaveBeenCalledWith("turn:error", {
            context: "Cloudflare API Error",
            status: 500,
            body: "Cloudflare Down",
        });
    });

    test("GET /api/turn-credentials should emit turn:credentials_issued on success", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({ iceServers: [{ urls: "stun:test" }] }),
            }),
        );

        const res = await request(server).get("/api/turn-credentials");
        expect(res.statusCode).toEqual(200);

        expect(mockEmit).toHaveBeenCalledWith("turn:credentials_issued", {
            clientIp: "127.0.0.1",
        });
    });

    test("GET / should return health check message", async () => {
        const res = await request(server).get("/");
        expect(res.statusCode).toEqual(200);
        expect(res.text).toContain("Server is alive");
    });

    test("GET /stats should return server stats", async () => {
        const res = await request(server).get("/stats");
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty("activeConnections");
        expect(res.body).toHaveProperty("uptime");
    });

    test("GET /unknown should return 404", async () => {
        const res = await request(server).get("/some-unknown-path");
        expect(res.statusCode).toEqual(404);
    });

    test("GET /api/status should omit process memory without an access key", async () => {
        const res = await request(server).get("/api/status");
        expect(res.statusCode).toEqual(200);
        expect(res.body).not.toHaveProperty("memory");
        expect(res.body).toHaveProperty("status", "operational");
    });

    test("GET /api/turn-credentials should rate-limit per IP", async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({ iceServers: [{ urls: "stun:test" }] }),
            }),
        );

        // Limit is 3/window and earlier tests already consumed some budget, so
        // a burst of requests must eventually be rejected with 429.
        let sawLimited = false;
        let limitedRes = null;
        for (let i = 0; i < 6; i++) {
            const res = await request(server).get("/api/turn-credentials");
            if (res.statusCode === 429) {
                sawLimited = true;
                limitedRes = res;
                break;
            }
        }

        expect(sawLimited).toBe(true);
        expect(limitedRes.body).toHaveProperty("error");
        expect(limitedRes.headers).toHaveProperty("retry-after");
        expect(limitedRes.headers).toHaveProperty("ratelimit-limit", "3");
    });

    test("secureHeaders should be present on responses", async () => {
        const res = await request(server).get("/");
        expect(res.headers).toHaveProperty("x-content-type-options", "nosniff");
        expect(res.headers).toHaveProperty("x-frame-options", "DENY");
    });
});
