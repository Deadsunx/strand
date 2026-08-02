import { useEffect, useState } from "react";
import { useAppState, useController } from "../app/AppContext.tsx";

// Prompt shown to the invitee when a nearby user invites them into a flight.
// It carries a live countdown to its own expiry, so the invitee can see how
// long they have to accept before it auto-dismisses.
export function InvitationToast() {
    const controller = useController();
    const invitation = useAppState((s) => s.incomingInvitation);

    const [secondsLeft, setSecondsLeft] = useState(0);

    useEffect(() => {
        if (!invitation) return;
        const tick = () => {
            const remaining = Math.max(
                0,
                Math.ceil((invitation.expiresAt - Date.now()) / 1000)
            );
            setSecondsLeft(remaining);
        };
        tick();
        const id = window.setInterval(tick, 500);
        return () => window.clearInterval(id);
    }, [invitation]);

    if (!invitation) return null;

    return (
        <div className="invitation-toast" role="alertdialog" aria-live="assertive">
            <span className="invitation-text">
                <strong>{invitation.fromName}</strong> invited you to a flight
                {secondsLeft > 0 && (
                    <span className="invitation-countdown">
                        {" "}
                        · expires in {secondsLeft}s
                    </span>
                )}
            </span>
            <div className="invitation-actions">
                <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() =>
                        void controller.acceptInvitation(invitation.flightCode)
                    }
                >
                    Join
                </button>
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => controller.dismissInvitation()}
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}
