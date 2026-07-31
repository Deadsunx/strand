import { useAppState, useController } from "../app/AppContext.tsx";

// Prompt shown to the invitee when a nearby user invites them into a flight.
export function InvitationToast() {
    const controller = useController();
    const invitation = useAppState((s) => s.incomingInvitation);

    if (!invitation) return null;

    return (
        <div className="invitation-toast" role="alertdialog" aria-live="assertive">
            <span className="invitation-text">
                <strong>{invitation.fromName}</strong> invited you to a flight
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
