/* static/js/deicticPatches.js
 * Lets users say things like "sort this", "write 52 here", etc.
 * Zero edits to existing code: we patch at the public function boundaries.
 */
(function (global) {
    'use strict';

    const DT = global.DeicticTarget;

    function resolveThisToCell(a1Maybe) {
        if (String(a1Maybe).toLowerCase() === 'this' || !a1Maybe) {
        return DT && DT.getCellA1 ? DT.getCellA1() : null;
        }
        return a1Maybe;
    }

    function resolveThisToColumn(colMaybe) {
        const s = (colMaybe || '').toString().trim().toLowerCase();
        if (s === 'this' || s === '') {
        return DT && DT.getColLetter ? DT.getColLetter() : null;
        }
        return colMaybe;
    }

    // ---- Patch your helpers used by voicechat.js ----
    const _write = global.executeWriteValue;
    if (typeof _write === 'function') {
        global.executeWriteValue = function (a1, value) {
        const target = resolveThisToCell(a1) || a1;
        return _write.call(this, target, value);
        };
    }

    const _sort = global.executeSortColumn;
    if (typeof _sort === 'function') {
        global.executeSortColumn = function (colLetter, direction) {
        const col = resolveThisToColumn(colLetter) || colLetter;
        return _sort.call(this, col, direction);
        };
    }

    // Optional: make Sum/Average accept “this” as a shorthand for the pointed column
    const _sum = global.executeSum;
    if (typeof _sum === 'function') {
        global.executeSum = function (range) {
        let r = range;
        if (!r || String(r).toLowerCase() === 'this') {
            const col = DT && DT.getColLetter && DT.getColLetter();
            if (col) r = `${col}1:${col}${(global.hot && global.hot.countRows ? global.hot.countRows() : 1000)}`;
        }
        return _sum.call(this, r);
        };
    }

    const _avg = global.executeAverage;
    if (typeof _avg === 'function') {
        global.executeAverage = function (range) {
        let r = range;
        if (!r || String(r).toLowerCase() === 'this') {
            const col = DT && DT.getColLetter && DT.getColLetter();
            if (col) r = `${col}1:${col}${(global.hot && global.hot.countRows ? global.hot.countRows() : 1000)}`;
        }
        return _avg.call(this, r);
        };
    }

    // ---- Patch VoiceActions.execute so JSON like {action:"write", range:"this"} works ----
    const VA = global.VoiceActions;
    if (VA && typeof VA.execute === 'function') {
        const _exec = VA.execute.bind(VA);
        VA.execute = function (cmd) {
        if (!cmd) return _exec(cmd);

        const fix = (x) => (typeof x === 'string' ? x.trim() : x);

        if (cmd.range) {
            // e.g., "this" or "this:this" → convert to a concrete cell/column span
            const r = fix(cmd.range).toLowerCase();
            if (r === 'this') {
            const a1 = DT && DT.getCellA1 && DT.getCellA1();
            if (a1) cmd.range = a1;
            }
        }

        if (cmd.at) {
            const at = fix(cmd.at).toLowerCase();
            if (at === 'this') {
            const a1 = DT && DT.getCellA1 && DT.getCellA1();
            if (a1) cmd.at = a1;
            }
        }

        if (cmd.column) {
            const c = fix(cmd.column).toLowerCase();
            if (c === 'this') {
            const col = DT && DT.getColLetter && DT.getColLetter();
            if (col) cmd.column = col;
            }
        }

        // If user said "write 52" without a range → use pointed cell
        if (cmd.action === 'write' && !cmd.range && typeof cmd.value !== 'undefined') {
            const a1 = DT && DT.getCellA1 && DT.getCellA1();
            if (a1) cmd.range = a1;
        }

        // If user said "sort" without a column → use pointed column
        if (cmd.action === 'sort' && !cmd.column) {
            const col = DT && DT.getColLetter && DT.getColLetter();
            if (col) cmd.column = col;
        }

        return _exec(cmd);
        };
    }

    console.info('[DeicticPatches] ready: “this” now resolves from pointing or selection.');
})(window);
