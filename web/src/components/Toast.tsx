import { useEffect } from "react";

export function Toast({
    message,
    onDismiss,
    duration = 6000,
}: {
    message: string;
    onDismiss: () => void;
    duration?: number;
}) {
    useEffect(() => {
        if (duration <= 0) return;
        const handle = window.setTimeout(onDismiss, duration);
        return () => window.clearTimeout(handle);
    }, [message, duration, onDismiss]);

    return (
        <div className="toast" role="alert">
            <span>{message}</span>
            <button
                type="button"
                className="icon-btn"
                onClick={onDismiss}
                aria-label="Dismiss"
            >
                ✕
            </button>
        </div>
    );
}
