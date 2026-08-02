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
    const relayed = useAppState((s) => s.relayed);
    const dataChannelOpen = useAppState((s) => s.dataChannelOpen);
    const connectionStalled = useAppState((s) => s.connectionStalled);

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
                        <span
                            className="conn-badge"
                            title={
                                relayed
                                    ? "Relayed through a TURN server — slower than a direct link, but works through strict firewalls."
                                    : relayed === false
                                    ? "Direct peer-to-peer link."
                                    : undefined
                            }
                        >
                            {connectionType.toUpperCase()}
                            {relayed ? " · RELAY" : relayed === false ? " · DIRECT" : ""}
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

            {connectionStalled && !dataChannelOpen && (
                <div className="reconnect-banner" role="alert">
                    <span>
                        Taking longer than usual to connect — this can happen on
                        distant or slow networks.
                    </span>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => controller.retryConnection()}
                    >
                        Reconnect
                    </button>
                </div>
            )}

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
