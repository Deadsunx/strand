import { useEffect, useState } from "react";
import heic2any from "heic2any";
import type { PreviewProps } from "../types.ts";

export default function HeicPreview({ file }: PreviewProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;
        (async () => {
            try {
                const blob = await (await fetch(file.url)).blob();
                if (cancelled) return;
                const converted = (await heic2any({
                    blob,
                    toType: "image/jpeg",
                    quality: 0.9,
                })) as Blob;
                if (cancelled) return;
                objectUrl = URL.createObjectURL(converted);
                setUrl(objectUrl);
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            }
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [file.url]);

    if (error) return <p className="preview-error">Couldn't convert HEIC image: {error}</p>;
    if (url === null) return <p className="preview-loading">Converting HEIC…</p>;

    return (
        <div className="preview-image">
            <img src={url} alt={file.name} />
        </div>
    );
}
