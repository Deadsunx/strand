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
        if (el && el.srcObject !== stream) el.srcObject = stream;
    }, [stream]);
    return (
        <figure className="video-tile">
            <video ref={ref} autoPlay playsInline muted={muted} />
            <figcaption>{label}</figcaption>
        </figure>
    );
}

// Plays the peer's incoming media. Screen share → a video tile (audio included);
// voice-only → a hidden audio sink plus a small "connected" indicator.
function RemoteMedia({ stream }: { stream: MediaStream }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const hasVideo = stream.getVideoTracks().length > 0;

    useEffect(() => {
        const el = audioRef.current;
        if (el && el.srcObject !== stream) el.srcObject = stream;
    }, [stream]);

    if (hasVideo) {
        return <VideoTile stream={stream} muted={false} label="Peer's screen" />;
    }
    return (
        <div className="voice-indicator">
            <span className="voice-dot" aria-hidden="true" />
            Peer voice connected
            <audio ref={audioRef} autoPlay />
        </div>
    );
}

export function ScreenShare() {
    const controller = useController();
    const dataChannelOpen = useAppState((s) => s.dataChannelOpen);
    const screenSharing = useAppState((s) => s.screenSharing);
    const micActive = useAppState((s) => s.micActive);
    const localStream = useAppState((s) => s.localStream);
    const remoteStream = useAppState((s) => s.remoteStream);

    const screenSupported = screenShareSupported();
    if (!dataChannelOpen) return null;

    const peerHasVideo =
        !!remoteStream && remoteStream.getVideoTracks().length > 0;

    return (
        <div className="panel screen-share">
            <div className="screen-share-head">
                <h2 className="panel-title">Voice &amp; screen</h2>
                <div className="media-controls">
                    <button
                        type="button"
                        className={`btn btn-sm ${
                            micActive ? "btn-primary" : "btn-secondary"
                        }`}
                        onClick={() =>
                            micActive
                                ? void controller.stopVoice()
                                : void controller.startVoice()
                        }
                    >
                        {micActive ? "🎤 Mic on" : "🎤 Start voice"}
                    </button>

                    {screenSupported ? (
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
                                disabled={peerHasVideo}
                                title={
                                    peerHasVideo
                                        ? "Peer is currently sharing"
                                        : "Share your screen"
                                }
                                onClick={() => void controller.startScreenShare()}
                            >
                                Share screen
                            </button>
                        )
                    ) : (
                        <span className="muted-note">
                            Screen sharing isn't supported here.
                        </span>
                    )}
                </div>
            </div>

            {(remoteStream || localStream || micActive) && (
                <div className="video-grid">
                    {remoteStream && <RemoteMedia stream={remoteStream} />}
                    {localStream && (
                        <VideoTile stream={localStream} muted label="Your screen" />
                    )}
                    {micActive && !localStream && (
                        <div className="voice-indicator is-self">
                            <span className="voice-dot" aria-hidden="true" />
                            Your mic is live
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
