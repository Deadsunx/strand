import { useState } from "react";
import { useAppState } from "../app/AppContext.tsx";

export function InviteBox() {
    const roomCode = useAppState((s) => s.roomCode);
    const [copied, setCopied] = useState<"code" | "link" | null>(null);

    if (!roomCode) return null;
    const inviteLink = `${window.location.origin}/?code=${roomCode}`;

    async function copy(what: "code" | "link", value: string) {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(what);
            window.setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard unavailable */
        }
    }

    return (
        <div className="invite-box">
            <p className="invite-lead">
                Share this code or link to invite the other device:
            </p>
            <div className="invite-row">
                <button
                    type="button"
                    className="invite-code"
                    onClick={() => copy("code", roomCode)}
                    title="Copy code"
                >
                    {roomCode}
                </button>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => copy("link", inviteLink)}
                >
                    {copied === "link" ? "Copied!" : "Copy invite link"}
                </button>
            </div>
            {copied === "code" && (
                <span className="invite-copied" role="status">
                    Code copied!
                </span>
            )}
        </div>
    );
}
