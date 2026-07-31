import { useEffect, useRef, useState } from "react";

// Simple localStorage-backed settings. Read at point-of-use elsewhere (the OPFS
// factory and the controller's auto-download), so this panel only needs to
// write the keys.

function useLocalFlag(key: string, fallback = false) {
    const [value, setValue] = useState<boolean>(() => {
        try {
            return localStorage.getItem(key) === "true";
        } catch {
            return fallback;
        }
    });
    const set = (v: boolean) => {
        setValue(v);
        try {
            localStorage.setItem(key, String(v));
        } catch {
            /* storage unavailable */
        }
    };
    return [value, set] as const;
}

export function Settings({ onClose }: { onClose: () => void }) {
    const [opfs, setOpfs] = useLocalFlag("dropsilk-use-opfs-buffer");
    const [autoDownload, setAutoDownload] = useLocalFlag("dropsilk-auto-download");
    const [maxSize, setMaxSize] = useState<string>(() => {
        try {
            return localStorage.getItem("dropsilk-auto-download-max-size") || "100";
        } catch {
            return "100";
        }
    });
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    function updateMaxSize(v: string) {
        setMaxSize(v);
        try {
            localStorage.setItem("dropsilk-auto-download-max-size", v);
        } catch {
            /* ignore */
        }
    }

    return (
        <div
            className="preview-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="settings-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
            >
                <header className="preview-header">
                    <span className="preview-title">Settings</span>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onClose}
                        aria-label="Close settings"
                        ref={closeRef}
                    >
                        ✕
                    </button>
                </header>
                <div className="settings-body">
                    <label className="setting-row">
                        <span>
                            <strong>Auto-download received files</strong>
                            <small>
                                Save non-executable files automatically as they
                                arrive.
                            </small>
                        </span>
                        <input
                            type="checkbox"
                            checked={autoDownload}
                            onChange={(e) => setAutoDownload(e.target.checked)}
                        />
                    </label>

                    <label className="setting-row">
                        <span>
                            <strong>Auto-download size limit</strong>
                            <small>Skip auto-download above this size (MB).</small>
                        </span>
                        <input
                            type="number"
                            className="text-input size-input"
                            min={1}
                            value={maxSize}
                            disabled={!autoDownload}
                            onChange={(e) => updateMaxSize(e.target.value)}
                        />
                    </label>

                    <label className="setting-row">
                        <span>
                            <strong>Disk buffer for huge files (OPFS)</strong>
                            <small>
                                Stream files over 256&nbsp;MB to disk instead of
                                memory. Recommended for very large transfers.
                            </small>
                        </span>
                        <input
                            type="checkbox"
                            checked={opfs}
                            onChange={(e) => setOpfs(e.target.checked)}
                        />
                    </label>
                </div>
            </div>
        </div>
    );
}
