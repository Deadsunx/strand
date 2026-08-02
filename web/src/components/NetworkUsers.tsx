import { useAppState, useController } from "../app/AppContext.tsx";

// Lists discoverable people on your network. The action is context-aware:
// on the home screen "Connect" spins up a flight and invites in one tap; in a
// flight lobby "Invite" pulls them into the flight you already hold. After you
// invite someone the button goes on cooldown until their invitation expires.
export function NetworkUsers({ actionLabel = "Invite" }: { actionLabel?: string }) {
    const users = useAppState((s) => s.networkUsers);
    const invitedUserIds = useAppState((s) => s.invitedUserIds);
    const controller = useController();

    if (users.length === 0) return null;

    return (
        <div className="network-users">
            <h2 className="panel-title">Users on your network</h2>
            <ul className="user-list">
                {users.map((user) => {
                    const invited = invitedUserIds.includes(user.id);
                    return (
                        <li key={user.id} className="user-row">
                            <span className="user-name">{user.name}</span>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={invited}
                                onClick={() =>
                                    controller.inviteOrConnect(user.id)
                                }
                            >
                                {invited ? "Invited" : actionLabel}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
