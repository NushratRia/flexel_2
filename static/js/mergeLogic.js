/* static/js/mergeLogic.js
 * ------------------------------------------------------------
 * FlexEL semantic merge logic for:
 *   - Cells:   "A2:B2", "A2:A3", "A2:B4"
 *   - Columns: "A:B"
 *   - Rows:    "3:4"
 *   - Deictic: "this"  (two-hand pinch select)
 *
 * Rules:
 *   - A pair can merge if:
 *       (A is empty) OR (B is empty) OR (same normalized type)
 *   - Otherwise: merge is blocked with an explanation.
 *
 * Merge behavior:
 *   - Cells-range merge: union rectangle, aggregate into top-left, clear others,
 *       then attempt Handsontable mergeCells plugin UI merge.
 *   - Row merge: merge row values column-wise into the upper row, then remove the other row.
 *   - Col merge: merge col values row-wise into the left col, then remove the other col.
 *
 * Requirements:
 *   - Handsontable instance available via window.hot OR window._hot OR window.HOT() if you use that.
 *   - If you use deictic/two-hand selection: you should have either:
 *       window.__lastTwoHandTargets = [{r1,c1,r2,c2}, {r1,c1,r2,c2}]
 *     OR window.__handLiveRects = { left:{...}, right:{...} }
 *
 * Exposes:
 *   - window.MergeLogic.mergeByVoiceRangeOrDeictic(hot, rangeOrThis, opts)
 *   - window.MergeLogic.mergeFromRects(hot, rectA, rectB, mode, opts)
 */
(function (global) {
    "use strict";

    // -----------------------------
    // Config
    // -----------------------------
    const DEFAULTS = {
        stringJoiner: " | ",
        // For cells merge: if true, UI merge via mergeCells plugin is attempted.
        tryUIMergeCells: true,
        // When merging strings: if true, avoid duplicates "A | A" -> "A"
        dedupeStrings: true,
        // For booleans: OR
        booleanOp: "or", // "or" only for now
        // For numbers: sum
        numberOp: "sum", // "sum" only for now
    };

    // -----------------------------
    // Utilities: type/empty/parsing
    // -----------------------------
    function isEmpty(v) {
        return (
        v === null ||
        v === undefined ||
        (typeof v === "string" && v.trim() === "")
        );
    }

    function isNumericString(s) {
        const t = String(s).trim();
        return /^-?\d+(\.\d+)?$/.test(t);
    }

    function isBoolString(s) {
        const t = String(s).trim().toLowerCase();
        return t === "true" || t === "false";
    }

    function normalizeType(v) {
        if (isEmpty(v)) return "empty";
        if (typeof v === "number" && !Number.isNaN(v)) return "number";
        if (typeof v === "boolean") return "boolean";
        if (typeof v === "string") {
        if (isNumericString(v)) return "number";
        if (isBoolString(v)) return "boolean";
        return "string";
        }
        // Fallback: treat as string
        return "string";
    }

    function toNumber(v) {
        if (typeof v === "number") return v;
        const n = parseFloat(String(v).trim());
        return Number.isNaN(n) ? null : n;
    }

    function toBoolean(v) {
        if (typeof v === "boolean") return v;
        const t = String(v).trim().toLowerCase();
        if (t === "true") return true;
        if (t === "false") return false;
        return null;
    }

    function canMergePair(a, b) {
        const ta = normalizeType(a);
        const tb = normalizeType(b);

        // Allow if either empty
        if (ta === "empty" || tb === "empty") {
        return { ok: true, type: ta === "empty" ? tb : ta };
        }
        // Allow if same normalized type
        if (ta === tb) return { ok: true, type: ta };

        return { ok: false, reason: `Type mismatch (${ta} vs ${tb})` };
    }

    function mergePair(a, b, opts) {
        const joiner = opts.stringJoiner;

        // Prefer non-empty
        if (isEmpty(a)) return b;
        if (isEmpty(b)) return a;

        const chk = canMergePair(a, b);
        if (!chk.ok) return { __merge_error: true, reason: chk.reason };

        const type = chk.type;

        if (type === "number") {
        const na = toNumber(a),
            nb = toNumber(b);
        if (na == null || nb == null)
            return { __merge_error: true, reason: "Number parse error" };
        return na + nb;
        }

        if (type === "boolean") {
        const ba = toBoolean(a),
            bb = toBoolean(b);
        if (ba == null || bb == null)
            return { __merge_error: true, reason: "Boolean parse error" };
        return ba || bb;
        }

        // string
        const sa = String(a).trim();
        const sb = String(b).trim();
        if (opts.dedupeStrings && sa === sb) return sa;
        return `${sa}${joiner}${sb}`;
    }

    // -----------------------------
    // Address parsing helpers
    // -----------------------------
    function colLettersToIndex(letters) {
        // A->0, B->1, Z->25, AA->26 ...
        const s = String(letters).trim().toUpperCase();
        let n = 0;
        for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 65 || c > 90) return null;
        n = n * 26 + (c - 64);
        }
        return n - 1;
    }

    function parseA1Cell(a1) {
        // "A2" -> {r:1, c:0}
        const m = String(a1).trim().match(/^([A-Za-z]{1,3})(\d+)$/);
        if (!m) return null;
        const c = colLettersToIndex(m[1]);
        const r = parseInt(m[2], 10) - 1;
        if (c == null || !Number.isFinite(r) || r < 0) return null;
        return { r, c };
    }

    function parseCellSpan(span) {
        // "A2:B4" -> rect
        const m = String(span).trim().match(/^([A-Za-z]{1,3}\d+)\s*:\s*([A-Za-z]{1,3}\d+)$/);
        if (!m) return null;
        const a = parseA1Cell(m[1]);
        const b = parseA1Cell(m[2]);
        if (!a || !b) return null;
        return rectFromCorners(a.r, a.c, b.r, b.c);
    }

    function parseColSpan(span) {
        // "A:B" -> {c1,c2}
        const m = String(span).trim().match(/^([A-Za-z]{1,3})\s*:\s*([A-Za-z]{1,3})$/);
        if (!m) return null;
        const c1 = colLettersToIndex(m[1]);
        const c2 = colLettersToIndex(m[2]);
        if (c1 == null || c2 == null) return null;
        return { c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
    }

    function parseRowSpan(span) {
        // "3:4" -> {r1,r2}
        const m = String(span).trim().match(/^(\d+)\s*:\s*(\d+)$/);
        if (!m) return null;
        const r1 = parseInt(m[1], 10) - 1;
        const r2 = parseInt(m[2], 10) - 1;
        if (!Number.isFinite(r1) || !Number.isFinite(r2) || r1 < 0 || r2 < 0) return null;
        return { r1: Math.min(r1, r2), r2: Math.max(r1, r2) };
    }

    function rectFromCorners(r1, c1, r2, c2) {
        return {
        r1: Math.min(r1, r2),
        c1: Math.min(c1, c2),
        r2: Math.max(r1, r2),
        c2: Math.max(c1, c2),
        };
    }

    function unionRects(a, b) {
        return {
        r1: Math.min(a.r1, b.r1),
        c1: Math.min(a.c1, b.c1),
        r2: Math.max(a.r2, b.r2),
        c2: Math.max(a.c2, b.c2),
        };
    }

    function rectEquals(a, b) {
        return a && b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
    }

    // -----------------------------
    // Deictic selection reading
    // -----------------------------
    function readBothHandRects() {
        // Prefer explicit last targets
        if (Array.isArray(global.__lastTwoHandTargets) && global.__lastTwoHandTargets.length >= 2) {
        const a = global.__lastTwoHandTargets[0];
        const b = global.__lastTwoHandTargets[1];
        if (a && b) return [a, b];
        }

        // Fallback: live rects map
        const live = global.__handLiveRects;
        if (live && live.left && live.right) return [live.left, live.right];

        return [];
    }

    // -----------------------------
    // Selection kind detection
    // -----------------------------
    function detectSelectionKind(rect, hot) {
        const totalRows = hot.countRows();
        const totalCols = hot.countCols();
        const rowSpan = rect.r2 - rect.r1 + 1;
        const colSpan = rect.c2 - rect.c1 + 1;

        // "full row" heuristic: spans almost all cols and starts at col 0
        if (rect.c1 === 0 && colSpan >= Math.max(1, totalCols - 1)) return "row";
        // "full col" heuristic: spans almost all rows and starts at row 0
        if (rect.r1 === 0 && rowSpan >= Math.max(1, totalRows - 1)) return "col";
        return "cell";
    }

    // -----------------------------
    // Core merge implementations
    // -----------------------------
    function mergeRows(hot, rowA, rowB, opts) {
        const keep = Math.min(rowA, rowB);
        const drop = Math.max(rowA, rowB);

        const cols = hot.countCols();
        for (let c = 0; c < cols; c++) {
        const a = hot.getDataAtCell(keep, c);
        const b = hot.getDataAtCell(drop, c);

        const chk = canMergePair(a, b);
        if (!chk.ok) {
            return { ok: false, reason: `Row merge blocked at column ${c + 1}: ${chk.reason}` };
        }

        const merged = mergePair(a, b, opts);
        if (merged && merged.__merge_error) {
            return {
            ok: false,
            reason: `Row merge blocked at column ${c + 1}: ${merged.reason || "merge error"}`,
            };
        }
        hot.setDataAtCell(keep, c, merged);
        }

        // remove the dropped row
        hot.alter("remove_row", drop, 1);
        return { ok: true, message: `Merged rows ${rowA + 1} and ${rowB + 1}` };
    }

    function mergeCols(hot, colA, colB, opts) {
        const keep = Math.min(colA, colB);
        const drop = Math.max(colA, colB);

        const rows = hot.countRows();
        for (let r = 0; r < rows; r++) {
        const a = hot.getDataAtCell(r, keep);
        const b = hot.getDataAtCell(r, drop);

        const chk = canMergePair(a, b);
        if (!chk.ok) {
            return { ok: false, reason: `Column merge blocked at row ${r + 1}: ${chk.reason}` };
        }

        const merged = mergePair(a, b, opts);
        if (merged && merged.__merge_error) {
            return {
            ok: false,
            reason: `Column merge blocked at row ${r + 1}: ${merged.reason || "merge error"}`,
            };
        }
        hot.setDataAtCell(r, keep, merged);
        }

        hot.alter("remove_col", drop, 1);
        return { ok: true, message: `Merged columns ${colA + 1} and ${colB + 1}` };
    }

    function mergeCellsRect(hot, rect, opts) {
        // Aggregate all non-empty values into top-left, enforce type compatibility across non-empty.
        let acc = hot.getDataAtCell(rect.r1, rect.c1);

        for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
            if (r === rect.r1 && c === rect.c1) continue;
            const v = hot.getDataAtCell(r, c);
            if (isEmpty(v)) continue;

            if (isEmpty(acc)) {
            acc = v;
            continue;
            }

            const chk = canMergePair(acc, v);
            if (!chk.ok) {
            return { ok: false, reason: `Cell merge blocked at (${r + 1}, ${c + 1}): ${chk.reason}` };
            }

            const next = mergePair(acc, v, opts);
            if (next && next.__merge_error) {
            return { ok: false, reason: `Cell merge blocked at (${r + 1}, ${c + 1}): ${next.reason || "merge error"}` };
            }
            acc = next;
        }
        }

        // Write final value to top-left
        hot.setDataAtCell(rect.r1, rect.c1, acc);

        // Clear others in rect
        for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
            if (r === rect.r1 && c === rect.c1) continue;
            hot.setDataAtCell(r, c, "");
        }
        }

        // Optional UI merge (Handsontable mergeCells plugin)
        if (opts.tryUIMergeCells) {
        const plug = hot.getPlugin && hot.getPlugin("mergeCells");
        if (plug && plug.mergeSelection) {
            try {
            hot.selectCells([[rect.r1, rect.c1, rect.r2, rect.c2]]);
            plug.mergeSelection();
            } catch (e) {
            // Semantic merge succeeded even if UI merge fails.
            }
        }
        }

        hot.render();
        return { ok: true, message: `Merged cells into ${indexToA1(rect.r1, rect.c1)}` };
    }

    // -----------------------------
    // Helpers: index -> A1 (for messages)
    // -----------------------------
    function indexToColLetters(idx) {
        let n = idx + 1;
        let s = "";
        while (n > 0) {
        const rem = (n - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function indexToA1(r, c) {
        return `${indexToColLetters(c)}${r + 1}`;
    }

    // -----------------------------
    // Public API: merge by rects (deictic) or by voice range
    // -----------------------------
    function mergeFromRects(hot, rectA, rectB, mode, optsIn) {
        const opts = Object.assign({}, DEFAULTS, optsIn || {});
        if (!hot || !rectA || !rectB) return { ok: false, reason: "Missing selections" };

        if (mode === "auto") {
        // If both are full rows -> rows, both full cols -> cols, else cells
        const aKind = detectSelectionKind(rectA, hot);
        const bKind = detectSelectionKind(rectB, hot);
        if (aKind === "row" && bKind === "row") mode = "rows";
        else if (aKind === "col" && bKind === "col") mode = "cols";
        else mode = "cells";
        }

        if (mode === "rows") {
        return mergeRows(hot, rectA.r1, rectB.r1, opts);
        }
        if (mode === "cols") {
        return mergeCols(hot, rectA.c1, rectB.c1, opts);
        }

        // cells: union rect
        const rect = rectEquals(rectA, rectB) ? rectA : unionRects(rectA, rectB);
        return mergeCellsRect(hot, rect, opts);
    }

    function mergeByVoiceRangeOrDeictic(hot, rangeOrThis, optsIn) {
        const opts = Object.assign({}, DEFAULTS, optsIn || {});
        const s = String(rangeOrThis || "").trim();

        if (!hot) return { ok: false, reason: "Spreadsheet not ready" };

        // Deictic
        if (s === "" || s.toLowerCase() === "this") {
        const rects = readBothHandRects();
        if (rects.length < 2) return { ok: false, reason: "Select two targets with both hands first" };
        return mergeFromRects(hot, rects[0], rects[1], "auto", opts);
        }

        // Cell span: A2:B4
        const cellRect = parseCellSpan(s);
        if (cellRect) {
        // Merge a single rect selection (no second rect); treat as cells merge
        return mergeCellsRect(hot, cellRect, opts);
        }

        // Single A1: A2  (merge doesn't make sense alone; require deictic or span)
        const single = parseA1Cell(s);
        if (single) {
        return { ok: false, reason: `Provide a range like ${s}:B2 or use "merge these"` };
        }

        // Column span: A:B
        const colSpan = parseColSpan(s);
        if (colSpan) {
        // For column span merge, we only support merging TWO columns at a time (A:B)
        // If user gives A:D, we block unless they use two-hand deictic selections.
        if (colSpan.c2 !== colSpan.c1 + 1) {
            return { ok: false, reason: "For column spans, merge only two adjacent columns (e.g., A:B). Use two-hand selection for non-adjacent." };
        }
        return mergeCols(hot, colSpan.c1, colSpan.c2, opts);
        }

        // Row span: 3:4
        const rowSpan = parseRowSpan(s);
        if (rowSpan) {
        if (rowSpan.r2 !== rowSpan.r1 + 1) {
            return { ok: false, reason: "For row spans, merge only two adjacent rows (e.g., 3:4). Use two-hand selection for non-adjacent." };
        }
        return mergeRows(hot, rowSpan.r1, rowSpan.r2, opts);
        }

        return { ok: false, reason: "Unrecognized merge target. Try: merge A2:B2, merge A:B, merge 3:4, or merge these." };
    }

    // -----------------------------
    // Export
    // -----------------------------
    global.MergeLogic = {
        mergeByVoiceRangeOrDeictic,
        mergeFromRects,

        // debug helpers if needed
        _debug: {
        isEmpty,
        normalizeType,
        canMergePair,
        mergePair,
        parseCellSpan,
        parseColSpan,
        parseRowSpan,
        parseA1Cell,
        colLettersToIndex,
        indexToA1,
        readBothHandRects,
        detectSelectionKind,
        },
    };

    console.info("[MergeLogic] loaded.");
})(window);


















// /* static/js/mergeLogic.js
//  * Semantic merge logic (not just UI merge).
//  * Rules:
//  * - OK if (A empty) OR (B empty) OR (same type)
//  * - If both non-empty and type differs -> block merge
//  * - number + number => sum
//  * - string + string => concatenate " | "
//  * - boolean + boolean => OR
//  * - otherwise => keep A (fallback)
//  */
// (function (global) {
//   "use strict";

//   const DEFAULT_STRING_JOIN = " | ";

//   function isEmpty(v) {
//     return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
//   }

//   function normalizeType(v) {
//     if (isEmpty(v)) return "empty";

//     // Preserve actual numbers
//     if (typeof v === "number" && !Number.isNaN(v)) return "number";

//     // Numeric strings -> number
//     if (typeof v === "string") {
//       const t = v.trim();
//       if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
//       if (/^(true|false)$/i.test(t)) return "boolean";
//       return "string";
//     }

//     if (typeof v === "boolean") return "boolean";

//     // Fallback
//     return "string";
//   }

//   function toNumber(v) {
//     if (typeof v === "number") return v;
//     const n = parseFloat(String(v).trim());
//     return Number.isNaN(n) ? null : n;
//   }

//   function toBoolean(v) {
//     if (typeof v === "boolean") return v;
//     const t = String(v).trim().toLowerCase();
//     if (t === "true") return true;
//     if (t === "false") return false;
//     return null;
//   }

//   function canMergePair(a, b) {
//     const ta = normalizeType(a);
//     const tb = normalizeType(b);

//     if (ta === "empty" || tb === "empty") return { ok: true, type: ta === "empty" ? tb : ta };
//     if (ta === tb) return { ok: true, type: ta };
//     return { ok: false, reason: `Type mismatch (${ta} vs ${tb})` };
//   }

//   function mergePair(a, b, joiner = DEFAULT_STRING_JOIN) {
//     // Prefer non-empty
//     if (isEmpty(a)) return b;
//     if (isEmpty(b)) return a;

//     const { ok, type } = canMergePair(a, b);
//     if (!ok) return { __merge_error: true };

//     if (type === "number") {
//       const na = toNumber(a), nb = toNumber(b);
//       if (na == null || nb == null) return { __merge_error: true };
//       return na + nb;
//     }

//     if (type === "boolean") {
//       const ba = toBoolean(a), bb = toBoolean(b);
//       if (ba == null || bb == null) return { __merge_error: true };
//       return (ba || bb);
//     }

//     // string
//     const sa = String(a).trim();
//     const sb = String(b).trim();
//     if (sa === sb) return sa; // avoid duplicates
//     return `${sa}${joiner}${sb}`;
//   }

//   function unionRects(a, b) {
//     return {
//       r1: Math.min(a.r1, b.r1),
//       c1: Math.min(a.c1, b.c1),
//       r2: Math.max(a.r2, b.r2),
//       c2: Math.max(a.c2, b.c2),
//     };
//   }

//   function rectEquals(a, b) {
//     return a && b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
//   }

//   function detectSelectionKind(rect, hot) {
//     const totalRows = hot.countRows();
//     const totalCols = hot.countCols();
//     const rowSpan = rect.r2 - rect.r1 + 1;
//     const colSpan = rect.c2 - rect.c1 + 1;

//     // Heuristic already used in your VoiceMergeHandler.js
//     if (colSpan >= totalCols - 1 && rect.c1 === 0) return "row";
//     if (rowSpan >= totalRows - 1 && rect.r1 === 0) return "col";
//     return "cell";
//   }

//   function mergeRows(hot, rowA, rowB, joiner) {
//     const keep = Math.min(rowA, rowB);
//     const drop = Math.max(rowA, rowB);

//     const cols = hot.countCols();
//     for (let c = 0; c < cols; c++) {
//       const a = hot.getDataAtCell(keep, c);
//       const b = hot.getDataAtCell(drop, c);

//       const ok = canMergePair(a, b);
//       if (!ok.ok) {
//         return { ok: false, reason: `Row merge blocked at col ${c + 1}: ${ok.reason}` };
//       }

//       const merged = mergePair(a, b, joiner);
//       if (merged && merged.__merge_error) {
//         return { ok: false, reason: `Row merge blocked at col ${c + 1}` };
//       }
//       hot.setDataAtCell(keep, c, merged);
//     }

//     // Remove the dropped row (true merge)
//     hot.alter("remove_row", drop, 1);
//     return { ok: true, message: `Merged rows into row ${keep + 1}` };
//   }

//   function mergeCols(hot, colA, colB, joiner) {
//     const keep = Math.min(colA, colB);
//     const drop = Math.max(colA, colB);

//     const rows = hot.countRows();
//     for (let r = 0; r < rows; r++) {
//       const a = hot.getDataAtCell(r, keep);
//       const b = hot.getDataAtCell(r, drop);

//       const ok = canMergePair(a, b);
//       if (!ok.ok) {
//         return { ok: false, reason: `Column merge blocked at row ${r + 1}: ${ok.reason}` };
//       }

//       const merged = mergePair(a, b, joiner);
//       if (merged && merged.__merge_error) {
//         return { ok: false, reason: `Column merge blocked at row ${r + 1}` };
//       }
//       hot.setDataAtCell(r, keep, merged);
//     }

//     hot.alter("remove_col", drop, 1);
//     return { ok: true, message: `Merged columns into col ${keep + 1}` };
//   }

//   function mergeCellsRange(hot, rectA, rectB, joiner) {
//     const mergedRect = rectEquals(rectA, rectB) ? rectA : unionRects(rectA, rectB);

//     // Combine all values into top-left (r1,c1), enforce type compatibility across non-empty
//     let acc = hot.getDataAtCell(mergedRect.r1, mergedRect.c1);

//     for (let r = mergedRect.r1; r <= mergedRect.r2; r++) {
//       for (let c = mergedRect.c1; c <= mergedRect.c2; c++) {
//         if (r === mergedRect.r1 && c === mergedRect.c1) continue;
//         const v = hot.getDataAtCell(r, c);

//         // If empty, ignore
//         if (isEmpty(v)) continue;

//         // If acc empty, take v
//         if (isEmpty(acc)) {
//           acc = v;
//           continue;
//         }

//         const ok = canMergePair(acc, v);
//         if (!ok.ok) {
//           return { ok: false, reason: `Cell merge blocked at (${r + 1}, ${c + 1}): ${ok.reason}` };
//         }

//         const next = mergePair(acc, v, joiner);
//         if (next && next.__merge_error) {
//           return { ok: false, reason: `Cell merge blocked at (${r + 1}, ${c + 1})` };
//         }
//         acc = next;
//       }
//     }

//     // Write final value to top-left
//     hot.setDataAtCell(mergedRect.r1, mergedRect.c1, acc);

//     // Clear other cells in the rectangle
//     for (let r = mergedRect.r1; r <= mergedRect.r2; r++) {
//       for (let c = mergedRect.c1; c <= mergedRect.c2; c++) {
//         if (r === mergedRect.r1 && c === mergedRect.c1) continue;
//         hot.setDataAtCell(r, c, "");
//       }
//     }

//     // Optional: UI merge (Handsontable mergeCells plugin)
//     const plug = hot.getPlugin && hot.getPlugin("mergeCells");
//     if (plug && plug.mergeSelection) {
//       try {
//         hot.selectCells([[mergedRect.r1, mergedRect.c1, mergedRect.r2, mergedRect.c2]]);
//         plug.mergeSelection();
//       } catch (e) {
//         // If plugin fails, semantic merge still succeeded
//       }
//     }

//     hot.render();
//     return { ok: true, message: "Merged cells (semantic + UI)" };
//   }

//   function mergeFromRects(hot, rectA, rectB, mode, opts) {
//     const joiner = (opts && opts.joiner) || DEFAULT_STRING_JOIN;

//     if (!hot || !rectA || !rectB) return { ok: false, reason: "Missing selections" };

//     const kindA = detectSelectionKind(rectA, hot);
//     const kindB = detectSelectionKind(rectB, hot);

//     // If user asked explicitly for rows/cols/cells, enforce it
//     if (mode === "rows" && (kindA !== "row" || kindB !== "row")) {
//       return { ok: false, reason: "Please select two full rows to merge" };
//     }
//     if (mode === "cols" && (kindA !== "col" || kindB !== "col")) {
//       return { ok: false, reason: "Please select two full columns to merge" };
//     }
//     if (mode === "cells" && (kindA !== "cell" || kindB !== "cell")) {
//       return { ok: false, reason: "Please select two cell regions to merge" };
//     }

//     if (mode === "rows") return mergeRows(hot, rectA.r1, rectB.r1, joiner);
//     if (mode === "cols") return mergeCols(hot, rectA.c1, rectB.c1, joiner);
//     return mergeCellsRange(hot, rectA, rectB, joiner);
//   }

//   global.MergeLogic = {
//     mergeFromRects,
//     _debug: { isEmpty, normalizeType, canMergePair, mergePair },
//   };

//   console.info("[MergeLogic] semantic merge ready.");
// })(window);
