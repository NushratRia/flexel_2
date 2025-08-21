/* static/js/gestureDeleteDwell.js
 * Delete with target "dwell-lock":
 *  - While PINCHING, we observe the candidate (cell/row/col) under your fingertip.
 *  - If the SAME candidate stays under the finger for DWELL_MS, we LOCK it for this pinch.
 *  - A strong DOWNWARD flick (LM9 Δy > 40) below midline+50 deletes the LOCKED target.
 *  - The lock stays until you release the pinch (no drifting to "random" cells).
 *  - Ranks into GestureActions to reuse your toast/visuals. Legacy delete is disabled.
 */
(function (global) {
    const GA = () => global.GestureActions;
    const GU = () => global.GestureUtils;

    // Tunables
    const DWELL_MS            = 450;  // how long you must hold over the same target to lock
    const FLICK_DELTA_Y_PX    = 40;   // downward flick threshold (pixels)
    const MIDLINE_OFFSET_PX   = 50;   // only delete when below midline+50
    const DELETE_COOLDOWN_MS  = 500;  // pace deletes per hand

    // State
    const lastY = {};                     // { h0: ypx, h1: ypx }
    const cooldownUntil = {};             // { h0: t,   h1: t }
    const pinchNow = {};                  // { h0: bool, h1: bool }

    const candId = {};                    // { h0: "cell:3,5" | "row:7" | "col:2" }
    const candSince = {};                 // { h0: timestamp when candidate started }
    const lockedId = {};                  // { h0: same id string once locked }
    const lockedTarget = {};              // { h0: {type,row?,col?} }

    function key(i){ return `h${i}`; }
    function canFire(k, t){ return t >= (cooldownUntil[k] || 0); }
    function arm(k, t){ cooldownUntil[k] = t + DELETE_COOLDOWN_MS; }

    function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
    function a1Cell(r,c){ const L=colLetters(c); const a=`${L}${r+1}`; return `${a}:${a}`; }
    function rowRange(hot, r){ const lastC=hot.countCols()-1; return `${colLetters(0)}${r+1}:${colLetters(lastC)}${r+1}`; }
    function colRange(hot, c){ const lastR=hot.countRows()-1; const L=colLetters(c); return `${L}1:${L}${lastR+1}`; }
    function lm9Ypx(lm9){ return lm9.y * global.innerHeight; }

    function idForTarget(t){
        if (!t) return null;
        if (t.type === 'cell') return `cell:${t.row},${t.col}`;
        if (t.type === 'row')  return `row:${t.row}`;
        if (t.type === 'col')  return `col:${t.col}`;
        return null;
    }

    function computeTarget(hot, indexTip) {
        const el = GU().elementAt(indexTip);
        if (!el || !el.closest) return null;

        if (el.closest('.ht_clone_top')) {
        const th = el.closest('th');
        if (th && th.parentNode) {
            const c = (th.cellIndex != null ? th.cellIndex : Array.from(th.parentNode.children).indexOf(th));
            if (c >= 0) return { type:'col', col:c };
        }
        }
        if (el.closest('.ht_clone_left')) {
        const th = el.closest('th');
        if (th) {
            const label = parseInt((th.innerText||'').trim(), 10);
            if (!Number.isNaN(label) && label > 0) return { type:'row', row: label-1 };
        }
        }
        const td = GU().tdAt(indexTip);
        if (td) {
        const rc = (hot && typeof hot.getCoords === 'function') ? hot.getCoords(td) : GU().rcFromTD(td);
        if (rc) return { type:'cell', row: rc.row, col: rc.col };
        }
        return null;
    }

    function install() {
        if (!GA() || !GU()) return false;
        const ga = GA();
        if (!ga._hands) return false;

        // Turn off legacy delete inside GA without editing its file
        ga._disableLegacyDelete = true;

        // Subscribe without replacing others
        if (typeof GU().multiplexOnResults === 'function') GU().multiplexOnResults(ga._hands);

        ga._hands.onResults((results) => {
        if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) return;

        const t = performance.now();
        const yMid = global.innerHeight / 2;

        results.multiHandLandmarks.forEach((lm, idx) => {
            const k = key(idx);
            const isPinch = GU().isPinching(lm);
            const indexTip = lm[8];
            const m9 = lm[9];

            const wasPinch = !!pinchNow[k];
            pinchNow[k] = !!isPinch;

            // Reset all target state on pinch END
            if (wasPinch && !pinchNow[k]) {
            candId[k] = candSince[k] = lockedId[k] = undefined;
            lockedTarget[k] = undefined;
            }

            // While pinching, evaluate candidate
            if (pinchNow[k] && ga._hot) {
            const tgt = computeTarget(ga._hot, indexTip);
            const id = idForTarget(tgt);

            if (!lockedId[k]) {
                // Not locked yet → dwell logic
                if (id && id === candId[k]) {
                // same candidate → check dwell time
                if ((t - (candSince[k] || t)) >= DWELL_MS) {
                    lockedId[k] = id;
                    lockedTarget[k] = tgt; // lock it
                }
                } else {
                // new candidate or null → reset dwell
                candId[k] = id || null;
                candSince[k] = id ? t : undefined;
                }
            } else {
                // Already locked → ignore changes (prevents "random" selection)
            }
            }

            // Flick detection (requires a LOCKED target)
            const y = lm9Ypx(m9);
            const y0 = lastY[k];
            lastY[k] = y;
            if (y0 == null) return;

            if (!pinchNow[k]) return;                            // must be pinching
            if (!lockedId[k] || !lockedTarget[k]) return;        // must have a locked target
            if (y <= (yMid + MIDLINE_OFFSET_PX)) return;         // only below midline+50
            const dy = y - y0;                                   // down is positive
            if (dy <= FLICK_DELTA_Y_PX) return;                  // strong flick
            if (!canFire(k, t)) return;                          // per-hand cooldown
            if (!ga._hot) return;

            // Build range for the LOCKED target
            let range = null;
            const tgt = lockedTarget[k];
            if (tgt.type === 'cell')      range = a1Cell(tgt.row, tgt.col);
            else if (tgt.type === 'row')  range = rowRange(ga._hot, tgt.row);
            else if (tgt.type === 'col')  range = colRange(ga._hot, tgt.col);
            if (!range) return;

            // Close editor if needed (consistent with other mutating actions)
            if (typeof ga._isEditorOpen === 'function' && ga._isEditorOpen()) {
            if (typeof ga._closeEditorIfOpen === 'function') ga._closeEditorIfOpen();
            }

            // Rank + commit (reuses toast + optional green ring)
            GU().rank(ga._score, 'delete', 0.99, {
            action: 'delete',
            range,
            ptScreen: GU().toScreenXY(indexTip)
            });
            if (typeof ga._commitTopGesture === 'function') ga._commitTopGesture();

            // Cooldown + keep lock (so you can't delete multiple things in one pinch unless you re-dwell)
            arm(k, t);
            ga._pasteArmed = false;
        });
        });

        console.info('[gestureDeleteDwell] installed (dwell-lock delete)');
        return true;
    }

    let tries = 0;
    const iv = setInterval(() => { if (install() || ++tries > 40) clearInterval(iv); }, 50);
    })(window);
