import { useEffect, useRef, useState } from "react";
import { readPsd } from "ag-psd";
import type { PreviewProps } from "../types.ts";

export default function PsdPreview({ file }: PreviewProps) {
    const holderRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        let cancelled = false;
        const holder = holderRef.current;
        (async () => {
            try {
                const buf = await (await fetch(file.url)).arrayBuffer();
                if (cancelled) return;
                // Only the composited image is needed for a preview.
                const psd = readPsd(buf, {
                    skipLayerImageData: true,
                    skipThumbnail: true,
                });
                const canvas = psd.canvas;
                if (!canvas || !holder) {
                    setStatus("error");
                    return;
                }
                canvas.className = "psd-canvas";
                holder.appendChild(canvas);
                if (!cancelled) setStatus("ready");
            } catch {
                if (!cancelled) setStatus("error");
            }
        })();
        return () => {
            cancelled = true;
            if (holder) holder.innerHTML = "";
        };
    }, [file.url]);

    return (
        <div className="preview-psd">
            {status === "loading" && <p className="preview-loading">Rendering PSD…</p>}
            {status === "error" && (
                <p className="preview-error">Couldn't render this PSD file.</p>
            )}
            <div ref={holderRef} className="psd-holder" />
        </div>
    );
}
