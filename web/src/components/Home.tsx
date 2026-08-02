import { useEffect, useState } from "react";
import {
    useAppActions,
    useAppState,
    useController,
} from "../app/AppContext.tsx";
import { SilkThread } from "./SilkThread.tsx";
import { NetworkUsers } from "./NetworkUsers.tsx";

export function Home() {
    const controller = useController();
    const actions = useAppActions();
    const discoverable = useAppState((s) => s.discoverable);
    const networkToken = useAppState((s) => s.networkToken);

    const [code, setCode] = useState("");
    const [busy, setBusy] = useState<"create" | "join" | null>(null);

    // Presence on the home screen: when discoverable, open the socket so we
    // advertise ourselves and receive the network list without needing a flight
    // first. Toggling off (in presence mode) drops the socket. No unmount
    // cleanup — entering a flight unmounts Home but must keep the socket alive.
    useEffect(() => {
        if (discoverable) controller.startDiscovery();
        else controller.stopDiscovery();
    }, [discoverable, controller]);

    // Re-advertise when the shared PIN changes while already discoverable.
    useEffect(() => {
        if (discoverable) controller.refreshRegistration();
    }, [networkToken, discoverable, controller]);

    // Pre-fill from a shared invite link (?code=ABC123).
    useEffect(() => {
        const linked = new URLSearchParams(window.location.search)
            .get("code")
            ?.toUpperCase();
        if (linked) setCode(linked.replace(/[^A-Z0-9]/g, "").slice(0, 6));
    }, []);

    async function handleCreate() {
        setBusy("create");
        try {
            await controller.createRoom();
        } catch {
            /* error surfaced via store */
        } finally {
            setBusy(null);
        }
    }

    async function handleJoin(e: React.FormEvent) {
        e.preventDefault();
        if (code.length !== 6) return;
        setBusy("join");
        try {
            await controller.joinRoom(code);
        } catch {
            /* error surfaced via store */
        } finally {
            setBusy(null);
        }
    }

    return (
        <section className="home">
            <p className="eyebrow">Peer-to-peer · No cloud · Encrypted</p>
            <SilkThread />
            <h1 className="home-title">
                One thread, <span className="accent">two devices.</span>
            </h1>
            <p className="home-sub">
                Files travel straight from your device to theirs — no upload, no
                size limit, encrypted end to end. Start a flight, share the code,
                and you're connected.
            </p>

            <div className="home-actions">
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleCreate}
                    disabled={busy !== null}
                >
                    {busy === "create" ? "Creating…" : "Create a Flight"}
                </button>

                <div className="home-or" aria-hidden="true">
                    or
                </div>

                <form className="join-form" onSubmit={handleJoin}>
                    <label htmlFor="flight-code" className="sr-only">
                        Enter flight code to join
                    </label>
                    <input
                        id="flight-code"
                        className="code-input"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={6}
                        placeholder="ABC123"
                        value={code}
                        onChange={(e) =>
                            setCode(
                                e.target.value
                                    .toUpperCase()
                                    .replace(/[^A-Z0-9]/g, "")
                                    .slice(0, 6)
                            )
                        }
                    />
                    <button
                        type="submit"
                        className="btn btn-secondary"
                        disabled={code.length !== 6 || busy !== null}
                    >
                        {busy === "join" ? "Joining…" : "Join Flight"}
                    </button>
                </form>
            </div>

            <details className="discovery">
                <summary>Nearby-device discovery (optional)</summary>
                <p className="discovery-note">
                    Off by default for privacy. When both people turn this on,
                    you see each other's names below — tap <strong>Connect</strong>{" "}
                    and a flight opens and invites them automatically, no code
                    needed. Add a shared PIN to only match people who enter the
                    same one.
                </p>
                <button
                    type="button"
                    role="switch"
                    aria-checked={discoverable}
                    className={`toggle ${discoverable ? "is-on" : ""}`}
                    onClick={() =>
                        actions.setDiscovery({ discoverable: !discoverable })
                    }
                >
                    <span className="toggle-track" aria-hidden="true">
                        <span className="toggle-thumb" />
                    </span>
                    <span className="toggle-label">
                        Make me discoverable on this network
                    </span>
                </button>
                <label className="field">
                    <span>Shared PIN (optional)</span>
                    <input
                        type="text"
                        className="text-input"
                        placeholder="e.g. team-42"
                        value={networkToken ?? ""}
                        disabled={!discoverable}
                        onChange={(e) =>
                            actions.setDiscovery({
                                networkToken: e.target.value || null,
                            })
                        }
                    />
                </label>
            </details>

            {discoverable && <NetworkUsers actionLabel="Connect" />}
        </section>
    );
}
