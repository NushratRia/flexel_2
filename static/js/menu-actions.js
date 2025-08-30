/* menu-actions.js
 * Wires <div onclick="menuAction('…')"> items to real actions.
 * - Requires: window.hot (Handsontable instance), #hot container exists.
 * - No HTML structure changes; everything is done via JS.
 */

(function () {
  // Bail out if HOT isn't ready yet; retry a few times.
    let retries = 0;
    function waitForHot() {
        if (window.hot && window.hot.getData) {
        bootstrap();
        } else if (retries < 40) {
        retries++;
        setTimeout(waitForHot, 100);
        } else {
        console.warn("[menu-actions] Handsontable instance not found (window.hot).");
        }
    }
    waitForHot();

    function bootstrap() {
        const hot = window.hot;
        const container = document.getElementById("hot");

        // --- Lightweight CSS injected for gridlines + formatting ---
        injectStyles(`
        /* Toggle gridlines off by adding .no-gridlines on #hot */
        #hot.no-gridlines .handsontable td,
        #hot.no-gridlines .handsontable th { border-color: transparent !important; }

        .cell-bold { font-weight: 700 !important; }
        .cell-italic { font-style: italic !important; }
        `);

        // Ensure columnSorting plugin can be used on demand
        try {
        const cs = hot.getPlugin("columnSorting");
        if (cs && cs.enablePlugin) cs.enablePlugin();
        } catch (e) {
        console.debug("[menu-actions] columnSorting enable attempt:", e);
        }

        // Track a few toggles
        let gridlinesHidden = false;
        let frozenTop = hot.getSettings().fixedRowsTop || 0;
        let protectedSheet = false;

        // Replace inline onclick handlers at runtime with precise actions,
        // so we can distinguish "Download as CSV" vs "Download as Excel".
        wireMenuTextToActions();

        // Expose global for your inline onclick="menuAction('…')" calls.
        // (We keep the same name to honor your markup.)
        window.menuAction = function (action) {
        if (!hot) return;

        // Fallback: infer more specific intent from the last clicked label, if any.
        const last = lastClickedLabel || "";
        const label = (action || "").toLowerCase();
        const precise = normalizeAction(label, last.toLowerCase());

        try {
            switch (precise) {
            case "new":
                doNew();
                break;
            case "open":
                doOpenCSV();
                break;
            case "download_csv":
                downloadCSV();
                break;
            case "download_excel":
                downloadExcelXML();
                break;

            case "undo":
                (hot.getPlugin("undoRedo")?.undo?.()) ?? console.warn("Undo plugin unavailable");
                break;
            case "redo":
                (hot.getPlugin("undoRedo")?.redo?.()) ?? console.warn("Redo plugin unavailable");
                break;
            case "clear":
                clearSelection();
                break;

            case "freeze_row":
                frozenTop = frozenTop ? 0 : 1;
                hot.updateSettings({ fixedRowsTop: frozenTop });
                break;
            case "gridlines":
                gridlinesHidden = !gridlinesHidden;
                container.classList.toggle("no-gridlines", gridlinesHidden);
                break;

            case "insert_row":
                insertRow();
                break;
            case "insert_column":
                insertCol();
                break;

            case "bold":
                toggleFormatClass("cell-bold");
                break;
            case "italic":
                toggleFormatClass("cell-italic");
                break;

            case "sort_asc":
                sortBySelection("asc");
                break;
            case "sort_desc":
                sortBySelection("desc");
                break;

            case "spell_check":
                alert("Spell Check uses the browser's built-in spellchecker in editors.");
                break;
            case "protect_sheet":
                protectedSheet = !protectedSheet;
                hot.updateSettings({ readOnly: protectedSheet });
                if (protectedSheet) {
                // Keep header row selectable but not editable
                hot.updateSettings({
                    cells: (row, col) => {
                    const cellProps = {};
                    cellProps.readOnly = true;
                    return cellProps;
                    },
                });
                } else {
                hot.updateSettings({ cells: undefined });
                }
                break;

            case "add_ons":
                alert("Add-ons: no add-ons registered.");
                break;

            case "docs":
                window.open("https://handsontable.com/docs/", "_blank", "noopener,noreferrer");
                break;
            case "send_feedback":
                window.open("mailto:feedback@example.com?subject=Spreadsheet%20Feedback");
                break;

            default:
                console.log("Unknown menu action:", action);
            }
        } catch (err) {
            console.error("Menu action failed:", precise, err);
            alert("⚠️ Action failed.");
        }
        };

        // ————— Helpers —————

        function injectStyles(css) {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
        }

        // Normalize action intent (given ambiguous 'Download')
        function normalizeAction(label, lastLabel) {
        if (label === "download") {
            if (lastLabel.includes("excel")) return "download_excel";
            return "download_csv";
        }
        const map = {
            "new": "new",
            "open": "open",
            "download as csv": "download_csv",
            "download csv": "download_csv",
            "download as excel": "download_excel",
            "download excel": "download_excel",

            "undo": "undo",
            "redo": "redo",
            "clear cell": "clear",
            "clear": "clear",

            "freeze row": "freeze_row",
            "toggle gridlines": "gridlines",

            "insert row": "insert_row",
            "insert column": "insert_column",

            "bold": "bold",
            "italic": "italic",

            "sort ascending": "sort_asc",
            "sort descending": "sort_desc",

            "spell check": "spell_check",
            "protect sheet": "protect_sheet",

            "add-ons": "add_ons",
            "add-ons.": "add_ons",
            "add ons": "add_ons",

            "docs": "docs",
            "send feedback": "send_feedback",
        };
        return map[label] || label;
        }

        // Keep track of the most recently clicked label text (from the dropdown)
        let lastClickedLabel = "";
        function wireMenuTextToActions() {
        document.querySelectorAll(".menu-bar .dropdown div").forEach((el) => {
            const label = (el.textContent || "").trim();
            // Override inline handler so we can disambiguate "Download"
            el.onclick = (ev) => {
            lastClickedLabel = label;
            window.menuAction(label); // route using precise label text
            ev?.stopPropagation?.();
            };
        });
        }

        function getSelectionRect() {
        const s = hot.getSelectedLast();
        if (!s) return null;
        const [r1, c1, r2, c2] = s;
        return {
            r1: Math.min(r1, r2),
            c1: Math.min(c1, c2),
            r2: Math.max(r1, r2),
            c2: Math.max(c1, c2),
        };
        }

        function clearSelection() {
        const sel = getSelectionRect();
        if (!sel) return;
        const ops = [];
        for (let r = sel.r1; r <= sel.r2; r++) {
            for (let c = sel.c1; c <= sel.c2; c++) {
            ops.push([r, c, ""]);
            }
        }
        hot.setDataAtCell(ops);
        }

        function insertRow() {
        const sel = getSelectionRect();
        const at = sel ? sel.r1 : (hot.countRows() || 0);
        hot.alter("insert_row", at, 1);
        }

        function insertCol() {
        const sel = getSelectionRect();
        const at = sel ? sel.c1 : (hot.countCols() || 0);
        hot.alter("insert_col", at, 1);
        }

        function toggleFormatClass(className) {
        const sel = getSelectionRect();
        if (!sel) return;
        // Determine if ALL selected cells already have the class
        let allHave = true;
        for (let r = sel.r1; r <= sel.r2; r++) {
            for (let c = sel.c1; c <= sel.c2; c++) {
            const existing = (hot.getCellMeta(r, c).className || "");
            if (!existing.split(/\s+/).includes(className)) {
                allHave = false;
                break;
            }
            }
            if (!allHave) break;
        }
        const shouldAdd = !allHave;
        // Apply toggle
        for (let r = sel.r1; r <= sel.r2; r++) {
            for (let c = sel.c1; c <= sel.c2; c++) {
            const meta = hot.getCellMeta(r, c);
            const classes = new Set((meta.className || "").split(/\s+/).filter(Boolean));
            if (shouldAdd) classes.add(className);
            else classes.delete(className);
            hot.setCellMeta(r, c, "className", Array.from(classes).join(" "));
            }
        }
        hot.render();
        }

        function sortBySelection(direction) {
        const sel = getSelectionRect();
        const col = sel ? sel.c1 : 0;
        const plugin = hot.getPlugin("columnSorting");
        if (!plugin) return;
        try {
            plugin.sort({ column: col, sortOrder: direction === "desc" ? "desc" : "asc" });
            hot.render();
        } catch (e) {
            console.warn("Sort failed:", e);
        }
        }

        function doNew() {
        if (!confirm("Start a new sheet? This will clear all data (except the header row).")) return;

        const rows = hot.countRows();
        const cols = hot.countCols();

        // Keep header row (row 0) as-is; clear everything below.
        const ops = [];
        for (let r = 1; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
            ops.push([r, c, ""]);
            }
        }
        hot.setDataAtCell(ops);
        // Also clear custom meta/formatting
        hot.clearUndo();
        hot.render();
        }

        function doOpenCSV() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,text/csv";
        input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const text = await file.text();
            const rows = parseCSV(text);
            if (!rows.length) return;

            const maxCols = Math.max(...rows.map((r) => r.length));
            // Expand sheet if needed
            const needRows = Math.max(rows.length, hot.countRows());
            const needCols = Math.max(maxCols, hot.countCols());
            if (needRows > hot.countRows()) hot.alter("insert_row", hot.countRows(), needRows - hot.countRows());
            if (needCols > hot.countCols()) hot.alter("insert_col", hot.countCols(), needCols - hot.countCols());

            // Write data
            const ops = [];
            for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                ops.push([r, c, rows[r][c]]);
            }
            }
            hot.setDataAtCell(ops);
            hot.render();
        });
        input.click();
        }

        function downloadCSV() {
        const data = hot.getData();
        const csv = toCSV(data);
        triggerDownload("sheet.csv", "text/csv;charset=utf-8", csv);
        }

        // Minimal Excel 2003 XML (opens in Excel/Google Sheets)
        function downloadExcelXML() {
        const data = hot.getData();
        const xml = toExcelXML(data);
        triggerDownload("sheet.xls", "application/vnd.ms-excel", xml);
        }

        function triggerDownload(filename, mime, content) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        }

        function toCSV(rows) {
        return rows
            .map((r) =>
            r
                .map((v) => {
                const s = v == null ? "" : String(v);
                if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
                return s;
                })
                .join(",")
            )
            .join("\n");
        }

        function parseCSV(text) {
        // Simple RFC4180-ish CSV parser
        const rows = [];
        let row = [];
        let i = 0,
            cur = "";
        let inQuotes = false;

        while (i < text.length) {
            const ch = text[i];
            if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                cur += '"';
                i += 2;
                continue;
                } else {
                inQuotes = false;
                i++;
                continue;
                }
            } else {
                cur += ch;
                i++;
                continue;
            }
            } else {
            if (ch === '"') {
                inQuotes = true;
                i++;
                continue;
            }
            if (ch === ",") {
                row.push(cur);
                cur = "";
                i++;
                continue;
            }
            if (ch === "\n" || ch === "\r") {
                // handle CRLF or LF
                row.push(cur);
                cur = "";
                rows.push(row);
                row = [];
                // skip \r\n pair
                if (ch === "\r" && text[i + 1] === "\n") i++;
                i++;
                continue;
            }
            cur += ch;
            i++;
            }
        }
        row.push(cur);
        rows.push(row);
        return rows;
        }

        function toExcelXML(rows) {
        const esc = (s) =>
            String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const tableRows = rows
            .map(
            (r) =>
                `<Row>${r
                .map((c) => `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`)
                .join("")}</Row>`
            )
            .join("");

        return `<?xml version="1.0"?>
    <?mso-application progid="Excel.Sheet"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:html="http://www.w3.org/TR/REC-html40">
    <Worksheet ss:Name="Sheet1">
        <Table>${tableRows}</Table>
    </Worksheet>
    </Workbook>`;
        }
  }
})();
