// --- tests/telemetry.test.js ---
// Tests for Gossamer telemetry wrapper

describe("Gossamer Telemetry Wrapper", () => {
    let gossamerModule;
    let mockGossamer;

    beforeEach(() => {
        jest.resetModules();

        // Mock the @dropsilk/gossamer module
        mockGossamer = {
            init: jest.fn().mockResolvedValue(undefined),
            emit: jest.fn(),
            emitError: jest.fn(),
            flush: jest.fn().mockResolvedValue(undefined),
        };

        jest.mock("@dropsilk/gossamer", () => ({
            gossamer: mockGossamer,
            ConsolePrettyTransport: jest.fn().mockImplementation(() => ({})),
        }));

        // Mock the config
        jest.mock("../gossamer.config.js", () => ({
            enabled: true,
            events: {},
            stories: {},
        }));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("initGossamer", () => {
        test("should initialize Gossamer with config", async () => {
            gossamerModule = require("../src/gossamer");
            await gossamerModule.initGossamer();

            expect(mockGossamer.init).toHaveBeenCalledTimes(1);
            expect(mockGossamer.init).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    transports: expect.any(Array),
                    captureCrashes: true,
                }),
            );
        });

        test("should only initialize once", async () => {
            gossamerModule = require("../src/gossamer");
            await gossamerModule.initGossamer();
            await gossamerModule.initGossamer();

            expect(mockGossamer.init).toHaveBeenCalledTimes(1);
        });
    });

    describe("emit", () => {
        test("should emit events after initialization", async () => {
            gossamerModule = require("../src/gossamer");
            await gossamerModule.initGossamer();

            gossamerModule.emit("test:event", { key: "value" });

            expect(mockGossamer.emit).toHaveBeenCalledWith("test:event", {
                key: "value",
            });
        });

        test("should warn if emit called before init", () => {
            const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
            gossamerModule = require("../src/gossamer");

            gossamerModule.emit("test:event", {});

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Emit before init"),
            );
            consoleSpy.mockRestore();
        });
    });

    describe("emitError", () => {
        test("should emit error events after initialization", async () => {
            gossamerModule = require("../src/gossamer");
            await gossamerModule.initGossamer();

            const error = new Error("Test error");
            gossamerModule.emitError("test:error", error, { context: "test" });

            expect(mockGossamer.emitError).toHaveBeenCalledWith(
                "test:error",
                error,
                { context: "test" },
            );
        });
    });

    describe("flush", () => {
        test("should flush transports", async () => {
            gossamerModule = require("../src/gossamer");
            await gossamerModule.initGossamer();
            await gossamerModule.flush();

            expect(mockGossamer.flush).toHaveBeenCalledTimes(1);
        });
    });
});