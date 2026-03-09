/* static/js/deicticActionsBridge.js */
(function (global) {
    'use strict';
    const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

    function rectEquals(a,b){ return a && b && a.r1===b.r1 && a.c1===b.c1 && a.r2===b.r2 && a.c2===b.c2; }

    function readHotRect(){
        const hot = HOT(); if (!hot) return null;
        if (typeof hot.getSelectedRangeLast === 'function') {
        const rng = hot.getSelectedRangeLast();
        if (rng && rng.from && rng.to) {
            return {
            r1: Math.min(rng.from.row, rng.to.row),
            c1: Math.min(rng.from.col, rng.to.col),
            r2: Math.max(rng.from.row, rng.to.row),
            c2: Math.max(rng.from.col, rng.to.col),
            };
        }
        }
        const arr = hot.getSelected && hot.getSelected();
        if (Array.isArray(arr) && arr.length) {
        const last = arr[arr.length - 1];
        if (Array.isArray(last) && last.length >= 4) {
            return {
            r1: Math.min(last[0], last[2]),
            c1: Math.min(last[1], last[3]),
            r2: Math.max(last[0], last[2]),
            c2: Math.max(last[1], last[3]),
            };
        }
        }
        return null;
    }

    function readBothHandRects(){
        const live = global.__handLiveRects || {};
        const out = [];
        if (live.L) out.push(live.L);
        if (live.R && (!out.length || !rectEquals(out[0], live.R))) out.push(live.R);
        if (!out.length) {
        const hotRect = readHotRect();
        if (hotRect) out.push(hotRect);
        }
        // If still empty, pinch-to-select or mouse selection might exist but not in rects yet
        // Try to ensure at least the current HOT selection is captured
        if (!out.length) {
            const hot = HOT();
            if (hot) {
                // Check if there's any active selection in HOT
                if (typeof hot.getSelectedLast === 'function') {
                    try {
                        const sel = hot.getSelectedLast();
                        if (sel && Array.isArray(sel) && sel.length >= 4) {
                            out.push({
                                r1: Math.min(sel[0], sel[2]),
                                c1: Math.min(sel[1], sel[3]),
                                r2: Math.max(sel[0], sel[2]),
                                c2: Math.max(sel[1], sel[3])
                            });
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        }
        return out;
    }

    function a1ToRect(a1){
        const m = String(a1||'').trim().match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
        if (!m) return null;
        const colToIdx = (s)=>{ s=s.toUpperCase(); let n=0; for (let i=0;i<s.length;i++){ n=n*26 + (s.charCodeAt(i)-64);} return n-1; };
        const r1 = parseInt(m[2],10)-1, c1 = colToIdx(m[1]);
        if (m[3] && m[4]){
        const r2 = parseInt(m[4],10)-1, c2 = colToIdx(m[3]);
        return { r1:Math.min(r1,r2), c1:Math.min(c1,c2), r2:Math.max(r1,r2), c2:Math.max(c1,c2) };
        }
        return { r1, c1, r2:r1, c2:c1 };
    }

    function resolveRanges(spec){
        console.log('[DeicticActionsBridge] resolveRanges called with spec:', spec);
        if (!spec || /^(this|here|there)$/i.test(String(spec))) {
            console.log('[DeicticActionsBridge] Resolving as deictic (this/here/there)');
            const rects = readBothHandRects();
            console.log('[DeicticActionsBridge] readBothHandRects returned:', rects);
            return rects;
        }
        if (Array.isArray(spec)) return spec.map(a1ToRect).filter(Boolean);
        const r = a1ToRect(spec);
        return r ? [r] : [];
    }

    function clearRects(rects){
        const hot = HOT(); if (!hot || !rects.length) return false;
        // Collect all cell clears so undo records one action
        const changes = [];
        rects.forEach(rect=>{
        for (let i = rect.r1; i <= rect.r2; i++) {
            for (let j = rect.c1; j <= rect.c2; j++) {
            changes.push([i, j, '']);
            }
        }
        });
        if (changes.length) {
        hot.setDataAtCell(changes);
        }
        const last = rects[rects.length-1];
        hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
        return true;
    }

    function writeRects(rects, value){
        const hot = HOT(); if (!hot || !rects.length) return false;
        rects.forEach(rect=>{
        const rows = rect.r2 - rect.r1 + 1, cols = rect.c2 - rect.c1 + 1;
        const payload = Array.from({length: rows}, () => Array.from({length: cols}, () => value));
        hot.populateFromArray(rect.r1, rect.c1, payload, rect.r2, rect.c2, 'overwrite');
        });
        const last = rects[rects.length-1];
        hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
        return true;
    }

    /*function DeicticRun(cmd){
        try{
        if (!cmd || !cmd.action) return false;
        const rects = resolveRanges(cmd.range);
        if (!rects.length) return false;

        if (cmd.action === 'delete') return clearRects(rects);
        if (cmd.action === 'write')  return writeRects(rects, (cmd.value ?? '').toString());
        return false;
        }catch(e){
        console.warn('[DeicticActionsBridge] Error', cmd, e);
        return false;
        }
    }*/



        function mergeRects(rects){
        console.log('[DeicticActionsBridge] mergeRects called with:', rects);
        const hot = HOT(); 
        if (!hot || !rects.length) {
            console.warn('[DeicticActionsBridge] mergeRects: no hot or empty rects');
            return false;
        }
        
        const plugin = hot.getPlugin && hot.getPlugin('mergeCells');
        if (!plugin) {
            console.warn('[DeicticActionsBridge] mergeRects: no mergeCells plugin found');
            return false;
        }
        
        // Combine all rectangles into a single bounding rectangle
        let minR1 = rects[0].r1, maxR2 = rects[0].r2;
        let minC1 = rects[0].c1, maxC2 = rects[0].c2;
        
        for (let i = 1; i < rects.length; i++) {
            minR1 = Math.min(minR1, rects[i].r1);
            maxR2 = Math.max(maxR2, rects[i].r2);
            minC1 = Math.min(minC1, rects[i].c1);
            maxC2 = Math.max(maxC2, rects[i].c2);
        }
        
        const r1 = Math.min(minR1, maxR2);
        const r2 = Math.max(minR1, maxR2);
        const c1 = Math.min(minC1, maxC2);
        const c2 = Math.max(minC1, maxC2);
        
        console.log(`[DeicticActionsBridge] Merge range: r1=${r1}, c1=${c1}, r2=${r2}, c2=${c2}`);
        
        // Validate multi-cell
        if (r1 === r2 && c1 === c2) {
            console.warn('[DeicticActionsBridge] Cannot merge a single cell');
            return false;
        }
        
        try {
            // If a specialized VoiceMergeHandler is available, prefer it (it contains
            // defensive unmerge logic and deictic resolution).
            if (global.VoiceMergeHandler && typeof global.VoiceMergeHandler.execute === 'function') {
                console.log('[DeicticActionsBridge] Delegating merge to VoiceMergeHandler.execute with temporary deictic rect and explicit selection');
                const oldLive = global.__handLiveRects;
                try {
                    // Temporarily set the live hand rects so VoiceMergeHandler resolves our intended range
                    global.__handLiveRects = { L: { r1: r1, c1: c1, r2: r2, c2: c2 } };
                    // Also ensure HOT selection matches, so handlers that prefer selection will work
                    try { hot.selectCell(r1, c1, r2, c2, true); } catch(e) { /* ignore */ }
                    return !!global.VoiceMergeHandler.execute({ action: 'merge' });
                } catch(e){
                    console.warn('[DeicticActionsBridge] VoiceMergeHandler failed:', e);
                } finally {
                    // restore previous live rects
                    global.__handLiveRects = oldLive;
                }
            }

            // Select the range
            hot.selectCell(r1, c1, r2, c2, true);

            // Enable plugin if needed
            if (plugin.enablePlugin) {
                try { plugin.enablePlugin(); } catch (_) {}
            }

            // Defensive: unmerge any existing merged cells that intersect our target
            try {
                const coll = plugin.mergedCellsCollection && plugin.mergedCellsCollection.mergedCells;
                if (Array.isArray(coll) && coll.length) {
                    const intersects = (m) => {
                        const mr1 = m.row;
                        const mc1 = m.col;
                        const mr2 = m.row + (m.rowspan||1) - 1;
                        const mc2 = m.col + (m.colspan||1) - 1;
                        return !(mr2 < r1 || mr1 > r2 || mc2 < c1 || mc1 > c2);
                    };
                    coll.slice().forEach(m => {
                        try {
                            if (intersects(m) && typeof plugin.unmerge === 'function') {
                                console.log('[DeicticActionsBridge] Unmerging overlapping merged cell at', m.row, m.col);
                                plugin.unmerge(m.row, m.col);
                            }
                        } catch(e){ /* ignore */ }
                    });
                }
            } catch(e) { console.warn('[DeicticActionsBridge] defensive unmerge check failed:', e); }

            // Try merge with parameters (better API)
            if (typeof plugin.merge === 'function') {
                console.log('[DeicticActionsBridge] Calling plugin.merge(r1, c1, r2, c2)');
                plugin.merge(r1, c1, r2, c2);
            } else if (typeof plugin.mergeSelection === 'function') {
                console.log('[DeicticActionsBridge] Calling plugin.mergeSelection()');
                plugin.mergeSelection();
            } else {
                console.warn('[DeicticActionsBridge] No merge API found on plugin');
                return false;
            }

            hot.render();
            console.log('[DeicticActionsBridge] mergeRects completed successfully');
            return true;
        } catch(e) {
            console.warn('[DeicticActionsBridge] Merge failed:', e);
            return false;
        }
    }

    function DeicticRun(cmd){
        console.log('[DeicticActionsBridge] DeicticRun called with cmd:', cmd);
        try{
        if (!cmd || !cmd.action) {
            console.warn('[DeicticActionsBridge] DeicticRun: no cmd or action');
            return false;
        }
        
        const rects = resolveRanges(cmd.range);
        console.log('[DeicticActionsBridge] resolveRanges returned:', rects);
        
        if (!rects.length) {
            console.warn('[DeicticActionsBridge] DeicticRun: no rects resolved');
            return false;
        }

        if (cmd.action === 'delete') {
            console.log('[DeicticActionsBridge] Executing DELETE action');
            return clearRects(rects);
        }
        if (cmd.action === 'write') {
            console.log('[DeicticActionsBridge] Executing WRITE action');
            return writeRects(rects, (cmd.value ?? '').toString());
        }
        if (cmd.action === 'merge' || cmd.action === 'merge_cells') {
            console.log('[DeicticActionsBridge] Executing MERGE action');
            return mergeRects(rects);
        }
        console.warn('[DeicticActionsBridge] DeicticRun: unknown action', cmd.action);
        return false;
        }catch(e){
        console.warn('[DeicticActionsBridge] Error', cmd, e);
        return false;
        }
    }

    global.DeicticRun = DeicticRun;
    console.info('[DeicticActionsBridge] Ready (deictic targets BOTH live hand rects).');
})(window);







// /* static/js/deicticActionsBridge.js */
// (function (global) {
//     'use strict';
//     const DT  = global.DeicticTarget;
//     const hot = (global.GestureActions && global.GestureActions._hot) || global.hot;

//     if (!hot) { console.warn('[DeicticActionsBridge] Handsontable not found yet.'); }

//     // Simple helpers ------------------------------------------------------------
//     function colLettersToIndex(s){
//         s = String(s||'').toUpperCase().trim();
//         let n=0; for(let i=0;i<s.length;i++){ const code=s.charCodeAt(i); if(code<65||code>90) return -1; n=n*26+(code-64); }
//         return n-1;
//     }
//     function a1ToRC(a1){
//         const m = String(a1||'').toUpperCase().match(/^([A-Z]+)(\d+)$/);
//         if(!m) return null;
//         return { row: parseInt(m[2],10)-1, col: colLettersToIndex(m[1]) };
//     }
//     function normalizeRange(r){
//         // accepts "A1:B3" or "C:C" (whole column)
//         const m = String(r||'').toUpperCase().match(/^([A-Z]+)(\d+)?:([A-Z]+)(\d+)?$/);
//         if (!m) return null;
//         const c1 = colLettersToIndex(m[1]), c2 = colLettersToIndex(m[3]);
//         const r1 = m[2]? (parseInt(m[2],10)-1) : 0;
//         const r2 = m[4]? (parseInt(m[4],10)-1) : ((hot && hot.countRows ? hot.countRows()-1 : 9999));
//         return { r1: Math.min(r1,r2), c1: Math.min(c1,c2), r2: Math.max(r1,r2), c2: Math.max(c1,c2) };
//     }
//     function resolveCellFallback(cmd){
//         return (DT && DT.getCellA1 && DT.getCellA1()) || (hot && hot.getSelectedLast && (()=>{ const s=hot.getSelectedLast(); if(!s) return null; const r=Math.min(s[0],s[2]), c=Math.min(s[1],s[3]); return rcToA1(r,c); })());
//     }
//     function rcToA1(r,c){
//         function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
//         return `${colLetters(c)}${r+1}`;
//     }

//     // Local implementations -----------------------------------------------------
//     const UndoRedo = () => hot && hot.getPlugin && hot.getPlugin('undoRedo');
//     const Merge    = () => hot && hot.getPlugin && hot.getPlugin('mergeCells');
//     const CopyPaste= () => hot && hot.getPlugin && hot.getPlugin('copyPaste');

//     function doSelect(range){
//         // "A1:C3" or "B:B" or a single "B7"
//         if (!range || range==='this'){
//         const a1 = resolveCellFallback();
//         if (!a1) return false;
//         const rc = a1ToRC(a1);
//         hot.selectCell(rc.row, rc.col);
//         return true;
//         }
//         const R = normalizeRange(range);
//         if (!R) { const rc=a1ToRC(range); if(rc){ hot.selectCell(rc.row, rc.col); return true; } return false; }
//         hot.selectCell(R.r1, R.c1, R.r2, R.c2, true);
//         return true;
//     }

//     function doScroll(cmd){
//         if (cmd.at){
//         const rc = a1ToRC(cmd.at);
//         if (rc){ hot.scrollViewportTo(rc.row, rc.col, true, true); hot.selectCell(rc.row, rc.col); return true; }
//         }
//         if (cmd.row!=null || cmd.col!=null){
//         const r = (cmd.row!=null) ? (cmd.row-1) : 0;
//         const c = (cmd.col!=null) ? colLettersToIndex(cmd.col) : 0;
//         hot.scrollViewportTo(r, c, true, true);
//         hot.selectCell(r,c);
//         return true;
//         }
//         if (cmd.delta){ // rows delta
//         const s = hot.getSelectedLast && hot.getSelectedLast();
//         const r = s ? Math.min(s[0],s[2]) : 0;
//         const c = s ? Math.min(s[1],s[3]) : 0;
//         const target = Math.max(0, r + cmd.delta);
//         hot.scrollViewportTo(target, c, true, true);
//         hot.selectCell(target, c);
//         return true;
//         }
//         // scroll to pointed cell
//         const a1 = resolveCellFallback(); if(a1){ const rc=a1ToRC(a1); hot.scrollViewportTo(rc.row,rc.col,true,true); hot.selectCell(rc.row,rc.col); return true; }
//         return false;
//     }

//     function doUndo(){ const u=UndoRedo(); if(u&&u.isEnabled()) { u.undo(); return true; } return false; }
//     function doRedo(){ const u=UndoRedo(); if(u&&u.isEnabled()) { u.redo(); return true; } return false; }

//     function doDelete(range){
//         // Clear to empty string
//         if (!range || range==='this'){
//         const a1 = resolveCellFallback(); if(!a1) return false; range = a1;
//         }
//         // column-only "C:C"
//         if (/^[A-Z]+:[A-Z]+$/.test(range)) {
//         const R = normalizeRange(range);
//         for (let r=R.r1; r<=R.r2; r++){
//             for (let c=R.c1; c<=R.c2; c++){
//             hot.setDataAtCell(r,c,'');
//             }
//         }
//         return true;
//         }
//         const R = normalizeRange(range);
//         if (R){
//         for (let r=R.r1; r<=R.r2; r++){
//             for (let c=R.c1; c<=R.c2; c++){
//             hot.setDataAtCell(r,c,'');
//             }
//         }
//         return true;
//         }
//         const rc = a1ToRC(range);
//         if (rc){ hot.setDataAtCell(rc.row, rc.col, ''); return true; }
//         return false;
//     }

//     function doMerge(range){
//         const plugin = Merge();
//         if (!plugin || !plugin.isEnabled || !plugin.isEnabled()) {
//         console.warn('[DeicticActionsBridge] mergeCells plugin not enabled.');
//         return false;
//         }
//         let R = range==='this' ? (hot.getSelectedRangeLast ? hot.getSelectedRangeLast() : null) : null;
//         if (R){ R = { r1:R.from.row, c1:R.from.col, r2:R.to.row, c2:R.to.col }; }
//         else { R = normalizeRange(range); }
//         if (!R) return false;
//         plugin.mergeSelection(R.r1, R.c1, R.r2, R.c2);
//         hot.render();
//         return true;
//     }

//     // simple zoom via CSS transform on the container
//     let zoom = 1;
//     function doZoom(direction){
//         const cont = document.getElementById('hot');
//         if (!cont) return false;
//         if (direction==='in')  zoom = Math.min(2.0, zoom+0.1);
//         else if (direction==='out') zoom = Math.max(0.5, zoom-0.1);
//         else zoom = 1.0;
//         cont.style.transformOrigin = '0 0';
//         cont.style.transform = `scale(${zoom})`;
//         (hot && hot.render && hot.render());
//         return true;
//     }

//     // in-app copy buffer (so we can paste later via voice)
//     let copyBuffer = null;
//     function doCopy(range){
//         // Prefer Handsontable copy if available
//         const cp = CopyPaste();
//         if (!range || range==='this'){
//         const sel = hot.getSelectedRangeLast && hot.getSelectedRangeLast();
//         if (sel && cp && cp.copy) { cp.copy(); return true; }
//         const a1 = resolveCellFallback(); if (!a1) return false; range = a1;
//         }
//         // Fallback: read values into our buffer
//         const R = normalizeRange(range) || (()=>{ const rc=a1ToRC(range); return rc?{r1:rc.row,c1:rc.col,r2:rc.row,c2:rc.col}:null; })();
//         if (!R) return false;
//         const data = [];
//         for (let r=R.r1; r<=R.r2; r++){
//         const row=[]; for(let c=R.c1; c<=R.c2; c++){ row.push(hot.getDataAtCell(r,c)); }
//         data.push(row);
//         }
//         copyBuffer = { R, data };
//         return true;
//     }

//     function doPaste(at){
//         const cp = CopyPaste();
//         if (cp && cp.paste){ // Handsontable cannot paste without clipboard perms; skip
//         // fall back to our buffer anyway
//         }
//         if (!copyBuffer) { console.warn('[DeicticActionsBridge] nothing copied.'); return false; }
//         const targetA1 = (at && at!=='this') ? at : (resolveCellFallback() || 'A1');
//         const rc = a1ToRC(targetA1); if (!rc) return false;

//         const { data } = copyBuffer;
//         for (let r=0; r<data.length; r++){
//         for (let c=0; c<data[r].length; c++){
//             hot.setDataAtCell(rc.row + r, rc.col + c, data[r][c]);
//         }
//         }
//         hot.selectCell(rc.row, rc.col, rc.row + data.length -1, rc.col + data[0].length -1, true);
//         return true;
//     }

//     // Patch VoiceActions.execute to fill in “this/here”, then run local fallbacks
//     const VA = global.VoiceActions;
//     if (VA && typeof VA.execute === 'function'){
//         const base = VA.execute.bind(VA);
//         VA.execute = function(cmd){
//         if (!cmd) return base(cmd);

//         // Fill missing targets from pointing/selection
//         if (cmd.range==='this' || !cmd.range){
//             const a1 = DT && DT.getCellA1 && DT.getCellA1();
//             if (a1 && (cmd.action==='select' || cmd.action==='write' || cmd.action==='delete' || cmd.action==='merge' || cmd.action==='copy')) {
//             cmd.range = cmd.range || a1;
//             }
//         }
//         if (!cmd.column && (cmd.action==='sort' || cmd.action==='filter')){
//             const C = DT && DT.getColLetter && DT.getColLetter();
//             if (C) cmd.column = C;
//         }
//         if (cmd.at==='this' || (!cmd.at && cmd.action==='paste')){
//             const a1 = resolveCellFallback(); if (a1) cmd.at = a1;
//         }

//         // Try the app's own executor first
//         const handledByApp = base(cmd);
//         if (handledByApp) return true;

//         // Local fallback per action
//         switch (cmd.action){
//             case 'select': return doSelect(cmd.range);
//             case 'scroll': return doScroll(cmd);
//             case 'undo':   return doUndo();
//             case 'redo':   return doRedo();
//             case 'delete': return doDelete(cmd.range);
//             case 'merge':  return doMerge(cmd.range || 'this');
//             case 'zoom':   return doZoom(cmd.direction || 'reset');
//             case 'copy':   return doCopy(cmd.range || 'this');
//             case 'paste':  return doPaste(cmd.at || 'this');
//             default: return false;
//         }
//         };
//         console.info('[DeicticActionsBridge] VoiceActions.execute patched with fallbacks.');
//     } else {
//         // If no VoiceActions, expose a global minimal runner so you can call window.DeicticRun(cmd)
//         global.DeicticRun = function(cmd){
//         switch (cmd.action){
//             case 'select': return doSelect(cmd.range);
//             case 'scroll': return doScroll(cmd);
//             case 'undo':   return doUndo();
//             case 'redo':   return doRedo();
//             case 'delete': return doDelete(cmd.range);
//             case 'merge':  return doMerge(cmd.range || 'this');
//             case 'zoom':   return doZoom(cmd.direction || 'reset');
//             case 'copy':   return doCopy(cmd.range || 'this');
//             case 'paste':  return doPaste(cmd.at || 'this');
//             default: return false;
//         }
//         };
//         console.info('[DeicticActionsBridge] minimal executor available at window.DeicticRun(cmd).');
//     }
// })(window);
