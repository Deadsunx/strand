import { useState } from "react";
import { useAppState } from "../app/AppContext.tsx";
import { formatBytes, percent } from "./format.ts";
import { isPreviewable } from "../preview/registry.ts";
import { PreviewModal } from "../preview/PreviewModal.tsx";
import type { PreviewFile } from "../preview/types.ts";

export function ReceivePanel() {
    const items = useAppState((s) => s.receiveItems);
    const [preview, setPreview] = useState<PreviewFile | null>(null);

    return (
        <div className="panel receive-panel">
            <h2 className="panel-title">Receiving</h2>
            <ul className="file-list">
                {items.length === 0 && (
                    <li className="empty-state">Waiting for incoming files</li>
                )}
                {items.map((item) => (
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
                            value={percent(item.received, item.size)}
                        />
                        <div className="file-foot">
                            <span className="file-status">
                                {item.status === "receiving" &&
                                    `${percent(item.received, item.size)}%`}
                                {item.status === "complete" &&
                                    (item.executable ? "⚠ Executable" : "Complete")}
                                {item.status === "error" && "Failed"}
                            </span>
                            {item.status === "receiving" && item.etr && (
                                <span className="file-etr">{item.etr}</span>
                            )}
                            {item.status === "complete" &&
                                item.url &&
                                !item.executable &&
                                isPreviewable(item.name) && (
                                    <button
                                        type="button"
                                        className="link-btn"
                                        onClick={() =>
                                            setPreview({
                                                name: item.name,
                                                type: item.type,
                                                url: item.url as string,
                                            })
                                        }
                                    >
                                        Preview
                                    </button>
                                )}
                            {item.status === "complete" && item.url && (
                                <a
                                    className="link-btn"
                                    href={item.url}
                                    download={item.name}
                                >
                                    Download
                                </a>
                            )}
                        </div>
                        {item.executable && item.status === "complete" && (
                            <p className="exec-warning" role="note">
                                This is an executable file. Only open it if you
                                trust the sender.
                            </p>
                        )}
                    </li>
                ))}
            </ul>
            {preview && (
                <PreviewModal file={preview} onClose={() => setPreview(null)} />
            )}
        </div>
    );
}
