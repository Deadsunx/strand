// Maps file extensions to lazily-loaded preview handlers. Every handler module
// is code-split behind a dynamic import, so heavy dependencies (pdfjs,
// highlight.js, marked/DOMPurify) never enter the first-load bundle — they load
// only when a user actually previews that file type.

import type { PreviewLoader } from "./types.ts";

interface PreviewEntry {
    kind: string;
    load: PreviewLoader;
}

const IMAGE = {
    kind: "image",
    load: () => import("./handlers/ImagePreview.tsx"),
} satisfies PreviewEntry;
const VIDEO = {
    kind: "video",
    load: () => import("./handlers/VideoPreview.tsx"),
} satisfies PreviewEntry;
const AUDIO = {
    kind: "audio",
    load: () => import("./handlers/AudioPreview.tsx"),
} satisfies PreviewEntry;
const TEXT = {
    kind: "text",
    load: () => import("./handlers/TextPreview.tsx"),
} satisfies PreviewEntry;
const MARKDOWN = {
    kind: "markdown",
    load: () => import("./handlers/MarkdownPreview.tsx"),
} satisfies PreviewEntry;
const PDF = {
    kind: "pdf",
    load: () => import("./handlers/PdfPreview.tsx"),
} satisfies PreviewEntry;
const DOCX = {
    kind: "docx",
    load: () => import("./handlers/DocxPreview.tsx"),
} satisfies PreviewEntry;
const SPREADSHEET = {
    kind: "spreadsheet",
    load: () => import("./handlers/SpreadsheetPreview.tsx"),
} satisfies PreviewEntry;
const PSD = {
    kind: "psd",
    load: () => import("./handlers/PsdPreview.tsx"),
} satisfies PreviewEntry;
const HEIC = {
    kind: "heic",
    load: () => import("./handlers/HeicPreview.tsx"),
} satisfies PreviewEntry;

const REGISTRY: Record<string, PreviewEntry> = {};
const register = (entry: PreviewEntry, extensions: string[]): void => {
    for (const ext of extensions) REGISTRY[ext] = entry;
};

register(IMAGE, ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "ico"]);
register(VIDEO, ["mp4", "webm", "ogv", "mov", "m4v", "mkv"]);
register(AUDIO, ["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus"]);
register(MARKDOWN, ["md", "markdown", "mdown"]);
register(PDF, ["pdf"]);
register(DOCX, ["docx"]);
register(SPREADSHEET, ["xlsx", "xls", "ods"]);
register(PSD, ["psd", "psb"]);
register(HEIC, ["heic", "heif"]);
register(TEXT, [
    "txt", "text", "log", "csv", "tsv", "json", "xml", "yaml", "yml", "ini",
    "toml", "env", "js", "jsx", "ts", "tsx", "mjs", "cjs", "css", "scss",
    "less", "html", "htm", "vue", "svelte", "py", "rb", "php", "java", "kt",
    "c", "h", "cpp", "hpp", "cc", "cs", "go", "rs", "swift", "sh", "bash",
    "zsh", "sql", "graphql", "dockerfile", "makefile", "conf",
]);

export function fileExtension(name: string): string {
    const parts = name.toLowerCase().split(".");
    return parts.length > 1 ? (parts.pop() as string) : "";
}

export function isPreviewable(name: string): boolean {
    return fileExtension(name) in REGISTRY;
}

export function previewLoaderFor(name: string): PreviewLoader | null {
    const entry = REGISTRY[fileExtension(name)];
    return entry ? entry.load : null;
}
