const mockEmit = jest.fn();
const mockDeleteExpiredRooms = jest.fn();

jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

jest.mock("../src/dbClient", () => ({
    isDatabaseInitialized: jest.fn(() => true),
}));

jest.mock("../src/roomStore", () => ({
    deleteExpiredRooms: mockDeleteExpiredRooms,
}));

const { runRoomCleanup } = require("../src/roomCleanupService");
const db = require("../src/dbClient");

describe("Room Cleanup Service", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("emits skipped when DB is unavailable", async () => {
        db.isDatabaseInitialized.mockReturnValueOnce(false);

        await runRoomCleanup();

        expect(mockDeleteExpiredRooms).not.toHaveBeenCalled();
        expect(mockEmit).toHaveBeenCalledWith("room_cleanup:skipped", {
            reason: "DB not initialized",
        });
    });

    test("emits deleted count on successful cleanup", async () => {
        mockDeleteExpiredRooms.mockResolvedValueOnce(4);

        await runRoomCleanup();

        expect(mockDeleteExpiredRooms).toHaveBeenCalledTimes(1);
        expect(mockEmit).toHaveBeenCalledWith("room_cleanup:complete", {
            deletedCount: 4,
        });
    });

    test("emits error on cleanup failure", async () => {
        mockDeleteExpiredRooms.mockRejectedValueOnce(new Error("boom"));

        await runRoomCleanup();

        expect(mockEmit).toHaveBeenCalledWith(
            "room_cleanup:error",
            expect.objectContaining({ error: "boom" })
        );
    });
});
