import { useRef, useState } from "react";
import {
    useAppActions,
    useAppState,
    useController,
} from "../app/AppContext.tsx";
import { formatBytes, percent } from "./format.ts";

export function SendPanel() {
    const controller = useController();
    const actions = useAppActions();
    const sendQueue = useAppState((s) => s.sendQueue);
    const dataChannelOpen = useAppState((s) => s.dataChannelOpen);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    function addFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        controller.enqueueFiles(Array.from(files));
    }

    return (
        <div className="panel send-panel">
            <h2 className="panel-title">Sending</h2>

            <div
                className={`dropzone ${dragging ? "is-dragging" : ""}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    addFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                    }
                }}
                aria-label="Add files to send. Click or drop files here."
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = "";
                    }}
                />
                <span className="dropzone-icon" aria-hidden="true">
                    ⬆
                </span>
                <span>
                    {dataChannelOpen
                        ? "Drop files or click to select"
                        : "You can queue files now; they'll send once connected"}
                </span>
            </div>

            <ul className="file-list">
                {sendQueue.length === 0 && (
                    <li className="empty-state">Select files to send</li>
                )}
                {sendQueue.map((item) => (
                    <li key={item.id} className={`file-row status-${item.status}`}>
                        <div className="file-meta">
                            <span className="file-name" title={item.name}>
                                {item.name}
                            </span>
                            <span className="file-size">
                                {formatBytes(item.size)}
                            </span>
                        </div>
                        <progress
                            max={100}
                            value={percent(item.sent, item.size)}
                        />
                        <div className="file-foot">
                            <span className="file-status">
                                {item.status === "sending" && `${percent(item.sent, item.size)}%`}
                                {item.status === "sent" && "Sent"}
                                {item.status === "queued" && "Queued"}
                                {item.status === "error" && "Failed"}
                            </span>
                            {item.status === "sending" && item.etr && (
                                <span className="file-etr">{item.etr}</span>
                            )}
                            {(item.status === "queued" ||
                                item.status === "error") && (
                                <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => actions.removeSendItem(item.id)}
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
