import type { PreviewProps } from "../types.ts";

export default function AudioPreview({ file }: PreviewProps) {
    return (
        <div className="preview-audio">
            <p className="preview-audio-name">{file.name}</p>
            <audio src={file.url} controls autoPlay>
                Your browser can't play this audio format.
            </audio>
        </div>
    );
}
