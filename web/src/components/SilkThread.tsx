// The signature element: two nodes joined by a single iridescent silk thread.
// A peer-to-peer link is literally a direct line between two devices, and
// "silk" is the app's promise — smooth, flowing, with a light-catching sheen.
// One gentle ambient motion; fully static when reduced motion is requested.

export function SilkThread({
    connected = false,
    label = "peer",
}: {
    connected?: boolean;
    label?: string;
}) {
    return (
        <div className="silk-thread" aria-hidden="true">
            <svg
                viewBox="0 0 600 160"
                preserveAspectRatio="xMidYMid meet"
                className={connected ? "is-connected" : "is-searching"}
            >
                <defs>
                    <linearGradient id="silk-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor="#56d4dd" />
                        <stop offset="0.5" stopColor="#6c8cff" />
                        <stop offset="1" stopColor="#b06cff" />
                    </linearGradient>
                    <filter id="silk-glow" x="-20%" y="-60%" width="140%" height="220%">
                        <feGaussianBlur stdDeviation="4" result="b" />
                        <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* The thread: a gently waving strand between the two nodes. */}
                <path
                    className="silk-strand"
                    d="M 70 80 C 200 40, 400 120, 530 80"
                    fill="none"
                    stroke="url(#silk-grad)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    filter="url(#silk-glow)"
                />

                {/* Endpoints: you (left) and the peer (right). */}
                <g className="silk-node">
                    <circle cx="70" cy="80" r="9" fill="url(#silk-grad)" />
                    <circle className="silk-node-ring" cx="70" cy="80" r="9" />
                </g>
                <g className={`silk-node ${connected ? "" : "silk-node-pending"}`}>
                    <circle cx="530" cy="80" r="9" fill="url(#silk-grad)" />
                    <circle className="silk-node-ring" cx="530" cy="80" r="9" />
                </g>

                <text className="silk-label" x="70" y="118" textAnchor="middle">
                    you
                </text>
                <text className="silk-label" x="530" y="118" textAnchor="middle">
                    {label}
                </text>
            </svg>
        </div>
    );
}
