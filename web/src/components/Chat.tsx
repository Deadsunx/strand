import { useEffect, useRef, useState } from "react";
import { useAppState, useController } from "../app/AppContext.tsx";

export function Chat() {
    const controller = useController();
    const messages = useAppState((s) => s.chatMessages);
    const chatEnabled = useAppState((s) => s.chatEnabled);
    const [draft, setDraft] = useState("");
    const logRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }, [messages]);

    function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!draft.trim()) return;
        controller.sendChat(draft);
        setDraft("");
    }

    return (
        <div className="panel chat-panel">
            <h2 className="panel-title">Chat</h2>
            <div className="chat-log" ref={logRef} aria-live="polite">
                {messages.length === 0 ? (
                    <p className="empty-state">
                        Messages appear here once a peer is connected.
                    </p>
                ) : (
                    messages.map((m) => (
                        <div key={m.id} className={`chat-msg from-${m.from}`}>
                            <span className="chat-text">{m.text}</span>
                        </div>
                    ))
                )}
            </div>
            <form className="chat-input" onSubmit={submit}>
                <label htmlFor="chat-draft" className="sr-only">
                    Type a message
                </label>
                <input
                    id="chat-draft"
                    className="text-input"
                    placeholder={
                        chatEnabled
                            ? "Type a message…"
                            : "Connect with a peer to chat"
                    }
                    value={draft}
                    disabled={!chatEnabled}
                    onChange={(e) => setDraft(e.target.value)}
                />
                <button
                    type="submit"
                    className="btn btn-secondary"
                    disabled={!chatEnabled || !draft.trim()}
                >
                    Send
                </button>
            </form>
        </div>
    );
}
