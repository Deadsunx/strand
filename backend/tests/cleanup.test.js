// --- tests/cleanup.test.js ---

const mockDeleteFiles = jest.fn();
const mockEmit = jest.fn();

jest.mock("uploadthing/server", () => ({
    UTApi: jest.fn().mockImplementation(() => ({
        deleteFiles: mockDeleteFiles,
    })),
}));

jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: jest.fn(() => true),
    query: jest.fn(),
}));

// Import runCleanup directly to make tests synchronous and predictable.
const { runCleanup } = require("../src/cleanupService");
const db = require("../src/dbClient");

describe("Cleanup Service Logic (runCleanup)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("Should emit cleanup:complete if no old files are found", async () => {
        db.query.mockResolvedValueOnce({ rows: [] });

        await runCleanup();

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(mockDeleteFiles).not.toHaveBeenCalled();
        expect(mockEmit).toHaveBeenCalledWith("cleanup:complete", {
            count: 0,
            message: "No files to clean",
        });
    });

    test("Should emit cleanup:start and cleanup:complete on successful cleanup", async () => {
        const fileKeys = ["key1", "key2"];
        db.query.mockResolvedValueOnce({
            rows: [{ file_key: "key1" }, { file_key: "key2" }],
        });
        mockDeleteFiles.mockResolvedValueOnce({ success: true });
        db.query.mockResolvedValueOnce({ rowCount: 2 });

        await runCleanup();

        // Check the sequence of calls
        const emitCalls = mockEmit.mock.calls;
        expect(emitCalls[0][0]).toBe("cleanup:start");
        expect(mockDeleteFiles).toHaveBeenCalledWith(fileKeys);
        expect(db.query).toHaveBeenCalledTimes(2);
        expect(emitCalls[1][0]).toBe("cleanup:complete");
        expect(emitCalls[1][1]).toEqual({ deletedCount: 2 });
    });

    test("Should emit cleanup:error and NOT delete from DB if UploadThing fails", async () => {
        const fileKeys = ["key1"];
        db.query.mockResolvedValueOnce({ rows: [{ file_key: "key1" }] });
        mockDeleteFiles.mockResolvedValueOnce({
            success: false,
            error: "UT API is down",
        });

        await runCleanup();

        expect(mockDeleteFiles).toHaveBeenCalledWith(fileKeys);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(mockEmit).toHaveBeenCalledWith("cleanup:error", {
            context: "UploadThing Deletion Failed",
            result: { success: false, error: "UT API is down" },
        });
    });
});