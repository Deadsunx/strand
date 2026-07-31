import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import DOMPurify from "dompurify";
import type { PreviewProps } from "../types.ts";

const MAX_ROWS = 500; // cap render so a giant sheet can't lock the tab

export default function SpreadsheetPreview({ file }: PreviewProps) {
    const [sheets, setSheets] = useState<string[]>([]);
    const [active, setActive] = useState(0);
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
    const [truncated, setTruncated] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const buf = await (await fetch(file.url)).arrayBuffer();
                if (cancelled) return;
                const wb = XLSX.read(buf, { sheetRows: MAX_ROWS + 1 });
                if (cancelled) return;
                setWorkbook(wb);
                setSheets(wb.SheetNames);
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [file.url]);

    useEffect(() => {
        if (!workbook || sheets.length === 0) return;
        const sheet = workbook.Sheets[sheets[active]];
        const ref = sheet["!ref"];
        if (ref) {
            const range = XLSX.utils.decode_range(ref);
            setTruncated(range.e.r - range.s.r + 1 > MAX_ROWS);
        }
        setHtml(DOMPurify.sanitize(XLSX.utils.sheet_to_html(sheet)));
    }, [workbook, sheets, active]);

    if (error) return <p className="preview-error">Couldn't read spreadsheet: {error}</p>;
    if (html === null) return <p className="preview-loading">Reading spreadsheet…</p>;

    return (
        <div className="preview-sheet">
            {sheets.length > 1 && (
                <div className="sheet-tabs" role="tablist">
                    {sheets.map((name, i) => (
                        <button
                            key={name}
                            type="button"
                            role="tab"
                            aria-selected={i === active}
                            className={`sheet-tab ${i === active ? "is-active" : ""}`}
                            onClick={() => setActive(i)}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            )}
            <div
                className="sheet-table"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {truncated && (
                <p className="preview-note">
                    Showing first {MAX_ROWS} rows — download for the full sheet.
                </p>
            )}
        </div>
    );
}
