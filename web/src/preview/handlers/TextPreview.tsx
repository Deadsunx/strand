import { useEffect, useState } from "react";
// Use the core build and register only a curated language set — the full
// highlight.js bundles ~190 languages (~950 KB). This keeps the lazy chunk small.
import hljs from "highlight.js/lib/core";
import "highlight.js/styles/github-dark.css";
import { fileExtension } from "../registry.ts";
import type { PreviewProps } from "../types.ts";

import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import plaintext from "highlight.js/lib/languages/plaintext";

for (const [name, lang] of Object.entries({
    javascript, typescript, python, ruby, rust, go, java, kotlin, c, cpp,
    csharp, bash, json, yaml, xml, css, scss, sql, php, swift, ini,
    dockerfile, plaintext,
})) {
    hljs.registerLanguage(name, lang);
}

// Cap what we render so a huge log file can't freeze the tab.
const MAX_CHARS = 500_000;

// Map a few extensions to highlight.js language ids; fall back to auto-detect.
const LANG_BY_EXT: Record<string, string> = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", kt: "kotlin",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cs: "csharp",
    sh: "bash", bash: "bash", zsh: "bash",
    json: "json", yaml: "yaml", yml: "yaml", xml: "xml", html: "xml",
    css: "css", scss: "scss", sql: "sql", php: "php", swift: "swift",
};

export default function TextPreview({ file }: PreviewProps) {
    const [html, setHtml] = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const text = await (await fetch(file.url)).text();
                if (cancelled) return;
                const clipped = text.slice(0, MAX_CHARS);
                setTruncated(text.length > MAX_CHARS);

                const lang = LANG_BY_EXT[fileExtension(file.name)];
                const result =
                    lang && hljs.getLanguage(lang)
                        ? hljs.highlight(clipped, { language: lang })
                        : hljs.highlightAuto(clipped);
                setHtml(result.value);
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [file.url, file.name]);

    if (error) return <p className="preview-error">Couldn't read file: {error}</p>;
    if (html === null) return <p className="preview-loading">Reading…</p>;

    return (
        <div className="preview-text">
            <pre>
                {/* highlight.js output is escaped HTML with span wrappers. */}
                <code
                    className="hljs"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            </pre>
            {truncated && (
                <p className="preview-note">
                    Preview truncated — download to view the full file.
                </p>
            )}
        </div>
    );
}
