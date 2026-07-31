import { Suspense, lazy, useEffect, useMemo, useRef } from "react";
import { previewLoaderFor } from "./registry.ts";
import type { PreviewFile } from "./types.ts";

export function PreviewModal({
    file,
    onClose,
}: {
    file: PreviewFile;
    onClose: () => void;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    const Handler = useMemo(() => {
        const loader = previewLoaderFor(file.name);
        return loader ? lazy(loader) : null;
    }, [file.name]);

    // Focus management + Escape to close + basic focus trap.
    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        closeRef.current?.focus();

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                onClose();
                return;
            }
            if (e.key !== "Tab") return;
            const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button, a[href], video, audio, [tabindex]:not([tabindex="-1"])'
            );
            if (!focusables || focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }

        document.addEventListener("keydown", onKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            document.body.style.overflow = prevOverflow;
            previouslyFocused?.focus();
        };
    }, [onClose]);

    return (
        <div
            className="preview-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="preview-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Preview of ${file.name}`}
                ref={dialogRef}
            >
                <header className="preview-header">
                    <span className="preview-title" title={file.name}>
                        {file.name}
                    </span>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onClose}
                        aria-label="Close preview"
                        ref={closeRef}
                    >
                        ✕
                    </button>
                </header>
                <div className="preview-body">
                    {Handler ? (
                        <Suspense
                            fallback={
                                <p className="preview-loading">Loading preview…</p>
                            }
                        >
                            <Handler file={file} />
                        </Suspense>
                    ) : (
                        <p className="preview-error">
                            No preview available for this file type.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
