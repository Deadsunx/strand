// Browser helper for screen capture. Ports the per-browser getDisplayMedia
// audio heuristics from the original webrtc.js. This stays in the app layer
// (not the framework-agnostic core) because it is inherently browser/UA
// specific and touches navigator.mediaDevices directly.

export interface DisplayMediaChoice {
    constraints: MediaStreamConstraints;
    /** Human-readable note about what audio to expect on this browser. */
    hint: string;
}

interface BrowserInfo {
    browser: "chrome" | "edge" | "opera" | "firefox" | "safari" | "unknown";
    os: "ios" | "android" | "windows" | "macos" | "linux" | "unknown";
}

export function isMobile(): boolean {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function screenShareSupported(): boolean {
    return (
        !isMobile() &&
        typeof navigator.mediaDevices?.getDisplayMedia === "function"
    );
}

function detectBrowser(): BrowserInfo {
    const ua = navigator.userAgent || "";
    const plat =
        (navigator as unknown as { userAgentData?: { platform?: string } })
            .userAgentData?.platform ||
        navigator.platform ||
        "";

    const isiOS =
        /iP(hone|ad|od)/i.test(ua) ||
        (/Mac/i.test(plat) && navigator.maxTouchPoints > 1 && !/Chrome/i.test(ua));

    let os: BrowserInfo["os"] = "unknown";
    if (isiOSGuard(isiOS)) os = "ios";
    else if (/Windows/i.test(plat)) os = "windows";
    else if (/Mac/i.test(plat)) os = "macos";
    else if (/Android/i.test(ua)) os = "android";
    else if (/Linux|X11/i.test(plat)) os = "linux";

    let browser: BrowserInfo["browser"] = "unknown";
    if (/Edg\//.test(ua)) browser = "edge";
    else if (/OPR\//.test(ua)) browser = "opera";
    else if (/Chrome\//.test(ua)) browser = "chrome";
    else if (/Firefox\//.test(ua)) browser = "firefox";
    else if (/Safari\//.test(ua) && !/Chrome|Chromium/i.test(ua)) browser = "safari";

    return { browser, os };
}

// Tiny indirection so the boolean reads clearly above.
function isiOSGuard(v: boolean): boolean {
    return v;
}

export function getDisplayMediaOptions(withSystemAudio = true): DisplayMediaChoice {
    const video: MediaTrackConstraints = {
        // `cursor` isn't in the standard MediaTrackConstraints type but is honoured.
        height: 720,
        frameRate: 30,
    };

    if (!withSystemAudio || isMobile()) {
        return {
            constraints: { video, audio: false },
            hint: isMobile()
                ? "Screen audio is not supported on mobile devices."
                : "Sharing without audio.",
        };
    }

    const info = detectBrowser();
    switch (info.browser) {
        case "chrome":
        case "edge":
        case "opera":
            return {
                constraints: {
                    video,
                    audio: { echoCancellation: false, noiseSuppression: false },
                },
                hint:
                    info.os === "macos"
                        ? "Tab audio works; full system audio may be unavailable on macOS."
                        : 'For best results use "Share tab audio". System audio works on Windows.',
            };
        case "firefox":
            return {
                constraints: { video, audio: true },
                hint: "Firefox supports tab audio only; window/screen may be silent.",
            };
        default:
            return {
                constraints: { video, audio: false },
                hint: "This browser does not reliably support screen-share audio.",
            };
    }
}

/** Prompt for and return a display-capture MediaStream, or null if cancelled. */
export async function captureScreen(
    withSystemAudio = true
): Promise<MediaStream | null> {
    const { constraints } = getDisplayMediaOptions(withSystemAudio);
    try {
        return await navigator.mediaDevices.getDisplayMedia(constraints);
    } catch {
        // User cancelled the picker or capture failed.
        return null;
    }
}
