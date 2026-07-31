import type { PreviewProps } from "../types.ts";

export default function ImagePreview({ file }: PreviewProps) {
    return (
        <div className="preview-image">
            <img src={file.url} alt={file.name} />
        </div>
    );
}
