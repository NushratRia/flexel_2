/* static/js/bimanualPinchSelect.js

 */
(function (global) {
    'use strict';

    const GU  = global.GestureUtils || {};
    const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

    // Expose shared buckets used by voice + HUD
    global.__handRegions          = global.__handRegions          || { L:null, R:null, tL:0, tR:0 };
    global.__lastTwoHandTargets   = global.__lastTwoHandTargets   || { L:null, R:null };
    global.__lastDeicticToastInfo = global.__lastDeicticToastInfo || { sig:'', t:0 };

    // ---------- helpers ----------
    function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
    function rcFromTD(td){
        const hot = HOT();
        if (hot && typeof hot.getCoords === 'function') return hot.getCoords(td);
        return (GU.rcFromTD ? GU.rcFromTD(td) : null);
    }

    function locateTargetForLandmarks(lm){
        const tip = lm[8];
        const el  = (GU.elementAt && GU.elementAt(tip)) || null;

        // Column header?
        if (el && el.closest && el.closest('.ht_clone_top')) {
        const hdr = el.closest('th,div') || el;
        const idx = (hdr.cellIndex != null)
            ? hdr.cellIndex
            : (hdr.parentNode ? Array.from(hdr.parentNode.children).indexOf(hdr) : -1);
        if (idx >= 0) return { kind:'col', colIndex: idx };
        }
        // Row header?
        if (el && el.closest && el.closest('.ht_clone_left')) {
        const hdr = el.closest('th,div') || el;
        const num = parseInt((hdr.textContent || hdr.innerText || '').trim(), 10);
        if (!Number.isNaN(num)) return { kind:'row', rowIndex: num - 1 };
        }
        // Body cell
        const td = GU.tdAt ? GU.tdAt(tip) : null;
        if (td) {
        const rc = rcFromTD(td);
        if (rc && rc.row >= 0 && rc.col >= 0) return { kind:'cell', row: rc.row, col: rc.col };
        }
        return null;
    }

    // pinch hysteresis
    const PINCH_IN  = 0.065;
    const PINCH_OUT = 0.085;
    const HOLD_MS   = 80;

    const state = {
        L: { down:false, since:0, target:null },
        R: { down:false, since:0, target:null }
    };

    function isPinching(lm){ const a=lm[4], b=lm[8]; return Math.hypot(a.x-b.x,a.y-b.y) < PINCH_IN; }
    function isReleased(lm){ const a=lm[4], b=lm[8]; return Math.hypot(a.x-b.x,a.y-b.y) > PINCH_OUT; }

    function hotCounts(){
        const hot = HOT(); if (!hot) return {rows:0, cols:0};
        return {
        rows: Math.max(0, (hot.countRows ? hot.countRows() : 0) - 1) + 1,
        cols: Math.max(0, (hot.countCols ? hot.countCols() : 0) - 1) + 1
        };
    }

    function targetToRect(tgt){
        const hot = HOT(); if (!hot || !tgt) return null;
        const { rows, cols } = hotCounts();
        if (tgt.kind === 'cell') return { r1:tgt.row, c1:tgt.col, r2:tgt.row, c2:tgt.col };
        if (tgt.kind === 'row')  return { r1:tgt.rowIndex, c1:0, r2:tgt.rowIndex, c2:Math.max(0, cols-1) };
        if (tgt.kind === 'col')  return { r1:0, c1:tgt.colIndex, r2:Math.max(0, rows-1), c2:tgt.colIndex };
        return null;
    }

    function selectRectVisible(rect){
        const hot=HOT(); if(!hot || !rect) return;
        hot.selectCell(rect.r1, rect.c1, rect.r2, rect.c2, true);
    }

    // ---------- HUD helpers ----------
    function encodeTargetSig(t){
        if (!t) return '';
        if (t.kind === 'cell') return `cell:${t.row},${t.col}`;
        if (t.kind === 'row')  return `row:${t.rowIndex}`;
        if (t.kind === 'col')  return `col:${t.colIndex}`;
        return '';
    }
    function showSelectionToastIfAny(){
        // Show "Selected A2 & B4" toast if available & not spammy
        const T = global.__lastTwoHandTargets || {};
        const L = T.L || null, R = T.R || null;
        if (!L && !R) return;

        const sig = `${encodeTargetSig(L)}|${encodeTargetSig(R)}`;
        const now = performance.now();
        const last = global.__lastDeicticToastInfo || { sig:'', t:0 };

        // Throttle duplicates within 450ms
        if (sig && last.sig === sig && (now - last.t) < 450) return;

        if (global.DeicticToast && typeof global.DeicticToast.show === 'function') {
        const arr = [L, R].filter(Boolean);
        if (arr.length) global.DeicticToast.show('selected', arr);
        global.__lastDeicticToastInfo = { sig, t: now };
        }
    }

    function commitHandSnapshot(hand, tgt){
        // Normalize & persist both a rect (for HOT ops) and the raw target (for HUD/voice)
        const rect = targetToRect(tgt);
        if (!rect) return;
        const now = performance.now();

        if (hand === 'L') {
        global.__handRegions.L = rect;  global.__handRegions.tL = now;
        global.__lastTwoHandTargets.L = tgt || null;
        } else {
        global.__handRegions.R = rect;  global.__handRegions.tR = now;
        global.__lastTwoHandTargets.R = tgt || null;
        }

        // Last hand wins the visible HOT selection (still single)
        selectRectVisible(rect);

        // Show HUD describing BOTH current selections (e.g., "Selected A2 & B4")
        showSelectionToastIfAny();
    }

    // ---------- main callback ----------
    function onResults(res){
        const hot = HOT(); if (!hot) return;

        const handsLM    = (res && res.multiHandLandmarks) || [];
        const handedness = (res && res.multiHandedness) || [];

        const observed = handsLM.map((lm,i)=>{
        let hand='R';
        try {
            const lbl = handedness[i] && handedness[i].label;
            if (lbl && /left/i.test(lbl))  hand='L';
            if (lbl && /right/i.test(lbl)) hand='R';
        } catch {}
        return { hand, lm, pin:isPinching(lm), rel:isReleased(lm), tgt:locateTargetForLandmarks(lm) };
        });

        const tNow = performance.now();

        for (const obs of observed) {
        const H = (obs.hand==='L') ? state.L : state.R;

        if (obs.tgt) H.target = obs.tgt;

        if (!H.down) {
            if (obs.pin) {
            if (H.since === 0) H.since = tNow;
            if (tNow - H.since >= HOLD_MS) {
                H.down = true; H.since = 0;
                commitHandSnapshot(obs.hand, H.target); // independent lock-in + HUD
            }
            } else {
            H.since = 0;
            }
        } else {
            if (obs.rel) { H.down = false; H.since = 0; }
        }
        }
    }

    // ---------- attach ----------
    function attachWhenReady(){
        function tryAttach(){
        const hands = (global.GestureActions && global.GestureActions._hands) || global.hands || null;
        if (!hands) return false;
        if (GU && typeof GU.multiplexOnResults === 'function') GU.multiplexOnResults(hands);
        hands.onResults(onResults);
        console.info('[BimanualPinchSelect] attached (independent two-hand selection + HUD).');
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








// /* static/js/bimanualPinchSelect.js
//  * Two-hand pinch selection for Handsontable.
//  * - Pinch with LEFT or RIGHT hand to select a cell / column / row under that hand.
//  * - If both hands pinch within a short window, we combine selections:
//  *    - cell + cell   -> rectangular block between the two cells
//  *    - col + col     -> full columns between them
//  *    - row + row     -> full rows between them
//  *    - col + row     -> intersection cell (row x col)
//  *    - header + cell -> rectangular block spanning that header across to the cell
//  *
//  * No edits to your existing code. Attaches via GestureUtils.multiplexOnResults.
//  */
// (function (global) {
//     'use strict';

//     // ---------- Shortcuts ----------
//     const GU  = global.GestureUtils || {};
//     const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

//     // Require simultaneous two-hand pinch in the SAME frame (strict mode)
//     const STRICT_SIMUL_TWO_HAND = true;

//     // ---------- Geometry helpers ----------
//     function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
//     function colIndexFromLetters(s){ s=s.toUpperCase(); let n=0; for (let i=0;i<s.length;i++){ n = n*26 + (s.charCodeAt(i)-64); } return n-1; }
//     function rcToA1(r,c){ return `${colLetters(c)}${r+1}`; }

//     // Try to get rc from a <td> using HOT APIs if present
//     function rcFromTD(td){
//         const hot = HOT();
//         if (hot && typeof hot.getCoords === 'function') {
//             return hot.getCoords(td); // {row, col}
//         }
//         return GU.rcFromTD ? GU.rcFromTD(td) : null;
//     }

//     // ---------- Hit-testing a single hand’s fingertip ----------
//     function locateTargetForLandmarks(lm){
//         // lm[8] is index fingertip; lm[4] is thumb tip
//         const tip = lm[8];

//         // Prefer GU.elementAt if available; else fallback to toScreenXY + elementFromPoint
//         let el = (GU.elementAt && GU.elementAt(tip)) || null;
//         if (!el && GU.toScreenXY) {
//             const pt = GU.toScreenXY(tip);
//             el = document.elementFromPoint(pt.x, pt.y);
//         }

//         // Column header?
//         if (el && el.closest && el.closest('.ht_clone_top')) {
//             const hdr = el.closest('th,div') || el;
//             const idx = (hdr.cellIndex != null)
//                 ? hdr.cellIndex
//                 : (hdr.parentNode ? Array.from(hdr.parentNode.children).indexOf(hdr) : -1);
//             if (idx >= 0) return { kind:'col', colIndex: idx, colLetter: colLetters(idx) };
//         }

//         // Row header?
//         if (el && el.closest && el.closest('.ht_clone_left')) {
//             const hdr = el.closest('th,div') || el;
//             const num = parseInt((hdr.textContent || hdr.innerText || '').trim(), 10);
//             if (!Number.isNaN(num)) return { kind:'row', rowIndex: num - 1 };
//         }

//         // Body cell
//         const td = GU.tdAt ? GU.tdAt(tip) : null;
//         if (td) {
//             const rc = rcFromTD(td);
//             if (rc && rc.row >= 0 && rc.col >= 0) {
//                 return { kind:'cell', row: rc.row, col: rc.col };
//             }
//         }
//         return null;
//     }

//     // ---------- Pinch detection with hysteresis ----------
//     const PINCH_IN  = 0.065; // tighten/loosen if needed (normalized distance)
//     const PINCH_OUT = 0.085; // hysteresis to avoid flicker
//     const HOLD_MS   = 80;    // require grip to persist for N ms to count as "start"
//     const COMBINE_WINDOW_MS = 350; // time window to combine two-hand pinches (fallback for non-strict)

//     const state = {
//         L: { down:false, since:0, lastStart:0, target:null },
//         R: { down:false, since:0, lastStart:0, target:null },
//         lastCombinedAt: 0,
//         simulCombined: false // prevents repeated combines while both pinches are held
//     };

//     function isPinching(lm){
//         // distance between thumb tip (4) and index tip (8), normalized by hand size
//         const a = lm[4], b = lm[8];
//         const dx = a.x - b.x, dy = a.y - b.y;
//         const d  = Math.hypot(dx, dy);
//         return d < PINCH_IN;
//     }
//     function isReleased(lm){
//         const a = lm[4], b = lm[8];
//         const dx = a.x - b.x, dy = a.y - b.y;
//         const d  = Math.hypot(dx, dy);
//         return d > PINCH_OUT;
//     }

//     // ---------- Selection primitives ----------
//     function selectCell(r, c){
//         const hot = HOT(); if (!hot) return false;
//         hot.selectCell(r, c);
//         return true;
//     }
//     function selectRect(r1,c1,r2,c2){
//         const hot = HOT(); if (!hot) return false;
//         hot.selectCell(Math.min(r1,r2), Math.min(c1,c2),
//                        Math.max(r1,r2), Math.max(c1,c2), true);
//         return true;
//     }
//     function selectColumns(c1, c2){
//         const hot = HOT(); if (!hot) return false;
//         const a = Math.min(c1,c2), b = Math.max(c1,c2);
//         const rows = hot.countRows ? hot.countRows() : 9999;
//         return selectRect(0, a, Math.max(0, rows-1), b);
//     }
//     function selectRows(r1, r2){
//         const hot = HOT(); if (!hot) return false;
//         const a = Math.min(r1,r2), b = Math.max(r1,r2);
//         const cols = hot.countCols ? hot.countCols() : 1;
//         return selectRect(a, 0, b, Math.max(0, cols-1));
//     }

//     // Combine two targets into one selection (fixed symmetric logic)
//     function combineTargets(tA, tB){
//         const A = tA, B = tB;

//         // cell + cell -> rectangle
//         if (A.kind==='cell' && B.kind==='cell') {
//             return () => selectRect(A.row, A.col, B.row, B.col);
//         }
//         // col + col -> columns span
//         if (A.kind==='col' && B.kind==='col') {
//             return () => selectColumns(A.colIndex, B.colIndex);
//         }
//         // row + row -> rows span
//         if (A.kind==='row' && B.kind==='row') {
//             return () => selectRows(A.rowIndex, B.rowIndex);
//         }
//         // col + row -> intersection cell
//         if ((A.kind==='col' && B.kind==='row') || (A.kind==='row' && B.kind==='col')) {
//             const r = (A.kind==='row' ? A.rowIndex : B.rowIndex);
//             const c = (A.kind==='col' ? A.colIndex : B.colIndex);
//             return () => selectCell(r, c);
//         }
//         // col + cell -> 1-row horizontal span from header col to the cell's col on the cell's row
//         if ((A.kind==='col' && B.kind==='cell') || (A.kind==='cell' && B.kind==='col')) {
//             const colIdx = (A.kind==='col' ? A.colIndex : B.colIndex);
//             const cell   = (A.kind==='cell' ? A : B);
//             const c1 = Math.min(colIdx, cell.col), c2 = Math.max(colIdx, cell.col);
//             return () => selectRect(cell.row, c1, cell.row, c2);
//         }
//         // row + cell -> 1-col vertical span from header row to the cell's row in the cell's column
//         if ((A.kind==='row' && B.kind==='cell') || (A.kind==='cell' && B.kind==='row')) {
//             const rowIdx = (A.kind==='row' ? A.rowIndex : B.rowIndex);
//             const cell   = (A.kind==='cell' ? A : B);
//             const r1 = Math.min(rowIdx, cell.row), r2 = Math.max(rowIdx, cell.row);
//             return () => selectRect(r1, cell.col, r2, cell.col);
//         }

//         // fallback: prefer A's single selection
//         if (A.kind==='cell') return () => selectCell(A.row, A.col);
//         if (A.kind==='col')  return () => selectColumns(A.colIndex, A.colIndex);
//         if (A.kind==='row')  return () => selectRows(A.rowIndex, A.rowIndex);
//         return null;
//     }

//     // ---------- Main hook ----------
//     function onResults(res){
//         const hot = HOT(); if (!hot) return; // need table ready

//         const handsLM = (res && res.multiHandLandmarks) || [];
//         const handsLabel = (res && res.multiHandedness) || []; // to know Left/Right if available

//         // Build an array of {hand:'L'|'R', lm, target, pinching, released}
//         const observed = handsLM.map((lm, i) => {
//             let hand = 'R'; // default
//             try {
//                 const lbl = handsLabel[i] && handsLabel[i].label;
//                 if (lbl && /left/i.test(lbl)) hand = 'L';
//                 if (lbl && /right/i.test(lbl)) hand = 'R';
//             } catch {}
//             const pin  = isPinching(lm);
//             const rel  = isReleased(lm);
//             const tgt  = locateTargetForLandmarks(lm);
//             return { hand, lm, pin, rel, tgt };
//         });

//         // ---------- STRICT same-frame two-hand combine ----------
//         if (STRICT_SIMUL_TWO_HAND) {
//             const L = observed.find(o => o.hand === 'L');
//             const R = observed.find(o => o.hand === 'R');
//             const bothPinching = !!(L && R && L.pin && R.pin);
//             if (bothPinching && !state.simulCombined) {
//                 // Need valid targets from both hands in this frame
//                 if (L.tgt && R.tgt) {
//                     const run = combineTargets(L.tgt, R.tgt);
//                     if (run) {
//                         run();
//                         state.simulCombined = true;
//                         state.lastCombinedAt = performance.now();
//                         return; // done for this frame; avoid single-hand flicker
//                     }
//                 }
//             }
//             if (!bothPinching) {
//                 // Reset latch when either hand releases or stops pinching
//                 state.simulCombined = false;
//             }
//         }

//         const tNow = performance.now();

//         // Update each hand's pinch state machine (one-hand + non-strict fallback)
//         for (const obs of observed){
//             const H = (obs.hand === 'L') ? state.L : state.R;

//             // Update target continuously (for freshest on pinch start)
//             if (obs.tgt) H.target = obs.tgt;

//             if (!H.down) {
//                 // Potential pinch start
//                 if (obs.pin) {
//                     if (H.since === 0) H.since = tNow;
//                     if (tNow - H.since >= HOLD_MS) {
//                         // Confirmed pinch start
//                         H.down = true; H.since = 0; H.lastStart = tNow;

//                         // In strict mode, if both are already pinching this frame we let the early branch handle it.
//                         // Otherwise, act immediately for single-hand selection:
//                         if (!STRICT_SIMUL_TWO_HAND) {
//                             applySelectionForSingleHand(H.target);
//                         } else if (!(state.L.down && state.R.down)) {
//                             // Only one hand pinched → single-hand behavior remains
//                             applySelectionForSingleHand(H.target);
//                         }

//                         // Try to combine if the other hand also just started (fallback for non-strict)
//                         maybeCombineSelections();
//                     }
//                 } else {
//                     // not pinching
//                     H.since = 0;
//                 }
//             } else {
//                 // Currently down; wait for release
//                 if (obs.rel) {
//                     H.down = false; H.since = 0;
//                 }
//             }
//         }
//     }

//     function applySelectionForSingleHand(tgt){
//         if (!tgt) return;
//         if (tgt.kind === 'cell') { selectCell(tgt.row, tgt.col); return; }
//         if (tgt.kind === 'col')  { selectColumns(tgt.colIndex, tgt.colIndex); return; }
//         if (tgt.kind === 'row')  { selectRows(tgt.rowIndex, tgt.rowIndex); return; }
//     }

//     function maybeCombineSelections(){
//         const tNow = performance.now();
//         if (tNow - state.lastCombinedAt < 80) return; // throttle combine calls

//         // If both hands pinched close in time, combine (non-strict fallback)
//         const near = Math.abs(state.L.lastStart - state.R.lastStart) <= COMBINE_WINDOW_MS;
//         if (state.L.lastStart && state.R.lastStart && near) {
//             const run = combineTargets(state.L.target, state.R.target);
//             if (run) { run(); state.lastCombinedAt = tNow; }
//         }
//     }

//     // ---------- Attach to Mediapipe Hands via your mux ----------
//     function attachWhenReady(){
//         function tryAttach(){
//             const hands = (global.GestureActions && global.GestureActions._hands) || global.hands || null;
//             if (!hands) return false;
//             if (GU && typeof GU.multiplexOnResults === 'function') GU.multiplexOnResults(hands);
//             hands.onResults(onResults);
//             console.info('[BimanualPinchSelect] attached (two-hand pinch selection).');
//             return true;
//         }
//         if (!tryAttach()) {
//             const id = setInterval(()=>{ if (tryAttach()) clearInterval(id); }, 250);
//             setTimeout(()=>clearInterval(id), 15000);
//         }
//     }

//     if (document.readyState === 'loading') {
//         document.addEventListener('DOMContentLoaded', attachWhenReady);
//     } else {
//         attachWhenReady();
//     }
// })(window);
