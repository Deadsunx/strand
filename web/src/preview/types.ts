import type { ComponentType } from "react";

/** A received file to preview. `url` is an object URL for the blob. */
export interface PreviewFile {
    name: string;
    type: string;
    url: string;
}

export interface PreviewProps {
    file: PreviewFile;
}

export type PreviewComponent = ComponentType<PreviewProps>;

/** A lazy loader for a preview handler module (default-exported component). */
export type PreviewLoader = () => Promise<{ default: PreviewComponent }>;
