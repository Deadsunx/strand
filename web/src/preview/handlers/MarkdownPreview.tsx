import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { PreviewProps } from "../types.ts";

export default function MarkdownPreview({ file }: PreviewProps) {
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const text = await (await fetch(file.url)).text();
                if (cancelled) return;
                const rendered = await marked.parse(text, { async: true });
                // Sanitize before rendering — the peer is only semi-trusted, and
                // Markdown can embed arbitrary HTML.
                setHtml(DOMPurify.sanitize(rendered));
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [file.url]);

    if (error) return <p className="preview-error">Couldn't read file: {error}</p>;
    if (html === null) return <p className="preview-loading">Rendering…</p>;

    return (
        <div
            className="preview-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
