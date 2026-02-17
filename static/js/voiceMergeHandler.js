/* static/js/voiceMergeHandler.js
 * Voice-triggered merge handler with:
 *  - supports TWO selections (cells/rows/cols) from bimanual/deictic (window.__handLiveRects)
 *  - requires mergeCells plugin
 *  - if merge area has >1 non-empty cell => shows warning like Google Sheets
 *  - if exactly 1 non-empty cell but not top-left => moves it to top-left before merging (so it’s preserved)
 *
 * Exposes:
 *  - window.VoiceMergeHandler.isDeicticMerge(cmd)
 *  - window.VoiceMergeHandler.execute(cmd)  // returns true if it initiated, false if cannot
 */

(function (global) {
  'use strict';

  function HOT() {
    return (global.GestureActions && global.GestureActions._hot) || global.hot || null;
  }

  function isDeicticWord(x) {
    const t = String(x || '').trim().toLowerCase();
    return t === 'this' || t === 'here' || t === 'there' || t === 'hear' || t === 'hair';
  }

  function sameRect(a, b) {
    return a && b &&
      a.r1 === b.r1 && a.c1 === b.c1 &&
      a.r2 === b.r2 && a.c2 === b.c2;
  }

  function rectArea(r) {
    return (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
  }

  function unionRect(a, b) {
    return {
      r1: Math.min(a.r1, b.r1),
      c1: Math.min(a.c1, b.c1),
      r2: Math.max(a.r2, b.r2),
      c2: Math.max(a.c2, b.c2),
    };
  }

  // union must be a perfect rectangle covering exactly a+b area (no gaps), and selections must not overlap
  function unionIsGapFreeRect(a, b) {
    const u = unionRect(a, b);

    // overlap check
    const overlap =
      !(a.r2 < b.r1 || b.r2 < a.r1 || a.c2 < b.c1 || b.c2 < a.c1);
    if (overlap) return false;

    const uArea = rectArea(u);
    const sumArea = rectArea(a) + rectArea(b);
    return uArea === sumArea;
  }

  function readTwoHandRects(hot) {
    const live = global.__handLiveRects || {};
    const out = [];

    if (live.L) out.push(live.L);
    if (live.R && (!out.length || !sameRect(out[0], live.R))) out.push(live.R);

    // fallback: Handsontable multi-range (if any)
    if (out.length < 2 && hot && hot.getSelectedRange) {
      try {
        const ranges = hot.getSelectedRange();
        if (Array.isArray(ranges) && ranges.length >= 2) {
          const r0 = ranges[0], r1 = ranges[1];
          const A = {
            r1: Math.min(r0.from.row, r0.to.row),
            c1: Math.min(r0.from.col, r0.to.col),
            r2: Math.max(r0.from.row, r0.to.row),
            c2: Math.max(r0.from.col, r0.to.col),
          };
          const B = {
            r1: Math.min(r1.from.row, r1.to.row),
            c1: Math.min(r1.from.col, r1.to.col),
            r2: Math.max(r1.from.row, r1.to.row),
            c2: Math.max(r1.from.col, r1.to.col),
          };
          out.length = 0;
          out.push(A, B);
        }
      } catch (_) {}
    }

    // fallback: single selection => return 1 rect
    if (!out.length && hot && hot.getSelectedRangeLast) {
      const sel = hot.getSelectedRangeLast();
      if (sel && sel.from && sel.to) {
        out.push({
          r1: Math.min(sel.from.row, sel.to.row),
          c1: Math.min(sel.from.col, sel.to.col),
          r2: Math.max(sel.from.row, sel.to.row),
          c2: Math.max(sel.from.col, sel.to.col),
        });
      }
    }

    return out;
  }

  function cellIsEmpty(v) {
    return v == null || String(v) === "";
  }

  function scanNonEmptyCells(hot, r) {
    const nonEmpty = [];
    for (let i = r.r1; i <= r.r2; i++) {
      for (let j = r.c1; j <= r.c2; j++) {
        const v = hot.getDataAtCell(i, j);
        if (!cellIsEmpty(v)) nonEmpty.push({ row: i, col: j, value: v });
      }
    }
    return nonEmpty;
  }

  function moveSingleValueToTopLeft(hot, u, nonEmpty) {
    if (!nonEmpty || nonEmpty.length !== 1) return;

    const tlRow = u.r1, tlCol = u.c1;
    const one = nonEmpty[0];
    if (one.row === tlRow && one.col === tlCol) return;

    // Move value to top-left so it will be preserved by mergeCells plugin.
    hot.setDataAtCell(tlRow, tlCol, one.value);
    hot.setDataAtCell(one.row, one.col, "");
  }

  async function doMergeWithOptionalWarning(hot, plugin, u) {
    const nonEmpty = scanNonEmptyCells(hot, u);

    // If more than one cell has content -> warn
    if (nonEmpty.length > 1) {
      const ok = await (global.MergeWarningDialog && global.MergeWarningDialog.confirm
        ? global.MergeWarningDialog.confirm({
            message: "Merging cells will only preserve the top-leftmost value. Merge anyway?"
          })
        : Promise.resolve(true));

      if (!ok) return false;

      // proceed as-is (plugin preserves top-left)
      hot.selectCells([[u.r1, u.c1, u.r2, u.c2]]);
      try {
        plugin.mergeSelection();
        hot.render();
        return true;
      } catch (e) {
        console.warn("[VoiceMergeHandler] mergeSelection failed", e);
        return false;
      }
    }

    // If exactly one cell has content but not top-left -> move it to top-left
    if (nonEmpty.length === 1) {
      moveSingleValueToTopLeft(hot, u, nonEmpty);
    }

    hot.selectCells([[u.r1, u.c1, u.r2, u.c2]]);
    try {
      plugin.mergeSelection();
      hot.render();
      return true;
    } catch (e) {
      console.warn("[VoiceMergeHandler] mergeSelection failed", e);
      return false;
    }
  }

  const VoiceMergeHandler = {
    isDeicticMerge(cmd) {
      if (!cmd || !cmd.action) return false;
      const a = String(cmd.action).toLowerCase();
      if (a !== "merge" && a !== "merge_cells" && a !== "merge_rows" && a !== "merge_cols") return false;

      // deictic if range missing or a deictic word
      if (cmd.range == null) return true;
      return isDeicticWord(cmd.range);
    },

    execute(cmd) {
      const hot = HOT();
      if (!hot) return false;

      const plugin = hot.getPlugin && hot.getPlugin("mergeCells");
      if (!plugin || !plugin.mergeSelection) return false;

      const rects = readTwoHandRects(hot);

      // If only one selection exists, just merge that selection (still warn if >1 values in the area)
      if (rects.length === 1) {
        const u = rects[0];
        // fire-and-forget async (keeps VoiceActions.execute synchronous)
        doMergeWithOptionalWarning(hot, plugin, u);
        return true;
      }

      // Need exactly 2 selections for "merge these"
      if (rects.length < 2) return false;

      const A = rects[0];
      const B = rects[1];

      // Must form a clean rectangle without gaps (like Sheets when you select two adjacent blocks)
      if (!unionIsGapFreeRect(A, B)) {
        // If it can’t form a rectangle, we refuse silently (no breaking changes)
        console.warn("[VoiceMergeHandler] selections are not mergeable (must form a single rectangle)");
        return false;
      }

      const u = unionRect(A, B);

      // fire-and-forget async
      doMergeWithOptionalWarning(hot, plugin, u);
      return true;
    }
  };

  global.VoiceMergeHandler = VoiceMergeHandler;
})(window);
