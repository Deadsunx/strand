import { useAppState } from "../app/AppContext.tsx";
import { formatBytes, formatSpeed } from "./format.ts";

export function MetricsBar() {
    const sent = useAppState((s) => s.totalBytesSent);
    const received = useAppState((s) => s.totalBytesReceived);
    const speed = useAppState((s) => s.speedBps);

    return (
        <div className="metrics-bar">
            <div className="metric">
                <span className="metric-label">Sent</span>
                <span className="metric-value">{formatBytes(sent)}</span>
            </div>
            <div className="metric">
                <span className="metric-label">Received</span>
                <span className="metric-value">{formatBytes(received)}</span>
            </div>
            <div className="metric">
                <span className="metric-label">Speed</span>
                <span className="metric-value">{formatSpeed(speed)}</span>
            </div>
        </div>
    );
}
