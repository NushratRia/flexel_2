/* static/js/gestureMergePinchCollision.js
 */
(function (global) {
    const GA = () => global.GestureActions;
    const GU = () => global.GestureUtils;

    // ---------- Tunables (scaled to screen) ----------
    const BASE_COLLIDE_PX   = 70;   // index–index distance below this ⇒ collided
    const BASE_APPROACH_PX  = 16;   // must be moving toward each other by ≥ this since last frame
    const HOLD_MS           = 120;  // each hand should hold its target at least this long
    const LOCAL_COOLDOWN_MS = 500;  // per-merge local refractory (arbiter still adds 500ms global)

    // ---------- Internals ----------
    let installed = false;
    let nextMergeAt = 0;

    // Per-hand tracking (keys 'h0', 'h1')
    const state = {
        h0: { tip: null, lastTip: null, pinching: false, target: null, targetSince: 0 },
        h1: { tip: null, lastTip: null, pinching: false, target: null, targetSince: 0 },
        lastPairDist: null
    };

    // ---------- Helpers ----------
    function key(i) { return i === 0 ? 'h0' : 'h1'; }
    function now() { return performance.now(); }
    function screenScale(px) {
        const dS = Math.hypot(global.innerWidth, global.innerHeight);
        const dB = Math.hypot(640, 480);
        return px * (dS / dB);
    }
    function toPx(lm) { return { x: lm.x * global.innerWidth, y: lm.y * global.innerHeight }; }
    function dist(a, b) { return Math.hypot((a.x - b.x), (a.y - b.y)); }

    function colLettersFromIndex(i){
        let n=i, s=''; do { s = String.fromCharCode(65+(n%26)) + s; n = Math.floor(n/26) - 1; } while (n>=0);
        return s;
    }
    function a1FromRect(r1, c1, r2, c2){
        const A = `${colLettersFromIndex(c1)}${r1+1}`;
        const B = `${colLettersFromIndex(c2)}${r2+1}`;
        return `${A}:${B}`;
    }

    // Identify user-intended target under fingertip:
    // { type:'row', row } OR { type:'col', col } OR { type:'cell', row, col }
    function computeTarget(hot, indexTip) {
        const g = GU();
        const el = typeof g.elementAt === 'function' ? g.elementAt(indexTip) : null;
        if (!el || !el.closest) {
        // fallback: tdAt → rcFromTD
        const td = typeof g.tdAt === 'function' ? g.tdAt(indexTip) : null;
        if (td) {
            const rc = hot && typeof hot.getCoords === 'function' ? hot.getCoords(td) :
                    (typeof g.rcFromTD === 'function' ? g.rcFromTD(td) : null);
            if (rc) return { type: 'cell', row: rc.row, col: rc.col };
        }
        return null;
        }

        // Column header (top clone)
        if (el.closest('.ht_clone_top')) {
        const th = el.closest('th');
        if (th && th.parentNode) {
            const c = (th.cellIndex != null ? th.cellIndex : Array.from(th.parentNode.children).indexOf(th));
            if (c >= 0) return { type: 'col', col: c };
        }
        }

        // Row header (left clone)
        if (el.closest('.ht_clone_left')) {
        const th = el.closest('th');
        if (th) {
            const label = parseInt((th.innerText || '').trim(), 10);
            if (!Number.isNaN(label) && label > 0) return { type: 'row', row: label - 1 };
        }
        }

        // Cell (master)
        const td = (typeof GU().tdAt === 'function') ? GU().tdAt(indexTip) : null;
        if (td) {
        const rc = (hot && typeof hot.getCoords === 'function') ? hot.getCoords(td) : (GU().rcFromTD ? GU().rcFromTD(td) : null);
        if (rc) return { type: 'cell', row: rc.row, col: rc.col };
        }
        return null;
    }

    // Expand a target to an inclusive rectangle [r1..r2, c1..c2]
    function rectFromTarget(hot, tgt) {
        const lastR = hot.countRows() - 1;
        const lastC = hot.countCols() - 1;
        if (!tgt) return null;

        if (tgt.type === 'row') return { r1: tgt.row, r2: tgt.row, c1: 0, c2: lastC };
        if (tgt.type === 'col') return { r1: 0, r2: lastR, c1: tgt.col, c2: tgt.col };
        if (tgt.type === 'cell') return { r1: tgt.row, r2: tgt.row, c1: tgt.col, c2: tgt.col };
        return null;
    }

    // Combine two rectangles into their bounding box
    function unionRects(a, b) {
        if (!a || !b) return null;
        return {
        r1: Math.min(a.r1, b.r1),
        r2: Math.max(a.r2, b.r2),
        c1: Math.min(a.c1, b.c1),
        c2: Math.max(a.c2, b.c2),
        };
    }

    function install() {
        if (installed) return true;
        if (!GA() || !GU()) return false;

        const ga = GA();
        if (!ga._hands) return false;

        if (typeof GU().multiplexOnResults === 'function') GU().multiplexOnResults(ga._hands);

        ga._hands.onResults((results) => {
        const hot = ga._hot;
        if (!hot || !results.multiHandLandmarks || results.multiHandLandmarks.length < 2) {
            // reset pair distance so approach test works when hands re-appear
            state.lastPairDist = null;
            return;
        }

        const HANDS = results.multiHandLandmarks.slice(0, 2); // consider first two detected
        const tNow = now();
        const COLLIDE = screenScale(BASE_COLLIDE_PX);
        const APPROACH = screenScale(BASE_APPROACH_PX);

        // Update both hands' per-frame state
        HANDS.forEach((lm, idx) => {
            const k = key(idx);
            const S = state[k];

            S.lastTip  = S.tip;
            S.tip      = toPx(lm[8]);
            S.pinching = !!GU().isPinching(lm);

            if (S.pinching) {
            // Track target continuously while pinching
            const tgt = computeTarget(hot, S.tip);
            if (tgt) {
                if (!S.target || (S.target.type !== tgt.type) ||
                    (tgt.row != null && tgt.row !== S.target.row) ||
                    (tgt.col != null && tgt.col !== S.target.col)) {
                S.target = tgt;
                S.targetSince = tNow;
                } // else: same target, keep holding
            }
            } else {
            S.target = null;
            S.targetSince = 0;
            }
        });

        // Need both pinching with valid targets, and both held long enough
        const H0 = state.h0, H1 = state.h1;
        if (!H0.pinching || !H1.pinching || !H0.target || !H1.target) {
            state.lastPairDist = null;
            return;
        }
        if ((tNow - H0.targetSince) < HOLD_MS || (tNow - H1.targetSince) < HOLD_MS) {
            // still stabilizing
            state.lastPairDist = null;
            return;
        }

        const d = dist(H0.tip, H1.tip);
        const dPrev = state.lastPairDist;
        state.lastPairDist = d;

        // Must be below collision threshold AND approaching
        if (d > COLLIDE) return;
        if (dPrev != null && (dPrev - d) < APPROACH) return;

        // Local cooldown gate
        if (tNow < nextMergeAt) return;

        // Build union rectangle of both targets
        const R0 = rectFromTarget(hot, H0.target);
        const R1 = rectFromTarget(hot, H1.target);
        const U  = unionRects(R0, R1);
        if (!U) return;

        const range = a1FromRect(U.r1, U.c1, U.r2, U.c2);

        // Rank & commit (arbiter handles global 0.5s + ambiguity margin)
        GU().rank(ga._score, 'merge', 0.97, {
            action: 'merge',
            range,
            from: 'two-hand-collision',
            tips: [H0.tip, H1.tip]
        });
        if (typeof ga._commitTopGesture === 'function') ga._commitTopGesture();

        nextMergeAt = tNow + LOCAL_COOLDOWN_MS;
        });

        console.info('[gestureMergePinchCollision] installed (two-hand pinch + collide → merge)');
        installed = true;
        return true;
    }

    let tries = 0;
    const iv = setInterval(() => { if (install() || ++tries > 40) clearInterval(iv); }, 50);
})(window);
