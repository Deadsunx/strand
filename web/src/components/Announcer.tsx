import { useEffect, useRef, useState } from "react";
import { useAppState } from "../app/AppContext.tsx";

// A visually-hidden polite live region that announces transfer milestones to
// screen readers — the original client left these state changes silent.
export function Announcer() {
    const sendQueue = useAppState((s) => s.sendQueue);
    const receiveItems = useAppState((s) => s.receiveItems);
    const connectedPeer = useAppState((s) => s.connectedPeer);

    const [message, setMessage] = useState("");
    const announced = useRef<Set<string>>(new Set());
    const hadPeer = useRef(false);

    useEffect(() => {
        for (const item of sendQueue) {
            const key = `sent:${item.id}`;
            if (item.status === "sent" && !announced.current.has(key)) {
                announced.current.add(key);
                setMessage(`Sent ${item.name}`);
            }
        }
    }, [sendQueue]);

    useEffect(() => {
        for (const item of receiveItems) {
            const key = `recv:${item.id}`;
            if (item.status === "complete" && !announced.current.has(key)) {
                announced.current.add(key);
                setMessage(
                    item.executable
                        ? `Received ${item.name}. Warning: this is an executable file.`
                        : `Received ${item.name}`
                );
            }
        }
    }, [receiveItems]);

    useEffect(() => {
        if (connectedPeer && !hadPeer.current) {
            hadPeer.current = true;
            setMessage(`${connectedPeer.name} connected`);
        } else if (!connectedPeer) {
            hadPeer.current = false;
        }
    }, [connectedPeer]);

    return (
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {message}
        </div>
    );
}
