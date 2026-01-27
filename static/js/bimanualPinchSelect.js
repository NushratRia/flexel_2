/* static/js/bimanualPinchSelect.js */
(function (global) {
    'use strict';

    const GU  = global.GestureUtils || {};
    const HOT = () =>
        (global.GestureActions && global.GestureActions._hot) ||
        global.hot ||
        null;

    // Shared state (unchanged)
    global.__handRegions        = global.__handRegions        || { L:null, R:null, tL:0, tR:0 };
    global.__lastTwoHandTargets = global.__lastTwoHandTargets || { L:null, R:null };

    // ---------- helpers ----------
    function rcFromTD(td){
        const hot = HOT();
        if (hot && typeof hot.getCoords === 'function') return hot.getCoords(td);
        return (GU.rcFromTD ? GU.rcFromTD(td) : null);
    }

    function locateTargetForLandmarks(lm){
        const tip = lm[8];
        const td  = GU.tdAt ? GU.tdAt(tip) : null;
        if (!td) return null;

        const rc = rcFromTD(td);
        if (rc && rc.row >= 0 && rc.col >= 0)
        return { kind:'cell', row: rc.row, col: rc.col };

        return null;
    }

    // 🔆 ADDED: meta-class helpers (survive Handsontable re-render)
    function addMetaClass(row, col, cls){
        const hot = HOT(); if (!hot) return;
        const meta = hot.getCellMeta(row, col) || {};
        const cur = (meta.className || '').split(/\s+/).filter(Boolean);
        if (!cur.includes(cls)) cur.push(cls);
        hot.setCellMeta(row, col, 'className', cur.join(' '));
    }

    function removeMetaClass(row, col, cls){
        const hot = HOT(); if (!hot) return;
        const meta = hot.getCellMeta(row, col) || {};
        const cur = (meta.className || '').split(/\s+/).filter(Boolean).filter(c => c !== cls);
        hot.setCellMeta(row, col, 'className', cur.join(' '));
    }

    // 🔆 ADDED: glow that persists even during live preview
    function glowSelectedCell(row, col, duration = 3000){
        const hot = HOT(); if (!hot) return;

        addMetaClass(row, col, 'gesture-selected');
        hot.render();

        setTimeout(() => {
        removeMetaClass(row, col, 'gesture-selected');
        hot.render();
        }, duration);
    }

    // ---------- pinch hysteresis ----------
    const PINCH_IN  = 0.065;
    const PINCH_OUT = 0.085;
    const HOLD_MS   = 80;

    const state = {
        L: { down:false, since:0, target:null, rangeStart:null },
        R: { down:false, since:0, target:null, rangeStart:null }
    };

    function isPinching(lm){
        const a=lm[4], b=lm[8];
        return Math.hypot(a.x-b.x,a.y-b.y) < PINCH_IN;
    }

    function isReleased(lm){
        const a=lm[4], b=lm[8];
        return Math.hypot(a.x-b.x,a.y-b.y) > PINCH_OUT;
    }

    function previewRange(start, end){
        const hot = HOT();
        if (!hot || !start || !end) return;

        const r1 = Math.min(start.row, end.row);
        const r2 = Math.max(start.row, end.row);
        const c1 = Math.min(start.col, end.col);
        const c2 = Math.max(start.col, end.col);

        hot.selectCell(r1, c1, r2, c2, true);
    }

    // ---------- main ----------
    function onResults(res){
        const hot = HOT(); if (!hot) return;

        const handsLM    = res.multiHandLandmarks || [];
        const handedness = res.multiHandedness || [];

        handsLM.forEach((lm, i) => {
        const hand =
            /left/i.test(handedness[i]?.label) ? 'L' : 'R';

        const H = state[hand];
        const tgt = locateTargetForLandmarks(lm);

        if (tgt) H.target = tgt;

        /* -------------------------------
            PINCH START → SET ANCHOR
        -------------------------------- */
        if (!H.down) {
            if (isPinching(lm)) {
            if (!H.since) H.since = performance.now();
            if (performance.now() - H.since >= HOLD_MS) {
                H.down = true;
                H.since = 0;
                H.rangeStart = H.target;   // anchor cell

                // 🔆 ADDED: glow immediately for single-cell selection feedback (anchor)
                if (H.rangeStart && H.rangeStart.kind === 'cell') {
                glowSelectedCell(H.rangeStart.row, H.rangeStart.col, 3000);
                }
            }
            } else {
            H.since = 0;
            }
        }

        /* -------------------------------
            PINCH HELD → LIVE PREVIEW
        -------------------------------- */
        else {
            if (H.rangeStart && H.target) {
            previewRange(H.rangeStart, H.target); // 🔷 LIVE BLUE RECTANGLE
            }

            /* -------------------------------
            PINCH RELEASE → COMMIT RANGE
            -------------------------------- */
            if (isReleased(lm)) {
            H.down = false;

            if (H.rangeStart && H.target) {
                previewRange(H.rangeStart, H.target); // final commit
                global.__lastTwoHandTargets[hand] = {
                start: H.rangeStart,
                end:   H.target
                };

                // 🔆 ADDED: glow end cell too (works for both single-cell & range)
                if (H.target.kind === 'cell') {
                glowSelectedCell(H.target.row, H.target.col, 3000);
                }
            }

            H.rangeStart = null;
            }
        }
        });
    }

    // ---------- attach ----------
    function attachWhenReady(){
        const hands =
        (global.GestureActions && global.GestureActions._hands) ||
        global.hands;

        if (!hands) return setTimeout(attachWhenReady, 200);

        GU.multiplexOnResults?.(hands);
        hands.onResults(onResults);
        console.info('[BimanualPinchSelect] live preview range selection + glow enabled');
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', attachWhenReady);
    else attachWhenReady();

})(window);















// /* static/js/bimanualPinchSelect.js */
// (function (global) {
//     'use strict';

//     const GU  = global.GestureUtils || {};
//     const HOT = () =>
//         (global.GestureActions && global.GestureActions._hot) ||
//         global.hot ||
//         null;

//     // Shared state
//     global.__handRegions          = global.__handRegions          || { L:null, R:null, tL:0, tR:0 };
//     global.__lastTwoHandTargets   = global.__lastTwoHandTargets   || { L:null, R:null };
//     global.__lastDeicticToastInfo = global.__lastDeicticToastInfo || { sig:'', t:0 };
//     global.__pinnedByHand         = global.__pinnedByHand         || { L:null, R:null };

//     // ---------- helpers ----------
//     function rcFromTD(td){
//         const hot = HOT();
//         if (hot && typeof hot.getCoords === 'function') return hot.getCoords(td);
//         return (GU.rcFromTD ? GU.rcFromTD(td) : null);
//     }

//     function locateTargetForLandmarks(lm){
//         const tip = lm[8];
//         const el  = (GU.elementAt && GU.elementAt(tip)) || null;

//         if (el && el.closest && el.closest('.ht_clone_top')) {
//         const hdr = el.closest('th,div') || el;
//         const idx = hdr.cellIndex ?? [...hdr.parentNode.children].indexOf(hdr);
//         if (idx >= 0) return { kind:'col', colIndex: idx };
//         }

//         if (el && el.closest && el.closest('.ht_clone_left')) {
//         const hdr = el.closest('th,div') || el;
//         const num = parseInt(hdr.textContent.trim(), 10);
//         if (!Number.isNaN(num)) return { kind:'row', rowIndex: num - 1 };
//         }

//         const td = GU.tdAt ? GU.tdAt(tip) : null;
//         if (td) {
//         const rc = rcFromTD(td);
//         if (rc && rc.row >= 0 && rc.col >= 0) return { kind:'cell', row: rc.row, col: rc.col };
//         }
//         return null;
//     }

//     // ---------- CELL META HELPERS (CRITICAL) ----------
//     function addMetaClass(row, col, cls){
//         const hot = HOT(); if (!hot) return;
//         const meta = hot.getCellMeta(row, col);
//         const cur  = (meta.className || '').split(/\s+/).filter(Boolean);
//         if (!cur.includes(cls)) cur.push(cls);
//         hot.setCellMeta(row, col, 'className', cur.join(' '));
//     }

//     function removeMetaClass(row, col, cls){
//         const hot = HOT(); if (!hot) return;
//         const meta = hot.getCellMeta(row, col);
//         const cur  = (meta.className || '').split(/\s+/).filter(c => c && c !== cls);
//         hot.setCellMeta(row, col, 'className', cur.join(' '));
//     }

//     // ---------- GLOW (META-BASED, survives render) ----------
//     function glowSelectedCell(row, col, duration = 3000){
//         const hot = HOT(); if (!hot) return;

//         addMetaClass(row, col, 'gesture-selected');
//         hot.render();

//         setTimeout(() => {
//         removeMetaClass(row, col, 'gesture-selected');
//         hot.render();
//         }, duration);
//     }

//     // ---------- PINNED BLUE RECTANGLE (META-BASED) ----------
//     function pinCellForHand(hand, row, col){
//         const hot = HOT(); if (!hot) return;

//         const prev = global.__pinnedByHand[hand];
//         if (prev) removeMetaClass(prev.row, prev.col, 'gesture-pinned');

//         addMetaClass(row, col, 'gesture-pinned');
//         global.__pinnedByHand[hand] = { row, col };

//         hot.render();
//     }

//     // ---------- pinch hysteresis ----------
//     const PINCH_IN  = 0.065;
//     const PINCH_OUT = 0.085;
//     const HOLD_MS   = 80;

//     const state = {
//         L: { down:false, since:0, target:null },
//         R: { down:false, since:0, target:null }
//     };

//     function isPinching(lm){
//         const a=lm[4], b=lm[8];
//         return Math.hypot(a.x-b.x,a.y-b.y) < PINCH_IN;
//     }
//     function isReleased(lm){
//         const a=lm[4], b=lm[8];
//         return Math.hypot(a.x-b.x,a.y-b.y) > PINCH_OUT;
//     }

//     function targetToRect(tgt){
//         if (!tgt) return null;
//         if (tgt.kind === 'cell')
//         return { r1:tgt.row, c1:tgt.col, r2:tgt.row, c2:tgt.col };
//         return null;
//     }

//     function selectRectVisible(rect){
//         const hot=HOT(); if(!hot||!rect) return;
//         hot.selectCell(rect.r1, rect.c1, rect.r2, rect.c2, true);
//     }

//     // ---------- commit ----------
//     function commitHandSnapshot(hand, tgt){
//         const rect = targetToRect(tgt);
//         if (!rect) return;

//         if (hand === 'L') global.__lastTwoHandTargets.L = tgt;
//         else              global.__lastTwoHandTargets.R = tgt;

//         // Native HOT selection = active hand
//         selectRectVisible(rect);

//         // Pin BOTH hands independently
//         if (tgt.kind === 'cell') {
//         pinCellForHand(hand, tgt.row, tgt.col);
//         glowSelectedCell(tgt.row, tgt.col);
//         }

//         const other = hand === 'L'
//         ? global.__lastTwoHandTargets.R
//         : global.__lastTwoHandTargets.L;

//         if (other && other.kind === 'cell') {
//         pinCellForHand(hand === 'L' ? 'R' : 'L', other.row, other.col);
//         glowSelectedCell(other.row, other.col);
//         }
//     }

//     // ---------- main ----------
//     function onResults(res){
//         const hot = HOT(); if (!hot) return;

//         const handsLM = res.multiHandLandmarks || [];
//         const handed  = res.multiHandedness || [];

//         handsLM.forEach((lm,i)=>{
//         const hand = /left/i.test(handed[i]?.label) ? 'L' : 'R';
//         const H = state[hand];
//         const tgt = locateTargetForLandmarks(lm);

//         if (tgt) H.target = tgt;

//         if (!H.down) {
//             if (isPinching(lm)) {
//             if (!H.since) H.since = performance.now();
//             if (performance.now() - H.since >= HOLD_MS) {
//                 H.down = true; H.since = 0;
//                 commitHandSnapshot(hand, H.target);
//             }
//             } else H.since = 0;
//         } else if (isReleased(lm)) {
//             H.down = false;
//         }
//         });
//     }

//     // ---------- attach ----------
//     function attachWhenReady(){
//         const hands =
//         (global.GestureActions && global.GestureActions._hands) ||
//         global.hands;
//         if (!hands) return setTimeout(attachWhenReady, 200);

//         GU.multiplexOnResults?.(hands);
//         hands.onResults(onResults);
//         console.info('[BimanualPinchSelect] attached');
//     }

//     if (document.readyState === 'loading')
//         document.addEventListener('DOMContentLoaded', attachWhenReady);
//     else attachWhenReady();

// })(window);


















// // /* static/js/bimanualPinchSelect.js

// //  */
// // (function (global) {
// //     'use strict';

// //     const GU  = global.GestureUtils || {};
// //     const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

// //     // Expose shared buckets used by voice + HUD
// //     global.__handRegions          = global.__handRegions          || { L:null, R:null, tL:0, tR:0 };
// //     global.__lastTwoHandTargets   = global.__lastTwoHandTargets   || { L:null, R:null };
// //     global.__lastDeicticToastInfo = global.__lastDeicticToastInfo || { sig:'', t:0 };

// //     // ---------- helpers ----------
// //     function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
// //     function rcFromTD(td){
// //         const hot = HOT();
// //         if (hot && typeof hot.getCoords === 'function') return hot.getCoords(td);
// //         return (GU.rcFromTD ? GU.rcFromTD(td) : null);
// //     }

// //     function locateTargetForLandmarks(lm){
// //         const tip = lm[8];
// //         const el  = (GU.elementAt && GU.elementAt(tip)) || null;

// //         // Column header?
// //         if (el && el.closest && el.closest('.ht_clone_top')) {
// //         const hdr = el.closest('th,div') || el;
// //         const idx = (hdr.cellIndex != null)
// //             ? hdr.cellIndex
// //             : (hdr.parentNode ? Array.from(hdr.parentNode.children).indexOf(hdr) : -1);
// //         if (idx >= 0) return { kind:'col', colIndex: idx };
// //         }
// //         // Row header?
// //         if (el && el.closest && el.closest('.ht_clone_left')) {
// //         const hdr = el.closest('th,div') || el;
// //         const num = parseInt((hdr.textContent || hdr.innerText || '').trim(), 10);
// //         if (!Number.isNaN(num)) return { kind:'row', rowIndex: num - 1 };
// //         }
// //         // Body cell
// //         const td = GU.tdAt ? GU.tdAt(tip) : null;
// //         if (td) {
// //         const rc = rcFromTD(td);
// //         if (rc && rc.row >= 0 && rc.col >= 0) return { kind:'cell', row: rc.row, col: rc.col };
// //         }
// //         return null;
// //     }

// //     // 🔆 ADDED: temporary glow helper (3 seconds)
// //     function glowSelectedCell(row, col, duration = 3000){
// //         const hot = HOT();
// //         if (!hot) return;
// //         const td = hot.getCell(row, col);
// //         if (!td) return;

// //         td.classList.add('gesture-selected');

// //         setTimeout(() => {
// //             td.classList.remove('gesture-selected');
// //         }, duration);
// //     }

// //     function pinSelectionCell(row, col) {
// //         const hot = HOT();
// //         if (!hot) return;
// //         const td = hot.getCell(row, col);
// //         if (!td) return;

// //         td.classList.add('gesture-pinned');
// //     }


// //     // pinch hysteresis
// //     const PINCH_IN  = 0.065;
// //     const PINCH_OUT = 0.085;
// //     const HOLD_MS   = 80;

// //     const state = {
// //         L: { down:false, since:0, target:null },
// //         R: { down:false, since:0, target:null }
// //     };

// //     function isPinching(lm){ const a=lm[4], b=lm[8]; return Math.hypot(a.x-b.x,a.y-b.y) < PINCH_IN; }
// //     function isReleased(lm){ const a=lm[4], b=lm[8]; return Math.hypot(a.x-b.x,a.y-b.y) > PINCH_OUT; }

// //     function hotCounts(){
// //         const hot = HOT(); if (!hot) return {rows:0, cols:0};
// //         return {
// //         rows: Math.max(0, (hot.countRows ? hot.countRows() : 0) - 1) + 1,
// //         cols: Math.max(0, (hot.countCols ? hot.countCols() : 0) - 1) + 1
// //         };
// //     }

// //     function targetToRect(tgt){
// //         const hot = HOT(); if (!hot || !tgt) return null;
// //         const { rows, cols } = hotCounts();
// //         if (tgt.kind === 'cell') return { r1:tgt.row, c1:tgt.col, r2:tgt.row, c2:tgt.col };
// //         if (tgt.kind === 'row')  return { r1:tgt.rowIndex, c1:0, r2:tgt.rowIndex, c2:Math.max(0, cols-1) };
// //         if (tgt.kind === 'col')  return { r1:0, c1:tgt.colIndex, r2:Math.max(0, rows-1), c2:tgt.colIndex };
// //         return null;
// //     }

// //     function selectRectVisible(rect){
// //         const hot=HOT(); if(!hot || !rect) return;
// //         hot.selectCell(rect.r1, rect.c1, rect.r2, rect.c2, true);
// //     }

// //     // ---------- HUD helpers ----------
// //     function encodeTargetSig(t){
// //         if (!t) return '';
// //         if (t.kind === 'cell') return `cell:${t.row},${t.col}`;
// //         if (t.kind === 'row')  return `row:${t.rowIndex}`;
// //         if (t.kind === 'col')  return `col:${t.colIndex}`;
// //         return '';
// //     }
// //     function showSelectionToastIfAny(){
// //         // Show "Selected A2 & B4" toast if available & not spammy
// //         const T = global.__lastTwoHandTargets || {};
// //         const L = T.L || null, R = T.R || null;
// //         if (!L && !R) return;

// //         const sig = `${encodeTargetSig(L)}|${encodeTargetSig(R)}`;
// //         const now = performance.now();
// //         const last = global.__lastDeicticToastInfo || { sig:'', t:0 };

// //         // Throttle duplicates within 450ms
// //         if (sig && last.sig === sig && (now - last.t) < 450) return;

// //         if (global.DeicticToast && typeof global.DeicticToast.show === 'function') {
// //         const arr = [L, R].filter(Boolean);
// //         if (arr.length) global.DeicticToast.show('selected', arr);
// //         global.__lastDeicticToastInfo = { sig, t: now };
// //         }
// //     }

// //     function commitHandSnapshot(hand, tgt){
// //         // Normalize & persist both a rect (for HOT ops) and the raw target (for HUD/voice)
// //         const rect = targetToRect(tgt);
// //         if (!rect) return;
// //         const now = performance.now();

// //         if (hand === 'L') {
// //         global.__handRegions.L = rect;  global.__handRegions.tL = now;
// //         global.__lastTwoHandTargets.L = tgt || null;
// //         } else {
// //         global.__handRegions.R = rect;  global.__handRegions.tR = now;
// //         global.__lastTwoHandTargets.R = tgt || null;
// //         }

// //         // // Last hand wins the visible HOT selection (still single)
// //         // selectRectVisible(rect);


// //         // Native HOT selection for the active hand
// //         selectRectVisible(rect);

// //         // Pin the OTHER hand’s cell so its rectangle stays
// //         if (hand === 'L' && global.__lastTwoHandTargets.R?.kind === 'cell') {
// //             pinSelectionCell(
// //                 global.__lastTwoHandTargets.R.row,
// //                 global.__lastTwoHandTargets.R.col
// //             );
// //         }

// //         if (hand === 'R' && global.__lastTwoHandTargets.L?.kind === 'cell') {
// //             pinSelectionCell(
// //                 global.__lastTwoHandTargets.L.row,
// //                 global.__lastTwoHandTargets.L.col
// //             );
// //         }






// //         // 🔆 ADDED: glow only for single-cell selections
// //         if (tgt && tgt.kind === 'cell') {
// //             glowSelectedCell(tgt.row, tgt.col);
// //         }

// //         // Show HUD describing BOTH current selections (e.g., "Selected A2 & B4")
// //         showSelectionToastIfAny();
// //     }

// //     // ---------- main callback ----------
// //     function onResults(res){
// //         const hot = HOT(); if (!hot) return;

// //         const handsLM    = (res && res.multiHandLandmarks) || [];
// //         const handedness = (res && res.multiHandedness) || [];

// //         const observed = handsLM.map((lm,i)=>{
// //         let hand='R';
// //         try {
// //             const lbl = handedness[i] && handedness[i].label;
// //             if (lbl && /left/i.test(lbl))  hand='L';
// //             if (lbl && /right/i.test(lbl)) hand='R';
// //         } catch {}
// //         return { hand, lm, pin:isPinching(lm), rel:isReleased(lm), tgt:locateTargetForLandmarks(lm) };
// //         });

// //         const tNow = performance.now();

// //         for (const obs of observed) {
// //         const H = (obs.hand==='L') ? state.L : state.R;

// //         if (obs.tgt) H.target = obs.tgt;

// //         if (!H.down) {
// //             if (obs.pin) {
// //             if (H.since === 0) H.since = tNow;
// //             if (tNow - H.since >= HOLD_MS) {
// //                 H.down = true; H.since = 0;
// //                 commitHandSnapshot(obs.hand, H.target); // independent lock-in + HUD
// //             }
// //             } else {
// //             H.since = 0;
// //             }
// //         } else {
// //             if (obs.rel) { H.down = false; H.since = 0; }
// //         }
// //         }
// //     }

// //     // ---------- attach ----------
// //     function attachWhenReady(){
// //         function tryAttach(){
// //         const hands = (global.GestureActions && global.GestureActions._hands) || global.hands || null;
// //         if (!hands) return false;
// //         if (GU && typeof GU.multiplexOnResults === 'function') GU.multiplexOnResults(hands);
// //         hands.onResults(onResults);
// //         console.info('[BimanualPinchSelect] attached (independent two-hand selection + HUD).');
// //         return true;
// //         }
// //         if (!tryAttach()) {
// //         const id = setInterval(()=>{ if (tryAttach()) clearInterval(id); }, 250);
// //         setTimeout(()=>clearInterval(id), 15000);
// //         }
// //     }

// //     if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachWhenReady);
// //     else attachWhenReady();

// // })(window);