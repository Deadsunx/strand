// --- tests/email.test.js ---
// Mock axios with explicit default export structure for ESM interop
jest.mock("axios", () => ({
    __esModule: true,
    default: {
        post: jest.fn(),
    },
}));

const axios = require("axios").default;

jest.mock("../src/config", () => ({
    __esModule: true,
    default: {
        recaptchaSecretKey: "mock-secret-key",
        contactEmail: "admin@example.com",
    },
}));

// Mock the Gossamer emit
const mockEmit = jest.fn();
jest.mock("../src/gossamer", () => ({
    emit: mockEmit,
}));

const { getRequestEmailResponse } = require("../src/emailService");

describe("Email Service", () => {
    beforeEach(() => {
        mockEmit.mockClear();
    });

    test("Should return 400 if token is missing", async () => {
        const res = await getRequestEmailResponse({ token: "" });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: "reCAPTCHA token is required",
        });
    });

    test("Should emit email:request event when validating", async () => {
        axios.post.mockResolvedValue({ data: { success: false } });

        await getRequestEmailResponse({ token: "any-token" });

        expect(mockEmit).toHaveBeenCalledWith("email:request", {
            status: "validating",
        });
    });

    test("Should return 200 and email if reCAPTCHA succeeds", async () => {
        axios.post.mockResolvedValue({ data: { success: true } });

        const res = await getRequestEmailResponse({ token: "valid-token" });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            email: "admin@example.com",
        });
    });

    test("Should emit email:error and return 500 if Google API errors out", async () => {
        const apiError = new Error("Network Error");
        axios.post.mockRejectedValue(apiError);

        const res = await getRequestEmailResponse({ token: "valid-token" });

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "internal_error" });

        // Verify that the correct telemetry event was emitted
        expect(mockEmit).toHaveBeenCalledWith("email:error", {
            context: "reCAPTCHA verification failed",
            error: "Network Error",
            axiosResponse: undefined,
        });
    });

    test("Should emit email:error if contactEmail is not configured", async () => {
        const config = require("../src/config").default;
        config.contactEmail = ""; // Temporarily unset for this test

        axios.post.mockResolvedValue({ data: { success: true } });
        const res = await getRequestEmailResponse({ token: "valid-token" });

        expect(res.status).toBe(500);
        expect(mockEmit).toHaveBeenCalledWith("email:error", {
            error: "server_not_configured",
        });

        config.contactEmail = "admin@example.com"; // Restore
    });
});
