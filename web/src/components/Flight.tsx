import { useController, useAppState } from "../app/AppContext.tsx";
import { InviteBox } from "./InviteBox.tsx";
import { NetworkUsers } from "./NetworkUsers.tsx";
import { SendPanel } from "./SendPanel.tsx";
import { ReceivePanel } from "./ReceivePanel.tsx";
import { Chat } from "./Chat.tsx";
import { ScreenShare } from "./ScreenShare.tsx";
import { MetricsBar } from "./MetricsBar.tsx";

export function Flight() {
    const controller = useController();
    const roomCode = useAppState((s) => s.roomCode);
    const statusText = useAppState((s) => s.statusText);
    const connectedPeer = useAppState((s) => s.connectedPeer);
    const connectionType = useAppState((s) => s.connectionType);
    const dataChannelOpen = useAppState((s) => s.dataChannelOpen);

    return (
        <section className="flight">
            <div className="flight-topbar">
                <div className="flight-code-block">
                    <span className="flight-label">FLIGHT</span>
                    <span className="flight-code">{roomCode}</span>
                </div>
                <div
                    className={`flight-status ${
                        dataChannelOpen ? "is-connected" : ""
                    }`}
                    role="status"
                    aria-live="polite"
                >
                    {statusText || "Setting up…"}
                    {connectedPeer && dataChannelOpen && (
                        <span className="conn-badge">
                            {connectionType.toUpperCase()}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => controller.leave()}
                >
                    Leave
                </button>
            </div>

            {!connectedPeer && (
                <>
                    <InviteBox />
                    <NetworkUsers />
                </>
            )}

            <div className="transfer-grid">
                <SendPanel />
                <ReceivePanel />
            </div>

            <ScreenShare />
            <Chat />
            <MetricsBar />
        </section>
    );
}
