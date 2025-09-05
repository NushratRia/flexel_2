/* static/js/deicticTargetBothHands.js
 */
(function (global) {
    'use strict';
    const GU  = global.GestureUtils || {};
    const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

    global.__handLiveRects = global.__handLiveRects || { L:null, R:null };

    function rcFromTD(td){
        const hot = HOT();
        if (hot && typeof hot.getCoords === 'function') return hot.getCoords(td);
        return (GU.rcFromTD ? GU.rcFromTD(td) : null);
    }
    function tableSize(){
        const hot = HOT(); if (!hot) return {rows:0, cols:0};
        return { rows: hot.countRows ? hot.countRows() : 0, cols: hot.countCols ? hot.countCols() : 0 };
    }
    function targetToRect(tgt){
        const { rows, cols } = tableSize();
        if (!tgt || !rows || !cols) return null;
        if (tgt.kind === 'cell') return { r1:tgt.row, c1:tgt.col, r2:tgt.row, c2:tgt.col };
        if (tgt.kind === 'row')  return { r1:tgt.rowIndex, c1:0, r2:tgt.rowIndex, c2:cols-1 };
        if (tgt.kind === 'col')  return { r1:0, c1:tgt.colIndex, r2:rows-1, c2:tgt.colIndex };
        return null;
    }
    function locateTarget(lm){
        // fingertip element
        const tip = lm[8];
        const el  = (GU.elementAt && GU.elementAt(tip)) || null;

        // col header?
        if (el && el.closest && el.closest('.ht_clone_top')) {
        const hdr = el.closest('th,div') || el;
        const idx = (hdr.cellIndex != null)
            ? hdr.cellIndex
            : (hdr.parentNode ? Array.from(hdr.parentNode.children).indexOf(hdr) : -1);
        if (idx >= 0) return { kind:'col', colIndex: idx };
        }
        // row header?
        if (el && el.closest && el.closest('.ht_clone_left')) {
        const hdr = el.closest('th,div') || el;
        const num = parseInt((hdr.textContent || hdr.innerText || '').trim(), 10);
        if (!Number.isNaN(num)) return { kind:'row', rowIndex: num - 1 };
        }
        // body cell
        const td = GU.tdAt ? GU.tdAt(tip) : null;
        if (td) {
        const rc = rcFromTD(td);
        if (rc && rc.row >= 0 && rc.col >= 0) return { kind:'cell', row: rc.row, col: rc.col };
        }
        return null;
    }

    function rectEquals(a,b){ return a && b && a.r1===b.r1 && a.c1===b.c1 && a.r2===b.r2 && a.c2===b.c2; }

    function onResults(res){
        const handsLM    = (res && res.multiHandLandmarks) || [];
        const handedness = (res && res.multiHandedness) || [];

        // reset; we’ll only set what we actually see this frame
        let nextL = null, nextR = null;

        handsLM.forEach((lm,i)=>{
        let hand='R';
        try {
            const lbl = handedness[i] && handedness[i].label;
            if (lbl && /left/i.test(lbl))  hand='L';
            if (lbl && /right/i.test(lbl)) hand='R';
        } catch {}

        const tgt  = locateTarget(lm);
        const rect = targetToRect(tgt);
        if (rect) {
            if (hand==='L') nextL = rect; else nextR = rect;
        }
        });

        // update globals only if changed (avoid churn)
        if (!rectEquals(global.__handLiveRects.L, nextL)) global.__handLiveRects.L = nextL;
        if (!rectEquals(global.__handLiveRects.R, nextR)) global.__handLiveRects.R = nextR;
    }

    function attachWhenReady(){
        function tryAttach(){
        const hands = (global.GestureActions && global.GestureActions._hands) || global.hands || null;
        if (!hands) return false;
        if (GU && typeof GU.multiplexOnResults === 'function') GU.multiplexOnResults(hands);
        hands.onResults(onResults);
        console.info('[deicticTargetBothHands] attached (live L/R rects).');
        return true;
        }
        if (!tryAttach()) {
        const id = setInterval(()=>{ if (tryAttach()) clearInterval(id); }, 250);
        setTimeout(()=>clearInterval(id), 15000);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachWhenReady);
    else attachWhenReady();

})(window);










// /* static/js/deicticTargetBothHands.js
//  * Tracks BOTH hands; last fresh pointer (L/R) is used as "this".
//  */
// (function (global) {
//     'use strict';
//     const GU = global.GestureUtils || {};
//     function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
//     function getHot(){ return (global.GestureActions && global.GestureActions._hot) || global.hot || null; }

//     const Target = {
//         _last:null,
//         _freshMs:1800, // grace window for hotword + STT lag

//         _updateFromFingers(res){
//         if(!res||!res.multiHandLandmarks) return;
//         // loop through all detected hands
//         for (const lm of res.multiHandLandmarks){
//             const el = (GU.elementAt && GU.elementAt(lm[8])) || null; // index fingertip

//             if (el && el.closest){
//             if (el.closest('.ht_clone_top')){
//                 const hdr = el.closest('th,div') || el;
//                 const idx = (hdr.cellIndex!=null) ? hdr.cellIndex
//                         : Array.from(hdr.parentNode.children).indexOf(hdr);
//                 if(idx>=0){ this._last = {type:'col', colLetter: colLetters(idx), t: performance.now()}; continue; }
//             }
//             if (el.closest('.ht_clone_left')){
//                 const hdr = el.closest('th,div') || el;
//                 const num = parseInt((hdr.textContent||hdr.innerText||'').trim(),10);
//                 if(!Number.isNaN(num)){ this._last = {type:'row', row1:num, t:performance.now()}; continue; }
//             }
//             }

//             const td = GU.tdAt ? GU.tdAt(lm[8]) : null;
//             if(td){
//             const hot = getHot();
//             const rc = (hot && typeof hot.getCoords==='function') ? hot.getCoords(td) : (GU.rcFromTD && GU.rcFromTD(td));
//             if(rc && rc.col>=0 && rc.row>=0){
//                 this._last = {type:'cell', a1:`${colLetters(rc.col)}${rc.row+1}`, t: performance.now()};
//             }
//             }
//         }
//         },

//         _fallbackFromSelection(){
//         const hot = getHot();
//         const sel = hot && hot.getSelectedLast && hot.getSelectedLast();
//         if(!sel) return null;
//         const r1 = Math.min(sel[0], sel[2]), c1 = Math.min(sel[1], sel[3]);
//         const r2 = Math.max(sel[0], sel[2]), c2 = Math.max(sel[1], sel[3]);
//         if(r1===r2 && c1===c2) return {type:'cell', a1:`${colLetters(c1)}${r1+1}`};
//         const rows = hot && hot.countRows ? hot.countRows() : null;
//         const cols = hot && hot.countCols ? hot.countCols() : null;
//         if(rows && r1===0 && r2>=rows-1 && c1===c2) return {type:'col', colLetter: colLetters(c1)};
//         if(cols && c1===0 && c2>=cols-1 && r1===r2) return {type:'row', row1: r1+1};
//         return {type:'cell', a1:`${colLetters(c1)}${r1+1}`};
//         },

//         get(){
//         const fresh = this._last && (performance.now()-this._last.t)<this._freshMs;
//         return fresh ? this._last : this._fallbackFromSelection();
//         },
//         getCellA1(){ const g=this.get(); if(!g) return null; if(g.type==='cell') return g.a1; if(g.type==='col') return `${g.colLetter}1`; if(g.type==='row') return `A${g.row1}`; return null; },
//         getColLetter(){ const g=this.get(); if(!g) return null; if(g.type==='col') return g.colLetter; if(g.type==='cell') return g.a1.replace(/\d+$/,''); return null; },
//         getRowIndex(){ const g=this.get(); if(!g) return null; if(g.type==='row') return g.row1; if(g.type==='cell'){ const m=g.a1.match(/\d+$/); return m?parseInt(m[0],10):null; } return null; }
//     };

//     function attachWhenReady(){
//         function tryAttach(){
//         const hands = (global.GestureActions && global.GestureActions._hands) || global.hands || null;
//         if(!hands) return false;
//         if(GU && typeof GU.multiplexOnResults==='function') GU.multiplexOnResults(hands);
//         hands.onResults((res)=>Target._updateFromFingers(res));
//         console.info('[DeicticTargetBothHands] attached for both hands.');
//         return true;
//         }
//         if(!tryAttach()){
//         const id=setInterval(()=>{ if(tryAttach()) clearInterval(id); },250);
//         setTimeout(()=>clearInterval(id),15000);
//         }
//     }
//     if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', attachWhenReady);
//     else attachWhenReady();

//     global.DeicticTarget = Target;
// })(window);
