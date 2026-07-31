import { useEffect, useRef } from "react";
import { useAppState, useController } from "../app/AppContext.tsx";
import { screenShareSupported } from "../app/screenShare.ts";

function VideoTile({
    stream,
    muted,
    label,
}: {
    stream: MediaStream;
    muted: boolean;
    label: string;
}) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el && el.srcObject !== stream) {
            el.srcObject = stream;
        }
    }, [stream]);
    return (
        <figure className="video-tile">
            <video ref={ref} autoPlay playsInline muted={muted} />
            <figcaption>{label}</figcaption>
        </figure>
    );
}

export function ScreenShare() {
    const controller = useController();
    const dataChannelOpen = useAppState((s) => s.dataChannelOpen);
    const screenSharing = useAppState((s) => s.screenSharing);
    const localStream = useAppState((s) => s.localStream);
    const remoteStream = useAppState((s) => s.remoteStream);

    const supported = screenShareSupported();
    if (!dataChannelOpen) return null;

    return (
        <div className="panel screen-share">
            <div className="screen-share-head">
                <h2 className="panel-title">Screen share</h2>
                {supported ? (
                    screenSharing ? (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void controller.stopScreenShare()}
                        >
                            Stop sharing
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={!!remoteStream}
                            title={
                                remoteStream
                                    ? "Peer is currently sharing"
                                    : "Share your screen"
                            }
                            onClick={() => void controller.startScreenShare()}
                        >
                            Share my screen
                        </button>
                    )
                ) : (
                    <span className="muted-note">
                        Screen sharing isn't supported on this device.
                    </span>
                )}
            </div>

            {(localStream || remoteStream) && (
                <div className="video-grid">
                    {remoteStream && (
                        <VideoTile
                            stream={remoteStream}
                            muted={false}
                            label="Peer's screen"
                        />
                    )}
                    {localStream && (
                        <VideoTile
                            stream={localStream}
                            muted
                            label="Your screen"
                        />
                    )}
                </div>
            )}
        </div>
    );
}
