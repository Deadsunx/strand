import { useEffect, useState } from "react";
import mammoth from "mammoth";
import DOMPurify from "dompurify";
import type { PreviewProps } from "../types.ts";

export default function DocxPreview({ file }: PreviewProps) {
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const arrayBuffer = await (await fetch(file.url)).arrayBuffer();
                if (cancelled) return;
                const result = await mammoth.convertToHtml({ arrayBuffer });
                if (cancelled) return;
                setHtml(DOMPurify.sanitize(result.value));
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [file.url]);

    if (error) return <p className="preview-error">Couldn't render document: {error}</p>;
    if (html === null) return <p className="preview-loading">Rendering document…</p>;

    return (
        <div
            className="preview-doc preview-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
