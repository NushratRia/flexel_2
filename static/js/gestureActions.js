/* static/js/gestureActions.js
 * Implements 9 spreadsheet gestures with score ranking + hitboxes.
 * Shows a popup text toast near the index tip after each successful action.
 */
(function (global) {
    const GU = global.GestureUtils;

    const GestureActions = {
        _hot: null,
        _container: null,
        _hands: null,
        _score: GU.newScoreBucket(),
        _kin: {},              // per-hand velocity cache
        _twoHandPrevDist: null,
        _twoHandStartRC: null, // for merge + autofill range corners
        _copyArmed: false,     // pinch selected, waiting for other fist
        _pasteArmed: false,    // closed fist -> open near target
        _successCue: null,
        _cueTimeout: 0,

        // toast cue
        _toastHost: null,

        // safety + pacing
        _cooldownUntil: 0,
        _COOLDOWN_MS: 350,

        // swipe detection (for undo/redo)
        _swipe: {},
        _SWIPE_MIN_D: 0.12,    // min horizontal travel (normalized units)
        _SWIPE_MAX_VERT: 0.06, // max vertical drift for a valid horizontal swipe
        _SWIPE_MIN_MS: 120,    // min duration
        _SWIPE_MAX_MS: 900,    // max duration

        init(hot, containerEl, hands) {
        this._hot = hot;
        this._container = containerEl;
        this._hands = hands;

        // If your GestureUtils has an onResults multiplexer, use it
        if (window.GestureUtils && typeof window.GestureUtils.multiplexOnResults === 'function') {
            window.GestureUtils.multiplexOnResults(hands);
        }

        // (Re)attach your existing highlighter safely
        try {
            const canvasElement = document.getElementById('handCanvas');
            const canvasCtx = canvasElement ? canvasElement.getContext('2d') : null;
            if (typeof window.setupGestureHighlightDebug === 'function' && canvasElement && canvasCtx) {
            window.setupGestureHighlightDebug(hands, canvasElement, canvasCtx);
            }
        } catch (_) { /* noop */ }

        // Register this module's results handler
        hands.onResults((res) => this._onResults(res));

        // legacy success canvas (we use toast now, but keep it)
        this._successCue = document.createElement('canvas');
        Object.assign(this._successCue.style, {
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            pointerEvents: 'none', zIndex: 99998
        });
        document.body.appendChild(this._successCue);
        this._resizeCue();
        window.addEventListener('resize', () => this._resizeCue());

        // toast host
        this._ensureToastHost();

        console.info('[GestureActions] ready');
        },

        _resizeCue() {
        this._successCue.width = window.innerWidth;
        this._successCue.height = window.innerHeight;
        },

        // kept for compatibility; no longer used for success cue by default
        _drawSuccessAt(ptScreen) {
        const ctx = this._successCue.getContext('2d');
        ctx.clearRect(0, 0, this._successCue.width, this._successCue.height);
        ctx.beginPath();
        ctx.arc(ptScreen.x, ptScreen.y, 28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,200,0,0.35)';
        ctx.strokeStyle = 'rgba(0,160,0,0.9)';
        ctx.lineWidth = 6;
        ctx.fill();
        ctx.stroke();
        clearTimeout(this._cueTimeout);
        this._cueTimeout = setTimeout(() => ctx.clearRect(0, 0, this._successCue.width, this._successCue.height), 400);
        },

        // === editor guards ===
        _isEditorOpen() {
        try {
            const ed = this._hot && this._hot.getActiveEditor && this._hot.getActiveEditor();
            return !!(ed && ed.isOpened && ed.isOpened());
        } catch (_) { return false; }
        },

        _closeEditorIfOpen() {
        try {
            const ed = this._hot && this._hot.getActiveEditor && this._hot.getActiveEditor();
            if (ed && ed.isOpened && ed.isOpened()) ed.close();
        } catch (_) {}
        },

        // === toast helpers ===
        _ensureToastHost() {
            if (this._toastHost) return;
            const host = document.createElement('div');
            Object.assign(host.style, {
                position: 'fixed',
                left: '0', top: '0',
                width: '100vw', height: '100vh',
                pointerEvents: 'none',
                zIndex: 99999,
                fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
            });
            document.body.appendChild(host);
            this._toastHost = host;
        },

        // ✅ Top-middle popup version
        _showToast(text) {
            this._ensureToastHost();
            const el = document.createElement('div');
            el.textContent = text;

            // fixed top middle
            const x = window.innerWidth / 2;
            const y = 60;

            Object.assign(el.style, {
                position: 'absolute',
                left: `${x}px`,
                top: `${y}px`,
                transform: 'translate(-50%, 0)',
                background: 'rgba(32,120,32,0.92)',
                color: '#fff',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '14px',
                lineHeight: '1.2',
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 150ms ease, transform 180ms ease'
            });

            this._toastHost.appendChild(el);
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'translate(-50%, -10%)';
            });
            setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translate(-50%, -20%)';
                setTimeout(() => el.remove(), 250);
            }, 1500);
        },


        _actionLabel(payload) {
        switch (payload?.action) {
            case 'select':   return `Selected ${payload.range}`;
            case 'scroll': { // ⬅️ change this case
            const tag = payload && payload._src ? ` [${payload._src}]` : '';
            return `Scrolled${tag}`;
            }
            case 'undo':     return 'Undo';
            case 'redo':     return 'Redo';
            case 'delete':   return `Cleared ${payload.range}`;
            case 'merge':    return `Merged ${payload.range}`;
            case 'zoom':     return `Zoom ${payload.direction || ''}`.trim();
            case 'copy':     return `Copied ${payload.range || ''}`.trim();
            case 'paste':    return `Pasted ${payload.at || ''}`.trim();
            default:         return 'Done';
            }
        },

        _commitTopGesture() {
        // cooldown guard
        if (performance.now() < this._cooldownUntil) return;

        const best = GU.best(this._score, 0.82);
        this._score = GU.newScoreBucket();
        if (!best) return;

        // close editor before mutating actions
        const mutating = new Set(['write','delete','merge','copy','paste','autofill','sort']);
        if (mutating.has(best.payload.action) && this._isEditorOpen()) {
            this._closeEditorIfOpen();
            return; // re-evaluate next frame if gesture persists
        }

        // 1) Try the existing execution path
        let ok = (global.VoiceActions && global.VoiceActions.execute(best.payload)) || false;

        // 2) Fallback: invoke Handsontable's undo/redo directly if needed
        if (!ok && (best.payload.action === 'undo' || best.payload.action === 'redo') && this._hot) {
            try {
            const ur = this._hot.getPlugin && this._hot.getPlugin('undoRedo');
            if (ur && typeof ur.undo === 'function' && typeof ur.redo === 'function') {
                if (best.payload.action === 'undo') ur.undo(); else ur.redo();
                ok = true;
            } else if (typeof this._hot.undo === 'function' && typeof this._hot.redo === 'function') {
                if (best.payload.action === 'undo') this._hot.undo(); else this._hot.redo();
                ok = true;
            }
            } catch (_) {}
        }

        // cooldown pacing
        if (ok) this._cooldownUntil = performance.now() + this._COOLDOWN_MS;

        // autosave on manipulations (skip for pure scroll/undo/redo/zoom)
        const autosaveActions = new Set(['delete', 'merge', 'copy', 'paste', 'autofill', 'write', 'sort']);
        if (ok && global.autoSave && autosaveActions.has(best.payload.action)) {
            try { global.autoSave(this._hot.getData()); } catch (_) {}
        }

        // toast cue
        this._showToast(this._actionLabel(best.payload), best.ptScreen);
        // (optionally also draw green ring:)
        // if (best.ptScreen) this._drawSuccessAt(best.ptScreen);
        },

        _onResults(results) {
        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

        const t = performance.now();
        const handsLM = results.multiHandLandmarks;

        // ---- per-hand analysis ----
        const handsInfo = handsLM.map((lm, idx) => {
            const indexTip = lm[8], thumbTip = lm[4];
            const td = GU.tdAt(indexTip);

            // Resolve coordinates correctly across Handsontable clones
            const rc = td
            ? (this._hot && typeof this._hot.getCoords === 'function'
                ? this._hot.getCoords(td)
                : GU.rcFromTD(td))
            : null;

            // Build A1 from resolved coords
            const a1 = rc ? `${this._col(rc.col)}${rc.row + 1}` : (td ? GU.a1FromTD(td) : null);

            const k = GU.updateKinematics(this._kin, `h${idx}`, indexTip, t);
            return {
            idx, lm, td, a1, rc,
            pinching: GU.isPinching(lm),
            openPalm: GU.isOpenPalm(lm),
            closedFist: GU.isClosedFist(lm),
            k, indexTip
            };
        });

        // --- swipe tracking (start/continue/stop) ---
        handsInfo.forEach(h => {
            const s = this._swipe[h.idx] || (this._swipe[h.idx] = { active: false });
            if (h.openPalm) {
            if (!s.active) { s.active = true; s.x0 = h.indexTip.x; s.y0 = h.indexTip.y; s.t0 = t; }
            s.x = h.indexTip.x; s.y = h.indexTip.y; s.t = t;
            } else {
            this._swipe[h.idx] = { active: false };
            }
        });

        // Header-aware prepass (probe into the sheet to get the true rc under the finger)
        // Keeps your structure: only sets h.a1 when pinching a header.
        {
        const hot = this._hot;
        if (hot) {
            // A→Z, AA, AB...
            const colLetters = (i) => { let n=i, s=''; do { s = String.fromCharCode(65+(n%26)) + s; n = Math.floor(n/26)-1; } while (n>=0); return s; };
            const rowRange  = (r)=> `${colLetters(0)}${r+1}:${colLetters(hot.countCols()-1)}${r+1}`;
            const colRange  = (c)=> { const L=colLetters(c); return `${L}1:${L}${hot.countRows()}`; };

            const PROBE_PX_Y = 24; // how far below the column header to sample
            const PROBE_PX_X = 24; // how far right of the row header to sample

            handsInfo.forEach(h => {
            if (!h.pinching) return;

            const el = GU.elementAt(h.indexTip);
            if (!el || !el.closest) return;

            // Work in real screen pixels (GU.toScreenXY mirrors X for us)
            const pt = GU.toScreenXY(h.indexTip);

            // Helper: get td at a screen point, then rc
            const tdAtXY = (x, y) => {
                const el2 = document.elementFromPoint(
                Math.max(0, Math.min(window.innerWidth - 1, x)),
                Math.max(0, Math.min(window.innerHeight - 1, y))
                );
                const td = el2 && el2.closest ? el2.closest('td') : null;
                if (!td) return null;
                return (typeof hot.getCoords === 'function' ? hot.getCoords(td) : (GU.rcFromTD && GU.rcFromTD(td)));
            };

            // If on COLUMN header: sample a point a little *below* the header to hit the data cell
            if (el.closest('.ht_clone_top')) {
                const rc = tdAtXY(pt.x, pt.y + PROBE_PX_Y);
                if (rc && Number.isInteger(rc.col)) {
                const c = rc.col;
                const range = colRange(c);
                // synthesize h.a1 so your existing block runs (blue highlight + popup)
                if (!h.a1) h.a1 = range;
                }
                return;
            }

            // If on ROW header: sample a point a little *right* into the sheet to hit the data cell
            if (el.closest('.ht_clone_left')) {
                const rc = tdAtXY(pt.x + PROBE_PX_X, pt.y);
                if (rc && Number.isInteger(rc.row)) {
                const r = rc.row;
                const range = rowRange(r);
                if (!h.a1) h.a1 = range;
                }
                return;
            }

            // else: normal cells already set h.a1 upstream; do nothing
            });
        }
        }





        // ---- 1) SELECT (pinch on a cell) ----
        handsInfo.forEach(h => {
        if (h.pinching && h.a1) {
            GU.rank(this._score, 'select', 0.92, {
            action: 'select', range: h.a1, _source: 'pinch', ptScreen: GU.toScreenXY(h.indexTip)
            });
            this._copyArmed = true;
            this._twoHandStartRC = this._twoHandStartRC || h.rc;
            this._pasteArmed = false;
        }
        });




        // ---- 1) SELECT (pinch on a cell) ----
        // handsInfo.forEach(h => {
        //     if (h.pinching && h.a1) {
        //     GU.rank(this._score, 'select', 0.92, {
        //         action: 'select', range: h.a1, _source: 'pinch', ptScreen: GU.toScreenXY(h.indexTip)
        //     });
        //     this._copyArmed = true;
        //     this._twoHandStartRC = this._twoHandStartRC || h.rc;
        //     // cancel paste intent only when a real select occurred
        //     this._pasteArmed = false;
        //     }
        // });

        // ---- 2) SCROLL (open palm swipe up/down) ----
        handsInfo.forEach(h => {
            if (h.openPalm) {
            const vy   = h.k.vy;                         // normalized units per ms
            const mag  = Math.min(1, Math.abs(vy) * 1200);
            const vxMag = Math.abs(h.k.vx) * 1200;       // horizontal velocity guard

            if (mag > 0.6 && vxMag < 0.25) {
                const dir     = vy < 0 ? -1 : 1;           // up/down
                const anchor  = this._hot.getSelectedLast() || [0, 0, 0, 0];
                const nextRow = Math.max(0, (anchor[0] || 0) + (dir * 5));

                GU.rank(this._score, 'scroll', 0.75 + 0.25 * mag, {
                action: 'scroll',
                // _src: 'vy', // ⬅️ tag old path
                row: nextRow + 1,
                col: (anchor[1] || 0) + 1,
                ptScreen: GU.toScreenXY(h.indexTip)
                });

                // cancel paste intent only when a real scroll is registered
                this._pasteArmed = false;
            }
            }
        });

        // // ---- 3) UNDO / 4) REDO (horizontal swipe with open palm) ----
        // handsInfo.forEach(h => {
        //     const s = this._swipe[h.idx];
        //     if (!h.openPalm || !s || !s.active) return;

        //     const dt = (s.t - s.t0);
        //     if (dt < this._SWIPE_MIN_MS || dt > this._SWIPE_MAX_MS) return;

        //     const dx = s.x - s.x0;  // horizontal travel
        //     const dy = s.y - s.y0;  // vertical drift

        //     if (Math.abs(dy) > this._SWIPE_MAX_VERT) return;   // too vertical
        //     if (Math.abs(dx) < this._SWIPE_MIN_D) return;      // not far enough

        //     const strength = Math.min(1, (Math.abs(dx) - this._SWIPE_MIN_D) / 0.25);
        //     const score = 0.85 + 0.15 * strength;

        //     this._pasteArmed = false; // cancel any pending paste intent
        //     GU.rank(this._score, dx < 0 ? 'undo' : 'redo', score, {
        //     action: dx < 0 ? 'undo' : 'redo',
        //     ptScreen: GU.toScreenXY(h.indexTip)
        //     });

        //     // reset this hand's swipe to avoid multiple triggers from one stroke
        //     this._swipe[h.idx] = { active: false };
        // });

        // // ---- 5) DELETE (selection + downward flick) ----
        // {
        //     const sel = this._hot.getSelectedLast();
        //     if (sel) {
        //     handsInfo.forEach(h => {
        //         const vy = h.k.vy;
        //         const mag = Math.min(1, Math.max(0, vy) * 1400);
        //         if (mag > 0.8) {
        //         const range = this._a1FromSel(sel);
        //         GU.rank(this._score, 'delete', 0.82 + 0.18 * mag, {
        //             action: 'delete', range, ptScreen: GU.toScreenXY(h.indexTip)
        //         });
        //         }
        //     });
        //     }
        // }

        // // ---- 6) MERGE (two hands collide while both are over cells) ----
        // if (handsInfo.length >= 2) {
        //     const [h0, h1] = handsInfo;
        //     if (h0.rc && h1.rc) {
        //     const dist = GU.dist(h0.indexTip, h1.indexTip);
        //     if (this._twoHandPrevDist != null && dist < 0.06 && this._twoHandPrevDist > dist) {
        //         const range = GU.a1Rect(h0.rc, h1.rc);
        //         GU.rank(this._score, 'merge', 0.9, { action: 'merge', range, ptScreen: GU.toScreenXY(h0.indexTip) });
        //     }
        //     this._twoHandPrevDist = dist;
        //     }
        // } else {
        //     this._twoHandPrevDist = null;
        // }

        // // ---- 7) ZOOM IN/OUT (two-hand pinch/expand) ----
        // if (handsInfo.length >= 2) {
        //     const [a, b] = handsInfo;
        //     const d = GU.dist(a.indexTip, b.indexTip);
        //     if (this._zoomLastDist == null) this._zoomLastDist = d;
        //     const delta = d - this._zoomLastDist;
        //     const mag = Math.min(1, Math.abs(delta) * 16);
        //     if (mag > 0.25) {
        //     if (delta > 0) GU.rank(this._score, 'zoomIn', 0.75 + 0.25 * mag, {
        //         action: 'zoom', direction: 'in', step: 0.1 + 0.2 * mag, ptScreen: GU.toScreenXY(a.indexTip)
        //     });
        //     else GU.rank(this._score, 'zoomOut', 0.75 + 0.25 * mag, {
        //         action: 'zoom', direction: 'out', step: 0.1 + 0.2 * mag, ptScreen: GU.toScreenXY(a.indexTip)
        //     });
        //     }
        //     this._zoomLastDist = d;
        // } else {
        //     this._zoomLastDist = null;
        // }

        // // ---- 8) COPY (pinch selection + other hand closed fist) ----
        // if (this._copyArmed && handsInfo.length >= 2) {
        //     const pinchHand = handsInfo.find(h => h.pinching && h.a1);
        //     const fistHand = handsInfo.find(h => h.closedFist);
        //     if (pinchHand && fistHand) {
        //     const range = this._hot.getSelectedLast()
        //         ? this._a1FromSel(this._hot.getSelectedLast())
        //         : pinchHand.a1;
        //     GU.rank(this._score, 'copy', 0.9, { action: 'copy', range, ptScreen: GU.toScreenXY(pinchHand.indexTip) });
        //     this._pasteArmed = true;     // allow paste next
        //     this._copyArmed = false;

        //     // expire paste window after 3s
        //     clearTimeout(this._pasteExpiry);
        //     this._pasteExpiry = setTimeout(() => { this._pasteArmed = false; }, 3000);
        //     }
        // }

        // // ---- 9) PASTE (closed fist -> open palm near target cell) ----
        // if (this._pasteArmed) {
        //     const opener = handsInfo.find(h => h.openPalm && h.a1);
        //     if (opener) {
        //     // require still hand to avoid swipes firing paste; and no editor open
        //     const still = Math.abs(opener.k.vx) * 1200 < 0.2 && Math.abs(opener.k.vy) * 1200 < 0.2;
        //     if (still && !this._isEditorOpen()) {
        //         GU.rank(this._score, 'paste', 0.9, {
        //         action: 'paste', at: opener.a1, ptScreen: GU.toScreenXY(opener.indexTip)
        //         });
        //         this._pasteArmed = false;
        //         clearTimeout(this._pasteExpiry);
        //     }
        //     }
        // }

        // ---- 10) AUTOFILL (drag diagonal from a selected seed) ----
        // {
        //     const sel = this._hot.getSelectedLast();
        //     const seed = sel ? { row: Math.min(sel[0], sel[2]), col: Math.min(sel[1], sel[3]) } : this._twoHandStartRC;
        //     const finger = handsInfo[0];
        //     if (seed && finger && finger.rc) {
        //     const dx = Math.abs(finger.rc.col - seed.col);
        //     const dy = Math.abs(finger.rc.row - seed.row);
        //     const diag = Math.min(dx, dy);
        //     if (diag >= 1 && finger.pinching) {
        //         const range = GU.a1Rect(seed, finger.rc);
        //         const sc = Math.min(1, 0.6 + 0.1 * diag);
        //         GU.rank(this._score, 'autofill', sc, { action: 'autofill', range, pattern: 'series', ptScreen: GU.toScreenXY(finger.indexTip) });
        //     }
        //     }
        // }

        // finally commit best
        this._commitTopGesture();
        },

        _a1FromSel(sel) {
        const r1 = Math.min(sel[0], sel[2]), c1 = Math.min(sel[1], sel[3]);
        const r2 = Math.max(sel[0], sel[2]), c2 = Math.max(sel[1], sel[3]);
        const a = `${this._col(c1)}${r1 + 1}`, b = `${this._col(c2)}${r2 + 1}`;
        return `${a}:${b}`;
        },
        _col(c) {
        let n = c, s = '';
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
        }
    };

    global.GestureActions = GestureActions;
})(window);
