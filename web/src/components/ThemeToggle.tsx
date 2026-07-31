import { useEffect, useState } from "react";

type Mode = "light" | "dark";

function getInitialMode(): Mode {
    const saved = localStorage.getItem("dropsilk-mode");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

export function ThemeToggle() {
    const [mode, setMode] = useState<Mode>(getInitialMode);

    useEffect(() => {
        document.documentElement.dataset.theme = mode;
        localStorage.setItem("dropsilk-mode", mode);
    }, [mode]);

    return (
        <button
            type="button"
            className="icon-btn"
            onClick={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
            aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
        >
            {mode === "dark" ? "☀" : "☾"}
        </button>
    );
}
