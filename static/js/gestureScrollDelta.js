/* static/js/gestureScrollDelta.js
 * Scroll via LM9 deltas in SCREEN pixels (Python-equivalent):
 *   dx = last.x - x, dy = last.y - y
 *   if |dy| > 30 and |dy| > |dx|*(1+HYST) → step row (dy>0 up, dy<0 down)
 *   if |dx| > 40 and |dx| >= |dy|*(1+HYST) → step col (dx>0 left, dx<0 right)
 *
 * Anti-confusion:
 * - GLOBAL cooldown between any two scrolls (STEP_COOLDOWN_MS)
 * - AXIS LOCK window (AXIS_LOCK_MS) to avoid instant axis flipping
 * - HYSTERESIS so one axis must clearly dominate
 * - OPEN PALM ONLY (and NOT pinching) so it won’t overlap with delete
 * - Calls GA._commitTopGesture() so you get the toast immediately
 */
(function (global) {
    const GA = () => global.GestureActions;
    const GU = () => global.GestureUtils;

    // Thresholds (match your Python feel)
    const Y_THRESH_PX = 30;
    const X_THRESH_PX = 40;

    // Anti-rapid-fire / clarity
    const STEP_COOLDOWN_MS = 500; // ← time between ANY two scroll steps
    const AXIS_LOCK_MS     = 500; // ← after a vertical step, temporarily block horizontal (and vice versa)
    const HYSTERESIS       = 0.15; // ← require 15% dominance of the winning axis

    // Old per-hand pacing (kept, but global cooldown is primary)
    const PER_HAND_COOLDOWN_MS = 500;

    // State
    const last = {};                 // { h0:{x,y}, h1:{x,y} }
    const handCooldownUntil = {};    // { h0:t,   h1:t }
    let globalCooldownUntil = 0;     // single refractory timer for all hands
    let axisLock = { axis: null, until: 0 }; // { 'v'|'h'|null, until }

    function key(i){ return `h${i}`; }

    function nowOKGlobal(t){ return t >= globalCooldownUntil; }
    function armGlobal(t){ globalCooldownUntil = t + STEP_COOLDOWN_MS; }

    function nowOKHand(k,t){ return t >= (handCooldownUntil[k] || 0); }
    function armHand(k,t){ handCooldownUntil[k] = t + PER_HAND_COOLDOWN_MS; }

    function axisLockedFor(ax, t){
    // If we locked vertical ('v'), block horizontal ('h') until expiry, and vice versa.
    return axisLock.axis && axisLock.axis !== ax && t < axisLock.until;
    }
    function lockAxis(ax, t){ axisLock = { axis: ax, until: t + AXIS_LOCK_MS }; }

    // Mirror to match your UI (same as gestureHighlight_debug)
    function lmToScreenPX(lm) {
    const x = global.innerWidth  - (lm.x * global.innerWidth);
    const y = lm.y * global.innerHeight;
    return { x, y };
    }

    function scrollBy(hot, dRows, dCols) {
    if (!hot) return;
    const sel = hot.getSelectedLast() || [0,0,0,0];
    const r0 = sel[0] || 0, c0 = sel[1] || 0;
    const r = Math.max(0, Math.min(hot.countRows() - 1, r0 + dRows));
    const c = Math.max(0, Math.min(hot.countCols() - 1, c0 + dCols));
    try {
        if (typeof hot.scrollViewportTo === 'function') hot.scrollViewportTo(r, c);
        hot.selectCell(r, c);
    } catch (_) {}
    }

    function install() {
    if (!GA() || !GU()) return false;
    const ga = GA();
    if (!ga._hands) return false;

    if (typeof GU().multiplexOnResults === 'function') GU().multiplexOnResults(ga._hands);

    ga._hands.onResults((results) => {
        if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) return;
        const t = performance.now();
        let didRank = false;

        // Obey global cooldown early to avoid building up ranks
        if (!nowOKGlobal(t)) return;

        results.multiHandLandmarks.forEach((lm, idx) => {
        const openPalm = GU().isOpenPalm(lm);
        const pinching = GU().isPinching(lm);
        if (!openPalm || pinching) return;       // avoid overlap with delete

        const k = key(idx);
        const p = lmToScreenPX(lm[9]);           // LM9 (middle MCP)
        const prev = last[k];
        last[k] = p;
        if (!prev || !nowOKHand(k, t)) return;   // per-hand pacing

        // EXACT Python semantics: delta = last - current
        const dx = prev.x - p.x;   // + => moved LEFT on screen
        const dy = prev.y - p.y;   // + => moved UP
        const ax = Math.abs(dx), ay = Math.abs(dy);

        const hot = ga._hot; if (!hot) return;

        // Decide axis with hysteresis
        const vDominant = (ay > Y_THRESH_PX) && (ay > ax * (1 + HYSTERESIS));
        const hDominant = (ax > X_THRESH_PX) && (ax >= ay * (1 + HYSTERESIS));

        // Respect axis lock
        if (vDominant && axisLockedFor('v', t)) return;
        if (hDominant && axisLockedFor('h', t)) return;

        // Vertical step
        if (vDominant) {
            const dRows = (dy > 0 ? -1 : 1); // up => row--, down => row++
            GU().rank(ga._score, 'scroll', 0.9, {
            action: 'scroll',
            _src: dy > 0 ? '↑' : '↓',
            row: (hot.getSelectedLast()?.[0] || 0) + 1,
            col: (hot.getSelectedLast()?.[1] || 0) + 1,
            ptScreen: GU().toScreenXY(lm[8])
            });
            scrollBy(hot, dRows, 0);

            // pace
            armGlobal(t);
            armHand(k, t);
            lockAxis('v', t);
            ga._pasteArmed = false;
            didRank = true;
            return;
        }

        // Horizontal step
        if (hDominant) {
            const dCols = (dx > 0 ? -1 : 1); // left when dx>0; right when dx<0
            GU().rank(ga._score, 'scroll', 0.9, {
            action: 'scroll',
            _src: dx > 0 ? '←' : '→',
            row: (hot.getSelectedLast()?.[0] || 0) + 1,
            col: (hot.getSelectedLast()?.[1] || 0) + 1,
            ptScreen: GU().toScreenXY(lm[8])
            });
            scrollBy(hot, 0, dCols);

            // pace
            armGlobal(t);
            armHand(k, t);
            lockAxis('h', t);
            ga._pasteArmed = false;
            didRank = true;
            return;
        }
        });

        // Toast immediately when we actually scrolled
        if (didRank && typeof ga._commitTopGesture === 'function') {
        ga._commitTopGesture();
        }
    });

    console.info('[gestureScrollDelta] installed with global cooldown + axis lock');
    return true;
    }

    let tries = 0;
    const iv = setInterval(() => { if (install() || ++tries > 40) clearInterval(iv); }, 50);
})(window);
