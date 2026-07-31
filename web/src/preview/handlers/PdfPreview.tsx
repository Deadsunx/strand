import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
// Vite resolves this to a hashed URL; the worker loads only with this handler.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PreviewProps } from "../types.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 20; // cap rendering so a huge PDF can't lock the tab

export default function PdfPreview({ file }: PreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [pageCount, setPageCount] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const container = containerRef.current;

        (async () => {
            try {
                const buffer = await (await fetch(file.url)).arrayBuffer();
                if (cancelled) return;
                const doc = await pdfjs.getDocument({ data: buffer }).promise;
                if (cancelled) return;
                setPageCount(doc.numPages);

                const pagesToRender = Math.min(doc.numPages, MAX_PAGES);
                for (let n = 1; n <= pagesToRender; n++) {
                    const page = await doc.getPage(n);
                    if (cancelled) return;
                    const viewport = page.getViewport({ scale: 1.3 });
                    const canvas = document.createElement("canvas");
                    canvas.className = "pdf-page";
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext("2d");
                    if (!ctx || !container) continue;
                    container.appendChild(canvas);
                    await page.render({ canvasContext: ctx, viewport, canvas })
                        .promise;
                }
                if (!cancelled) setStatus("ready");
            } catch {
                if (!cancelled) setStatus("error");
            }
        })();

        return () => {
            cancelled = true;
            if (container) container.innerHTML = "";
        };
    }, [file.url]);

    return (
        <div className="preview-pdf">
            {status === "loading" && <p className="preview-loading">Loading PDF…</p>}
            {status === "error" && (
                <p className="preview-error">Couldn't render this PDF.</p>
            )}
            {status === "ready" && pageCount > MAX_PAGES && (
                <p className="preview-note">
                    Showing first {MAX_PAGES} of {pageCount} pages — download for
                    the rest.
                </p>
            )}
            <div ref={containerRef} className="pdf-pages" />
        </div>
    );
}
