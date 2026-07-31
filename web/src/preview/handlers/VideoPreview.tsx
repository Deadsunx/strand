import type { PreviewProps } from "../types.ts";

export default function VideoPreview({ file }: PreviewProps) {
    return (
        <div className="preview-video">
            <video src={file.url} controls autoPlay playsInline>
                Your browser can't play this video format.
            </video>
        </div>
    );
}
