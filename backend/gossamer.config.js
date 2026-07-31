// --- gossamer.config.js ---
// Config-driven telemetry using @dropsilk/gossamer

/** @type {import('@dropsilk/gossamer').GossamerUserConfig} */
const config = {
    enabled: true,
    verbosity: 0,

    levels: {
        INFO: { active: true, label: "INFO", colour: "cyan" },
        WARN: { active: true, label: "WARN", colour: "yellow" },
        ERROR: { active: true, label: "ERROR", colour: "red" },
    },

    events: {
        // --- System ---
        "system:startup": { level: "INFO" },
        "system:shutdown": { level: "WARN" },
        "system:heartbeat": { level: "INFO", active: false },
        "system:log_access": { level: "WARN" },
        "system:error": { level: "ERROR" },

        // --- HTTP ---
        "http:request": { level: "INFO" },
        "http:error": { level: "ERROR" },

        // --- Client ---
        "client:connected": { level: "INFO" },
        "client:disconnected": { level: "INFO" },
        "client:registered_details": { level: "INFO" },
        "client:error": { level: "ERROR" },

        // --- Flight ---
        "flight:created": { level: "INFO" },
        "flight:joined": { level: "INFO" },
        "flight:ended": { level: "INFO" },
        "flight:signal": { level: "INFO", active: false }, // Silent in console, tracked by story
        "flight:invitation": { level: "INFO" },
        "flight:error": { level: "ERROR" },

        // --- TURN ---
        "turn:credentials_issued": { level: "INFO" },
        "turn:error": { level: "ERROR" },

        // --- Upload ---
        "upload:success": { level: "INFO" },
        "upload:db_saved": { level: "INFO" },
        "upload:error": { level: "ERROR" },

        // --- Cleanup ---
        "cleanup:start": { level: "INFO" },
        "cleanup:complete": { level: "INFO" },
        "cleanup:skipped": { level: "INFO" },
        "cleanup:error": { level: "ERROR" },

        // --- Email ---
        "email:request": { level: "INFO" },
        "email:error": { level: "ERROR" },
    },

    stories: {
        FlightStory: {
            enabled: true,
            correlationKey: "flightCode",
            trigger: "flight:created",
            ender: "flight:ended",
            maxAgeMs: 2 * 60 * 60 * 1000, // 2 hours
            track: {
                "flight:joined": { mode: "append" },
                "flight:signal": { mode: "count", counter: "signalsExchanged" },
                "client:disconnected": { mode: "append" },
            },
        },
    },
};

module.exports = config;
