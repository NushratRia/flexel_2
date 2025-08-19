/* static/js/deicticActionsBridge.js */
(function (global) {
    'use strict';
    const DT  = global.DeicticTarget;
    const hot = (global.GestureActions && global.GestureActions._hot) || global.hot;

    if (!hot) { console.warn('[DeicticActionsBridge] Handsontable not found yet.'); }

    // Simple helpers ------------------------------------------------------------
    function colLettersToIndex(s){
        s = String(s||'').toUpperCase().trim();
        let n=0; for(let i=0;i<s.length;i++){ const code=s.charCodeAt(i); if(code<65||code>90) return -1; n=n*26+(code-64); }
        return n-1;
    }
    function a1ToRC(a1){
        const m = String(a1||'').toUpperCase().match(/^([A-Z]+)(\d+)$/);
        if(!m) return null;
        return { row: parseInt(m[2],10)-1, col: colLettersToIndex(m[1]) };
    }
    function normalizeRange(r){
        // accepts "A1:B3" or "C:C" (whole column)
        const m = String(r||'').toUpperCase().match(/^([A-Z]+)(\d+)?:([A-Z]+)(\d+)?$/);
        if (!m) return null;
        const c1 = colLettersToIndex(m[1]), c2 = colLettersToIndex(m[3]);
        const r1 = m[2]? (parseInt(m[2],10)-1) : 0;
        const r2 = m[4]? (parseInt(m[4],10)-1) : ((hot && hot.countRows ? hot.countRows()-1 : 9999));
        return { r1: Math.min(r1,r2), c1: Math.min(c1,c2), r2: Math.max(r1,r2), c2: Math.max(c1,c2) };
    }
    function resolveCellFallback(cmd){
        return (DT && DT.getCellA1 && DT.getCellA1()) || (hot && hot.getSelectedLast && (()=>{ const s=hot.getSelectedLast(); if(!s) return null; const r=Math.min(s[0],s[2]), c=Math.min(s[1],s[3]); return rcToA1(r,c); })());
    }
    function rcToA1(r,c){
        function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
        return `${colLetters(c)}${r+1}`;
    }

    // Local implementations -----------------------------------------------------
    const UndoRedo = () => hot && hot.getPlugin && hot.getPlugin('undoRedo');
    const Merge    = () => hot && hot.getPlugin && hot.getPlugin('mergeCells');
    const CopyPaste= () => hot && hot.getPlugin && hot.getPlugin('copyPaste');

    function doSelect(range){
        // "A1:C3" or "B:B" or a single "B7"
        if (!range || range==='this'){
        const a1 = resolveCellFallback();
        if (!a1) return false;
        const rc = a1ToRC(a1);
        hot.selectCell(rc.row, rc.col);
        return true;
        }
        const R = normalizeRange(range);
        if (!R) { const rc=a1ToRC(range); if(rc){ hot.selectCell(rc.row, rc.col); return true; } return false; }
        hot.selectCell(R.r1, R.c1, R.r2, R.c2, true);
        return true;
    }

    function doScroll(cmd){
        if (cmd.at){
        const rc = a1ToRC(cmd.at);
        if (rc){ hot.scrollViewportTo(rc.row, rc.col, true, true); hot.selectCell(rc.row, rc.col); return true; }
        }
        if (cmd.row!=null || cmd.col!=null){
        const r = (cmd.row!=null) ? (cmd.row-1) : 0;
        const c = (cmd.col!=null) ? colLettersToIndex(cmd.col) : 0;
        hot.scrollViewportTo(r, c, true, true);
        hot.selectCell(r,c);
        return true;
        }
        if (cmd.delta){ // rows delta
        const s = hot.getSelectedLast && hot.getSelectedLast();
        const r = s ? Math.min(s[0],s[2]) : 0;
        const c = s ? Math.min(s[1],s[3]) : 0;
        const target = Math.max(0, r + cmd.delta);
        hot.scrollViewportTo(target, c, true, true);
        hot.selectCell(target, c);
        return true;
        }
        // scroll to pointed cell
        const a1 = resolveCellFallback(); if(a1){ const rc=a1ToRC(a1); hot.scrollViewportTo(rc.row,rc.col,true,true); hot.selectCell(rc.row,rc.col); return true; }
        return false;
    }

    function doUndo(){ const u=UndoRedo(); if(u&&u.isEnabled()) { u.undo(); return true; } return false; }
    function doRedo(){ const u=UndoRedo(); if(u&&u.isEnabled()) { u.redo(); return true; } return false; }

    function doDelete(range){
        // Clear to empty string
        if (!range || range==='this'){
        const a1 = resolveCellFallback(); if(!a1) return false; range = a1;
        }
        // column-only "C:C"
        if (/^[A-Z]+:[A-Z]+$/.test(range)) {
        const R = normalizeRange(range);
        for (let r=R.r1; r<=R.r2; r++){
            for (let c=R.c1; c<=R.c2; c++){
            hot.setDataAtCell(r,c,'');
            }
        }
        return true;
        }
        const R = normalizeRange(range);
        if (R){
        for (let r=R.r1; r<=R.r2; r++){
            for (let c=R.c1; c<=R.c2; c++){
            hot.setDataAtCell(r,c,'');
            }
        }
        return true;
        }
        const rc = a1ToRC(range);
        if (rc){ hot.setDataAtCell(rc.row, rc.col, ''); return true; }
        return false;
    }

    function doMerge(range){
        const plugin = Merge();
        if (!plugin || !plugin.isEnabled || !plugin.isEnabled()) {
        console.warn('[DeicticActionsBridge] mergeCells plugin not enabled.');
        return false;
        }
        let R = range==='this' ? (hot.getSelectedRangeLast ? hot.getSelectedRangeLast() : null) : null;
        if (R){ R = { r1:R.from.row, c1:R.from.col, r2:R.to.row, c2:R.to.col }; }
        else { R = normalizeRange(range); }
        if (!R) return false;
        plugin.mergeSelection(R.r1, R.c1, R.r2, R.c2);
        hot.render();
        return true;
    }

    // simple zoom via CSS transform on the container
    let zoom = 1;
    function doZoom(direction){
        const cont = document.getElementById('hot');
        if (!cont) return false;
        if (direction==='in')  zoom = Math.min(2.0, zoom+0.1);
        else if (direction==='out') zoom = Math.max(0.5, zoom-0.1);
        else zoom = 1.0;
        cont.style.transformOrigin = '0 0';
        cont.style.transform = `scale(${zoom})`;
        (hot && hot.render && hot.render());
        return true;
    }

    // in-app copy buffer (so we can paste later via voice)
    let copyBuffer = null;
    function doCopy(range){
        // Prefer Handsontable copy if available
        const cp = CopyPaste();
        if (!range || range==='this'){
        const sel = hot.getSelectedRangeLast && hot.getSelectedRangeLast();
        if (sel && cp && cp.copy) { cp.copy(); return true; }
        const a1 = resolveCellFallback(); if (!a1) return false; range = a1;
        }
        // Fallback: read values into our buffer
        const R = normalizeRange(range) || (()=>{ const rc=a1ToRC(range); return rc?{r1:rc.row,c1:rc.col,r2:rc.row,c2:rc.col}:null; })();
        if (!R) return false;
        const data = [];
        for (let r=R.r1; r<=R.r2; r++){
        const row=[]; for(let c=R.c1; c<=R.c2; c++){ row.push(hot.getDataAtCell(r,c)); }
        data.push(row);
        }
        copyBuffer = { R, data };
        return true;
    }

    function doPaste(at){
        const cp = CopyPaste();
        if (cp && cp.paste){ // Handsontable cannot paste without clipboard perms; skip
        // fall back to our buffer anyway
        }
        if (!copyBuffer) { console.warn('[DeicticActionsBridge] nothing copied.'); return false; }
        const targetA1 = (at && at!=='this') ? at : (resolveCellFallback() || 'A1');
        const rc = a1ToRC(targetA1); if (!rc) return false;

        const { data } = copyBuffer;
        for (let r=0; r<data.length; r++){
        for (let c=0; c<data[r].length; c++){
            hot.setDataAtCell(rc.row + r, rc.col + c, data[r][c]);
        }
        }
        hot.selectCell(rc.row, rc.col, rc.row + data.length -1, rc.col + data[0].length -1, true);
        return true;
    }

    // Patch VoiceActions.execute to fill in “this/here”, then run local fallbacks
    const VA = global.VoiceActions;
    if (VA && typeof VA.execute === 'function'){
        const base = VA.execute.bind(VA);
        VA.execute = function(cmd){
        if (!cmd) return base(cmd);

        // Fill missing targets from pointing/selection
        if (cmd.range==='this' || !cmd.range){
            const a1 = DT && DT.getCellA1 && DT.getCellA1();
            if (a1 && (cmd.action==='select' || cmd.action==='write' || cmd.action==='delete' || cmd.action==='merge' || cmd.action==='copy')) {
            cmd.range = cmd.range || a1;
            }
        }
        if (!cmd.column && (cmd.action==='sort' || cmd.action==='filter')){
            const C = DT && DT.getColLetter && DT.getColLetter();
            if (C) cmd.column = C;
        }
        if (cmd.at==='this' || (!cmd.at && cmd.action==='paste')){
            const a1 = resolveCellFallback(); if (a1) cmd.at = a1;
        }

        // Try the app's own executor first
        const handledByApp = base(cmd);
        if (handledByApp) return true;

        // Local fallback per action
        switch (cmd.action){
            case 'select': return doSelect(cmd.range);
            case 'scroll': return doScroll(cmd);
            case 'undo':   return doUndo();
            case 'redo':   return doRedo();
            case 'delete': return doDelete(cmd.range);
            case 'merge':  return doMerge(cmd.range || 'this');
            case 'zoom':   return doZoom(cmd.direction || 'reset');
            case 'copy':   return doCopy(cmd.range || 'this');
            case 'paste':  return doPaste(cmd.at || 'this');
            default: return false;
        }
        };
        console.info('[DeicticActionsBridge] VoiceActions.execute patched with fallbacks.');
    } else {
        // If no VoiceActions, expose a global minimal runner so you can call window.DeicticRun(cmd)
        global.DeicticRun = function(cmd){
        switch (cmd.action){
            case 'select': return doSelect(cmd.range);
            case 'scroll': return doScroll(cmd);
            case 'undo':   return doUndo();
            case 'redo':   return doRedo();
            case 'delete': return doDelete(cmd.range);
            case 'merge':  return doMerge(cmd.range || 'this');
            case 'zoom':   return doZoom(cmd.direction || 'reset');
            case 'copy':   return doCopy(cmd.range || 'this');
            case 'paste':  return doPaste(cmd.at || 'this');
            default: return false;
        }
        };
        console.info('[DeicticActionsBridge] minimal executor available at window.DeicticRun(cmd).');
    }
})(window);
