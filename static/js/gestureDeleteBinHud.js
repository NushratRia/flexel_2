/* static/js/gestureDeleteBinHudBottom.js
 * Black bin HUD fixed at bottom-center:
 *  - Shows while PINCHING and LM9 is below midline+50px (armed zone)
 *  - Pulses when per-frame Δy > 40px (strong flick feedback)
 *  - Purely visual; logic remains in your delete plugin.
 */
(function (global) {
    const GA = () => global.GestureActions;
    const GU = () => global.GestureUtils;

    const MIDLINE_OFFSET_PX = 50;
    const FLICK_DELTA_Y_PX  = 40;
    const SIZE_PX           = 56;
    const BOTTOM_OFFSET     = 64;  // distance from bottom

    const lastY = {};
    let el = null, styleEl = null, _installed = false;

    function key(i){ return `h${i}`; }
    function m9Ypx(lm9){ return lm9.y * global.innerHeight; }

    function ensureStyles(){
        if (styleEl) return;
        styleEl = document.createElement('style');
        styleEl.textContent = `
        #binHudBottom {
            position: fixed;
            left: 50%;
            bottom: ${BOTTOM_OFFSET}px;
            width: ${SIZE_PX}px; height: ${SIZE_PX}px;
            transform: translateX(-50%);
            pointer-events: none;
            z-index: 2147483647;
            display: none;
            opacity: 0.92;
            transition: opacity 140ms ease;
            filter: drop-shadow(0 6px 14px rgba(0,0,0,0.35));
        }
        #binHudBottom.pulse { animation: binPulse 220ms ease-out 1; }
        @keyframes binPulse {
            0% { transform: translateX(-50%) scale(1.0); }
            60%{ transform: translateX(-50%) scale(1.15); }
            100%{ transform: translateX(-50%) scale(1.0); }
        }
        #binHudBottom svg { width: 100%; height: 100%; }
        #binHudBottom .bin-body { fill: #000000; } /* black */
        #binHudBottom .bin-lid  { fill: #111111; } /* near-black */
        #binHudBottom .bin-slot { fill: #ffffff; } /* white bars */
        `;
        document.head.appendChild(styleEl);
    }
    function ensureHud(){
        if (el) return;
        el = document.createElement('div');
        el.id = 'binHudBottom';
        el.innerHTML = `
        <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect class="bin-lid"  x="12" y="10" width="40" height="6" rx="2"></rect>
            <rect class="bin-body" x="16" y="16" width="32" height="40" rx="6"></rect>
            <rect class="bin-slot" x="24" y="22" width="4" height="26" rx="2"></rect>
            <rect class="bin-slot" x="30" y="22" width="4" height="26" rx="2"></rect>
            <rect class="bin-slot" x="36" y="22" width="4" height="26" rx="2"></rect>
        </svg>`;
        document.body.appendChild(el);
    }
    function show(pulse=false){
        if (!el) return;
        el.style.display = 'block';
        if (pulse) {
        el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
        }
    }
    function hide(){ if (el) { el.classList.remove('pulse'); el.style.display = 'none'; } }

    function install(){
        if (_installed) return true;
        if (!GA() || !GU()) return false;
        const ga = GA(); if (!ga._hands) return false;
        ensureStyles(); ensureHud();

        if (typeof GU().multiplexOnResults === 'function') GU().multiplexOnResults(ga._hands);

        ga._hands.onResults((results) => {
        if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) { hide(); return; }
        const yMid = global.innerHeight / 2;
        let armed = false, doPulse = false;

        results.multiHandLandmarks.forEach((lm, idx) => {
            const k = key(idx);
            const pinching = GU().isPinching(lm);
            if (!pinching) { lastY[k] = undefined; return; }

            const y = m9Ypx(lm[9]);
            const y0 = lastY[k];
            lastY[k] = y;

            if (y > (yMid + MIDLINE_OFFSET_PX)) {
            armed = true;
            if (y0 != null && (y - y0) > FLICK_DELTA_Y_PX) doPulse = true;
            }
        });

        if (armed) show(doPulse); else hide();
        });

        console.info('[gestureDeleteBinHudBottom] installed (black bin, bottom center)');
        _installed = true;
        return true;
    }

    let tries = 0;
    const iv = setInterval(() => { if (install() || ++tries > 40) clearInterval(iv); }, 50);
})(window);
