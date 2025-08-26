/* static/js/multiSheetFetch.js
 * Fetch { sheets: [{ name, headers, rows }] } from a helper route.
 * No dependencies on your existing files.
 */
(function (global) {
    const MultiSheetFetch = {
        async getAllSheets() {
        // Reuse the existing query param you already use in your template: ?csv_url=...
        const q = new URLSearchParams(location.search);
        const src = q.get("csv_url");
        if (!src) return { sheets: [] };

        const url = `/api/all-sheets?csv_url=${encodeURIComponent(src)}`;
        const res = await fetch(url).catch(() => null);
        if (!res || !res.ok) return { sheets: [] };

        const payload = await res.json().catch(() => ({ sheets: [] }));
        // Normalize: ensure arrays exist
        const sheets = Array.isArray(payload.sheets) ? payload.sheets : [];
        return {
            sheets: sheets.map(s => ({
            name: String(s.name || "Sheet"),
            headers: Array.isArray(s.headers) ? s.headers : [],
            rows: Array.isArray(s.rows) ? s.rows : []
            }))
        };
        }
    };
    global.MultiSheetFetch = MultiSheetFetch;
})(window);
