/* static/js/voiceDeicticMiddleware.js
 * Two-hand deictic voice middleware + visual cues.
 *  - Handles "select/delete/write ... here/this" LOCALLY for BOTH hands (via DeicticRun + range:"this")
 *  - Adds rich parsing for copy/paste/merge + UNMERGE (cells/rows/cols/ranges) with semantic synonyms
 *  - Shows HUD toasts like "Selected A2 & B4", "Deleted A2 & B4", "Wrote 50 → A2 & B4"
 *  - Very tolerant to ASR mishears: here/hear/hair/there/thiss/dis, right→write, etc.
 *  - Falls back to server, then to local execution (unmerge) if VoiceActions doesn’t handle it.
 *
 * Requires (recommended):
 *  - static/js/bimanualPinchSelect.js  (populates window.__lastTwoHandTargets)
 *  - static/js/deicticActionsBridge.js (provides window.DeicticRun that understands range:"this")
 * Optional:
 *  - global.DeicticToast.show(op, targets[, meta]) → nice HUD; otherwise a simple inline toast is used.
 */
(function (global) {
    'use strict';

    const DT = global.DeicticTarget;
    const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

    // ---------- misc helpers ----------
    function clean(s){
        let t = String(s||'').trim();

        // drop wake words and common misfires
        t = t.replace(/^(?:hey|ok|okay)\s+(?:flexe?i?e?)\s*/i,'');
        t = t.replace(/^(?:flexe?i?e?),?\s*/i,'');
        t = t.replace(/^(?:play\s+se?a?\s+|play\s+see\s+|place\s+|plexi\s+|lexi\s+|sexy\s+)/i,'');

        // normalize words
        t = (' '+t.toLowerCase()+' ')
        .replace(/\sright\s/g,' write ')
        .replace(/\srite\s/g,' write ')
        .replace(/\ssea\s+salt\s/g,' sort ')
        .replace(/\ssee\s+salt\s/g,' sort ')
        .replace(/\s u\s/gi,' you ')
        .trim();

        // compress spaced digits: "5 0" -> "50", "1 2 3" -> "123"
        t = t.replace(/(\d)\s+(?=\d)/g, '$1');




        // --- accent / ASR mishear fixes (safe, command-keyword–only) ---
        t = (' ' + t + ' ')
        // deictics
        .replace(/\b(hair|hare|hear)\b/g, ' here ')
        .replace(/\b(dis|diss)\b/g, ' this ')
        // merge family
        .replace(/\b(march|marsh|merch|marge)\b/g, ' merge ')
        .replace(/\b(merges)\b/g, ' merge ')
        // ultra-common: "merge this" → "mercedes"
        .replace(/\b(mercedes)\b/g, ' merge this ')
        // paste family
        .replace(/\b(best|based|baste|pace|pest|pastee)\b/g, ' paste ')
        // copy family
        .replace(/\b(coffee|coppy)\b/g, ' copy ')
        // select family
        .replace(/\b(sillect|cillect|selects)\b/g, ' select ')
        // delete family
        .replace(/\b(delight|dilate)\b/g, ' delete ')
        // row/column
        .replace(/\b(roll)\b/g, ' row ')
        .replace(/\b(calm|colon)\b/g, ' column ')
        // "A5 and X6" → "A5:X6" so span extractor catches it
        .replace(/\b([a-z]+)\s*(\d+)\s+and\s+([a-z]+)\s*(\d+)\b/gi, (_,$c1,$r1,$c2,$r2)=>`${$c1}${$r1}:${$c2}${$r2}`)


        
        .trim();

        return t;
    }



    function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }

    // Prefer raw targets provided by bimanualPinchSelect (cell/row/col), else empty
    function getTwoHandTargets(){
        const T = global.__lastTwoHandTargets || {};
        const arr = [];
        if (T.L) arr.push(T.L);
        if (T.R) arr.push(T.R);
        return arr;
    }

    function labelForTarget(t){
        if (!t) return '';
        if (t.kind === 'cell') return `${colLetters(t.col)}${t.row+1}`;
        if (t.kind === 'row')  return `row ${t.rowIndex+1}`;
        if (t.kind === 'col')  return `col ${colLetters(t.colIndex)}`;
        return '';
    }

    // ---------- HUD / Toasts ----------
    function fallbackToast(msg){
        try{
        const id = 'vdm_toast';
        let el = document.getElementById(id);
        if (!el){
            el = document.createElement('div');
            el.id = id;
            Object.assign(el.style, {
            position:'fixed', left:'50%', top:'60px', transform:'translateX(-50%)',
            background:'rgba(32,120,32,0.92)', color:'#fff', padding:'8px 14px',
            borderRadius:'8px', font:'14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
            boxShadow:'0 2px 8px rgba(0,0,0,0.25)', zIndex:99999, pointerEvents:'none', opacity:'0',
            transition:'opacity 150ms ease, transform 180ms ease'
            });
            document.body.appendChild(el);
        }
        el.textContent = msg;
        requestAnimationFrame(()=>{ el.style.opacity='1'; el.style.transform='translate(-50%, -10%)'; });
        setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translate(-50%, -20%)'; }, 1500);
        }catch(_){}
    }
    function showOpToast(op, targets, meta){
        const pretty = (targets||[]).map(labelForTarget).filter(Boolean).join(' & ');
        const txt = meta && meta.value != null ? `${op} ${meta.value} → ${pretty || 'target'}` : (pretty ? `${op} ${pretty}` : op);
        (global.DeicticToast && global.DeicticToast.show) ? global.DeicticToast.show(op, targets, meta) : fallbackToast(txt);
    }

    // ---------- deictic accessors ----------
    function cell(){ return DT && DT.getCellA1 ? DT.getCellA1() : null; }
    function col(){ return DT && DT.getColLetter ? DT.getColLetter() : null; }
    function rowIndex(){ return DT && DT.getRowIndex ? DT.getRowIndex() : null; }

    // ---------- number + range helpers (NEW) ----------
    const WORD_NUM = {
        'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,
        'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,'nineteen':19,'twenty':20
    };
    const ORD_NUM = {
        '1st':1,'first':1,'2nd':2,'second':2,'3rd':3,'third':3,'4th':4,'fourth':4,'5th':5,'fifth':5,'6th':6,'sixth':6,
        '7th':7,'seventh':7,'8th':8,'eighth':8,'9th':9,'ninth':9,'10th':10,'tenth':10
    };

    function extractRowNumber(s){
        for (const [k,v] of Object.entries(ORD_NUM)) { if (new RegExp(`\\b${k}\\b`,`i`).test(s)) return v; }
        const m = s.match(/\b(?:row|line)\s+([a-z]+|\d+)\b/i);
        if (m){
        const w = m[1].toLowerCase();
        if (/^\d+$/.test(w)) return parseInt(w,10);
        if (WORD_NUM[w] != null) return WORD_NUM[w];
        }
        const m2 = s.match(/\b(?:go|scroll|jump)\s+(?:to|into|down to|up to)?\s*(\d+|[a-z]+(?:th|st|nd|rd)?)\b/i);
        if (m2){
        const w = m2[1].toLowerCase();
        if (/^\d+$/.test(w)) return parseInt(w,10);
        if (ORD_NUM[w] != null) return ORD_NUM[w];
        }
        return null;
    }
    function extractA1(s){
        const cell = s.match(/\b(?:cell\s*)?([a-z]+)\s*(\d+)\b/i);
        if (cell){ return (cell[1]+cell[2]).toUpperCase(); }
        return null;
    }
    // "columns C–F" / "cols c to f" → "C1:F999999" ; "column C" → "C1:C999999"
    function extractColRange(s){
        const span = s.match(/\b(?:columns?|cols?)\s+([a-z]+)\s*(?:to|through|thru|[-–—])\s*([a-z]+)\b/i);
        if (span) { const a = span[1].toUpperCase(), b = span[2].toUpperCase(); return `${a}1:${b}999999`; }
        const single = s.match(/\b(?:column|col)\s+([a-z]+)\b/i);
        if (single) { const L = single[1].toUpperCase(); return `${L}1:${L}999999`; }
        return null;
    }
    // "rows 3–7" / "row five" → "A3:ZZ7" or "A5:ZZ5"
    function extractRowRangeOrSingle(s){
        const span = s.match(/\b(?:rows?|lines?)\s+([a-z]+(?:th|st|nd|rd)?|\d+)\s*(?:to|through|thru|[-–—])\s*([a-z]+(?:th|st|nd|rd)?|\d+)\b/i);
        if (span) {
        const a = span[1].toLowerCase(), b = span[2].toLowerCase();
        const n1 = /^\d+$/.test(a) ? parseInt(a,10) : (ORD_NUM[a] ?? WORD_NUM[a]);
        const n2 = /^\d+$/.test(b) ? parseInt(b,10) : (ORD_NUM[b] ?? WORD_NUM[b]);
        if (n1 && n2) return `A${n1}:ZZ${n2}`;
        }
        const single = s.match(/\b(?:row|line)\s+([a-z]+(?:th|st|nd|rd)?|\d+)\b/i);
        if (single) {
        const w = single[1].toLowerCase();
        const n = /^\d+$/.test(w) ? parseInt(w,10) : (ORD_NUM[w] ?? WORD_NUM[w]);
        if (n) return `A${n}:ZZ${n}`;
        }
        return null;
    }
    // "cells B5 to D7" / "B5:D7" / "b5 - d7" → "B5:D7"
    function extractCellSpan(s){
        const m = s.match(/\b([a-z]+)\s*(\d+)\s*(?:\:|to|through|thru|[-–—])\s*([a-z]+)\s*(\d+)\b/i);
        if (!m) return null;
        const a = (m[1]+m[2]).toUpperCase();
        const b = (m[3]+m[4]).toUpperCase();
        return `${a}:${b}`;
    }

    // ---------- tiny A1 parsers for local unmerge fallback ----------
    function colLettersToIndex(s){
        s = String(s||'').toUpperCase().trim();
        let n=0; for(let i=0;i<s.length;i++){ const code=s.charCodeAt(i); if(code<65||code>90) return -1; n=n*26+(code-64); }
        return n-1;
    }
    function parseA1Range(a1){
        const m = String(a1||'').toUpperCase().trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
        if (!m) return null;
        const c1 = colLettersToIndex(m[1]), r1 = parseInt(m[2],10)-1;
        if (m[3] && m[4]){
        const c2 = colLettersToIndex(m[3]), r2 = parseInt(m[4],10)-1;
        return { r1: Math.min(r1,r2), c1: Math.min(c1,c2), r2: Math.max(r1,r2), c2: Math.max(c1,c2) };
        }
        return { r1, c1, r2:r1, c2:c1 };
    }

    // ---------- local deictic handler (unchanged semantics for delete/write/select) ----------
    function maybeHandleLocalDeictic(str){
        if (!str) return false;
        const s = clean(str);
        const has = (w)=> s.indexOf(w) !== -1;
        const anyDeictic = (/\b(this|here|there|hear|hair)\b/.test(s) || /^this$/.test(s) || /^here$/.test(s));

        // DELETE this
        if ((has('delete') || has('clear') || has('remove')) && anyDeictic) {
        const ok = (global.DeicticRun && global.DeicticRun({ action:'delete', range:'this' })) || false;
        if (ok) { showOpToast('Cleared', getTwoHandTargets()); }
        return ok;
        }

        // WRITE value ... this
        const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
        if (m && m[2]) {
        const val = m[2].trim();
        const ok = (global.DeicticRun && global.DeicticRun({ action:'write', range:'this', value: val })) || false;
        if (ok) { showOpToast('Wrote', getTwoHandTargets(), { value: val }); }
        return ok;
        }

        // SELECT this
        if ((has('select') || has('highlight')) && anyDeictic) {
        const a1 = cell() || (col() ? `${col()}1` : (rowIndex() ? `A${rowIndex()}` : null));
        if (a1 && global.VoiceActions && global.VoiceActions.execute({ action:'select', range:a1 })) {
            showOpToast('Selected', [{kind:'cell', row: (parseA1Range(a1).r1), col: (parseA1Range(a1).c1)}]);
            return true;
        }
        }

        return false;
    }

    // expose the simple deictic hook (kept name)
    global.__maybeHandleLocalVoice = maybeHandleLocalDeictic;

    // ---------- main local intent parser (extended) ----------
    function parseLocal(raw){
        const s = clean(raw);

        // --- SELECT specific cell / column / row ---
        {
        const a1 = extractA1(s);
        if (a1 && /\b(select|go to|focus|highlight|pick)\b/i.test(s)) {
            return { action:'select', range:a1, confidence:0.96 };
        }
        const colM = s.match(/\bselect\s+(?:column|col)\s+([a-z]+)\b/i);
        if (colM) {
            const L = colM[1].toUpperCase();
            return { action:'select', range:`${L}1:${L}999999`, confidence:0.94 };
        }
        const rSel = extractRowRangeOrSingle(s);
        if (rSel && /\bselect\b/i.test(s)) {
            return { action:'select', range:rSel, confidence:0.93 };
        }
        }

        // --- SCROLL: generic + “to Nth row” + “up/down” default step ---
        {
        const DEFAULT_STEP = 8;
        if (/\b(scroll|go|move)\s+(down|below)\b/i.test(s) && !/\b\d+\b/.test(s))
            return { action:'scroll', delta:+DEFAULT_STEP, confidence:0.90 };
        if (/\b(scroll|go|move)\s+up\b/i.test(s) && !/\b\d+\b/.test(s))
            return { action:'scroll', delta:-DEFAULT_STEP, confidence:0.90 };
        const rowN = extractRowNumber(s);
        if (rowN && /\b(scroll|go|jump)\b/i.test(s))
            return { action:'scroll', row: rowN, confidence:0.95 };
        if (/\b(top|first row|beginning|start)\b/i.test(s))
            return { action:'scroll', row:1, confidence:0.90 };
        if (/\b(bottom|last row|end)\b/i.test(s))
            return { action:'scroll', row:999999, confidence:0.90 };
        }

        // --- ZOOM synonyms ---
        if (/\b(zoom|scale)\b/i.test(s)){
        if (/\b(in|closer|bigger)\b/i.test(s))   return { action:'zoom', direction:'in',    confidence:0.95 };
        if (/\b(out|smaller|farther)\b/i.test(s))return { action:'zoom', direction:'out',   confidence:0.95 };
        if (/\b(reset|normal|default)\b/i.test(s))return { action:'zoom', direction:'reset', confidence:0.90 };
        }

        // UNDO / REDO
        if (/^undo\b/.test(s)) return { action:'undo', confidence:0.95 };
        if (/^redo\b/.test(s)) return { action:'redo', confidence:0.95 };

        // DELETE (clear) — deictic → BOTH hands via "this"
        if (/^(delete|clear|remove)\b/.test(s) && /\b(this|here)\b/.test(s)){
        return { action:'delete', range:'this', confidence:0.92 };
        }

        // --- COPY (cells/rows/cols/ranges + deictic) ---
        if (/\b(copy|duplicate)\b/i.test(s)) {
        const spanCells = extractCellSpan(s); if (spanCells) return { action:'copy', range: spanCells, confidence:0.97 };
        const cols = extractColRange(s);      if (cols)     return { action:'copy', range: cols,      confidence:0.96 };
        const rows = extractRowRangeOrSingle(s); if (rows)  return { action:'copy', range: rows,      confidence:0.96 };
        const a1 = extractA1(s);              if (a1)       return { action:'copy', range: a1,        confidence:0.94 };
        if (/\b(this|here|there|hear|hair)\b/i.test(s))     return { action:'copy', range:'this',     confidence:0.90 };
        }

        // --- PASTE (to cell / row / column / deictic) ---
        if (/\b(paste|place|put)\b/i.test(s)) {
        const a1 = extractA1(s); if (a1) return { action:'paste', at:a1, confidence:0.96 };

        const colOnly = s.match(/\b(?:column|col)\s+([a-z]+)\b/i);
        if (colOnly) return { action:'paste', at: `${colOnly[1].toUpperCase()}1`, confidence:0.93 };

        const rOnly = extractRowNumber(s);
        if (rOnly) return { action:'paste', at: `A${rOnly}`, confidence:0.92 };

        const rc1 = s.match(/\brow\s+(\d+|[a-z]+(?:th|st|nd|rd)?)\b.*\bcolumn\s+([a-z]+)\b/i);
        const rc2 = s.match(/\bcolumn\s+([a-z]+)\b.*\brow\s+(\d+|[a-z]+(?:th|st|nd|rd)?)\b/i);
        const rc = rc1 || rc2;
        if (rc) {
            const rowWord = (rc1 ? rc1[1] : rc2[2]).toLowerCase();
            const rowNum  = /^\d+$/.test(rowWord) ? parseInt(rowWord,10) : (ORD_NUM[rowWord] ?? WORD_NUM[rowWord]);
            const colL    = (rc1 ? rc1[2] : rc2[1]).toUpperCase();
            if (rowNum && colL) return { action:'paste', at: `${colL}${rowNum}`, confidence:0.95 };
        }
        if (/\b(this|here|there|hear|hair)\b/i.test(s)) {
            const at = cell() || (col() ? `${col()}1` : (rowIndex() ? `A${rowIndex()}` : null));
            if (at) return { action:'paste', at, confidence:0.90 };
        }
        }




        // SORT
        if (/^sort\b/.test(s)){
        const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
        let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
        if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
        if (!C && /\bthis\b/.test(s)) C = col();
        if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
        }

        // WRITE (non-deictic fallback)
        if (/^write\b/.test(s)){
        const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
        if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };

        const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
        if (mHere){ return { action:'write', range:'this', value:mHere[1].trim(), confidence:0.92 }; }

        const mBare = s.match(/^write\s+(.+?)\s*$/i);
        if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
        }

        // Column aggregate shorthands on "this" column
        if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum',     range:`${C}1:${C}9999`, confidence:0.9 }; }
        if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }





        // --- MERGE (cells/rows/cols/ranges + deictic) ---
        if (/\b(merge|combine|join)\b/i.test(s)) {
        const spanCells = extractCellSpan(s); if (spanCells) return { action:'merge', range: spanCells, confidence:0.96 };
        const cols = extractColRange(s);      if (cols)     return { action:'merge', range: cols,      confidence:0.95 };
        const rows = extractRowRangeOrSingle(s); if (rows)  return { action:'merge', range: rows,      confidence:0.95 };
        const a1 = extractA1(s);              if (a1)       return { action:'merge', range: a1,        confidence:0.90 };
        if (/\b(this|here|there|hear|hair)\b/i.test(s))     return { action:'merge', range:'this',     confidence:0.90 };
        }

        // --- UNMERGE (NEW) — semantic variants: unmerge/split/separate/break merge/remove merge ---
        if (/\b(un[-\s]?merge|split\s+cells?|separate\s+cells?|break\s+merge|remove\s+merge|un\s*merge)\b/i.test(s)) {
        const spanCells = extractCellSpan(s); if (spanCells) return { action:'unmerge', range: spanCells, confidence:0.96 };
        const cols = extractColRange(s);      if (cols)     return { action:'unmerge', range: cols,      confidence:0.95 };
        const rows = extractRowRangeOrSingle(s); if (rows)  return { action:'unmerge', range: rows,      confidence:0.95 };
        const a1 = extractA1(s);              if (a1)       return { action:'unmerge', range: a1,        confidence:0.92 };
        if (/\b(this|here|there|hear|hair)\b/i.test(s))     return { action:'unmerge', range:'this',     confidence:0.90 };
        }


        // SORT + WRITE + SUM + AVERAGE already covered (but keep them too if you used earlier version)
        if (/^sort\b/.test(s)){
        const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
        let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
        if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
        if (!C && /\bthis\b/.test(s)) C = col();
        if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
        }
        if (/^write\b/.test(s)){
        const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
        if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };
        const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
        if (mHere){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mHere[1].trim(), confidence:0.92 }; }
        const mBare = s.match(/^write\s+(.+?)\s*$/i);
        if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
        }
        if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum', range:`${C}1:${C}9999`, confidence:0.9 }; }
        if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }

        return null; // let server or other local logic handle it
    }


    // Support explicit column letters: "sum column C", "average column D"
    if (/\b(sum|total)\b/i.test(s)) {
    const m = s.match(/\b(?:column|col)\s+([a-z]+)\b/i);
    if (m) return { action:'sum', range: `${m[1].toUpperCase()}1:${m[1].toUpperCase()}999999`, confidence:0.94 };
    }
    if (/\b(average|mean)\b/i.test(s)) {
    const m = s.match(/\b(?:column|col)\s+([a-z]+)\b/i);
    if (m) return { action:'average', range: `${m[1].toUpperCase()}1:${m[1].toUpperCase()}999999`, confidence:0.94 };
    }

    // ---------- local fallback runner for UNMERGE ----------
    function tryLocalUnmerge(cmd){
        if (!cmd || cmd.action !== 'unmerge') return false;
        const hot = HOT(); if (!hot) return false;
        const plug = hot.getPlugin && hot.getPlugin('mergeCells');
        if (!plug || !plug.unmergeSelection) return false;

        // Resolve the target selection
        let r = null;

        if (!cmd.range || /^(this|here|there)$/i.test(String(cmd.range))) {
        // Prefer the current Handsontable selection if available
        const sel = hot.getSelectedRangeLast && hot.getSelectedRangeLast();
        if (sel && sel.from && sel.to) {
            r = { r1: Math.min(sel.from.row, sel.to.row), c1: Math.min(sel.from.col, sel.to.col),
                r2: Math.max(sel.from.row, sel.to.row), c2: Math.max(sel.from.col, sel.to.col) };
        } else {
            const a1 = cell() || (col() ? `${col()}1` : (rowIndex() ? `A${rowIndex()}` : null));
            r = a1 ? parseA1Range(a1) : null;
        }
        } else {
        r = parseA1Range(String(cmd.range));
        // also accept column/row spans like "C1:C999999" or "A5:ZZ5" produced by our parser above
        }

        if (!r) return false;

        // Select then unmerge; plugin needs selection
        try{
        hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
        plug.unmergeSelection();
        hot.render();
        fallbackToast('Unmerged');
        return true;
        }catch(e){
        console.warn('[VDM] unmerge failed', e);
        return false;
        }
    }

    // ---------- integration point: call BEFORE server, then route to VoiceActions ----------
    // Expose a convenience function you can call from your voice loop:
    //   const local = window.VDM_parse(transcript);
    //   if (local && (window.VoiceActions && window.VoiceActions.execute(local))) return;
    //   if (local && local.action==='unmerge' && tryLocalUnmerge(local)) return;
    global.VDM_parse = parseLocal;
    global.VDM_tryLocalUnmerge = tryLocalUnmerge;

    console.info('[VoiceDeicticMiddleware] ready: deictic + extended copy/paste/merge + UNMERGE.');
})(window);






















// /* static/js/voiceDeicticMiddleware.js
//  * Two-hand deictic voice middleware + visual cues.
//  *  - Handles "select/delete/write ... here/this" LOCALLY for BOTH hands (via DeicticRun + range:"this")
//  *  - Shows HUD toasts like "Selected A2 & B4", "Deleted A2 & B4", "Wrote 50 → A2 & B4"
//  *  - Very tolerant to ASR mishears: here/hear/hair/there/thiss/dis, right→write, etc.
//  *  - Falls back to server, then to a legacy local parser for other commands.
//  *
//  * Requires (recommended):
//  *  - static/js/bimanualPinchSelect.js (populates window.__lastTwoHandTargets)
//  *  - static/js/deicticActionsBridge.js (provides window.DeicticRun that understands range:"this")
//  * Optional:
//  *  - global.DeicticToast.show(op, targets[, meta]) → nice HUD; otherwise a simple inline toast is used.
//  */
// (function (global) {
//     'use strict';

//     const DT  = global.DeicticTarget;


//     // Put these near clean()
//     const WORD_NUM = {
//     'zero':0,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,
//     'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,'fifteen':15,'sixteen':16,'seventeen':17,'eighteen':18,'nineteen':19,'twenty':20
//     };
//     const ORD_NUM = {
//     '1st':1,'first':1,'2nd':2,'second':2,'3rd':3,'third':3,'4th':4,'fourth':4,'5th':5,'fifth':5,'6th':6,'sixth':6,
//     '7th':7,'seventh':7,'8th':8,'eighth':8,'9th':9,'ninth':9,'10th':10,'tenth':10
//     };

//     // "row five" -> 5, "fifth row" -> 5, "line 12" -> 12
//     function extractRowNumber(s){
//     // ordinals anywhere
//     for (const [k,v] of Object.entries(ORD_NUM)) {
//         if (new RegExp(`\\b${k}\\b`).test(s)) return v;
//     }
//     // "row five", "row 5", "line 10"
//     const m = s.match(/\b(?:row|line)\s+([a-z]+|\d+)\b/);
//     if (m){
//         const w = m[1];
//         if (/^\d+$/.test(w)) return parseInt(w,10);
//         if (WORD_NUM[w] != null) return WORD_NUM[w];
//     }
//     // "go to 5th", "to 12"
//     const m2 = s.match(/\b(?:go|scroll|jump)\s+(?:to|into|down to|up to)?\s*(\d+|[a-z]+(?:th|st|nd|rd)?)\b/);
//     if (m2){
//         const w = m2[1];
//         if (/^\d+$/.test(w)) return parseInt(w,10);
//         if (ORD_NUM[w]) return ORD_NUM[w];
//     }
//     return null;
//     }

//     // "b5" / "b 5" / "cell b5" / "select column b" / "select row five"
//     function extractA1(s){
//     // "cell b 5" / "cell b5" / "b5"
//     const cell = s.match(/\b(?:cell\s*)?([a-z]+)\s*(\d+)\b/i);
//     if (cell){ return (cell[1]+cell[2]).toUpperCase(); }
//     return null;
//     }






//     // ---------- misc helpers ----------
//     function clean(s){
//         let t = String(s||'').trim();

//         // drop wake words and common misfires
//         t = t.replace(/^(?:hey|ok|okay)\s+(?:flexe?i?e?)\s*/i,'');
//         t = t.replace(/^(?:flexe?i?e?),?\s*/i,'');
//         t = t.replace(/^(?:play\s+se?a?\s+|play\s+see\s+|place\s+|plexi\s+|lexi\s+|sexy\s+)/i,'');

//         // normalize words
//         t = (' '+t.toLowerCase()+' ')
//         .replace(/\sright\s/g,' write ')
//         .replace(/\srite\s/g,' write ')
//         .replace(/\ssea\s+salt\s/g,' sort ')
//         .replace(/\ssee\s+salt\s/g,' sort ')
//         .replace(/\s u\s/gi,' you ')
//         .trim();

//         // compress spaced digits: "5 0" -> "50", "1 2 3" -> "123"
//         t = t.replace(/(\d)\s+(?=\d)/g, '$1');

//         return t;
//     }

//     function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }

//     // Prefer raw targets provided by bimanualPinchSelect (cell/row/col), else empty
//     function getTwoHandTargets(){
//         const T = global.__lastTwoHandTargets || {};
//         const arr = [];
//         if (T.L) arr.push(T.L);
//         if (T.R) arr.push(T.R);
//         return arr;
//     }

//     function labelForTarget(t){
//         if (!t) return '';
//         if (t.kind === 'cell') return `${colLetters(t.col)}${t.row+1}`;
//         if (t.kind === 'row')  return `row ${t.rowIndex+1}`;
//         if (t.kind === 'col')  return `col ${colLetters(t.colIndex)}`;
//         return '';
//     }

//     // ---------- HUD / Toasts ----------
//     function fallbackToast(msg){
//         try{
//         const id = 'vdm_toast';
//         let el = document.getElementById(id);
//         if (!el){
//             el = document.createElement('div');
//             el.id = id;
//             Object.assign(el.style, {
//             position:'fixed', left:'50%', top:'14px', transform:'translateX(-50%)',
//             background:'rgba(20,20,20,0.92)', color:'#fff', font:'500 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
//             padding:'10px 14px', borderRadius:'10px', boxShadow:'0 6px 20px rgba(0,0,0,0.25)',
//             zIndex: 2147483647, transition:'opacity 180ms ease',
//             opacity:'0', pointerEvents:'none', whiteSpace:'nowrap'
//             });
//             document.body.appendChild(el);
//         }
//         el.textContent = msg;
//         el.style.opacity = '1';
//         clearTimeout(el.__t);
//         el.__t = setTimeout(()=>{ el.style.opacity='0'; }, 1200);
//         }catch(_){}
//     }

//     function showOpToast(op, value){
//         const arr = getTwoHandTargets();
//         if (arr.length === 0) return;

//         // If a nicer HUD is available, use it
//         if (global.DeicticToast && typeof global.DeicticToast.show === 'function') {
//         const meta = value != null ? { value } : undefined;
//         global.DeicticToast.show(op, arr, meta);
//         return;
//         }

//         // Fallback: simple text toast
//         const labels = arr.map(labelForTarget).filter(Boolean);
//         if (!labels.length) return;

//         let msg = '';
//         if (op === 'selected') msg = `Selected ${labels.join(' & ')}`;
//         else if (op === 'deleted') msg = `Deleted ${labels.join(' & ')}`;
//         else if (op === 'wrote') msg = `Wrote ${value} \u2192 ${labels.join(' & ')}`;
//         else msg = `${op} ${labels.join(' & ')}`;

//         fallbackToast(msg);
//     }

//     const col      = () => (DT && DT.getColLetter && DT.getColLetter()) || null;
//     const cell     = () => (DT && DT.getCellA1 && DT.getCellA1()) || null;
//     const rowIndex = () => (DT && DT.getRowIndex && DT.getRowIndex()) || null;

//     // ---------- TWO-HAND deictic local handler (runs actions immediately) ----------
//     function maybeHandleLocalVoice(raw){
//         if (!raw) return false;
//         const s = clean(raw);

//         // Accept many deictic mishears
//         const deicticRe = /\b(this|here|there|hear|hair|thiss|dis)\b/;

//         // SELECT both (useful for "select this")
//         if ((/^select\b/.test(s) || /\bselect\b/.test(s)) && deicticRe.test(s)) {
//         if (global.DeicticRun) {
//             const ok = global.DeicticRun({ action:'select', range:'this' });
//             if (ok) { showOpToast('selected'); return true; }
//         }
//         }

//         // DELETE both selections
//         if ((/\b(delete|clear|remove)\b/.test(s)) && deicticRe.test(s)) {
//         if (global.DeicticRun) {
//             const ok = global.DeicticRun({ action:'delete', range:'this' });
//             if (ok) { showOpToast('deleted'); return true; }
//         }
//         }

//         // WRITE value to both selections
//         // Catches: "write 50 here", "put hello there", "fill 'x' this", "set 3.14 hear"
//         const mWrite = s.match(/(?:^|\s)(?:write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on|at)?\s*(?:this|here|there|hear|hair|thiss|dis)\b/);
//         if (mWrite && mWrite[1]) {
//         let value = mWrite[1].trim();
//         value = value.replace(/^["']|["']$/g,''); // strip surrounding quotes
//         if (global.DeicticRun) {
//             const ok = global.DeicticRun({ action:'write', range:'this', value });
//             if (ok) { showOpToast('wrote', value); return true; }
//         }
//         }

//         return false;
//     }
//     // expose for other modules (e.g., voiceActions.js can call it pre-send)
//     global.__maybeHandleLocalVoice = maybeHandleLocalVoice;

//     // ---------- Legacy local parser (kept for non-deictic or single-target cases) ----------
//     function parseLocal(raw){
//         const s = clean(raw);

//         /* ==== [ADD] new semantic branches (runs before your existing ones) ==== */
//         {
//         // --- SELECT specific cell / column / row ---
//         // e.g. "select b5", "select cell b 5", "go to cell c12", "select row five", "select column B"
//         const a1 = extractA1(s);
//         if (a1 && /\b(select|go to|focus|highlight|pick)\b/i.test(s)) {
//             return { action: 'select', range: a1, confidence: 0.96 };
//         }
//         const colM = s.match(/\bselect\s+(?:column|col)\s+([a-z]+)\b/i);
//         if (colM) {
//             const L = colM[1].toUpperCase();
//             // whole column span; executor will clamp rows
//             return { action: 'select', range: `${L}1:${L}999999`, confidence: 0.94 };
//         }
//         const rowN_for_select = extractRowNumber(s);
//         if (rowN_for_select && /\bselect\b/i.test(s)) {
//             // whole row span; executor will clamp columns
//             return { action: 'select', range: `A${rowN_for_select}:ZZ${rowN_for_select}`, confidence: 0.93 };
//         }

//         // --- SCROLL: generic + “to Nth row” + “up/down” with default step ---
//         const DEFAULT_STEP = 8;

//         // "scroll down" / "go down" / "move down" (no number → default step)
//         if (/\b(scroll|go|move)\s+(down|below)\b/i.test(s) && !/\b\d+\b/.test(s)) {
//             return { action: 'scroll', delta: +DEFAULT_STEP, confidence: 0.90 };
//         }
//         // "scroll up"
//         if (/\b(scroll|go|move)\s+up\b/i.test(s) && !/\b\d+\b/.test(s)) {
//             return { action: 'scroll', delta: -DEFAULT_STEP, confidence: 0.90 };
//         }
//         // "scroll to the 5th row" / "go to row five" / "jump to 20"
//         const rowN_for_scroll = extractRowNumber(s);
//         if (rowN_for_scroll && /\b(scroll|go|jump)\b/i.test(s)) {
//             return { action: 'scroll', row: rowN_for_scroll, confidence: 0.95 };
//         }
//         // "go to top/bottom"
//         if (/\b(top|first row|beginning|start)\b/i.test(s)) {
//             return { action: 'scroll', row: 1, confidence: 0.90 };
//         }
//         if (/\b(bottom|last row|end)\b/i.test(s)) {
//             return { action: 'scroll', row: 999999, confidence: 0.90 }; // executor clamps
//         }

//         // --- ZOOM synonyms (maps to your existing zoom executor) ---
//         if (/\b(zoom|scale)\b/i.test(s)){
//             if (/\b(in|closer|bigger)\b/i.test(s))   return { action:'zoom', direction:'in',    confidence:0.95 };
//             if (/\b(out|smaller|farther)\b/i.test(s))return { action:'zoom', direction:'out',   confidence:0.95 };
//             if (/\b(reset|normal|default)\b/i.test(s))return { action:'zoom', direction:'reset', confidence:0.90 };
//         }
//         }
//         /* ==== [END add] continue with your existing branches below ==== */






//         // SELECT
//         if (/^select\b/.test(s) || /\bselect\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)){
//             return { action:'select', range:'this', confidence:0.9 };
//         }
//         }

//         // SCROLL
//         if (/^scroll\b/.test(s) || /\bscroll\b/.test(s) || /\bgo to\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell(); if (a1) return { action:'scroll', at:a1, confidence:0.9 };
//             const ri = rowIndex(); if (ri || ri===0) return { action:'scroll', row:ri, confidence:0.85 };
//         }
//         const up = s.match(/\bscroll\s+up\s+(\d+)\b/);   if (up) return { action:'scroll', delta:-parseInt(up[1],10), confidence:0.85 };
//         const dn = s.match(/\bscroll\s+down\s+(\d+)\b/); if (dn) return { action:'scroll', delta: parseInt(dn[1],10), confidence:0.85 };
//         const r  = s.match(/\brow\s+(\d+)\b/);           if (r)  return { action:'scroll', row:parseInt(r[1],10), confidence:0.9 };
//         const cM = s.match(/\bcolumn\s+([a-z]+)\b/i);    if (cM) return { action:'scroll', col:cM[1].toUpperCase(), confidence:0.9 };
//         }

//         // UNDO / REDO
//         if (/^undo\b/.test(s)) return { action:'undo', confidence:0.95 };
//         if (/^redo\b/.test(s)) return { action:'redo', confidence:0.95 };

//         // DELETE (clear) — deictic → BOTH hands via "this"
//         if (/^(delete|clear|remove)\b/.test(s) && /\b(this|here)\b/.test(s)){
//         return { action:'delete', range:'this', confidence:0.92 };
//         }

//         // MERGE
//         if (/^merge\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)){
//             return { action:'merge', range:'this', confidence:0.85 };
//         }
//         const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
//         if (m) return { action:'merge', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
//         }

//         // ZOOM
//         if (/^zoom\b/.test(s) || /\bzoom\b/.test(s)){
//         if (/\bin\b/.test(s))   return { action:'zoom', direction:'in',    confidence:0.9 };
//         if (/\bout\b/.test(s))  return { action:'zoom', direction:'out',   confidence:0.9 };
//         if (/\breset\b/.test(s))return { action:'zoom', direction:'reset', confidence:0.9 };
//         }

//         // COPY
//         if (/^copy\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)) return { action:'copy', range:'this', confidence:0.9 };
//         const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
//         if (m) return { action:'copy', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
//         }

//         // PASTE
//         if (/^paste\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell() || (col() ? `${col()}1` : null);
//             if (a1) return { action:'paste', at:a1, confidence:0.9 };
//         }
//         const m = s.match(/\bat\s+([a-z]+\d+)\b/i);
//         if (m) return { action:'paste', at:m[1].toUpperCase(), confidence:0.92 };
//         }

//         // SORT
//         if (/^sort\b/.test(s)){
//         const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
//         let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
//         if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
//         if (!C && /\bthis\b/.test(s)) C = col();
//         if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
//         }

//         // WRITE (non-deictic fallback)
//         if (/^write\b/.test(s)){
//         const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
//         if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };

//         const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
//         if (mHere){ return { action:'write', range:'this', value:mHere[1].trim(), confidence:0.92 }; }

//         const mBare = s.match(/^write\s+(.+?)\s*$/i);
//         if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
//         }

//         // Column aggregate shorthands on "this" column
//         if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum',     range:`${C}1:${C}9999`, confidence:0.9 }; }
//         if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }

//         return null;
//     }

//     // ---------- Wrap fetch('/api/voice-command') ----------
//     const _fetch = global.fetch.bind(global);

//     global.fetch = async function(input, init){
//         const url = (typeof input === 'string') ? input : (input && input.url);
//         const isVoice = /\/api\/voice-command$/.test(url || '');
//         if (!isVoice) return _fetch(input, init);

//         // Extract raw transcript (if present) and CLEAN it for server
//         let rawTranscript = null;
//         try {
//         if (init && typeof init.body === 'string') {
//             const parsed = JSON.parse(init.body);
//             rawTranscript = parsed && parsed.transcript;
//             if (rawTranscript) {
//             init = { ...init, body: JSON.stringify({ transcript: clean(rawTranscript) }) };
//             }
//         }
//         } catch (_) {}

//         // 1) Try LOCAL two-hand deictic first (applies BOTH selections immediately)
//         try {
//         if (rawTranscript && maybeHandleLocalVoice(rawTranscript)) {
//             // Already executed the action locally; return a benign JSON
//             return new Response(
//             JSON.stringify({ result: { action:'none', confidence:1.0, handledLocally:true } }),
//             { status:200, headers:{'Content-Type':'application/json'} }
//             );
//         }
//         } catch (e) {
//         console.warn('[VoiceDeicticMiddleware] local pre-send handler error:', e);
//         }

//         // 2) Ask the server
//         const res = await _fetch(input, init);

//         // 3) If server declines (action:none), try local fallbacks
//         try {
//         const clone   = res.clone();
//         const payload = await clone.json().catch(()=>null);
//         const cmd     = payload && (payload.result || payload);

//         // If server produced a command, pass it through
//         if (cmd && cmd.action && cmd.action !== 'none') return res;

//         // Otherwise: two-tier fallback
//         // 3a) Try two-hand deictic again (in case we couldn't run it pre-send)
//         if (rawTranscript && maybeHandleLocalVoice(rawTranscript)) {
//             return new Response(
//             JSON.stringify({ result: { action:'none', confidence:1.0, handledLocally:true } }),
//             { status:200, headers:{'Content-Type':'application/json'} }
//             );
//         }

//         // 3b) Legacy single-target local parse (kept for other ops)
//         const local = parseLocal(rawTranscript || '');
//         if (local && local.action && (local.confidence ?? 0) >= 0.55) {
//             return new Response(
//             JSON.stringify({ result: local }),
//             { status:200, headers:{'Content-Type':'application/json'} }
//             );
//         }
//         return res;
//         } catch (e) {
//         console.warn('[VoiceDeicticMiddleware] post-server local handling error:', e);
//         return res;
//         }
//     };

//     console.info('[VoiceDeicticMiddleware] ready (two-hand deictic + HUD toasts).');
// })(window);


















// // /* static/js/voiceDeicticMiddleware.js
// //  * Intercept simple deictic commands locally so one command hits BOTH hands.
// //  * Falls back to server if no local match.
// //  */
// // (function (global) {
// //     'use strict';

// //     // call this with raw ASR text; return true if handled locally
// //     function handleLocalVoice(text){
// //         if (!text) return false;
// //         const s = String(text).trim().toLowerCase();

// //         // common ASR variants for "here/this"
// //         const deictic = ['this','here','there','hear','hare','hair'];

// //         // delete this/here
// //         if (/^(delete|clear)\s+(\w+)$/.test(s)) {
// //         const word = s.split(/\s+/).pop();
// //         if (deictic.includes(word)) {
// //             return !!(global.DeicticRun && global.DeicticRun({ action:'delete', range:'this' }));
// //         }
// //         }

// //         // write/put/fill <value> here/this
// //         const m = s.match(/^(write|put|fill|set)\s+(.+?)\s+(\w+)$/);
// //         if (m) {
// //         const value = m[2];
// //         const where = m[3];
// //         if (deictic.includes(where)) {
// //             return !!(global.DeicticRun && global.DeicticRun({ action:'write', range:'this', value }));
// //         }
// //         }

// //         return false;
// //     }

// //     // Wire into your existing voice path if available
// //     global.__maybeHandleLocalVoice = handleLocalVoice;
// //     console.info('[VoiceDeicticMiddleware] Ready (local deictic → BOTH selections).');

// // })(window);





// // /* static/js/voiceDeicticMiddleware.js */
// // (function (global) {
// //     'use strict';
// //     const DT = global.DeicticTarget;

// //     // ---------- helpers ----------
// //     function clean(s){
// //         // strip hotword and common mishears
// //         let t = String(s||'').trim();
// //         t = t.replace(/^(?:hey|ok|okay)\s+(?:flexe?i?e?)\s*/i,'');
// //         t = t.replace(/^(?:flexe?i?e?),?\s*/i,'');
// //         t = t.replace(/^(?:play\s+se?a?\s+|play\s+see\s+|place\s+|plexi\s+|lexi\s+|sexy\s+)/i,'');
// //         // normalize words
// //         t = (' '+t.toLowerCase()+' ')
// //         .replace(/\sright\s/g,' write ')
// //         .replace(/\srite\s/g,' write ')
// //         .replace(/\ssea\s+salt\s/g,' sort ')
// //         .replace(/\ssee\s+salt\s/g,' sort ')
// //         .trim();
// //         // compress spaced digits ("5 0" -> "50")
// //         t = t.replace(/\b(\d)\s+(\d)\b/g,(_,a,b)=>a+b);
// //         return t;
// //     }
// //     const col = () => (DT && DT.getColLetter && DT.getColLetter()) || null;
// //     const cell = () => (DT && DT.getCellA1 && DT.getCellA1()) || null;
// //     const rowIndex = () => (DT && DT.getRowIndex && DT.getRowIndex()) || null;

// //     // Build a local command object for all supported actions
// //     function parseLocal(raw){
// //         const s = clean(raw);

// //         // SELECT
// //         if (/^select\b/.test(s) || /\bselect\b/.test(s)){
// //         // select this / select here
// //         if (/\b(this|here)\b/.test(s)){
// //             const a1 = cell();
// //             if (a1) return { action:'select', range:a1, confidence:0.9 };
// //             const c = col(); if (c) return { action:'select', range:`${c}:${c}`, confidence:0.85 };
// //         }
// //         }

// //         // SCROLL
// //         if (/^scroll\b/.test(s) || /\bscroll\b/.test(s) || /\bgo to\b/.test(s)){
// //         // "scroll to this" / "go to this"
// //         if (/\b(this|here)\b/.test(s)){
// //             const a1 = cell(); if (a1) return { action:'scroll', at:a1, confidence:0.9 };
// //             const ri = rowIndex(); if (ri) return { action:'scroll', row:ri, confidence:0.85 };
// //         }
// //         // up/down N
// //         const up = s.match(/\bscroll\s+up\s+(\d+)\b/); if (up) return { action:'scroll', delta:-parseInt(up[1],10), confidence:0.85 };
// //         const dn = s.match(/\bscroll\s+down\s+(\d+)\b/); if (dn) return { action:'scroll', delta:parseInt(dn[1],10), confidence:0.85 };
// //         // to row N / column C
// //         const r = s.match(/\brow\s+(\d+)\b/); if (r) return { action:'scroll', row:parseInt(r[1],10), confidence:0.9 };
// //         const c = s.match(/\bcolumn\s+([a-z]+)\b/i); if (c) return { action:'scroll', col:c[1].toUpperCase(), confidence:0.9 };
// //         }

// //         // UNDO / REDO
// //         if (/^undo\b/.test(s)) return { action:'undo', confidence:0.95 };
// //         if (/^redo\b/.test(s)) return { action:'redo', confidence:0.95 };

// //         // DELETE (clear)
// //         if (/^(delete|clear)\b/.test(s)){
// //         // delete this / here
// //         if (/\b(this|here)\b/.test(s)){
// //             const a1 = cell(); if (a1) return { action:'delete', range:a1, confidence:0.92 };
// //             const c = col(); if (c) return { action:'delete', range:`${c}:${c}`, confidence:0.9 };
// //         }
// //         }

// //         // MERGE
// //         if (/^merge\b/.test(s)){
// //         if (/\b(this|here)\b/.test(s)){
// //             // Merge current selection; if only a cell, no-op
// //             return { action:'merge', range:'this', confidence:0.85 };
// //         }
// //         const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
// //         if (m) return { action:'merge', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
// //         }

// //         // ZOOM
// //         if (/^zoom\b/.test(s) || /\bzoom\b/.test(s)){
// //         if (/\bin\b/.test(s)) return { action:'zoom', direction:'in', confidence:0.9 };
// //         if (/\bout\b/.test(s)) return { action:'zoom', direction:'out', confidence:0.9 };
// //         if (/\breset\b/.test(s)) return { action:'zoom', direction:'reset', confidence:0.9 };
// //         }

// //         // COPY
// //         if (/^copy\b/.test(s)){
// //         if (/\b(this|here)\b/.test(s)){
// //             const a1 = cell(); if (a1) return { action:'copy', range:a1, confidence:0.9 };
// //             const c = col();  if (c)  return { action:'copy', range:`${c}:${c}`, confidence:0.9 };
// //         }
// //         const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
// //         if (m) return { action:'copy', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
// //         }

// //         // PASTE
// //         if (/^paste\b/.test(s)){
// //         // paste here / paste at this
// //         if (/\b(this|here)\b/.test(s)){
// //             const a1 = cell() || (col() ? `${col()}1` : null);
// //             if (a1) return { action:'paste', at:a1, confidence:0.9 };
// //         }
// //         const m = s.match(/\bat\s+([a-z]+\d+)\b/i);
// //         if (m) return { action:'paste', at:m[1].toUpperCase(), confidence:0.92 };
// //         }

// //         // SORT + WRITE + SUM + AVERAGE already covered (but keep them too if you used earlier version)
// //         if (/^sort\b/.test(s)){
// //         const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
// //         let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
// //         if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
// //         if (!C && /\bthis\b/.test(s)) C = col();
// //         if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
// //         }
// //         if (/^write\b/.test(s)){
// //         const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
// //         if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };
// //         const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
// //         if (mHere){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mHere[1].trim(), confidence:0.92 }; }
// //         const mBare = s.match(/^write\s+(.+?)\s*$/i);
// //         if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
// //         }
// //         if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum', range:`${C}1:${C}9999`, confidence:0.9 }; }
// //         if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }

// //         return null;
// //     }

// //     // Wrap fetch('/api/voice-command')
// //     const _fetch = global.fetch.bind(global);
// //     global.fetch = async function(input, init){
// //         const url = (typeof input === 'string') ? input : (input && input.url);
// //         if (!/\/api\/voice-command$/.test(url || '')) return _fetch(input, init);

// //         // send cleaned transcript to server
// //         let transcript = null;
// //         try {
// //         if (init && typeof init.body === 'string') {
// //             const parsed = JSON.parse(init.body);
// //             transcript = parsed && parsed.transcript;
// //             if (transcript) init = { ...init, body: JSON.stringify({ transcript: clean(transcript) }) };
// //         }
// //         } catch (_) {}

// //         const res = await _fetch(input, init);

// //         try {
// //         const clone = res.clone();
// //         const payload = await clone.json().catch(()=>null);
// //         const cmd = payload && (payload.result || payload);

// //         if (cmd && cmd.action && cmd.action !== 'none') return res;

// //         const local = parseLocal(transcript || '');
// //         if (local && local.action && local.confidence >= 0.55) {
// //             return new Response(JSON.stringify({ result: local }), { status:200, headers:{'Content-Type':'application/json'} });
// //         }
// //         return res;
// //         } catch (_) {
// //         return res;
// //         }
// //     };

// //     console.info('[VoiceDeicticMiddleware] ready for select/scroll/undo/redo/delete/merge/zoom/copy/paste.');
// // })(window);
