/* static/js/gestureCopyPasteBimanual.js

 */
(function (global) {
    const GA = () => global.GestureActions;
    const GU = () => global.GestureUtils;

    const LOCAL_COOLDOWN_MS = 500;   // per-action local cooldown (arbiter also enforces 500ms global)
    const RANK_STRONG       = 0.96;  // confident but leaves room for arbiter margin checks
    const IDX_MIN_SEP_PX    = 50;    // gate: index must be away from thumb to avoid pinch-vs-zoom/select overlap

    let installed = false;
    let nextCopyAt  = 0;
    let nextPasteAt = 0;

    function now() { return performance.now(); }
    function toPx(lm){ return { x: lm.x * global.innerWidth, y: lm.y * global.innerHeight }; }
    function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

    // ---- A1 helpers (match style used in your other gesture files) ----
    function colLettersFromIndex(i){
        let n=i, s=''; do { s = String.fromCharCode(65+(n%26)) + s; n = Math.floor(n/26) - 1; } while (n>=0);
        return s;
    }
    function a1Cell(r,c){ const L = colLettersFromIndex(c); const a = `${L}${r+1}`; return `${a}:${a}`; }

    // Resolve the grid cell under the given fingertip (returns {row,col} or null)
    function rcUnderTip(hot, indexTip) {
        const GUx = GU();
        // Prefer existing helpers from your stack
        const td = (typeof GUx.tdAt === 'function') ? GUx.tdAt(indexTip)
                : (typeof GUx.elementAt === 'function') ? GUx.elementAt(indexTip)
                : null;

        if (!td) return null;

        // If elementAt hits inside a TD, keep that; otherwise try closest TD up the tree:
        const tdEl = td.tagName === 'TD' ? td : td.closest ? td.closest('td') : null;
        if (!tdEl) return null;

        if (hot && typeof hot.getCoords === 'function') {
        const rc = hot.getCoords(tdEl);
        if (rc && Number.isInteger(rc.row) && Number.isInteger(rc.col)) return rc;
        }
        // Fallback via GU helper (if provided)
        if (typeof GUx.rcFromTD === 'function') return GUx.rcFromTD(tdEl);
        return null;
    }

    // Simple, scale-robust FIST check (no dependency on GU):
    // Treat as fist when the 4 finger segments are curled (tips close to their MCPs) and
    // thumb-index distance is relatively small.
    function isFist(lm) {
        // Landmarks we need
        const wrist = toPx(lm[0]);
        const mcpIdx = [5, 9, 13, 17];   // MCPs: index, middle, ring, pinky
        const tipIdx = [8, 12, 16, 20];  // tips

        // Use palm size as a dynamic scale (wrist to middle MCP)
        const palm = dist(wrist, toPx(lm[9])) || 1;

        // Fingers curled if TIP-to-MCP is short across all 4 fingers
        let curledCount = 0;
        for (let k = 0; k < 4; k++) {
        const d = dist(toPx(lm[tipIdx[k]]), toPx(lm[mcpIdx[k]]));
        if (d < 0.6 * palm) curledCount++;
        }

        // Thumb-index relatively close (helps separate from "open" shapes)
        const dTI = dist(toPx(lm[4]), toPx(lm[8]));
        const thumbNearIndex = dTI < 0.9 * palm;

        return curledCount >= 3 && thumbNearIndex;
    }

    // Gate against accidental overlap with select/zoom:
    function indexThumbSeparated(lm){
        const dB = Math.hypot(640, 480);
        const dS = Math.hypot(global.innerWidth, global.innerHeight);
        const scale = dS / dB;
        const minSep = IDX_MIN_SEP_PX * scale;
        return dist(toPx(lm[8]), toPx(lm[4])) >= minSep;
    }

    function install(){
        if (installed) return true;
        if (!GA() || !GU()) return false;

        const ga = GA();
        if (!ga._hands) return false;

        // Co-subscribe without disturbing other onResults
        if (typeof GU().multiplexOnResults === 'function') GU().multiplexOnResults(ga._hands);

        ga._hands.onResults((results) => {
        const hot = ga._hot;
        if (!hot || !results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

        // Build a light hand state list for this frame
        const hands = results.multiHandLandmarks.map(lm => {
            return {
            lm,
            pinching: !!GU().isPinching(lm),
            openPalm: !!GU().isOpenPalm(lm),
            fist:     isFist(lm),
            indexTip: toPx(lm[8]),
            thumbTip: toPx(lm[4]),
            };
        });

        // Try to find a COPY pattern: one hand pinching on a cell, the other hand fist
        // (and index-thumb separated to avoid confusion with "select/zoom")
        const tNow = now();

        // We will allow at most one action per frame (copy OR paste)
        let fired = false;

        // ---- COPY detection ----
        if (tNow >= nextCopyAt && (ga._copyArmed !== false)) { // if undefined, we permit; if false, we block
            for (let a = 0; a < hands.length && !fired; a++) {
            const Hpinch = hands[a];
            if (!Hpinch.pinching || !indexThumbSeparated(Hpinch.lm)) continue;

            const rc = rcUnderTip(hot, Hpinch.indexTip);
            if (!rc) continue; // must be over an actual cell

            for (let b = 0; b < hands.length && !fired; b++) {
                if (b === a) continue;
                const Hother = hands[b];
                if (!Hother.fist || Hother.pinching) continue; // fist only, not pinching

                const range = a1Cell(rc.row, rc.col);
                GU().rank(ga._score, 'copy', RANK_STRONG, {
                action: 'copy',
                range,
                ptScreen: GU().toScreenXY ? GU().toScreenXY(Hpinch.indexTip) : Hpinch.indexTip,
                from: 'bimanual'
                });
                if (typeof ga._commitTopGesture === 'function') ga._commitTopGesture();

                // After a successful attempt, arm paste intent (mirrors your existing flow)
                ga._pasteArmed = true;
                nextCopyAt = tNow + LOCAL_COOLDOWN_MS;
                fired = true;
            }
            }
        }

        // ---- PASTE detection ----
        if (!fired && tNow >= nextPasteAt && (ga._pasteArmed !== false)) {
            for (let a = 0; a < hands.length && !fired; a++) {
            const Hpinch = hands[a];
            if (!Hpinch.pinching || !indexThumbSeparated(Hpinch.lm)) continue;

            const rc = rcUnderTip(hot, Hpinch.indexTip);
            if (!rc) continue;

            for (let b = 0; b < hands.length && !fired; b++) {
                if (b === a) continue;
                const Hother = hands[b];
                if (!Hother.openPalm || Hother.pinching) continue; // open palm only, not pinching

                const range = a1Cell(rc.row, rc.col);
                GU().rank(ga._score, 'paste', RANK_STRONG, {
                action: 'paste',
                range,
                ptScreen: GU().toScreenXY ? GU().toScreenXY(Hpinch.indexTip) : Hpinch.indexTip,
                from: 'bimanual'
                });
                if (typeof ga._commitTopGesture === 'function') ga._commitTopGesture();

                // Clear paste-armed after pasting (lets your normal flow re-arm via select/copy)
                ga._pasteArmed = false;
                nextPasteAt = tNow + LOCAL_COOLDOWN_MS;
                fired = true;
            }
            }
        }
        });

        console.info('[gestureCopyPasteBimanual] installed (PINCH+FIST = Copy, PINCH+PALM = Paste)');
        installed = true;
        return true;
    }

    let tries = 0;
    const iv = setInterval(() => { if (install() || ++tries > 40) clearInterval(iv); }, 50);
})(window);
