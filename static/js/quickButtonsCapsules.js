/* static/js/quickButtonsCapsules.js
 * Two pill "capsules" beside your existing quick buttons:
 *  - Action: [Undo] [Redo]
 *  - Zoom:   [−] [+]
 *
 * No HTML changes. This file records EVERY user action we can observe
 * (cell edits/paste/autofill, insert/remove rows, insert/remove columns,
 * zoom) into a single local history so Undo/Redo step through ALL past
 * actions, not just the most recent one.
 *
 * Handsontable’s native undo may still exist; we don’t rely on it.
 * Our buttons always use the local history first.
 */
(() => {
    const STRIP_ID = 'quickButtons';
    const HOT_ID   = 'hot';

    // ------------------------------
    // Immediate, multi-step history
    // ------------------------------
    const ImmediateHistory = (() => {
        const MAX = 500; // cap to avoid unbounded growth
        const undoStack = [];
        const redoStack = [];

        function clearRedo() { redoStack.length = 0; }
        function push(action) {
        // action: { do: fn, undo: fn, label?: string }
        if (!action || typeof action.undo !== 'function') return;
        undoStack.push(action);
        if (undoStack.length > MAX) undoStack.shift();
        clearRedo();
        }
        function canUndo() { return undoStack.length > 0; }
        function canRedo() { return redoStack.length > 0; }
        function undo() {
        if (!canUndo()) return false;
        const a = undoStack.pop();
        try { a.undo(); } catch(_) {}
        redoStack.push(a);
        return true;
        }
        function redo() {
        if (!canRedo()) return false;
        const a = redoStack.pop();
        try { a.do?.(); } catch(_) {}
        undoStack.push(a);
        return true;
        }
        return { push, undo, redo, canUndo, canRedo };
    })();

    // Optional public hook: other scripts can register actions
    window.ImmediateHistory = window.ImmediateHistory || {
        register: (action) => ImmediateHistory.push(action)
    };

    // ------------------------------
    // Utilities
    // ------------------------------
    const $ = (sel, root=document) => root.querySelector(sel);
    function make(tag, cls, text){
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }
    const getHot = () => (window.hot || null);

    function waitForElement(selector, maxMs = 5000) {
        return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const id = setInterval(() => {
            const el = document.querySelector(selector);
            if (el) { clearInterval(id); resolve(el); }
            else if (performance.now() - t0 > maxMs) { clearInterval(id); reject(new Error('element timeout')); }
        }, 50);
        });
    }

    function waitForHot(maxMs = 5000) {
        return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const id = setInterval(() => {
            const hot = getHot();
            if (hot) { clearInterval(id); resolve(hot); }
            else if (performance.now() - t0 > maxMs) { clearInterval(id); reject(new Error('hot timeout')); }
        }, 50);
        });
    }

    // ------------------------------
    // Zoom support (undoable)
    // ------------------------------
    const Z = { value: 1, min: 0.5, max: 2, step: 0.1 };

    function applyZoom() {
        const hotEl = $(`#${HOT_ID}`);
        if (!hotEl) return;
        hotEl.style.transformOrigin = 'top left';
        hotEl.style.zoom = String(Z.value);
        if (!('zoom' in hotEl.style)) {
        hotEl.style.transform = `scale(${Z.value})`;
        hotEl.style.width = `${100 / Z.value}%`;
        hotEl.style.height = `${100 / Z.value}%`;
        }
    }

    function setZoom(newVal, fromUser = true) {
        const prev = Z.value;
        const next = Math.min(Z.max, Math.max(Z.min, +newVal.toFixed(2)));
        if (next === prev) return;
        Z.value = next;
        applyZoom();

        if (fromUser) {
        ImmediateHistory.push({
            label: 'zoom',
            do:   () => { Z.value = next; applyZoom(); },
            undo: () => { Z.value = prev; applyZoom(); }
        });
        }
    }
    function zoomIn()  { setZoom(Z.value + Z.step); }
    function zoomOut() { setZoom(Z.value - Z.step); }

    // ------------------------------
    // Undo/Redo buttons (local history)
    // ------------------------------
    function doUndo() {
        // Our local history is the source of truth for the buttons.
        if (ImmediateHistory.canUndo()) ImmediateHistory.undo();
    }
    function doRedo() {
        if (ImmediateHistory.canRedo()) ImmediateHistory.redo();
    }

    // ------------------------------
    // Handsontable action capture
    // ------------------------------
    let _replaying = false;

    function snapshotCells(hot, rows, cols) {
        const data = [];
        for (let r of rows) {
        const row = [];
        for (let c of cols) row.push(hot.getDataAtCell(r, c));
        data.push(row);
        }
        return data;
    }

    function setCells(hot, rows, cols, data) {
        const batch = [];
        for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < cols.length; j++) {
            batch.push([rows[i], cols[j], data[i][j], 'qb-replay']);
        }
        }
        // Apply in a batch to reduce hook spam:
        _replaying = true;
        batch.forEach(([r, c, v, src]) => hot.setDataAtCell(r, c, v, src));
        _replaying = false;
    }

    function allRowIndices(hot){ return Array.from({length: hot.countRows()}, (_, i) => i); }
    function allColIndices(hot){ return Array.from({length: hot.countCols()}, (_, i) => i); }

    function wireHandsontableHistory(hot) {
        // 1) Cell edits / paste / autofill → one atomic action per event
        let pending = null;

        hot.addHook('beforeChange', (changes, source) => {
        if (!changes || source === 'loadData' || source === 'qb-replay' || _replaying) return;
        pending = changes.map(([r, c, oldVal, newVal]) => ({ r, c, oldVal, newVal }));
        });

        hot.addHook('afterChange', (changes, source) => {
        if (!changes || source === 'loadData' || source === 'qb-replay' || _replaying) return;
        if (!pending) return;

        const rows = [...new Set(pending.map(x => x.r))].sort((a,b)=>a-b);
        const cols = [...new Set(pending.map(x => x.c))].sort((a,b)=>a-b);
        // Build before/after matrices for the union area:
        const before = snapshotCells(hot, rows, cols);
        // apply pending to "before" snapshot to build "after"
        const map = new Map(pending.map(x => [`${x.r}:${x.c}`, x.newVal]));
        const after = before.map((rowVals, i) => rowVals.map((v, j) => {
            const r = rows[i], c = cols[j];
            const key = `${r}:${c}`;
            return map.has(key) ? map.get(key) : v;
        }));

        // When we captured "before", it was the state *prior to this change*?
        // Actually, "before" now represents current (afterChange has already applied).
        // So rebuild true BEFORE by applying oldVal at those coordinates:
        const trueBefore = after.map(arr => arr.slice());
        for (const {r,c,oldVal} of pending) {
            const ri = rows.indexOf(r), ci = cols.indexOf(c);
            if (ri >= 0 && ci >= 0) trueBefore[ri][ci] = oldVal;
        }

        ImmediateHistory.push({
            label: 'cell-edit',
            do:   () => { _replaying = true; setCells(hot, rows, cols, after);  _replaying = false; },
            undo: () => { _replaying = true; setCells(hot, rows, cols, trueBefore); _replaying = false; }
        });

        pending = null;
        });

        // 2) INSERT ROWS
        // Capture index/amount; redo = insert again; undo = remove them.
        let lastCreateRow = null;
        hot.addHook('beforeCreateRow', (index, amount, source) => {
        if (_replaying) return;
        lastCreateRow = { index, amount };
        });
        hot.addHook('afterCreateRow', (index, amount, source) => {
        if (_replaying) return;
        const { index: idx, amount: amt } = lastCreateRow || { index, amount };
        ImmediateHistory.push({
            label: 'insert-rows',
            do: () => {
            _replaying = true;
            try { hot.alter('insert_row', idx, amt, 'qb-replay'); }
            catch { try { hot.alter('insert_row_above', idx, amt, 'qb-replay'); } catch(_){} }
            _replaying = false;
            },
            undo: () => {
            _replaying = true;
            try { hot.alter('remove_row', idx, amt, 'qb-replay'); } catch(_){}
            _replaying = false;
            }
        });
        lastCreateRow = null;
        });

        // 3) REMOVE ROWS (snapshot removed data to restore)
        let removeRowSnap = null;
        hot.addHook('beforeRemoveRow', (index, amount, physicalRows, source) => {
        if (_replaying) return;
        const rows = Array.from({length: amount}, (_,i)=>index+i);
        const cols = allColIndices(hot);
        const data = snapshotCells(hot, rows, cols);
        removeRowSnap = { index, amount, cols, data };
        });
        hot.addHook('afterRemoveRow', (index, amount, physicalRows, source) => {
        if (_replaying || !removeRowSnap) return;
        const snap = removeRowSnap; removeRowSnap = null;
        ImmediateHistory.push({
            label: 'remove-rows',
            do: () => {
            _replaying = true;
            try { hot.alter('remove_row', snap.index, snap.amount, 'qb-replay'); } catch(_){}
            _replaying = false;
            },
            undo: () => {
            _replaying = true;
            try {
                hot.alter('insert_row', snap.index, snap.amount, 'qb-replay');
                // restore cell data into re-inserted rows
                for (let i=0;i<snap.amount;i++){
                for (let j=0;j<snap.cols.length;j++){
                    hot.setDataAtCell(snap.index+i, snap.cols[j], snap.data[i][j], 'qb-replay');
                }
                }
            } catch(_) {}
            _replaying = false;
            }
        });
        });

        // 4) INSERT COLS
        let lastCreateCol = null;
        hot.addHook('beforeCreateCol', (index, amount, source) => {
        if (_replaying) return;
        lastCreateCol = { index, amount };
        });
        hot.addHook('afterCreateCol', (index, amount, source) => {
        if (_replaying) return;
        const { index: idx, amount: amt } = lastCreateCol || { index, amount };
        ImmediateHistory.push({
            label: 'insert-cols',
            do: () => {
            _replaying = true;
            try { hot.alter('insert_col', idx, amt, 'qb-replay'); }
            catch { try { hot.alter('insert_col_start', idx, amt, 'qb-replay'); } catch(_){} }
            _replaying = false;
            },
            undo: () => {
            _replaying = true;
            try { hot.alter('remove_col', idx, amt, 'qb-replay'); } catch(_){}
            _replaying = false;
            }
        });
        lastCreateCol = null;
        });

        // 5) REMOVE COLS (snapshot removed data to restore)
        let removeColSnap = null;
        hot.addHook('beforeRemoveCol', (index, amount, physicalColumns, source) => {
        if (_replaying) return;
        const rows = allRowIndices(hot);
        const cols = Array.from({length: amount}, (_,i)=>index+i);
        const data = snapshotCells(hot, rows, cols);
        removeColSnap = { index, amount, rows, data };
        });
        hot.addHook('afterRemoveCol', (index, amount, physicalColumns, source) => {
        if (_replaying || !removeColSnap) return;
        const snap = removeColSnap; removeColSnap = null;
        ImmediateHistory.push({
            label: 'remove-cols',
            do: () => {
            _replaying = true;
            try { hot.alter('remove_col', snap.index, snap.amount, 'qb-replay'); } catch(_){}
            _replaying = false;
            },
            undo: () => {
            _replaying = true;
            try {
                hot.alter('insert_col', snap.index, snap.amount, 'qb-replay');
                // restore data into re-inserted columns
                for (let r=0;r<snap.rows.length;r++){
                for (let j=0;j<snap.amount;j++){
                    const c = snap.index + j;
                    hot.setDataAtCell(snap.rows[r], c, snap.data[r][j], 'qb-replay');
                }
                }
            } catch(_) {}
            _replaying = false;
            }
        });
        });

        // (Optional) TODO: merge/unmerge capture if you enable the plugin later.
    }

    // ------------------------------
    // UI injection
    // ------------------------------
    function buildCapsule(labelText, buttons) {
        const cap = make('div', 'qb-capsule');
        const label = make('span', 'qb-label', labelText);
        const group = make('div', 'qb-group');
        buttons.forEach(({ title, aria, text, onClick, id }) => {
        const btn = make('button', 'qb-mini');
        if (id) btn.id = id;
        btn.type = 'button';
        btn.title = title;
        btn.setAttribute('aria-label', aria || title);
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        group.appendChild(btn);
        });
        cap.appendChild(label);
        cap.appendChild(group);
        return cap;
    }

    function injectStyles() {
        const css = `
        #${STRIP_ID} { gap: 8px; }
        #${STRIP_ID} .qb-capsule{
            display:flex; align-items:center; gap:8px;
            padding:6px 8px; border-radius:9999px;
            background:#fff; border:1px solid rgba(0,0,0,.08);
            box-shadow:0 2px 8px rgba(0,0,0,.08);
        }
        #${STRIP_ID} .qb-label{
            font-size:12px; color:#333; opacity:.8; user-select:none;
        }
        #${STRIP_ID} .qb-group{ display:flex; gap:6px; }
        #${STRIP_ID} .qb-mini{
            pointer-events:auto;
            min-width:32px; height:28px; padding:0 10px;
            border-radius:9999px; border:1px solid rgba(0,0,0,.08);
            background:#f9f9f9; cursor:pointer; font-size:13px;
            box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        #${STRIP_ID} .qb-mini:active{ transform:translateY(1px); }
        #${STRIP_ID} .qb-mini:focus{ outline:2px solid #007bff33; outline-offset:1px; }
        @media (max-width: 480px){ #${STRIP_ID} .qb-label{ display:none; } }
        `;
        const style = make('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    async function mount() {
        // Ensure the quick buttons strip exists
        let strip = document.getElementById(STRIP_ID);
        if (!strip) {
        try { strip = await waitForElement(`#${STRIP_ID}`); }
        catch (e) { console.warn('[Capsules] #quickButtons not found:', e); return; }
        }

        injectStyles();

        // Handsontable hooks (if present)
        try {
        const hot = await waitForHot();   // waits up to 5s
        wireHandsontableHistory(hot);     // capture ALL major actions
        } catch (e) {
        console.warn('[Capsules] Proceeding without HOT instance:', e);
        }

        // Capsules: Action + Zoom
        const capHistory = buildCapsule('Action', [
        { id:'qbUndo', title:'Undo', aria:'Undo', text:'Undo', onClick: doUndo },
        { id:'qbRedo', title:'Redo', aria:'Redo', text:'Redo', onClick: doRedo },
        ]);
        const capZoom = buildCapsule('Zoom', [
        { id:'qbZoomOut', title:'Zoom out', aria:'Zoom out', text:'−', onClick: zoomOut },
        { id:'qbZoomIn',  title:'Zoom in',  aria:'Zoom in',  text:'+', onClick: zoomIn  },
        ]);

        strip.appendChild(capHistory);
        strip.appendChild(capZoom);

        setZoom(1, /*fromUser=*/false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
