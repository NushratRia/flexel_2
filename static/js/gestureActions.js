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
        // safety + pacing
        _cooldownUntil: 0,
        _COOLDOWN_MS: 350,

        // --- added for toast cue ---
        _toastHost: null,

        init(hot, containerEl, hands) {
            this._hot = hot;
            this._container = containerEl;
            this._hands = hands;

            // 1) Install results multiplexer so multiple handlers can coexist
            if (window.GestureUtils && typeof window.GestureUtils.multiplexOnResults === 'function') {
                window.GestureUtils.multiplexOnResults(hands);
            }

            // 2) Re-register the existing highlighter under the mux (safe if already set)
            try {
                const canvasElement = document.getElementById('handCanvas');
                const canvasCtx = canvasElement ? canvasElement.getContext('2d') : null;
                if (typeof window.setupGestureHighlightDebug === 'function' && canvasElement && canvasCtx) {
                    window.setupGestureHighlightDebug(hands, canvasElement, canvasCtx);
                }
            } catch (_) { /* noop */ }

            // 3) Register THIS module's handler under the mux
            hands.onResults((res) => this._onResults(res));

            // Success cue canvas (kept, though we now use toast)
            this._successCue = document.createElement('canvas');
            Object.assign(this._successCue.style, {
                position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                pointerEvents: 'none', zIndex: 99998
            });
            document.body.appendChild(this._successCue);
            this._resizeCue();
            window.addEventListener('resize', () => this._resizeCue());

            // Ensure toast host exists
            this._ensureToastHost();

            console.info('[GestureActions] ready (multiplexed)');
        },

        _resizeCue() {
            this._successCue.width = window.innerWidth;
            this._successCue.height = window.innerHeight;
        },

        // kept for compatibility; we don't call it for success anymore
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



                // === ADD: editor guards ===
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




        // --- toast helpers (added) ---
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

        _showToast(text, ptScreen) {
            this._ensureToastHost();
            const el = document.createElement('div');
            el.textContent = text;

            // default to top-right if no fingertip screen point
            const x = ptScreen?.x ?? (window.innerWidth - 160);
            const y = ptScreen?.y ?? 72;

            Object.assign(el.style, {
                position: 'absolute',
                left: `${x}px`,
                top: `${y}px`,
                transform: 'translate(-50%, -50%)',
                background: 'rgba(32,120,32,0.92)',
                color: '#fff',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '13px',
                lineHeight: '1',
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 120ms ease, transform 180ms ease'
            });

            this._toastHost.appendChild(el);
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'translate(-50%, -58%)';
            });
            setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translate(-50%, -70%)';
                setTimeout(() => el.remove(), 250);
            }, 1200);
        },

        _actionLabel(payload) {
            switch (payload?.action) {
                case 'select':   return `Selected ${payload.range}`;
                case 'scroll':   return `Scrolled`;
                case 'undo':     return 'Undo';
                case 'redo':     return 'Redo';
                case 'delete':   return `Cleared ${payload.range}`;
                case 'merge':    return `Merged ${payload.range}`;
                case 'zoom':     return `Zoom ${payload.direction || ''}`.trim();
                case 'copy':     return `Copied ${payload.range || ''}`.trim();
                case 'paste':    return `Pasted ${payload.at || ''}`.trim();
                case 'autofill': return `Autofill ${payload.range}`;
                default:         return 'Done';
            }
        },
        // --- end toast helpers ---

        _commitTopGesture() {
            const best = GU.best(this._score, 0.82);
            this._score = GU.newScoreBucket();
            if (!best) return;

            // execute
            const ok = (global.VoiceActions && global.VoiceActions.execute(best.payload)) || false;

            // autosave on manipulations (skip for pure scroll/undo/redo/zoom)
            const autosaveActions = new Set(['delete', 'merge', 'copy', 'paste', 'autofill', 'write', 'sort']);
            if (ok && global.autoSave && autosaveActions.has(best.payload.action)) {
                try { global.autoSave(this._hot.getData()); } catch (_) {}
            }

            // ✅ success popup near the fingertip (replaces green circle)
            this._showToast(this._actionLabel(best.payload), best.ptScreen);
            // (if you want both, also call: if (best.ptScreen) this._drawSuccessAt(best.ptScreen);)
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
                const openScore = GU.palmOpenScore(lm);
                return {
                    idx, lm, td, a1, rc,
                    pinching: GU.isPinching(lm),
                    openPalm: GU.isOpenPalm(lm),
                    closedFist: GU.isClosedFist(lm),
                    k, indexTip
                };
            });

            // ---- 1) SELECT (pinch on a cell) ----
            handsInfo.forEach(h => {
                if (h.pinching && h.a1) {
                    GU.rank(this._score, 'select', 0.92, { action: 'select', range: h.a1, _source: 'pinch', ptScreen: GU.toScreenXY(h.indexTip) });
                    this._copyArmed = true;
                    this._twoHandStartRC = this._twoHandStartRC || h.rc;
                }
            });

            // ---- 2) SCROLL (open palm swipe up/down) ----
            handsInfo.forEach(h => {
                if (h.openPalm) {
                    const vy = h.k.vy; // normalized units per ms
                    const mag = Math.min(1, Math.abs(vy) * 1200);
                    if (mag > 0.6) {
                        const dir = vy < 0 ? -1 : 1;
                        const anchor = this._hot.getSelectedLast() || [0, 0, 0, 0];
                        const nextRow = Math.max(0, (anchor[0] || 0) + (dir * 5));
                        GU.rank(this._score, 'scroll', 0.75 + 0.25 * mag, {
                            action: 'scroll',
                            row: nextRow + 1,
                            col: (anchor[1] || 0) + 1,
                            ptScreen: GU.toScreenXY(h.indexTip)
                        });
                    }
                }
            });

            // ---- 3) UNDO / 4) REDO (long swipe left/right with open palm) ----
            handsInfo.forEach(h => {
            if (!h.openPalm) return;
            const vx = h.k.vx, vy = h.k.vy;
            const horiz = Math.abs(vx) * 1200;
            const vert  = Math.abs(vy) * 1200;

            if (horiz > 0.8 && vert < 0.25) {
                // cancel any pending paste intent
                this._pasteArmed = false;

                if (vx < 0) GU.rank(this._score, 'undo', 0.85 + 0.15 * Math.min(1, horiz),
                { action: 'undo', ptScreen: GU.toScreenXY(h.indexTip) });
                else GU.rank(this._score, 'redo', 0.85 + 0.15 * Math.min(1, horiz),
                { action: 'redo', ptScreen: GU.toScreenXY(h.indexTip) });
            }
            });


            // ---- 5) DELETE (selection + downward flick) ----
            {
                const sel = this._hot.getSelectedLast();
                if (sel) {
                    handsInfo.forEach(h => {
                        const vy = h.k.vy;
                        const mag = Math.min(1, Math.max(0, vy) * 1400);
                        if (mag > 0.8) {
                            const range = this._a1FromSel(sel);
                            GU.rank(this._score, 'delete', 0.82 + 0.18 * mag, { action: 'delete', range, ptScreen: GU.toScreenXY(h.indexTip) });
                        }
                    });
                }
            }

            // ---- 6) MERGE (two hands collide while both are over cells) ----
            if (handsInfo.length >= 2) {
                const [h0, h1] = handsInfo;
                if (h0.rc && h1.rc) {
                    const dist = GU.dist(h0.indexTip, h1.indexTip);
                    if (this._twoHandPrevDist != null && dist < 0.06 && this._twoHandPrevDist > dist) {
                        const range = GU.a1Rect(h0.rc, h1.rc);
                        GU.rank(this._score, 'merge', 0.9, { action: 'merge', range, ptScreen: GU.toScreenXY(h0.indexTip) });
                    }
                    this._twoHandPrevDist = dist;
                }
            } else {
                this._twoHandPrevDist = null;
            }

            // ---- 7) ZOOM IN/OUT (two-hand pinch/expand) ----
            if (handsInfo.length >= 2) {
                const [a, b] = handsInfo;
                const d = GU.dist(a.indexTip, b.indexTip);
                if (this._zoomLastDist == null) this._zoomLastDist = d;
                const delta = d - this._zoomLastDist;
                const mag = Math.min(1, Math.abs(delta) * 16);
                if (mag > 0.25) {
                    if (delta > 0) GU.rank(this._score, 'zoomIn', 0.75 + 0.25 * mag, { action: 'zoom', direction: 'in', step: 0.1 + 0.2 * mag, ptScreen: GU.toScreenXY(a.indexTip) });
                    else GU.rank(this._score, 'zoomOut', 0.75 + 0.25 * mag, { action: 'zoom', direction: 'out', step: 0.1 + 0.2 * mag, ptScreen: GU.toScreenXY(a.indexTip) });
                }
                this._zoomLastDist = d;
            } else {
                this._zoomLastDist = null;
            }

            // ---- 8) COPY (pinch selection + other hand closed fist) ----
            if (this._copyArmed && handsInfo.length >= 2) {
                const pinchHand = handsInfo.find(h => h.pinching && h.a1);
                const fistHand = handsInfo.find(h => h.closedFist);
                if (pinchHand && fistHand) {
                    const range = this._hot.getSelectedLast()
                        ? this._a1FromSel(this._hot.getSelectedLast())
                        : pinchHand.a1;
                    GU.rank(this._score, 'copy', 0.9, { action: 'copy', range, ptScreen: GU.toScreenXY(pinchHand.indexTip) });
                    this._pasteArmed = true;     // allow paste next
                    clearTimeout(this._pasteExpiry);
                    this._pasteExpiry = setTimeout(() => { this._pasteArmed = false; }, 3000); // 3s paste window
                    this._copyArmed = false;
                }
            }

            // ---- 9) PASTE (closed fist -> open palm near target cell) ----
            if (this._pasteArmed) {
                const opener = handsInfo.find(h => h.openPalm && h.a1);
                if (opener) {
                    GU.rank(this._score, 'paste', 0.9, { action: 'paste', at: opener.a1, ptScreen: GU.toScreenXY(opener.indexTip) });
                    this._pasteArmed = false;
                }
            }

            // ---- 10) AUTOFILL (drag diagonal from a selected seed) ----
            {
                const sel = this._hot.getSelectedLast();
                const seed = sel ? { row: Math.min(sel[0], sel[2]), col: Math.min(sel[1], sel[3]) } : this._twoHandStartRC;
                const finger = handsInfo[0];
                if (seed && finger && finger.rc) {
                    const dx = Math.abs(finger.rc.col - seed.col);
                    const dy = Math.abs(finger.rc.row - seed.row);
                    const diag = Math.min(dx, dy);
                    if (diag >= 1 && finger.pinching) {
                        const range = GU.a1Rect(seed, finger.rc);
                        const sc = Math.min(1, 0.6 + 0.1 * diag);
                        GU.rank(this._score, 'autofill', sc, { action: 'autofill', range, pattern: 'series', ptScreen: GU.toScreenXY(finger.indexTip) });
                    }
                }
            }

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
