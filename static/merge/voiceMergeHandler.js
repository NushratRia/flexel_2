// static/merge/voiceMergeHandler.js
// Safe, isolated merge/unmerge handler for VOICE commands.
// Does NOT touch gestures. Only consumes Handsontable instance via window.VoiceActions._hot.

(function (global) {
  const VoiceMergeHandler = {
    // Decide if a cmd should be treated as a "deictic merge"
    // i.e., "merge this", "merge here", "merge these", etc.
    isDeicticMerge(cmd) {
      if (!cmd) return false;
      const a = String(cmd.action || "").toLowerCase();
      if (a !== "merge" && a !== "merge_cells" && a !== "merge_rows" && a !== "merge_cols") return false;

      const r = (cmd.range == null) ? "" : String(cmd.range).trim().toLowerCase();
      return (
        r === "" ||
        r === "this" || r === "these" ||
        r === "here" || r === "there" ||
        r === "hear" || r === "hair"
      );
    },

    execute(cmd) {
      const hot = global.VoiceActions && global.VoiceActions._hot;
      if (!hot) {
        console.warn("[VoiceMergeHandler] No hot instance available.");
        return false;
      }

      // Ensure plugin exists and is enabled
      const plugin = hot.getPlugin && hot.getPlugin("mergeCells");
      if (!plugin) {
        console.warn("[VoiceMergeHandler] mergeCells plugin missing. Did you set mergeCells:true in Handsontable settings?");
        return false;
      }

      // Some HOT versions require enablePlugin()
      try { plugin.enablePlugin && plugin.enablePlugin(); } catch (_) {}

      const action = String(cmd.action || "").toLowerCase();
      const wantUnmerge =
        action === "unmerge" ||
        action === "split" ||
        action === "split_cells" ||
        action === "unmerge_cells" ||
        (String(cmd.mode || "").toLowerCase() === "unmerge");

      // 1) Resolve target rect:
      // Prefer your existing deictic selection rectangles if present (two hands),
      // else fallback to HOT selected range.
      const rect = this._resolveRectFromDeicticOrSelection(hot);
      if (!rect) {
        console.warn("[VoiceMergeHandler] No selection found to merge/unmerge.");
        return false;
      }

      // Normalize
      const r1 = Math.min(rect.r1, rect.r2);
      const c1 = Math.min(rect.c1, rect.c2);
      const r2 = Math.max(rect.r1, rect.r2);
      const c2 = Math.max(rect.c1, rect.c2);

      // Merging a single cell is a no-op; keep it safe
      if (!wantUnmerge && r1 === r2 && c1 === c2) {
        console.warn("[VoiceMergeHandler] Selection is a single cell; merge ignored.");
        return false;
      }

      // 2) Apply:
      try {
        // keep selection visible
        hot.selectCell(r1, c1, r2, c2, true);

        if (wantUnmerge) {
          // Unmerge all merged cells in selection area
          // Handsontable merge plugin supports unmergeSelection() in many versions.
          if (typeof plugin.unmergeSelection === "function") {
            plugin.unmergeSelection();
          } else {
            // fallback: unmerge by iterating merged cells that intersect selection
            this._unmergeByIntersection(plugin, r1, c1, r2, c2);
          }
          hot.render();
          return true;
        }

        // Prefer explicit merge (most reliable)
        if (typeof plugin.merge === "function") {
          plugin.merge(r1, c1, r2, c2);
        } else if (typeof plugin.mergeSelection === "function") {
          plugin.mergeSelection();
        } else {
          console.warn("[VoiceMergeHandler] merge API not found on mergeCells plugin.");
          return false;
        }

        hot.render();
        return true;
      } catch (e) {
        console.warn("[VoiceMergeHandler] merge/unmerge failed:", e);
        return false;
      }
    },

    _resolveRectFromDeicticOrSelection(hot) {
      // A) If your bimanual/deictic tracker is active:
      // global.__handLiveRects = { L:{r1,c1,r2,c2}, R:{...} }
      const live = global.__handLiveRects || null;
      if (live) {
        // Prefer a rect that has span (multi-cell), else take any existing
        const candidates = [];
        if (live.L) candidates.push(live.L);
        if (live.R) candidates.push(live.R);

        if (candidates.length) {
          const spanning = candidates.find(r => r && (Math.abs(r.r2 - r.r1) + Math.abs(r.c2 - r.c1) > 0));
          return spanning || candidates[0];
        }
      }

      // B) Fallback to Handsontable selection
      const sel = hot.getSelectedLast && hot.getSelectedLast();
      if (!sel) return null;
      return { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
    },

    _unmergeByIntersection(plugin, r1, c1, r2, c2) {
      // Defensive fallback when unmergeSelection() is unavailable.
      // We find merged cells and unmerge those that intersect our selection.
      try {
        const merged = plugin.mergedCellsCollection && plugin.mergedCellsCollection.mergedCells;
        if (!merged || !merged.length) return;

        const intersects = (m) => {
          const mr1 = m.row;
          const mc1 = m.col;
          const mr2 = m.row + m.rowspan - 1;
          const mc2 = m.col + m.colspan - 1;
          return !(mr2 < r1 || mr1 > r2 || mc2 < c1 || mc1 > c2);
        };

        merged.slice().forEach(m => {
          if (intersects(m) && typeof plugin.unmerge === "function") {
            plugin.unmerge(m.row, m.col);
          }
        });
      } catch (e) {
        console.warn("[VoiceMergeHandler] fallback unmerge failed:", e);
      }
    },
  };

  global.VoiceMergeHandler = VoiceMergeHandler;
})(window);
