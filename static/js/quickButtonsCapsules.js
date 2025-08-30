/* static/js/quickButtonsCapsules.js
 * Adds two "capsules" beside your existing quick buttons:
 *  - Action: [Undo] [Redo]
 *  - Zoom:   [−] [+]
 *
 * Requirements:
 *  - Does NOT change your HTML structure.
 *  - Prefers Handsontable's native undo/redo if available.
 *  - Also provides a fallback so typing in cells can be undone/redone
 *    even if the native stack wasn't enabled in time.
 */
(() => {
    const STRIP_ID = 'quickButtons';
    const HOT_ID   = 'hot';

    // ------------------------------
    // Immediate, lightweight history
    // ------------------------------
    const ImmediateHistory = (() => {
        const undoStack = [];
        const redoStack = [];

        function clearRedo() { redoStack.length = 0; }
        function push(action) {
        // action: { do: fn, undo: fn, label?: string }
        if (!action || typeof action.undo !== 'function') return;
        undoStack.push(action);
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

    // expose a tiny API in case other scripts want to register actions later
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

    // Wait until an element exists in DOM
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

    // wait for window.hot (Handsontable instance) to be ready
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

    // enable Handsontable native undo/redo (works across versions)
    function ensureHotUndoRedo(hot) {
        try {
        // turn on options (harmless if already on)
        hot.updateSettings({ undo: true, undoRedo: true });
        const p = hot.getPlugin && hot.getPlugin('undoRedo');
        if (p && p.enablePlugin) p.enablePlugin();
        } catch (e) {
        console.warn('[Capsules] Unable to enable HOT undoRedo:', e);
        }
    }

    function hasNativeUndo(hot) {
        try {
        if (typeof hot.undo === 'function' || typeof hot.redo === 'function') return true;
        const p = hot.getPlugin && hot.getPlugin('undoRedo');
        return !!(p && (typeof p.undo === 'function' || typeof p.redo === 'function'));
        } catch (_) { return false; }
    }

    // ------------------------------
    // Zoom support (immediate stack)
    // ------------------------------
    const Z = { value: 1, min: 0.5, max: 2, step: 0.1 };

    function applyZoom() {
        const hotEl = $(`#${HOT_ID}`);
        if (!hotEl) return;
        hotEl.style.transformOrigin = 'top left';
        // Prefer CSS zoom (Chromium)
        hotEl.style.zoom = String(Z.value);
        // Fallback for browsers without zoom support (Safari)
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

        // Only register user-triggered changes as "immediate actions"
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

    // ------------------------------------------
    // Undo/Redo that prefer Handsontable history
    // ------------------------------------------
    function doUndo() {
        const hot = getHot();
        if (hot) {
        try {
            if (typeof hot.undo === 'function') { hot.undo(); return; }
            const p = hot.getPlugin && hot.getPlugin('undoRedo');
            if (p && typeof p.undo === 'function') { p.undo(); return; }
        } catch (e) {
            console.warn('[Capsules] HOT undo error:', e);
        }
        }
        // Fallback: our immediate stack (e.g., zoom or captured cell edits)
        if (ImmediateHistory.canUndo()) ImmediateHistory.undo();
    }

    function doRedo() {
        const hot = getHot();
        if (hot) {
        try {
            if (typeof hot.redo === 'function') { hot.redo(); return; }
            const p = hot.getPlugin && hot.getPlugin('undoRedo');
            if (p && typeof p.redo === 'function') { p.redo(); return; }
        } catch (e) {
            console.warn('[Capsules] HOT redo error:', e);
        }
        }
        if (ImmediateHistory.canRedo()) ImmediateHistory.redo();
    }

    // ----------------------------------------------
    // Fallback recorder for cell edits (only used if
    // HOT native undo/redo isn't available)
    // ----------------------------------------------
    let _replaying = false;

    function wireCellEditFallback(hot) {
        let pending = null;

        hot.addHook('beforeChange', (changes, source) => {
        if (!changes || source === 'loadData' || source === 'qb-replay' || _replaying) return;
        // snapshot OLD values
        pending = changes.map(([r, c, oldVal, newVal]) => ({ r, c, oldVal, newVal }));
        });

        hot.addHook('afterChange', (changes, source) => {
        if (!changes || source === 'loadData' || source === 'qb-replay' || _replaying) return;

        // If HOT has a working native stack, we DO NOT record a fallback entry.
        if (hasNativeUndo(hot)) { pending = null; return; }

        if (!pending) return;

        const before = pending.map(x => ({ r: x.r, c: x.c, v: x.oldVal }));
        const after  = pending.map(x => ({ r: x.r, c: x.c, v: x.newVal }));
        pending = null;

        // push one atomic action
        ImmediateHistory.push({
            label: 'cell-edit',
            do: () => {
            _replaying = true;
            after.forEach(({ r, c, v }) => hot.setDataAtCell(r, c, v, 'qb-replay'));
            _replaying = false;
            },
            undo: () => {
            _replaying = true;
            before.forEach(({ r, c, v }) => hot.setDataAtCell(r, c, v, 'qb-replay'));
            _replaying = false;
            }
        });
        });
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
        // Wait for the quick buttons strip to exist
        let strip = document.getElementById(STRIP_ID);
        if (!strip) {
        try { strip = await waitForElement(`#${STRIP_ID}`); }
        catch (e) { console.warn('[Capsules] #quickButtons not found:', e); return; }
        }

        injectStyles();

        // Wait for HOT (if present), then enable native undo and wire fallback
        try {
        const hot = await waitForHot();     // waits up to 5s
        ensureHotUndoRedo(hot);             // turn on native stack
        wireCellEditFallback(hot);          // capture typed edits if native stack isn't usable
        } catch (e) {
        console.warn('[Capsules] Proceeding without HOT instance:', e);
        }

        // Capsules: History (Undo/Redo) + Zoom (−/+)
        const capHistory = buildCapsule('Action', [
        { id:'qbUndo', title:'Undo last action', aria:'Undo', text:'Undo', onClick: doUndo },
        { id:'qbRedo', title:'Redo last action', aria:'Redo', text:'Redo', onClick: doRedo },
        ]);
        const capZoom = buildCapsule('Zoom', [
        { id:'qbZoomOut', title:'Zoom out', aria:'Zoom out', text:'−', onClick: zoomOut },
        { id:'qbZoomIn',  title:'Zoom in',  aria:'Zoom in',  text:'+', onClick: zoomIn  },
        ]);

        strip.appendChild(capHistory);
        strip.appendChild(capZoom);

        // Start at 1.0 zoom (non-user apply)
        setZoom(1, /*fromUser=*/false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
