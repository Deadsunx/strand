// --- tests/uploadthing.test.js ---
// Polyfills
if (!global.Request) { global.Request = class Request { constructor(url, options) { this.url = url; this.method = options.method || 'GET'; this.headers = options.headers || new Headers(); this.body = options.body; } async arrayBuffer() { return Buffer.from(''); } }; }
if (!global.Response) { global.Response = class Response { constructor(body, options) { this.status = options.status || 200; this.headers = new Headers(options.headers); this._body = body; } async arrayBuffer() { return Buffer.from(this._body || ''); } }; }
if (!global.Headers) { global.Headers = class Headers { constructor(init) { this.map = new Map(); if (init && typeof init === 'object') { Object.entries(init).forEach(([k, v]) => this.append(k, v)); } } append(k, v) { this.map.set(k.toLowerCase(), v); } set(k, v) { this.map.set(k.toLowerCase(), v); } get(k) { return this.map.get(k.toLowerCase()); } forEach(cb) { this.map.forEach((v, k) => cb(v, k, this)); } [Symbol.iterator]() { return this.map.entries(); } }; }

// FIX: Define the callback variable BEFORE jest.mock is called.
let onUploadCompleteCallback;

const mockHandler = jest.fn(
    (req) => new Response(JSON.stringify({ success: true }), { status: 200 }),
);

jest.mock("uploadthing/server", () => ({
    createUploadthing: () => () => ({
        middleware: () => ({
            onUploadComplete: (cb) => {
                onUploadCompleteCallback = cb;
                return {};
            },
        }),
    }),
    createRouteHandler: () => mockHandler,
}));

// Mock the Gossamer emit
const mockEmit = jest.fn();
jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

jest.mock("../src/config", () => ({
    __esModule: true,
    default: {
        UPLOADTHING_TOKEN: "sk_live_mock_token_12345",
        PORT: 3000,
    },
}));
jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: jest.fn(() => true),
    query: jest.fn(),
}));

// And finally, require the modules
const { handleUploadThingWebRequest } = require("../src/uploadthingHandler");

describe("UploadThing Handler", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset the modules to ensure the memoized handler is cleared
        jest.resetModules();
        // Since modules are reset, we must re-require our file under test
        // This is a bit heavy, but guarantees a clean state for the handler
        const { handleUploadThingWebRequest: newHandler } = require('../src/uploadthingHandler');
        onUploadCompleteCallback = null;
    });

    test("onUploadComplete should emit upload:success and upload:db_saved", async () => {
        // We need to re-require here because of jest.resetModules
        const { handleUploadThingWebRequest } = require('../src/uploadthingHandler');
        const { emit } = require("../src/gossamer");

        const req = new Request("http://localhost:3000/api/uploadthing", {
            method: "GET",
        });
        await handleUploadThingWebRequest(req);

        expect(onUploadCompleteCallback).toBeInstanceOf(Function);

        const fileData = {
            file: {
                key: "123-abc",
                ufsUrl: "https://utfs.io/f/123-abc",
                name: "test.pptx",
            },
        };
        await onUploadCompleteCallback(fileData);

        expect(emit).toHaveBeenCalledWith("upload:success", {
            key: "123-abc",
            url: "https://utfs.io/f/123-abc",
        });
        expect(emit).toHaveBeenCalledWith("upload:db_saved", {
            key: "123-abc",
        });
    });
});
