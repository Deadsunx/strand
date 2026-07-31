import { useState } from "react";
import { useAppState } from "../app/AppContext.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { Settings } from "./Settings.tsx";

export function Header() {
    const myName = useAppState((s) => s.myName);
    const [settingsOpen, setSettingsOpen] = useState(false);
    return (
        <header className="header">
            <a className="brand" href="/" aria-label="Strand home">
                <span className="brand-mark" aria-hidden="true">
                    ◇
                </span>
                <span className="brand-text">Strand</span>
            </a>
            <div className="header-right">
                <span className="my-name" title="Your display name">
                    {myName}
                </span>
                <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Settings"
                    title="Settings"
                >
                    ⚙
                </button>
                <ThemeToggle />
            </div>
            {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
        </header>
    );
}
