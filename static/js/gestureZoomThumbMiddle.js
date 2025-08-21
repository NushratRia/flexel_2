/* static/js/gestureZoomThumbMiddle.js
 * Zoom with thumb–middle distance, non-overlapping & clean HUD:
 *  - Require thumb–index separation for BOTH IN/OUT (prevents select overlap)
 *  - Scale only .ht_master .wtHider (grid content), so HUD/toasts stay crisp
 *  - 500ms local cooldown; global arbiter still enforces 500ms + rank margin
 */
(function (global) {
  const GA = () => global.GestureActions;
  const GU = () => global.GestureUtils;

  // Baseline (Python demo @ 640x480); we scale to screen diagonal
  const BASE_OUT_LOW   = 30;   // thumb–middle < 30 → OUT
  const BASE_IN_HIGH   = 120;  // thumb–middle > 120 → IN
  const BASE_IDX_SEP   = 60;   // thumb–index ≥ 60 → allow zoom (avoids select)
  const BASE_OUT_MARGIN= 10;   // OUT must be closer to middle than index by this

  const STEP             = 0.10;
  const MIN_SCALE        = 0.50;
  const MAX_SCALE        = 2.00;
  const ZOOM_COOLDOWN_MS = 500; // local

  let lastZoomAt = 0;
  let installed  = false;

  function scaled(px){
    const dS = Math.hypot(global.innerWidth, global.innerHeight);
    const dB = Math.hypot(640, 480);
    return px * (dS / dB);
  }

  function getScale(ga){ if (typeof ga._zoomScale !== 'number') ga._zoomScale = 1.0; return ga._zoomScale; }
  function setScale(ga, s){ ga._zoomScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)); }

  // Apply scale only to grid content (wtHider) so overlays/toasts remain unscaled
  function applyScale(ga) {
    const scale = getScale(ga);
    // Prefer the live instance structure
    const htRoot = (ga._hot && ga._hot.rootElement) || document.querySelector('.handsontable');
    const hider  = htRoot && htRoot.querySelector('.ht_master .wtHider');
    if (hider) {
      hider.style.transformOrigin = '0 0';
      hider.style.transform = `scale(${scale})`;
    } else {
      // Fallback: try generic master/hider path
      const h = document.querySelector('.ht_master .wtHider');
      if (h) {
        h.style.transformOrigin = '0 0';
        h.style.transform = `scale(${scale})`;
      } else {
        // Last resort: body zoom (may affect HUD; only used if no HOT DOM found)
        document.body.style.zoom = String(scale);
      }
    }
  }

  function toPx(lm){ return { x: lm.x * global.innerWidth, y: lm.y * global.innerHeight }; }

  function install(){
    if (installed) return true;
    if (!GA() || !GU()) return false;
    const ga = GA(); if (!ga._hands) return false;

    if (typeof GU().multiplexOnResults === 'function') GU().multiplexOnResults(ga._hands);

    console.info('[gestureZoom] scaled thresholds:',
      { OUT_LOW: Math.round(scaled(BASE_OUT_LOW)),
        IN_HIGH: Math.round(scaled(BASE_IN_HIGH)),
        IDX_SEP: Math.round(scaled(BASE_IDX_SEP)),
        OUT_MARGIN: Math.round(scaled(BASE_OUT_MARGIN)) });

    ga._hands.onResults((results) => {
      if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) return;

      const now = performance.now();
      if (now - lastZoomAt < ZOOM_COOLDOWN_MS) return; // local cooldown

      for (const lm of results.multiHandLandmarks) {
        // avoid scroll conflict
        if (GU().isOpenPalm(lm)) continue;

        const t = toPx(lm[4]);   // thumb
        const i = toPx(lm[8]);   // index
        const m = toPx(lm[12]);  // middle

        const dTM = Math.hypot(m.x - t.x, m.y - t.y);
        const dTI = Math.hypot(i.x - t.x, i.y - t.y);

        const OUT_LOW    = scaled(BASE_OUT_LOW);
        const IN_HIGH    = scaled(BASE_IN_HIGH);
        const IDX_SEP    = scaled(BASE_IDX_SEP);
        const OUT_MARGIN = scaled(BASE_OUT_MARGIN);

        // Hard gate: index must be away to avoid select overlap
        if (dTI < IDX_SEP || GU().isPinching(lm)) continue;

        let dir = null;

        // OUT: thumb–middle tight AND clearly closer than thumb–index
        if (dTM < OUT_LOW && (dTM + OUT_MARGIN) < dTI) dir = 'out';
        // IN: thumb–middle wide
        else if (dTM > IN_HIGH) dir = 'in';
        else continue;

        const before = getScale(ga);
        const after  = dir === 'in' ? before + STEP : before - STEP;
        setScale(ga, after);
        applyScale(ga);

        // Strong rank; arbiter will enforce global 0.5s & margin against other gestures
        GU().rank(ga._score, 'zoom', 0.97, {
          action: 'zoom', dir, scale: getScale(ga), tm: Math.round(dTM), ti: Math.round(dTI)
        });
        if (typeof ga._commitTopGesture === 'function') ga._commitTopGesture();

        lastZoomAt = now;
        break; // only one zoom per frame
      }
    });

    console.info('[gestureZoomThumbMiddle] installed (no select overlap + clean HUD scaling)');
    installed = true;
    return true;
  }

  let tries = 0;
  const iv = setInterval(() => { if (install() || ++tries > 40) clearInterval(iv); }, 50);
})(window);
