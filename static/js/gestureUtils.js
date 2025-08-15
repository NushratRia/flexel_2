/* static/js/gestureUtils.js
 * Small helpers for gesture math, hitboxes, A1 refs, palm state, and scoring.
 */
(function (global) {
    const GU = {
        // ---- geometry ----
        dist(a, b) {
        const dx = a.x - b.x, dy = a.y - b.y;
        return Math.hypot(dx, dy);
        },
        // screen coords from normalized (mirrored like your highlight code)
        toScreenXY(pt) {
        return {
            x: window.innerWidth - (pt.x * window.innerWidth),
            y: pt.y * window.innerHeight
        };
        },

        // ---- hitbox / A1 conversion ----
        elementAt(pt) {
        const { x, y } = this.toScreenXY(pt);
        return document.elementFromPoint(x, y);
        },
        tdAt(pt) {
        const el = this.elementAt(pt);
        return el && el.closest ? el.closest('td, .htCore td') : null;
        },
        colLettersFromIndex(i) {
        let n = i, s = '';
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
        },
        a1FromTD(td) {
        if (!td) return null;
        const row = td.parentElement?.rowIndex ?? -1;
        const col = td.cellIndex ?? -1;
        if (row < 0 || col < 0) return null;
        return `${this.colLettersFromIndex(col)}${row + 1}`;
        },
        a1Rect(a, b) {
        // a & b are {row, col} (0‑based). Return "A1:C3"
        const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row);
        const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
        return `${this.colLettersFromIndex(c1)}${r1 + 1}:${this.colLettersFromIndex(c2)}${r2 + 1}`;
        },
        rcFromTD(td) {
        if (!td) return null;
        return { row: td.parentElement.rowIndex, col: td.cellIndex };
        },

        // ---- hand state heuristics (fast + simple) ----
        isPinching(landmarks, threshold = 0.055) {
        return this.dist(landmarks[4], landmarks[8]) < threshold;
        },
        palmOpenScore(landmarks) {
        // average (tip to mcp) across four fingers, higher => more open
        const pairs = [[8, 5], [12, 9], [16, 13], [20, 17]];
        const d = pairs.map(([tip, mcp]) => this.dist(landmarks[tip], landmarks[mcp]));
        return d.reduce((a, b) => a + b, 0) / d.length;
        },
        isOpenPalm(landmarks) {
        return this.palmOpenScore(landmarks) > 0.18; // tuned for MP Hands normalized space
        },
        isClosedFist(landmarks) {
        return this.palmOpenScore(landmarks) < 0.11;
        },

        // ---- velocity tracking ----
        updateKinematics(cache, key, pt, t) {
        const last = cache[key];
        if (!last) { cache[key] = { x: pt.x, y: pt.y, t, vx: 0, vy: 0 }; return cache[key]; }
        const dt = Math.max(1, t - last.t);
        last.vx = (pt.x - last.x) / dt;
        last.vy = (pt.y - last.y) / dt;
        last.x = pt.x; last.y = pt.y; last.t = t;
        return last;
        },

        // ---- scoring bucket ----
        newScoreBucket() { return Object.create(null); },
        rank(bucket, name, score, payload) {
        const prev = bucket[name];
        if (!prev || score > prev.score) bucket[name] = { score, payload };
        },
        best(bucket, min = 0.8) {
        const arr = Object.entries(bucket);
        if (!arr.length) return null;
        arr.sort((a, b) => b[1].score - a[1].score);
        return arr[0][1].score >= min ? { name: arr[0][0], ...arr[0][1] } : null;
        }
    };

    global.GestureUtils = GU;
})(window);

/* === ADD: results multiplexer (fan‑out for Hands.onResults) === */
(function (global) {
    const GU = global.GestureUtils;
    if (!GU) return;

    GU.multiplexOnResults = function (handsInstance) {
        if (!handsInstance || handsInstance.__muxInstalled) return;

        const origOnResults = handsInstance.onResults.bind(handsInstance);
        const subscribers = [];

        // Replace onResults with a registrar that stores callbacks,
        // and install a single dispatcher once.
        handsInstance.onResults = function (cb) {
        if (typeof cb === "function") subscribers.push(cb);
        };

        // Install the dispatcher exactly once
        origOnResults((res) => {
        for (let i = 0; i < subscribers.length; i++) {
            try { subscribers[i](res); } catch (e) { /* swallow to keep stream alive */ }
        }
        });

        handsInstance.__getResultSubscribers = () => subscribers.slice();
        handsInstance.__muxInstalled = true;
    };
})(window);











/* static/js/gestureUtils.js
 * Small helpers for gesture math, hitboxes, A1 refs, palm state, and scoring.
 */
/*(function (global) {
    const GU = {
        // ---- geometry ----
        dist(a, b) {
        const dx = a.x - b.x, dy = a.y - b.y;
        return Math.hypot(dx, dy);
        },
        // screen coords from normalized (mirrored like your highlight code)
        toScreenXY(pt) {
        return {
            x: window.innerWidth - (pt.x * window.innerWidth),
            y: pt.y * window.innerHeight
        };
        },

        // ---- hitbox / A1 conversion ----
        elementAt(pt) {
        const { x, y } = this.toScreenXY(pt);
        return document.elementFromPoint(x, y);
        },
        tdAt(pt) {
        const el = this.elementAt(pt);
        return el && el.closest ? el.closest('td, .htCore td') : null;
        },
        colLettersFromIndex(i) {
        let n = i, s = '';
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
        },
        a1FromTD(td) {
        if (!td) return null;
        const row = td.parentElement?.rowIndex ?? -1;
        const col = td.cellIndex ?? -1;
        if (row < 0 || col < 0) return null;
        return `${this.colLettersFromIndex(col)}${row + 1}`;
        },
        a1Rect(a, b) {
        // a & b are {row, col} (0‑based). Return "A1:C3"
        const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row);
        const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
        return `${this.colLettersFromIndex(c1)}${r1 + 1}:${this.colLettersFromIndex(c2)}${r2 + 1}`;
        },
        rcFromTD(td) {
        if (!td) return null;
        return { row: td.parentElement.rowIndex, col: td.cellIndex };
        },

        // ---- hand state heuristics (fast + simple) ----
        isPinching(landmarks, threshold = 0.055) {
        return this.dist(landmarks[4], landmarks[8]) < threshold;
        },
        palmOpenScore(landmarks) {
        // average (tip to mcp) across four fingers, higher => more open
        const pairs = [[8, 5], [12, 9], [16, 13], [20, 17]];
        const d = pairs.map(([tip, mcp]) => this.dist(landmarks[tip], landmarks[mcp]));
        return d.reduce((a, b) => a + b, 0) / d.length;
        },
        isOpenPalm(landmarks) {
        return this.palmOpenScore(landmarks) > 0.18; // tuned for MP Hands normalized space
        },
        isClosedFist(landmarks) {
        return this.palmOpenScore(landmarks) < 0.11;
        },

        // ---- velocity tracking ----
        updateKinematics(cache, key, pt, t) {
        const last = cache[key];
        if (!last) { cache[key] = { x: pt.x, y: pt.y, t, vx: 0, vy: 0 }; return cache[key]; }
        const dt = Math.max(1, t - last.t);
        last.vx = (pt.x - last.x) / dt;
        last.vy = (pt.y - last.y) / dt;
        last.x = pt.x; last.y = pt.y; last.t = t;
        return last;
        },

        // ---- scoring bucket ----
        newScoreBucket() { return Object.create(null); },
        rank(bucket, name, score, payload) {
        const prev = bucket[name];
        if (!prev || score > prev.score) bucket[name] = { score, payload };
        },
        best(bucket, min = 0.8) {
        const arr = Object.entries(bucket);
        if (!arr.length) return null;
        arr.sort((a, b) => b[1].score - a[1].score);
        return arr[0][1].score >= min ? { name: arr[0][0], ...arr[0][1] } : null;
        }
    };

    global.GestureUtils = GU;
})(window); */
