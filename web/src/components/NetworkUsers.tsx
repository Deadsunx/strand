import { useAppState, useController } from "../app/AppContext.tsx";

export function NetworkUsers() {
    const users = useAppState((s) => s.networkUsers);
    const controller = useController();

    if (users.length === 0) return null;

    return (
        <div className="network-users">
            <h2 className="panel-title">Users on your network</h2>
            <ul className="user-list">
                {users.map((user) => (
                    <li key={user.id} className="user-row">
                        <span className="user-name">{user.name}</span>
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => controller.invite(user.id)}
                        >
                            Invite
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
