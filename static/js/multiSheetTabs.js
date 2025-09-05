/* static/js/multiSheetTabs.js

 */
(function (global) {
    function colLabel(i) {
        let n = i, s = "";
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
    }

    function buildMatrix(headers, rows, padCols = 26, padRows = 20) {
        const body = rows || [];
        const allRows = [headers || [], ...body];
        const totalRows = allRows.length + padRows;
        const totalCols = Math.max((headers || []).length + 10, padCols);

        const data = Array.from({ length: totalRows }, (_, r) =>
        Array.from({ length: totalCols }, (_, c) =>
            (allRows[r] && allRows[r][c]) ? allRows[r][c] : ""
        )
        );
        const colHeaders = Array.from({ length: totalCols }, (_, i) => colLabel(i));
        return { data, colHeaders };
    }

    function makeTabsHost() {
        let host = document.getElementById("sheetTabsHost");
        if (host) return host;
        const toolbar = document.querySelector(".sheet-toolbar");
        host = document.createElement("div");
        host.id = "sheetTabsHost";
        Object.assign(host.style, {
        display: "flex",
        gap: "8px",
        marginLeft: "12px",
        alignItems: "center",
        fontSize: "13px",
        fontWeight: "500"
        });
        toolbar && toolbar.appendChild(host);
        return host;
    }

    function renderTabs(host, sheets, onPick) {
        host.innerHTML = "";
        sheets.forEach((s, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = s.name;
        Object.assign(btn.style, {
            border: "1px solid #ddd",
            background: idx === 0 ? "#e9f1ff" : "#fff",
            padding: "4px 8px",
            borderRadius: "8px",
            cursor: "pointer"
        });
        btn.addEventListener("click", () => onPick(idx));
        host.appendChild(btn);
        });
    }

    const MultiSheetTabs = {
        _hot: null,
        _sheets: [],
        _current: 0,

        async init(hot) {
        this._hot = hot;
        const { sheets } = await (window.MultiSheetFetch || { getAllSheets: async () => ({ sheets: [] }) }).getAllSheets();
        if (!sheets.length) return; // nothing to do; your primary sheet stays visible

        this._sheets = sheets;

        // Inject a small tabs strip to the right of your editable title
        const host = makeTabsHost();

        // Initial render + load the first sheet (index 0) into the SAME hot instance
        const pick = (idx) => {
            this._current = idx;
            // Visual active state
            Array.from(host.children).forEach((b, i) => b.style.background = (i === idx ? "#e9f1ff" : "#fff"));

            const s = this._sheets[idx];
            const { data, colHeaders } = buildMatrix(s.headers, s.rows);

            // 1) swap table data
            this._hot.loadData(data);
            // 2) keep your style: A–Z headers + frozen first row
            this._hot.updateSettings({ colHeaders, fixedRowsTop: 1 });

            // 3) update the editable title (optional)
            const title = document.getElementById("editableTitle");
            if (title && title.textContent) title.textContent = s.name;
        };

        renderTabs(host, this._sheets, pick);
        pick(0);
        }
    };

    global.MultiSheetTabs = MultiSheetTabs;



    document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#tipsPanel .gif-hover').forEach(img => {
        const still = img.getAttribute('data-still');
        const gif   = img.getAttribute('data-gif');
        if (still) img.src = still; // start with static frame
        img.addEventListener('mouseenter', () => { if (gif)   img.src = gif;   });
        img.addEventListener('mouseleave', () => { if (still) img.src = still; });
        // Optional: reapply still when panel closes
        document.getElementById('closeTipsBtn')?.addEventListener('click', () => { if (still) img.src = still; });
        });
    });
})(window);
