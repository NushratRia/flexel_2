//2/20
// //2/16
(function (global) {
  const VoiceActions = {
    _hot: null,
    _containerEl: null,
    _zoom: 1,

    init(hotInstance, containerEl) {
      this._hot = hotInstance;
      this._containerEl = containerEl || hotInstance.rootElement;
      console.info("[VoiceActions] initialized");

      // ✅ Ensure mergeCells is enabled so merges actually render
      try {
        const s = (this._hot && this._hot.getSettings) ? this._hot.getSettings() : {};
        const hasMergeSetting = (s && (s.mergeCells === true || Array.isArray(s.mergeCells)));
        if (!hasMergeSetting) {
          this._hot.updateSettings({ mergeCells: true });
        }
        const plugin = this._hot.getPlugin && this._hot.getPlugin("mergeCells");
        if (plugin && typeof plugin.enablePlugin === "function") {
          plugin.enablePlugin();
        }
      } catch (e) {
        console.warn("[VoiceActions] mergeCells enable failed", e);
      }
    },

    execute(cmd) {
      if (!cmd || !this._hot) return false;

      // ---- Deictic fan-out aware path for deletex/write ----
      if (cmd.action === "delete") {
        return this._clearMulti(cmd.range);
      }
      if (cmd.action === "write") {
        if (cmd.value == null) return false;
        return this._writeMulti(cmd.range, String(cmd.value));
      }

      // ---- NEW actions (non-breaking extensions) ----
      if (cmd.action === "dedupe" || cmd.action === "remove_duplicates") {
        return this._dedupeRowsMulti(cmd.range);
      }

      if (cmd.action === "insert") {
        const target   = (cmd.target || "").toLowerCase();
        const position = (cmd.position || "before").toLowerCase();
        const count    = Math.max(1, parseInt(cmd.count || 1, 10));
        return this._insertAt(target, cmd.where || cmd.range || "this", position, count);
      }

      if (cmd.action === "fillna" || cmd.action === "fill_missing" || cmd.action === "impute") {
        const fillVal = (cmd.value != null) ? String(cmd.value) : "N/A";
        return this._fillMissingMulti(cmd.range, fillVal);
      }

      // merge aliases for convenience -> use the same merge helper
      if (cmd.action === "merge_rows" || cmd.action === "merge_cols" || cmd.action === "merge_cells") {
        if (!cmd.range) cmd.range = "this";
        return this._mergeMulti(cmd.range);
      }

      // ---- Legacy actions (unchanged semantics) ----
      if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
      if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
      if (cmd.action === "undo") return this.undo();
      if (cmd.action === "redo") return this.redo();

      // ✅ Merge (deictic + A1) routed through helper
      if (cmd.action === "merge") {
        return this._mergeMulti(cmd.range || "this");
      }

      if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
      if (cmd.action === "copy") return this.copyTSV(cmd.range);
      if (cmd.action === "paste") return this.pasteTSV(cmd.at);
      if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

      return false;
    },

    // ---------- parsing helpers ----------
    _colLettersToIndex(colLetters) {
      const s = String(colLetters || "").toUpperCase().trim();
      let n = 0;
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 65 || code > 90) return -1;
        n = n * 26 + (code - 64);
      }
      return n - 1; // zero-based
    },

    _parseA1Range(a1) {
      const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
      if (!m) return null;
      const c1 = this._colLettersToIndex(m[1]);
      const r1 = parseInt(m[2], 10) - 1;
      const c2 = this._colLettersToIndex(m[3]);
      const r2 = parseInt(m[4], 10) - 1;
      if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
      return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
    },

    _parseA1Cell(a1) {
      const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
      if (!m) return null;
      const c = this._colLettersToIndex(m[1]);
      const r = parseInt(m[2], 10) - 1;
      if (c < 0 || r < 0) return null;

      // ✅ FIX: correct return object (prevents "remember is not defined")
      return { r, c };
    },

    _rectFromA1(a1) {
      return this._parseA1Range(a1) || this._parseA1Cell(a1);
    },

    _currentSelectionRect() {
      // Prefer newer API
      if (this._hot.getSelectedLast) {
        const sel = this._hot.getSelectedLast();
        if (sel && sel.length >= 4) {
          return { r1: Math.min(sel[0], sel[2]), c1: Math.min(sel[1], sel[3]), r2: Math.max(sel[0], sel[2]), c2: Math.max(sel[1], sel[3]) };
        }
      }
      // Fallback for mouse/keyboard selections
      if (this._hot.getSelected) {
        const arr = this._hot.getSelected();
        if (Array.isArray(arr) && arr.length) {
          const last = arr[arr.length - 1];
          if (Array.isArray(last) && last.length >= 4) {
            return { r1: Math.min(last[0], last[2]), c1: Math.min(last[1], last[3]), r2: Math.max(last[0], last[2]), c2: Math.max(last[1], last[3]) };
          }
        }
      }
      return null;
    },

    _readBothHandRects() {
      const live = global.__handLiveRects || {};
      const out = [];

      const norm = (x) => {
        if (!x) return null;

        // If rect comes as {r,c} make it a 1x1 rect
        if (typeof x.r === "number" && typeof x.c === "number" && (x.r1 == null || x.c1 == null)) {
          return { r1: x.r, c1: x.c, r2: x.r, c2: x.c };
        }

        // If rect already has r1/c1/r2/c2, normalize ordering
        if (typeof x.r1 === "number" && typeof x.c1 === "number" && typeof x.r2 === "number" && typeof x.c2 === "number") {
          return {
            r1: Math.min(x.r1, x.r2),
            c1: Math.min(x.c1, x.c2),
            r2: Math.max(x.r1, x.r2),
            c2: Math.max(x.c1, x.c2),
          };
        }

        return null;
      };

      const same = (a, b) =>
        a && b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

      const L = norm(live.L);
      const R = norm(live.R);

      if (L) out.push(L);
      if (R && (!out.length || !same(out[0], R))) out.push(R);

      // fallback: HOT selection
      // ✅ Prefer an actual multi-cell HOT selection over a single-cell hover rect
      const cur = this._currentSelectionRect();
      const curIsMulti = cur && !(cur.r1 === cur.r2 && cur.c1 === cur.c2);

      if (curIsMulti) return [cur];

      if (!out.length) {
        if (cur) out.push(cur);
      }
      return out;
    },

    _isDeictic(s) {
      const t = String(s || "").trim().toLowerCase();
      return t === "this" || t === "here" || t === "there" || t === "hear" || t === "hair";
    },

    _resolveToRects(spec) {
      if (!spec || this._isDeictic(spec)) {
        return this._readBothHandRects();
      }

      const single = this._rectFromA1(spec);
      if (single) {
        if ("r2" in single) return [single];
        return [{ r1: single.r, c1: single.c, r2: single.r, c2: single.c }];
      }

      if (Array.isArray(spec)) {
        const arr = [];
        spec.forEach(s => {
          const r = this._rectFromA1(s);
          if (r) {
            if ("r2" in r) arr.push(r);
            else arr.push({ r1: r.r, c1: r.c, r2: r.r, c2: r.c });
          }
        });
        return arr;
      }
      return [];
    },

    // ---------- actions (legacy) ----------
    select(a1) {
      const r = this._rectFromA1(a1);
      if (!r) return false;

      if ("r2" in r) {
        this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
      } else {
        this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
      }
      return true;
    },

    scroll(row1Based, colRef) {
      const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
      let col = 0;
      if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
      else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
      this._hot.scrollViewportTo(row, col);
      return true;
    },

    undo() {
      const u = this._hot.getPlugin("undoRedo");
      if (!u) return false;
      u.undo();
      return true;
    },

    redo() {
      const u = this._hot.getPlugin("undoRedo");
      if (!u) return false;
      u.redo();
      return true;
    },

    clearRange(a1) {
      const r = this._rectFromA1(a1);
      if (!r) return false;

      // accumulate changes so undo sees one action
      const changes = [];
      if ("r2" in r) {
        for (let i = r.r1; i <= r.r2; i++) {
          for (let j = r.c1; j <= r.c2; j++) {
            changes.push([i, j, ""]);
          }
        }
      } else {
        changes.push([r.r, r.c, ""]);
      }
      if (changes.length) this._hot.setDataAtCell(changes);
      return true;
    },

    // ---------- actions (BOTH hands) ----------
    _clearMulti(rangeSpec) {
      let rects = this._resolveToRects(rangeSpec);
      if (!rects.length) return false;

      // build single change list
      const changes = [];
      rects.forEach(r=>{
        for (let i = r.r1; i <= r.r2; i++) {
          for (let j = r.c1; j <= r.c2; j++) {
            changes.push([i, j, ""]);
          }
        }
      });
      if (changes.length) this._hot.setDataAtCell(changes);

      const last = rects[rects.length - 1];
      this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
      return true;
    },

    _writeMulti(rangeSpec, value) {
      let rects = this._resolveToRects(rangeSpec);
      if (!rects.length) return false;

      rects.forEach(r=>{
        for (let i = r.r1; i <= r.r2; i++) {
          for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, value);
        }
      });

      const last = rects[rects.length - 1];
      this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
      return true;
    },

    // ✅ NEW: deictic + multi merge helper (same pattern as other multi helpers)
    _mergeMulti(rangeSpec) {
      let rects = this._resolveToRects(rangeSpec);

      // ✅ MERGE-SPECIFIC: if "this" came from two-hand deictic, convert to ONE bounding rect
      if (this._isDeictic(rangeSpec)) {
        const live = global.__handLiveRects || {};

        const norm = (x) => {
          if (!x) return null;
          if (typeof x.r === "number" && typeof x.c === "number" && (x.r1 == null || x.c1 == null)) {
            return { r1: x.r, c1: x.c, r2: x.r, c2: x.c };
          }
          if (typeof x.r1 === "number" && typeof x.c1 === "number" && typeof x.r2 === "number" && typeof x.c2 === "number") {
            return {
              r1: Math.min(x.r1, x.r2),
              c1: Math.min(x.c1, x.c2),
              r2: Math.max(x.r1, x.r2),
              c2: Math.max(x.c1, x.c2),
            };
          }
          return null;
        };

        const L = norm(live.L);
        const R = norm(live.R);

        if (L && R) {
          const r1 = Math.min(L.r1, R.r1);
          const c1 = Math.min(L.c1, R.c1);
          const r2 = Math.max(L.r2, R.r2);
          const c2 = Math.max(L.c2, R.c2);

          // overwrite rects to a single merge target rectangle
          rects.length = 0;
          rects.push({ r1, c1, r2, c2 });
        }
      }

      if (!rects.length) {
        if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Select a valid range (2+ cells) to merge.");
        return false;
      }

      const plugin = this._hot.getPlugin("mergeCells");
      if (!plugin) {
        if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Merge is not available.");
        return false;
      }

      // Ensure plugin is enabled (safe)
      try {
        if (typeof plugin.enablePlugin === "function") plugin.enablePlugin();
        const s = this._hot.getSettings ? this._hot.getSettings() : {};
        const hasMergeSetting = (s && (s.mergeCells === true || Array.isArray(s.mergeCells)));
        if (!hasMergeSetting) this._hot.updateSettings({ mergeCells: true });
      } catch (e) {
        console.warn("[VoiceActions] mergeCells enable failed", e);
      }

      // ✅ If two hands selected two single cells, merge the bounding rectangle
      if (rects.length >= 2 && rects.every(r => (r.r1 === r.r2 && r.c1 === r.c2))) {
        const r1 = Math.min(...rects.map(r => r.r1));
        const c1 = Math.min(...rects.map(r => r.c1));
        const r2 = Math.max(...rects.map(r => r.r2));
        const c2 = Math.max(...rects.map(r => r.c2));

        // Only convert if it becomes a real 2+ cell rectangle
        if (!(r1 === r2 && c1 === c2)) {
          rects.length = 0;
          rects.push({ r1, c1, r2, c2 });
        }
      }

      // If every rect is a single cell, don’t report success
      const hasAnyMultiCell = rects.some(r => !(r.r1 === r.r2 && r.c1 === r.c2));
      if (!hasAnyMultiCell) {
        if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Select a valid range (2+ cells) to merge.");
        return false;
      }

      let mergedAny = false;

      rects.forEach(r => {
        // skip single-cell rects
        if (r.r1 === r.r2 && r.c1 === r.c2) return;

        try {
          // ✅ Always select first (matches mouse/menu merge path)
          this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);

          // ✅ Prefer mergeSelection() first (most reliable across HOT builds)
          if (typeof plugin.mergeSelection === "function") {
            plugin.mergeSelection();
            mergedAny = true;
            return;
          }

          // fallback: some builds expose merge()
          if (typeof plugin.merge === "function") {
            plugin.merge(r.r1, r.c1, r.r2, r.c2);
            mergedAny = true;
            return;
          }

          console.warn("[VoiceActions] mergeCells plugin has no mergeSelection() or merge()");
        } catch (e) {
          console.warn("[VoiceActions] merge failed", e);
        }
      });

      if (mergedAny) {
        // keep last rect selected for user feedback
        const last = rects[rects.length - 1];
        this._hot.selectCells([[last.r1, last.c1, last.r2, last.c2]]);

        // ✅ Force persistence + redraw (fixes “true but no visual merge” cases)
        // ✅ Force persistence + redraw (compatible with older/newer HOT builds)
        try {
          const coll = plugin && plugin.mergedCellsCollection;

          // Most builds store merged cells here:
          const raw = (coll && Array.isArray(coll.mergedCells)) ? coll.mergedCells : [];

          if (raw.length) {
            const merges = raw.map(m => ({
              row: m.row,
              col: m.col,
              rowspan: m.rowspan,
              colspan: m.colspan
            }));
            this._hot.updateSettings({ mergeCells: merges });
          } else {
            // fallback: at least ensure mergeCells is enabled
            this._hot.updateSettings({ mergeCells: true });
          }
        } catch (e) {
          console.warn("[VoiceActions] merge persistence sync failed", e);
        }

        this._hot.render();
        // Log success when merge actually happens
        if (global.addToChatLog) global.addToChatLog("bot", "✅ Cells merged successfully.");
        return true;
      }

      // Only show warning if no merge actually occurred
      if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Select a valid range (2+ cells) to merge.");
      return false;
    },

    // A1-only merge kept for backward compatibility
    merge(a1) {
      const r = this._parseA1Range(a1);
      if (!r) return false;

      const plugin = this._hot.getPlugin("mergeCells");
      if (!plugin) return false;

      this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
      try {
        plugin.mergeSelection();
        this._hot.render();
        return true;
      } catch (e) {
        console.warn("[VoiceActions] merge failed", e);
        return false;
      }
    },

    zoom(direction = "in", step = 0.1) {
      if (!this._containerEl) return false;
      if (direction === "reset") this._zoom = 1;
      else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
      else this._zoom = Math.min(2, this._zoom + step);

      this._containerEl.style.transformOrigin = "top left";
      this._containerEl.style.transform = `scale(${this._zoom})`;
      return true;
    },

    copyTSV(rangeA1) {
      let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
      if (!r) {
        const sel = this._hot.getSelectedLast();
        if (!sel) return false;
        r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
      }
      const lines = [];
      for (let i = r.r1; i <= r.r2; i++) {
        const row = [];
        for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
        lines.push(row.join("\t"));
      }
      const tsv = lines.join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).catch(() => {});
      }
      return true;
    },

    async pasteTSV(atA1) {
      try {
        const txt = await navigator.clipboard.readText();
        if (!txt) return false;

        const start = atA1 ? this._parseA1Cell(atA1) : null;
        let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

        const rows = txt.split(/\r?\n/);
        rows.forEach((line, i) => {
          const cells = line.split("\t");
          cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
        });
        return true;
      } catch (e) {
        console.warn("[VoiceActions] paste failed", e);
        return false;
      }
    },

    autofill(rangeA1, pattern = "repeat") {
      const r = this._parseA1Range(rangeA1);
      if (!r) return false;

      const height = r.r2 - r.r1 + 1;
      const width  = r.c2 - r.c1 + 1;

      if (pattern === "series" && (width === 1 || height === 1)) {
        const values = [];
        for (let k = 0; k < (width === 1 ? height : width); k++) {
          const v = width === 1
            ? this._hot.getDataAtCell(r.r1 + k, r.c1)
            : this._hot.getDataAtCell(r.r1, r.c1 + k);
          values.push(parseFloat(v));
        }
        if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
          const step = values[1] - values[0];
          for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
            const val = values[0] + step * idx;
            if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
            else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
          }
          return true;
        }
      }

      const seed = this._hot.getDataAtCell(r.r1, r.c1);
      for (let i = r.r1; i <= r.r2; i++) {
        for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
      }
      return true;
    },

    // ---------- NEW helpers (append-only; do not alter existing behavior) ----------
    _dedupeRowsMulti(rangeSpec) {
      let rects = this._resolveToRects(rangeSpec);
      if (!rects.length) return false;
      const hot = this._hot;

      rects.forEach(r => {
        const rows = r.r2 - r.r1 + 1;
        const cols = r.c2 - r.c1 + 1;

        const data = [];
        for (let i = 0; i < rows; i++) {
          const row = [];
          for (let j = 0; j < cols; j++) row.push(hot.getDataAtCell(r.r1 + i, r.c1 + j) ?? "");
          data.push(row);
        }

        const seen = new Set();
        const unique = [];
        for (const row of data) {
          const sig = row.join("\u0001");
          if (!seen.has(sig)) {
            seen.add(sig);
            unique.push(row);
          }
        }

        for (let i = r.r1; i <= r.r2; i++) {
          for (let j = r.c1; j <= r.c2; j++) hot.setDataAtCell(i, j, "");
        }

        unique.forEach((row, i) => {
          row.forEach((val, j) => hot.setDataAtCell(r.r1 + i, r.c1 + j, val));
        });
      });

      const last = rects[rects.length - 1];
      this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
      return true;
    },

    _insertAt(target, whereSpec, position = "before", count = 1) {
      const hot = this._hot;
      const rects = this._resolveToRects(whereSpec);
      if (!rects.length) return false;
      const r = rects[0];

      try {
        if (target === "row") {
          const idx = (position === "after") ? (r.r2 + 1) : r.r1;
          hot.alter("insert_row", idx, count);
          hot.selectCell(idx, r.c1, idx + Math.max(0, count - 1), r.c1, true);
          return true;
        }
        if (target === "col" || target === "column") {
          const idx = (position === "after") ? (r.c2 + 1) : r.c1;
          hot.alter("insert_col", idx, count);
          hot.selectCell(r.r1, idx, r.r1, idx + Math.max(0, count - 1), true);
          return true;
        }
      } catch (e) {
        console.warn("[VoiceActions] insert failed", e);
      }
      return false;
    },

    _fillMissingMulti(rangeSpec, value) {
      let rects = this._resolveToRects(rangeSpec);
      if (!rects.length) return false;
      const hot = this._hot;

      rects.forEach(r => {
        for (let i = r.r1; i <= r.r2; i++) {
          for (let j = r.c1; j <= r.c2; j++) {
            const v = hot.getDataAtCell(i, j);
            if (v == null || v === "") hot.setDataAtCell(i, j, value);
          }
        }
      });

      const last = rects[rects.length - 1];
      hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
      return true;
    },
  };

  function __maybeHandleLocalVoice(transcript){
    if (!transcript) return false;
    const s = String(transcript).trim().toLowerCase();

    const has = (w)=>s.includes(w);
    const anyDeictic = (has(" this") || has(" here") || has(" there") || has(" hear") || has(" hair") || /^this$/.test(s) || /^here$/.test(s));

    if ((has("delete") || has("clear") || has("remove")) && anyDeictic) {
      return VoiceActions._clearMulti("this");
    }

    const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
    if (m && m[2]) {
      return VoiceActions._writeMulti("this", m[2].trim());
    }

    return false;
  }

  global.VoiceActions = VoiceActions;
  global.__maybeHandleLocalVoice = __maybeHandleLocalVoice;
})(window);















// // //2/16
// (function (global) {
//   const VoiceActions = {
//     _hot: null,
//     _containerEl: null,
//     _zoom: 1,

//     init(hotInstance, containerEl) {
//       this._hot = hotInstance;
//       this._containerEl = containerEl || hotInstance.rootElement;
//       console.info("[VoiceActions] initialized");

//       // ✅ Ensure mergeCells is enabled so merges actually render
//       try {
//         const s = (this._hot && this._hot.getSettings) ? this._hot.getSettings() : {};
//         const hasMergeSetting = (s && (s.mergeCells === true || Array.isArray(s.mergeCells)));
//         if (!hasMergeSetting) {
//           this._hot.updateSettings({ mergeCells: true });
//         }
//         const plugin = this._hot.getPlugin && this._hot.getPlugin("mergeCells");
//         if (plugin && typeof plugin.enablePlugin === "function") {
//           plugin.enablePlugin();
//         }
//       } catch (e) {
//         console.warn("[VoiceActions] mergeCells enable failed", e);
//       }
//     },

//     execute(cmd) {
//       if (!cmd || !this._hot) return false;

//       // ---- Deictic fan-out aware path for deletex/write ----
//       if (cmd.action === "delete") {
//         return this._clearMulti(cmd.range);
//       }
//       if (cmd.action === "write") {
//         if (cmd.value == null) return false;
//         return this._writeMulti(cmd.range, String(cmd.value));
//       }

//       // ---- NEW actions (non-breaking extensions) ----
//       if (cmd.action === "dedupe" || cmd.action === "remove_duplicates") {
//         return this._dedupeRowsMulti(cmd.range);
//       }

//       if (cmd.action === "insert") {
//         const target   = (cmd.target || "").toLowerCase();
//         const position = (cmd.position || "before").toLowerCase();
//         const count    = Math.max(1, parseInt(cmd.count || 1, 10));
//         return this._insertAt(target, cmd.where || cmd.range || "this", position, count);
//       }

//       if (cmd.action === "fillna" || cmd.action === "fill_missing" || cmd.action === "impute") {
//         const fillVal = (cmd.value != null) ? String(cmd.value) : "N/A";
//         return this._fillMissingMulti(cmd.range, fillVal);
//       }

//       // merge aliases for convenience -> use the same merge helper
//       if (cmd.action === "merge_rows" || cmd.action === "merge_cols" || cmd.action === "merge_cells") {
//         if (!cmd.range) cmd.range = "this";
//         return this._mergeMulti(cmd.range);
//       }

//       // ---- Legacy actions (unchanged semantics) ----
//       if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
//       if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
//       if (cmd.action === "undo") return this.undo();
//       if (cmd.action === "redo") return this.redo();

//       // ✅ Merge (deictic + A1) routed through helper
//       if (cmd.action === "merge") {
//         return this._mergeMulti(cmd.range || "this");
//       }

//       if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
//       if (cmd.action === "copy") return this.copyTSV(cmd.range);
//       if (cmd.action === "paste") return this.pasteTSV(cmd.at);
//       if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

//       return false;
//     },

//     // ---------- parsing helpers ----------
//     _colLettersToIndex(colLetters) {
//       const s = String(colLetters || "").toUpperCase().trim();
//       let n = 0;
//       for (let i = 0; i < s.length; i++) {
//         const code = s.charCodeAt(i);
//         if (code < 65 || code > 90) return -1;
//         n = n * 26 + (code - 64);
//       }
//       return n - 1; // zero-based
//     },

//     _parseA1Range(a1) {
//       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
//       if (!m) return null;
//       const c1 = this._colLettersToIndex(m[1]);
//       const r1 = parseInt(m[2], 10) - 1;
//       const c2 = this._colLettersToIndex(m[3]);
//       const r2 = parseInt(m[4], 10) - 1;
//       if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
//       return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
//     },

//     _parseA1Cell(a1) {
//       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
//       if (!m) return null;
//       const c = this._colLettersToIndex(m[1]);
//       const r = parseInt(m[2], 10) - 1;
//       if (c < 0 || r < 0) return null;

//       // ✅ FIX: correct return object (prevents "remember is not defined")
//       return { r, c };
//     },

//     _rectFromA1(a1) {
//       return this._parseA1Range(a1) || this._parseA1Cell(a1);
//     },

//     _currentSelectionRect() {
//       const sel = this._hot.getSelectedLast && this._hot.getSelectedLast();
//       if (!sel) return null;
//       return { r1: Math.min(sel[0], sel[2]), c1: Math.min(sel[1], sel[3]), r2: Math.max(sel[0], sel[2]), c2: Math.max(sel[1], sel[3]) };
//     },

//     _readBothHandRects() {
//       const live = global.__handLiveRects || {};
//       const out = [];

//       const norm = (x) => {
//         if (!x) return null;

//         // If rect comes as {r,c} make it a 1x1 rect
//         if (typeof x.r === "number" && typeof x.c === "number" && (x.r1 == null || x.c1 == null)) {
//           return { r1: x.r, c1: x.c, r2: x.r, c2: x.c };
//         }

//         // If rect already has r1/c1/r2/c2, normalize ordering
//         if (typeof x.r1 === "number" && typeof x.c1 === "number" && typeof x.r2 === "number" && typeof x.c2 === "number") {
//           return {
//             r1: Math.min(x.r1, x.r2),
//             c1: Math.min(x.c1, x.c2),
//             r2: Math.max(x.r1, x.r2),
//             c2: Math.max(x.c1, x.c2),
//           };
//         }

//         return null;
//       };

//       const same = (a, b) =>
//         a && b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;

//       const L = norm(live.L);
//       const R = norm(live.R);

//       if (L) out.push(L);
//       if (R && (!out.length || !same(out[0], R))) out.push(R);

//       // fallback: HOT selection
//       // ✅ Prefer an actual multi-cell HOT selection over a single-cell hover rect
//       const cur = this._currentSelectionRect();
//       const curIsMulti = cur && !(cur.r1 === cur.r2 && cur.c1 === cur.c2);

//       if (curIsMulti) return [cur];

//       if (!out.length) {
//         if (cur) out.push(cur);
//       }
//       return out;

//     },




//     _isDeictic(s) {
//       const t = String(s || "").trim().toLowerCase();
//       return t === "this" || t === "here" || t === "there" || t === "hear" || t === "hair";
//     },

//     _resolveToRects(spec) {
//       if (!spec || this._isDeictic(spec)) {
//         return this._readBothHandRects();
//       }

//       const single = this._rectFromA1(spec);
//       if (single) {
//         if ("r2" in single) return [single];
//         return [{ r1: single.r, c1: single.c, r2: single.r, c2: single.c }];
//       }

//       if (Array.isArray(spec)) {
//         const arr = [];
//         spec.forEach(s => {
//           const r = this._rectFromA1(s);
//           if (r) {
//             if ("r2" in r) arr.push(r);
//             else arr.push({ r1: r.r, c1: r.c, r2: r.r, c2: r.c });
//           }
//         });
//         return arr;
//       }
//       return [];
//     },

//     // ---------- actions (legacy) ----------
//     select(a1) {
//       const r = this._rectFromA1(a1);
//       if (!r) return false;

//       if ("r2" in r) {
//         this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
//       } else {
//         this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
//       }
//       return true;
//     },

//     scroll(row1Based, colRef) {
//       const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
//       let col = 0;
//       if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
//       else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
//       this._hot.scrollViewportTo(row, col);
//       return true;
//     },

//     undo() {
//       const u = this._hot.getPlugin("undoRedo");
//       if (!u) return false;
//       u.undo();
//       return true;
//     },

//     redo() {
//       const u = this._hot.getPlugin("undoRedo");
//       if (!u) return false;
//       u.redo();
//       return true;
//     },

//     clearRange(a1) {
//       const r = this._rectFromA1(a1);
//       if (!r) return false;

//       if ("r2" in r) {
//         for (let i = r.r1; i <= r.r2; i++) {
//           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
//         }
//       } else {
//         this._hot.setDataAtCell(r.r, r.c, "");
//       }
//       return true;
//     },

//     // ---------- actions (BOTH hands) ----------
//     _clearMulti(rangeSpec) {
//       let rects = this._resolveToRects(rangeSpec);
//       if (!rects.length) return false;

//       rects.forEach(r=>{
//         for (let i = r.r1; i <= r.r2; i++) {
//           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
//         }
//       });

//       const last = rects[rects.length - 1];
//       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
//       return true;
//     },

//     _writeMulti(rangeSpec, value) {
//       let rects = this._resolveToRects(rangeSpec);
//       if (!rects.length) return false;

//       rects.forEach(r=>{
//         for (let i = r.r1; i <= r.r2; i++) {
//           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, value);
//         }
//       });

//       const last = rects[rects.length - 1];
//       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
//       return true;
//     },

//     // ✅ NEW: deictic + multi merge helper (same pattern as other multi helpers)
//     _mergeMulti(rangeSpec) {
//       let rects = this._resolveToRects(rangeSpec);


//       // ✅ MERGE-SPECIFIC: if "this" came from two-hand deictic, convert to ONE bounding rect
//       if (this._isDeictic(rangeSpec)) {
//         const live = global.__handLiveRects || {};
//         if (live.L && live.R) {
//           const r1 = Math.min(live.L.r1, live.R.r1);
//           const c1 = Math.min(live.L.c1, live.R.c1);
//           const r2 = Math.max(live.L.r2, live.R.r2);
//           const c2 = Math.max(live.L.c2, live.R.c2);

//           // overwrite rects to a single merge target rectangle
//           rects.length = 0;
//           rects.push({ r1, c1, r2, c2 });
//         }
//       }





//       if (!rects.length) {
//         if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Select a valid range (2+ cells) to merge.");
//         return false;
//       }

//       const plugin = this._hot.getPlugin("mergeCells");
//       if (!plugin) {
//         if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Merge is not available.");
//         return false;
//       }

//       // Ensure plugin is enabled (safe)
//       try {
//         if (typeof plugin.enablePlugin === "function") plugin.enablePlugin();
//         const s = this._hot.getSettings ? this._hot.getSettings() : {};
//         const hasMergeSetting = (s && (s.mergeCells === true || Array.isArray(s.mergeCells)));
//         if (!hasMergeSetting) this._hot.updateSettings({ mergeCells: true });
//       } catch (e) {
//         console.warn("[VoiceActions] mergeCells enable failed", e);
//       }


//       // ✅ If two hands selected two single cells, merge the bounding rectangle
//       if (rects.length >= 2 && rects.every(r => (r.r1 === r.r2 && r.c1 === r.c2))) {
//         const r1 = Math.min(...rects.map(r => r.r1));
//         const c1 = Math.min(...rects.map(r => r.c1));
//         const r2 = Math.max(...rects.map(r => r.r2));
//         const c2 = Math.max(...rects.map(r => r.c2));

//         // Only convert if it becomes a real 2+ cell rectangle
//         if (!(r1 === r2 && c1 === c2)) {
//           rects = [{ r1, c1, r2, c2 }];
//         }
//       }


//       // If every rect is a single cell, don’t report success
//       const hasAnyMultiCell = rects.some(r => !(r.r1 === r.r2 && r.c1 === r.c2));
//       if (!hasAnyMultiCell) {
//         if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Select a valid range (2+ cells) to merge.");
//         return false;
//       }

//       let mergedAny = false;

//       rects.forEach(r => {
//         // skip single-cell rects
//         if (r.r1 === r.r2 && r.c1 === r.c2) return;

//         try {
//           // ✅ Always select first (matches mouse/menu merge path)
//           this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);

//           // ✅ Prefer mergeSelection() first (most reliable across HOT builds)
//           if (typeof plugin.mergeSelection === "function") {
//             plugin.mergeSelection();
//             mergedAny = true;
//             return;
//           }

//           // fallback: some builds expose merge()
//           if (typeof plugin.merge === "function") {
//             plugin.merge(r.r1, r.c1, r.r2, r.c2);
//             mergedAny = true;
//             return;
//           }

//           console.warn("[VoiceActions] mergeCells plugin has no mergeSelection() or merge()");
//         } catch (e) {
//           console.warn("[VoiceActions] merge failed", e);
//         }
//       });


//       if (mergedAny) {
//         // keep last rect selected for user feedback
//         const last = rects[rects.length - 1];
//         this._hot.selectCells([[last.r1, last.c1, last.r2, last.c2]]);

//         // ✅ Force persistence + redraw (fixes “true but no visual merge” cases)
//         // ✅ Force persistence + redraw (compatible with older/newer HOT builds)
//         try {
//           const coll = plugin && plugin.mergedCellsCollection;

//           // Most builds store merged cells here:
//           const raw = (coll && Array.isArray(coll.mergedCells)) ? coll.mergedCells : [];

//           if (raw.length) {
//             const merges = raw.map(m => ({
//               row: m.row,
//               col: m.col,
//               rowspan: m.rowspan,
//               colspan: m.colspan
//             }));
//             this._hot.updateSettings({ mergeCells: merges });
//           } else {
//             // fallback: at least ensure mergeCells is enabled
//             this._hot.updateSettings({ mergeCells: true });
//           }
//         } catch (e) {
//           console.warn("[VoiceActions] merge persistence sync failed", e);
//         }


//         this._hot.render();
//         return true;
//       }

//       if (global.addToChatLog) global.addToChatLog("bot", "⚠️ Select a valid range (2/2+ cells) to merge.");
//       return false;
//     },

//     // A1-only merge kept for backward compatibility
//     merge(a1) {
//       const r = this._parseA1Range(a1);
//       if (!r) return false;

//       const plugin = this._hot.getPlugin("mergeCells");
//       if (!plugin) return false;

//       this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
//       try {
//         plugin.mergeSelection();
//         this._hot.render();
//         return true;
//       } catch (e) {
//         console.warn("[VoiceActions] merge failed", e);
//         return false;
//       }
//     },

//     zoom(direction = "in", step = 0.1) {
//       if (!this._containerEl) return false;
//       if (direction === "reset") this._zoom = 1;
//       else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
//       else this._zoom = Math.min(2, this._zoom + step);

//       this._containerEl.style.transformOrigin = "top left";
//       this._containerEl.style.transform = `scale(${this._zoom})`;
//       return true;
//     },

//     copyTSV(rangeA1) {
//       let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
//       if (!r) {
//         const sel = this._hot.getSelectedLast();
//         if (!sel) return false;
//         r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
//       }
//       const lines = [];
//       for (let i = r.r1; i <= r.r2; i++) {
//         const row = [];
//         for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
//         lines.push(row.join("\t"));
//       }
//       const tsv = lines.join("\n");
//       if (navigator.clipboard && navigator.clipboard.writeText) {
//         navigator.clipboard.writeText(tsv).catch(() => {});
//       }
//       return true;
//     },

//     async pasteTSV(atA1) {
//       try {
//         const txt = await navigator.clipboard.readText();
//         if (!txt) return false;

//         const start = atA1 ? this._parseA1Cell(atA1) : null;
//         let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

//         const rows = txt.split(/\r?\n/);
//         rows.forEach((line, i) => {
//           const cells = line.split("\t");
//           cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
//         });
//         return true;
//       } catch (e) {
//         console.warn("[VoiceActions] paste failed", e);
//         return false;
//       }
//     },

//     autofill(rangeA1, pattern = "repeat") {
//       const r = this._parseA1Range(rangeA1);
//       if (!r) return false;

//       const height = r.r2 - r.r1 + 1;
//       const width  = r.c2 - r.c1 + 1;

//       if (pattern === "series" && (width === 1 || height === 1)) {
//         const values = [];
//         for (let k = 0; k < (width === 1 ? height : width); k++) {
//           const v = width === 1
//             ? this._hot.getDataAtCell(r.r1 + k, r.c1)
//             : this._hot.getDataAtCell(r.r1, r.c1 + k);
//           values.push(parseFloat(v));
//         }
//         if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
//           const step = values[1] - values[0];
//           for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
//             const val = values[0] + step * idx;
//             if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
//             else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
//           }
//           return true;
//         }
//       }

//       const seed = this._hot.getDataAtCell(r.r1, r.c1);
//       for (let i = r.r1; i <= r.r2; i++) {
//         for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
//       }
//       return true;
//     },

//     // ---------- NEW helpers (append-only; do not alter existing behavior) ----------
//     _dedupeRowsMulti(rangeSpec) {
//       let rects = this._resolveToRects(rangeSpec);
//       if (!rects.length) return false;
//       const hot = this._hot;

//       rects.forEach(r => {
//         const rows = r.r2 - r.r1 + 1;
//         const cols = r.c2 - r.c1 + 1;

//         const data = [];
//         for (let i = 0; i < rows; i++) {
//           const row = [];
//           for (let j = 0; j < cols; j++) row.push(hot.getDataAtCell(r.r1 + i, r.c1 + j) ?? "");
//           data.push(row);
//         }

//         const seen = new Set();
//         const unique = [];
//         for (const row of data) {
//           const sig = row.join("\u0001");
//           if (!seen.has(sig)) {
//             seen.add(sig);
//             unique.push(row);
//           }
//         }

//         for (let i = r.r1; i <= r.r2; i++) {
//           for (let j = r.c1; j <= r.c2; j++) hot.setDataAtCell(i, j, "");
//         }

//         unique.forEach((row, i) => {
//           row.forEach((val, j) => hot.setDataAtCell(r.r1 + i, r.c1 + j, val));
//         });
//       });

//       const last = rects[rects.length - 1];
//       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
//       return true;
//     },

//     _insertAt(target, whereSpec, position = "before", count = 1) {
//       const hot = this._hot;
//       const rects = this._resolveToRects(whereSpec);
//       if (!rects.length) return false;
//       const r = rects[0];

//       try {
//         if (target === "row") {
//           const idx = (position === "after") ? (r.r2 + 1) : r.r1;
//           hot.alter("insert_row", idx, count);
//           hot.selectCell(idx, r.c1, idx + Math.max(0, count - 1), r.c1, true);
//           return true;
//         }
//         if (target === "col" || target === "column") {
//           const idx = (position === "after") ? (r.c2 + 1) : r.c1;
//           hot.alter("insert_col", idx, count);
//           hot.selectCell(r.r1, idx, r.r1, idx + Math.max(0, count - 1), true);
//           return true;
//         }
//       } catch (e) {
//         console.warn("[VoiceActions] insert failed", e);
//       }
//       return false;
//     },

//     _fillMissingMulti(rangeSpec, value) {
//       let rects = this._resolveToRects(rangeSpec);
//       if (!rects.length) return false;
//       const hot = this._hot;

//       rects.forEach(r => {
//         for (let i = r.r1; i <= r.r2; i++) {
//           for (let j = r.c1; j <= r.c2; j++) {
//             const v = hot.getDataAtCell(i, j);
//             if (v == null || v === "") hot.setDataAtCell(i, j, value);
//           }
//         }
//       });

//       const last = rects[rects.length - 1];
//       hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
//       return true;
//     },
//   };

//   function __maybeHandleLocalVoice(transcript){
//     if (!transcript) return false;
//     const s = String(transcript).trim().toLowerCase();

//     const has = (w)=>s.includes(w);
//     const anyDeictic = (has(" this") || has(" here") || has(" there") || has(" hear") || has(" hair") || /^this$/.test(s) || /^here$/.test(s));

//     if ((has("delete") || has("clear") || has("remove")) && anyDeictic) {
//       return VoiceActions._clearMulti("this");
//     }

//     const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
//     if (m && m[2]) {
//       return VoiceActions._writeMulti("this", m[2].trim());
//     }

//     return false;
//   }

//   global.VoiceActions = VoiceActions;
//   global.__maybeHandleLocalVoice = __maybeHandleLocalVoice;
// })(window);














// // //2/9

// // (function (global) {
// //   const VoiceActions = {
// //     _hot: null,
// //     _containerEl: null,
// //     _zoom: 1,

// //     init(hotInstance, containerEl) {
// //       this._hot = hotInstance;
// //       this._containerEl = containerEl || hotInstance.rootElement;
// //       console.info("[VoiceActions] initialized");
// //     },

// //     execute(cmd) {
// //       if (!cmd || !this._hot) return false;

// //       // ---- Deictic fan-out aware path for delete/write ----
// //       if (cmd.action === "delete") {
// //         // allow A1 ("A1" or "A1:C3") OR deictic ("this"/"here"/"there")
// //         return this._clearMulti(cmd.range);
// //       }
// //       if (cmd.action === "write") {
// //         // write <value> into A1 or BOTH hands when range is deictic
// //         if (cmd.value == null) return false;
// //         return this._writeMulti(cmd.range, String(cmd.value));
// //       }

// //       // ---- NEW actions (non-breaking extensions) ----
// //       // remove duplicates in the selected rows/rect (keeps first occurrence)
// //       if (cmd.action === "dedupe" || cmd.action === "remove_duplicates") {
// //         return this._dedupeRowsMulti(cmd.range);
// //       }
// //       // insert row/col relative to a deictic or A1 target
// //       if (cmd.action === "insert") {
// //         // cmd.target: "row" | "col"
// //         // cmd.position: "before" | "after" (default "before")
// //         // cmd.count: number (default 1)
// //         const target   = (cmd.target || "").toLowerCase();
// //         const position = (cmd.position || "before").toLowerCase();
// //         const count    = Math.max(1, parseInt(cmd.count || 1, 10));
// //         return this._insertAt(target, cmd.where || cmd.range || "this", position, count);
// //       }
// //       // fill missing (null/empty) cells within range with a value (default "N/A")
// //       if (cmd.action === "fillna" || cmd.action === "fill_missing" || cmd.action === "impute") {
// //         const fillVal = (cmd.value != null) ? String(cmd.value) : "N/A";
// //         return this._fillMissingMulti(cmd.range, fillVal);
// //       }
// //       // merge aliases for convenience - route through deictic merge handler
// //       if (cmd.action === "merge_rows" || cmd.action === "merge_cols" || cmd.action === "merge_cells") {
// //         if (!cmd.range) cmd.range = "this";
// //         // Use VoiceMergeHandler for deictic merges
// //         if (global.VoiceMergeHandler && global.VoiceMergeHandler.isDeicticMerge(cmd)) {
// //           return global.VoiceMergeHandler.execute(cmd);
// //         }
// //         return this.merge(cmd.range);
// //       }

// //       // ---- Legacy actions (unchanged semantics) ----
// //       if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
// //       if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
// //       if (cmd.action === "undo") return this.undo();
// //       if (cmd.action === "redo") return this.redo();
// //       // Use VoiceMergeHandler for deictic merge, fallback to legacy for A1 notation
// //       if (cmd.action === "merge") {
// //         if (global.VoiceMergeHandler && global.VoiceMergeHandler.isDeicticMerge(cmd)) {
// //           return global.VoiceMergeHandler.execute(cmd);
// //         }
// //         if (cmd.range) return this.merge(cmd.range);
// //         return false;
// //       }
// //       if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
// //       if (cmd.action === "copy") return this.copyTSV(cmd.range);
// //       if (cmd.action === "paste") return this.pasteTSV(cmd.at);
// //       if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

// //       // Defer to your page-level handlers (sum/average/sort/etc.)
// //       return false;
// //     },

// //     // ---------- parsing helpers ----------
// //     _colLettersToIndex(colLetters) {
// //       const s = String(colLetters || "").toUpperCase().trim();
// //       let n = 0;
// //       for (let i = 0; i < s.length; i++) {
// //         const code = s.charCodeAt(i);
// //         if (code < 65 || code > 90) return -1;
// //         n = n * 26 + (code - 64);
// //       }
// //       return n - 1; // zero-based
// //     },

// //     _parseA1Range(a1) {
// //       // "A1:C3" -> {r1,c1,r2,c2} zero-based
// //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
// //       if (!m) return null;
// //       const c1 = this._colLettersToIndex(m[1]);
// //       const r1 = parseInt(m[2], 10) - 1;
// //       const c2 = this._colLettersToIndex(m[3]);
// //       const r2 = parseInt(m[4], 10) - 1;
// //       if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
// //       return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
// //     },

// //     _parseA1Cell(a1) {
// //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
// //       if (!m) return null;
// //       const c = this._colLettersToIndex(m[1]);
// //       const r = parseInt(m[2], 10) - 1;
// //       if (c < 0 || r < 0) return null;
// //       return { r, c };
// //     },

// //     _rectFromA1(a1) {
// //       return this._parseA1Range(a1) || this._parseA1Cell(a1);
// //     },

// //     _currentSelectionRect() {
// //       // fallback when no hand rects and no A1 provided
// //       const sel = this._hot.getSelectedLast && this._hot.getSelectedLast();
// //       if (!sel) return null;
// //       return { r1: Math.min(sel[0], sel[2]), c1: Math.min(sel[1], sel[3]), r2: Math.max(sel[0], sel[2]), c2: Math.max(sel[1], sel[3]) };
// //     },

// //     _readBothHandRects() {
// //       // Pull from global live tracker set by deicticTargetBothHands.js
// //       const live = global.__handLiveRects || {};
// //       const out = [];
// //       const same = (a,b)=> a && b && a.r1===b.r1 && a.c1===b.c1 && a.r2===b.r2 && a.c2===b.c2;

// //       if (live.L) out.push(live.L);
// //       if (live.R && (!out.length || !same(out[0], live.R))) out.push(live.R);

// //       if (!out.length) {
// //         const cur = this._currentSelectionRect();
// //         if (cur) out.push(cur);
// //       }
// //       return out;
// //     },

// //     _isDeictic(s) {
// //       const t = String(s || "").trim().toLowerCase();
// //       return t === "this" || t === "here" || t === "there" || t === "hear" || t === "hair"; // include common ASR confusions
// //     },

// //     _resolveToRects(spec) {
// //       // Returns array of rects: [{r1,c1,r2,c2}, ...]
// //       if (!spec || this._isDeictic(spec)) {
// //         return this._readBothHandRects();
// //       }
// //       // Allow a single A1 or A1:A2
// //       const single = this._rectFromA1(spec);
// //       if (single) {
// //         if ("r2" in single) return [single];
// //         return [{ r1: single.r, c1: single.c, r2: single.r, c2: single.c }];
// //       }
// //       // Allow array of A1 strings (optional upstream feature)
// //       if (Array.isArray(spec)) {
// //         const arr = [];
// //         spec.forEach(s => {
// //           const r = this._rectFromA1(s);
// //           if (r) {
// //             if ("r2" in r) arr.push(r);
// //             else arr.push({ r1: r.r, c1: r.c, r2: r.r, c2: r.c });
// //           }
// //         });
// //         return arr;
// //       }
// //       return [];
// //     },

// //     // ---------- actions (legacy) ----------
// //     select(a1) {
// //       const r = this._rectFromA1(a1);
// //       if (!r) return false;

// //       if ("r2" in r) {
// //         this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// //       } else {
// //         this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
// //       }
// //       return true;
// //     },

// //     scroll(row1Based, colRef) {
// //       const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
// //       let col = 0;
// //       if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
// //       else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
// //       this._hot.scrollViewportTo(row, col);
// //       return true;
// //     },

// //     undo() {
// //       const u = this._hot.getPlugin("undoRedo");
// //       if (!u) return false;
// //       u.undo();
// //       return true;
// //     },

// //     redo() {
// //       const u = this._hot.getPlugin("undoRedo");
// //       if (!u) return false;
// //       u.redo();
// //       return true;
// //     },

// //     clearRange(a1) {
// //       // kept for backward compatibility (single target)
// //       const r = this._rectFromA1(a1);
// //       if (!r) return false;

// //       if ("r2" in r) {
// //         for (let i = r.r1; i <= r.r2; i++) {
// //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// //         }
// //       } else {
// //         this._hot.setDataAtCell(r.r, r.c, "");
// //       }
// //       return true;
// //     },

// //     // ---------- actions (BOTH hands) ----------
// //     _clearMulti(rangeSpec) {
// //       const rects = this._resolveToRects(rangeSpec);
// //       if (!rects.length) return false;

// //       rects.forEach(r=>{
// //         for (let i = r.r1; i <= r.r2; i++) {
// //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// //         }
// //       });
// //       // keep last rect selected for user feedback
// //       const last = rects[rects.length - 1];
// //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// //       return true;
// //     },

// //     _writeMulti(rangeSpec, value) {
// //       const rects = this._resolveToRects(rangeSpec);
// //       if (!rects.length) return false;

// //       rects.forEach(r=>{
// //         for (let i = r.r1; i <= r.r2; i++) {
// //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, value);
// //         }
// //       });
// //       const last = rects[rects.length - 1];
// //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// //       return true;
// //     },

// //     merge(a1) {
// //       const r = this._parseA1Range(a1);
// //       if (!r) return false;
// //       const plugin = this._hot.getPlugin("mergeCells");
// //       if (!plugin) return false;
// //       this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// //       try {
// //         plugin.mergeSelection();
// //         this._hot.render();
// //         return true;
// //       } catch (e) {
// //         console.warn("[VoiceActions] merge failed", e);
// //         return false;
// //       }
// //     },

// //     zoom(direction = "in", step = 0.1) {
// //       if (!this._containerEl) return false;
// //       if (direction === "reset") this._zoom = 1;
// //       else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
// //       else this._zoom = Math.min(2, this._zoom + step);

// //       this._containerEl.style.transformOrigin = "top left";
// //       this._containerEl.style.transform = `scale(${this._zoom})`;
// //       return true;
// //     },

// //     copyTSV(rangeA1) {
// //       let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
// //       if (!r) {
// //         const sel = this._hot.getSelectedLast();
// //         if (!sel) return false;
// //         r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
// //       }
// //       const lines = [];
// //       for (let i = r.r1; i <= r.r2; i++) {
// //         const row = [];
// //         for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
// //         lines.push(row.join("\t"));
// //       }
// //       const tsv = lines.join("\n");
// //       if (navigator.clipboard && navigator.clipboard.writeText) {
// //         navigator.clipboard.writeText(tsv).catch(() => {});
// //       }
// //       return true;
// //     },

// //     async pasteTSV(atA1) {
// //       try {
// //         const txt = await navigator.clipboard.readText();
// //         if (!txt) return false;

// //         const start = atA1 ? this._parseA1Cell(atA1) : null;
// //         let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

// //         const rows = txt.split(/\r?\n/);
// //         rows.forEach((line, i) => {
// //           const cells = line.split("\t");
// //           cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
// //         });
// //         return true;
// //       } catch (e) {
// //         console.warn("[VoiceActions] paste failed", e);
// //         return false;
// //       }
// //     },

// //     autofill(rangeA1, pattern = "repeat") {
// //       const r = this._parseA1Range(rangeA1);
// //       if (!r) return false;

// //       const height = r.r2 - r.r1 + 1;
// //       const width  = r.c2 - r.c1 + 1;

// //       if (pattern === "series" && (width === 1 || height === 1)) {
// //         const values = [];
// //         for (let k = 0; k < (width === 1 ? height : width); k++) {
// //           const v = width === 1
// //             ? this._hot.getDataAtCell(r.r1 + k, r.c1)
// //             : this._hot.getDataAtCell(r.r1, r.c1 + k);
// //           values.push(parseFloat(v));
// //         }
// //         if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
// //           const step = values[1] - values[0];
// //           for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
// //             const val = values[0] + step * idx;
// //             if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
// //             else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
// //           }
// //           return true;
// //         }
// //       }

// //       // repeat
// //       const seed = this._hot.getDataAtCell(r.r1, r.c1);
// //       for (let i = r.r1; i <= r.r2; i++) {
// //         for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
// //       }
// //       return true;
// //     },

// //     // ---------- NEW helpers (append-only; do not alter existing behavior) ----------
// //     _dedupeRowsMulti(rangeSpec) {
// //       const rects = this._resolveToRects(rangeSpec);
// //       if (!rects.length) return false;
// //       const hot = this._hot;

// //       rects.forEach(r => {
// //         const rows = r.r2 - r.r1 + 1;
// //         const cols = r.c2 - r.c1 + 1;

// //         // read submatrix
// //         const data = [];
// //         for (let i = 0; i < rows; i++) {
// //           const row = [];
// //           for (let j = 0; j < cols; j++) row.push(hot.getDataAtCell(r.r1 + i, r.c1 + j) ?? "");
// //           data.push(row);
// //         }

// //         // dedupe by full-row signature (keep first)
// //         const seen = new Set();
// //         const unique = [];
// //         for (const row of data) {
// //           const sig = row.join("\u0001"); // unlikely separator
// //           if (!seen.has(sig)) {
// //             seen.add(sig);
// //             unique.push(row);
// //           }
// //         }

// //         // write back unique rows
// //         // 1) clear rect
// //         for (let i = r.r1; i <= r.r2; i++) {
// //           for (let j = r.c1; j <= r.c2; j++) hot.setDataAtCell(i, j, "");
// //         }
// //         // 2) populate unique, top-aligned
// //         unique.forEach((row, i) => {
// //           row.forEach((val, j) => hot.setDataAtCell(r.r1 + i, r.c1 + j, val));
// //         });
// //       });

// //       const last = rects[rects.length - 1];
// //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// //       return true;
// //     },

// //     _insertAt(target, whereSpec, position = "before", count = 1) {
// //       const hot = this._hot;
// //       const rects = this._resolveToRects(whereSpec);
// //       if (!rects.length) return false;
// //       const r = rects[0]; // use first target for the anchor

// //       try {
// //         if (target === "row") {
// //           const idx = (position === "after") ? (r.r2 + 1) : r.r1;
// //           hot.alter("insert_row", idx, count);
// //           hot.selectCell(idx, r.c1, idx + Math.max(0, count - 1), r.c1, true);
// //           return true;
// //         }
// //         if (target === "col" || target === "column") {
// //           const idx = (position === "after") ? (r.c2 + 1) : r.c1;
// //           hot.alter("insert_col", idx, count);
// //           hot.selectCell(r.r1, idx, r.r1, idx + Math.max(0, count - 1), true);
// //           return true;
// //         }
// //       } catch (e) {
// //         console.warn("[VoiceActions] insert failed", e);
// //       }
// //       return false;
// //     },

// //     _fillMissingMulti(rangeSpec, value) {
// //       const rects = this._resolveToRects(rangeSpec);
// //       if (!rects.length) return false;
// //       const hot = this._hot;

// //       rects.forEach(r => {
// //         for (let i = r.r1; i <= r.r2; i++) {
// //           for (let j = r.c1; j <= r.c2; j++) {
// //             const v = hot.getDataAtCell(i, j);
// //             if (v == null || v === "") hot.setDataAtCell(i, j, value);
// //           }
// //         }
// //       });
// //       const last = rects[rects.length - 1];
// //       hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// //       return true;
// //     },
// //   };

// //   // Optional local voice interceptor (helps when server LLM says {"action":"none"})
// //   // In your caller (e.g., voicechat.js), run this BEFORE posting to /api/voice-command:
// //   //   if (window.__maybeHandleLocalVoice && window.__maybeHandleLocalVoice(transcript)) return;
// //   function __maybeHandleLocalVoice(transcript){
// //     if (!transcript) return false;
// //     const s = String(transcript).trim().toLowerCase();

// //     const has = (w)=>s.includes(w);
// //     const anyDeictic = (has(" this") || has(" here") || has(" there") || has(" hear") || has(" hair") || /^this$/.test(s) || /^here$/.test(s));

// //     // delete/clear this
// //     if ((has("delete") || has("clear") || has("remove")) && anyDeictic) {
// //       return VoiceActions._clearMulti("this");
// //     }

// //     // write/put/fill/set <value> ... this/here
// //     // Try to grab the token(s) right after the verb
// //     const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
// //     if (m && m[2]) {
// //       return VoiceActions._writeMulti("this", m[2].trim());
// //     }

// //     // Simple "write 50 here" without prepositions also covered above.
// //     return false;
// //   }

// //   // Expose globally
// //   global.VoiceActions = VoiceActions;
// //   global.__maybeHandleLocalVoice = __maybeHandleLocalVoice;
// // })(window);





// // // //2/9

// // // (function (global) {
// // //   const VoiceActions = {
// // //     _hot: null,
// // //     _containerEl: null,
// // //     _zoom: 1,

// // //     init(hotInstance, containerEl) {
// // //       this._hot = hotInstance;
// // //       this._containerEl = containerEl || hotInstance.rootElement;
// // //       console.info("[VoiceActions] initialized");
// // //     },

// // //     execute(cmd) {
// // //       if (!cmd || !this._hot) return false;

// // //       // ---- Deictic fan-out aware path for delete/write ----
// // //       if (cmd.action === "delete") {
// // //         // allow A1 ("A1" or "A1:C3") OR deictic ("this"/"here"/"there")
// // //         return this._clearMulti(cmd.range);
// // //       }
// // //       if (cmd.action === "write") {
// // //         // write <value> into A1 or BOTH hands when range is deictic
// // //         if (cmd.value == null) return false;
// // //         return this._writeMulti(cmd.range, String(cmd.value));
// // //       }

// // //       // ---- NEW actions (non-breaking extensions) ----
// // //       // remove duplicates in the selected rows/rect (keeps first occurrence)
// // //       if (cmd.action === "dedupe" || cmd.action === "remove_duplicates") {
// // //         return this._dedupeRowsMulti(cmd.range);
// // //       }
// // //       // insert row/col relative to a deictic or A1 target
// // //       if (cmd.action === "insert") {
// // //         // cmd.target: "row" | "col"
// // //         // cmd.position: "before" | "after" (default "before")
// // //         // cmd.count: number (default 1)
// // //         const target   = (cmd.target || "").toLowerCase();
// // //         const position = (cmd.position || "before").toLowerCase();
// // //         const count    = Math.max(1, parseInt(cmd.count || 1, 10));
// // //         return this._insertAt(target, cmd.where || cmd.range || "this", position, count);
// // //       }
// // //       // fill missing (null/empty) cells within range with a value (default "N/A")
// // //       if (cmd.action === "fillna" || cmd.action === "fill_missing" || cmd.action === "impute") {
// // //         const fillVal = (cmd.value != null) ? String(cmd.value) : "N/A";
// // //         return this._fillMissingMulti(cmd.range, fillVal);
// // //       }
// // //       // merge aliases for convenience - route through deictic merge handler
// // //       if (cmd.action === "merge_rows" || cmd.action === "merge_cols" || cmd.action === "merge_cells") {
// // //         if (!cmd.range) cmd.range = "this";
// // //         // Use VoiceMergeHandler for deictic merges
// // //         if (global.VoiceMergeHandler && global.VoiceMergeHandler.isDeicticMerge(cmd)) {
// // //           return global.VoiceMergeHandler.execute(cmd);
// // //         }
// // //         return this.merge(cmd.range);
// // //       }

// // //       // ---- Legacy actions (unchanged semantics) ----
// // //       if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
// // //       if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
// // //       if (cmd.action === "undo") return this.undo();
// // //       if (cmd.action === "redo") return this.redo();
// // //       // Use VoiceMergeHandler for deictic merge, fallback to legacy for A1 notation
// // //       if (cmd.action === "merge") {
// // //         if (global.VoiceMergeHandler && global.VoiceMergeHandler.isDeicticMerge(cmd)) {
// // //           return global.VoiceMergeHandler.execute(cmd);
// // //         }
// // //         if (cmd.range) return this.merge(cmd.range);
// // //         return false;
// // //       }
// // //       if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
// // //       if (cmd.action === "copy") return this.copyTSV(cmd.range);
// // //       if (cmd.action === "paste") return this.pasteTSV(cmd.at);
// // //       if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

// // //       // Defer to your page-level handlers (sum/average/sort/etc.)
// // //       return false;
// // //     },

// // //     // ---------- parsing helpers ----------
// // //     _colLettersToIndex(colLetters) {
// // //       const s = String(colLetters || "").toUpperCase().trim();
// // //       let n = 0;
// // //       for (let i = 0; i < s.length; i++) {
// // //         const code = s.charCodeAt(i);
// // //         if (code < 65 || code > 90) return -1;
// // //         n = n * 26 + (code - 64);
// // //       }
// // //       return n - 1; // zero-based
// // //     },

// // //     _parseA1Range(a1) {
// // //       // "A1:C3" -> {r1,c1,r2,c2} zero-based
// // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
// // //       if (!m) return null;
// // //       const c1 = this._colLettersToIndex(m[1]);
// // //       const r1 = parseInt(m[2], 10) - 1;
// // //       const c2 = this._colLettersToIndex(m[3]);
// // //       const r2 = parseInt(m[4], 10) - 1;
// // //       if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
// // //       return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
// // //     },

// // //     _parseA1Cell(a1) {
// // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
// // //       if (!m) return null;
// // //       const c = this._colLettersToIndex(m[1]);
// // //       const r = parseInt(m[2], 10) - 1;
// // //       if (c < 0 || r < 0) return null;
// // //       return { r, c };
// // //     },

// // //     _rectFromA1(a1) {
// // //       return this._parseA1Range(a1) || this._parseA1Cell(a1);
// // //     },

// // //     _currentSelectionRect() {
// // //       // fallback when no hand rects and no A1 provided
// // //       const sel = this._hot.getSelectedLast && this._hot.getSelectedLast();
// // //       if (!sel) return null;
// // //       return { r1: Math.min(sel[0], sel[2]), c1: Math.min(sel[1], sel[3]), r2: Math.max(sel[0], sel[2]), c2: Math.max(sel[1], sel[3]) };
// // //     },

// // //     _readBothHandRects() {
// // //       // Pull from global live tracker set by deicticTargetBothHands.js
// // //       const live = global.__handLiveRects || {};
// // //       const out = [];
// // //       const same = (a,b)=> a && b && a.r1===b.r1 && a.c1===b.c1 && a.r2===b.r2 && a.c2===b.c2;

// // //       if (live.L) out.push(live.L);
// // //       if (live.R && (!out.length || !same(out[0], live.R))) out.push(live.R);

// // //       if (!out.length) {
// // //         const cur = this._currentSelectionRect();
// // //         if (cur) out.push(cur);
// // //       }
// // //       return out;
// // //     },

// // //     _isDeictic(s) {
// // //       const t = String(s || "").trim().toLowerCase();
// // //       return t === "this" || t === "here" || t === "there" || t === "hear" || t === "hair"; // include common ASR confusions
// // //     },

// // //     _resolveToRects(spec) {
// // //       // Returns array of rects: [{r1,c1,r2,c2}, ...]
// // //       if (!spec || this._isDeictic(spec)) {
// // //         return this._readBothHandRects();
// // //       }
// // //       // Allow a single A1 or A1:A2
// // //       const single = this._rectFromA1(spec);
// // //       if (single) {
// // //         if ("r2" in single) return [single];
// // //         return [{ r1: single.r, c1: single.c, r2: single.r, c2: single.c }];
// // //       }
// // //       // Allow array of A1 strings (optional upstream feature)
// // //       if (Array.isArray(spec)) {
// // //         const arr = [];
// // //         spec.forEach(s => {
// // //           const r = this._rectFromA1(s);
// // //           if (r) {
// // //             if ("r2" in r) arr.push(r);
// // //             else arr.push({ r1: r.r, c1: r.c, r2: r.r, c2: r.c });
// // //           }
// // //         });
// // //         return arr;
// // //       }
// // //       return [];
// // //     },

// // //     // ---------- actions (legacy) ----------
// // //     select(a1) {
// // //       const r = this._rectFromA1(a1);
// // //       if (!r) return false;

// // //       if ("r2" in r) {
// // //         this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // //       } else {
// // //         this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
// // //       }
// // //       return true;
// // //     },

// // //     scroll(row1Based, colRef) {
// // //       const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
// // //       let col = 0;
// // //       if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
// // //       else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
// // //       this._hot.scrollViewportTo(row, col);
// // //       return true;
// // //     },

// // //     undo() {
// // //       const u = this._hot.getPlugin("undoRedo");
// // //       if (!u) return false;
// // //       u.undo();
// // //       return true;
// // //     },

// // //     redo() {
// // //       const u = this._hot.getPlugin("undoRedo");
// // //       if (!u) return false;
// // //       u.redo();
// // //       return true;
// // //     },

// // //     clearRange(a1) {
// // //       // kept for backward compatibility (single target)
// // //       const r = this._rectFromA1(a1);
// // //       if (!r) return false;

// // //       if ("r2" in r) {
// // //         for (let i = r.r1; i <= r.r2; i++) {
// // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // //         }
// // //       } else {
// // //         this._hot.setDataAtCell(r.r, r.c, "");
// // //       }
// // //       return true;
// // //     },

// // //     // ---------- actions (BOTH hands) ----------
// // //     _clearMulti(rangeSpec) {
// // //       const rects = this._resolveToRects(rangeSpec);
// // //       if (!rects.length) return false;

// // //       rects.forEach(r=>{
// // //         for (let i = r.r1; i <= r.r2; i++) {
// // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // //         }
// // //       });
// // //       // keep last rect selected for user feedback
// // //       const last = rects[rects.length - 1];
// // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // //       return true;
// // //     },

// // //     _writeMulti(rangeSpec, value) {
// // //       const rects = this._resolveToRects(rangeSpec);
// // //       if (!rects.length) return false;

// // //       rects.forEach(r=>{
// // //         for (let i = r.r1; i <= r.r2; i++) {
// // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, value);
// // //         }
// // //       });
// // //       const last = rects[rects.length - 1];
// // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // //       return true;
// // //     },

// // //     merge(a1) {
// // //       const r = this._parseA1Range(a1);
// // //       if (!r) return false;
// // //       const plugin = this._hot.getPlugin("mergeCells");
// // //       if (!plugin) return false;
// // //       this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // //       try {
// // //         plugin.mergeSelection();
// // //         this._hot.render();
// // //         return true;
// // //       } catch (e) {
// // //         console.warn("[VoiceActions] merge failed", e);
// // //         return false;
// // //       }
// // //     },

// // //     zoom(direction = "in", step = 0.1) {
// // //       if (!this._containerEl) return false;
// // //       if (direction === "reset") this._zoom = 1;
// // //       else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
// // //       else this._zoom = Math.min(2, this._zoom + step);

// // //       this._containerEl.style.transformOrigin = "top left";
// // //       this._containerEl.style.transform = `scale(${this._zoom})`;
// // //       return true;
// // //     },

// // //     copyTSV(rangeA1) {
// // //       let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
// // //       if (!r) {
// // //         const sel = this._hot.getSelectedLast();
// // //         if (!sel) return false;
// // //         r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
// // //       }
// // //       const lines = [];
// // //       for (let i = r.r1; i <= r.r2; i++) {
// // //         const row = [];
// // //         for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
// // //         lines.push(row.join("\t"));
// // //       }
// // //       const tsv = lines.join("\n");
// // //       if (navigator.clipboard && navigator.clipboard.writeText) {
// // //         navigator.clipboard.writeText(tsv).catch(() => {});
// // //       }
// // //       return true;
// // //     },

// // //     async pasteTSV(atA1) {
// // //       try {
// // //         const txt = await navigator.clipboard.readText();
// // //         if (!txt) return false;

// // //         const start = atA1 ? this._parseA1Cell(atA1) : null;
// // //         let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

// // //         const rows = txt.split(/\r?\n/);
// // //         rows.forEach((line, i) => {
// // //           const cells = line.split("\t");
// // //           cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
// // //         });
// // //         return true;
// // //       } catch (e) {
// // //         console.warn("[VoiceActions] paste failed", e);
// // //         return false;
// // //       }
// // //     },

// // //     autofill(rangeA1, pattern = "repeat") {
// // //       const r = this._parseA1Range(rangeA1);
// // //       if (!r) return false;

// // //       const height = r.r2 - r.r1 + 1;
// // //       const width  = r.c2 - r.c1 + 1;

// // //       if (pattern === "series" && (width === 1 || height === 1)) {
// // //         const values = [];
// // //         for (let k = 0; k < (width === 1 ? height : width); k++) {
// // //           const v = width === 1
// // //             ? this._hot.getDataAtCell(r.r1 + k, r.c1)
// // //             : this._hot.getDataAtCell(r.r1, r.c1 + k);
// // //           values.push(parseFloat(v));
// // //         }
// // //         if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
// // //           const step = values[1] - values[0];
// // //           for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
// // //             const val = values[0] + step * idx;
// // //             if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
// // //             else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
// // //           }
// // //           return true;
// // //         }
// // //       }

// // //       // repeat
// // //       const seed = this._hot.getDataAtCell(r.r1, r.c1);
// // //       for (let i = r.r1; i <= r.r2; i++) {
// // //         for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
// // //       }
// // //       return true;
// // //     },

// // //     // ---------- NEW helpers (append-only; do not alter existing behavior) ----------
// // //     _dedupeRowsMulti(rangeSpec) {
// // //       const rects = this._resolveToRects(rangeSpec);
// // //       if (!rects.length) return false;
// // //       const hot = this._hot;

// // //       rects.forEach(r => {
// // //         const rows = r.r2 - r.r1 + 1;
// // //         const cols = r.c2 - r.c1 + 1;

// // //         // read submatrix
// // //         const data = [];
// // //         for (let i = 0; i < rows; i++) {
// // //           const row = [];
// // //           for (let j = 0; j < cols; j++) row.push(hot.getDataAtCell(r.r1 + i, r.c1 + j) ?? "");
// // //           data.push(row);
// // //         }

// // //         // dedupe by full-row signature (keep first)
// // //         const seen = new Set();
// // //         const unique = [];
// // //         for (const row of data) {
// // //           const sig = row.join("\u0001"); // unlikely separator
// // //           if (!seen.has(sig)) {
// // //             seen.add(sig);
// // //             unique.push(row);
// // //           }
// // //         }

// // //         // write back unique rows
// // //         // 1) clear rect
// // //         for (let i = r.r1; i <= r.r2; i++) {
// // //           for (let j = r.c1; j <= r.c2; j++) hot.setDataAtCell(i, j, "");
// // //         }
// // //         // 2) populate unique, top-aligned
// // //         unique.forEach((row, i) => {
// // //           row.forEach((val, j) => hot.setDataAtCell(r.r1 + i, r.c1 + j, val));
// // //         });
// // //       });

// // //       const last = rects[rects.length - 1];
// // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // //       return true;
// // //     },

// // //     _insertAt(target, whereSpec, position = "before", count = 1) {
// // //       const hot = this._hot;
// // //       const rects = this._resolveToRects(whereSpec);
// // //       if (!rects.length) return false;
// // //       const r = rects[0]; // use first target for the anchor

// // //       try {
// // //         if (target === "row") {
// // //           const idx = (position === "after") ? (r.r2 + 1) : r.r1;
// // //           hot.alter("insert_row", idx, count);
// // //           hot.selectCell(idx, r.c1, idx + Math.max(0, count - 1), r.c1, true);
// // //           return true;
// // //         }
// // //         if (target === "col" || target === "column") {
// // //           const idx = (position === "after") ? (r.c2 + 1) : r.c1;
// // //           hot.alter("insert_col", idx, count);
// // //           hot.selectCell(r.r1, idx, r.r1, idx + Math.max(0, count - 1), true);
// // //           return true;
// // //         }
// // //       } catch (e) {
// // //         console.warn("[VoiceActions] insert failed", e);
// // //       }
// // //       return false;
// // //     },

// // //     _fillMissingMulti(rangeSpec, value) {
// // //       const rects = this._resolveToRects(rangeSpec);
// // //       if (!rects.length) return false;
// // //       const hot = this._hot;

// // //       rects.forEach(r => {
// // //         for (let i = r.r1; i <= r.r2; i++) {
// // //           for (let j = r.c1; j <= r.c2; j++) {
// // //             const v = hot.getDataAtCell(i, j);
// // //             if (v == null || v === "") hot.setDataAtCell(i, j, value);
// // //           }
// // //         }
// // //       });
// // //       const last = rects[rects.length - 1];
// // //       hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // //       return true;
// // //     },
// // //   };

// // //   // Optional local voice interceptor (helps when server LLM says {"action":"none"})
// // //   // In your caller (e.g., voicechat.js), run this BEFORE posting to /api/voice-command:
// // //   //   if (window.__maybeHandleLocalVoice && window.__maybeHandleLocalVoice(transcript)) return;
// // //   function __maybeHandleLocalVoice(transcript){
// // //     if (!transcript) return false;
// // //     const s = String(transcript).trim().toLowerCase();

// // //     const has = (w)=>s.includes(w);
// // //     const anyDeictic = (has(" this") || has(" here") || has(" there") || has(" hear") || has(" hair") || /^this$/.test(s) || /^here$/.test(s));

// // //     // delete/clear this
// // //     if ((has("delete") || has("clear") || has("remove")) && anyDeictic) {
// // //       return VoiceActions._clearMulti("this");
// // //     }

// // //     // write/put/fill/set <value> ... this/here
// // //     // Try to grab the token(s) right after the verb
// // //     const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
// // //     if (m && m[2]) {
// // //       return VoiceActions._writeMulti("this", m[2].trim());
// // //     }

// // //     // Simple "write 50 here" without prepositions also covered above.
// // //     return false;
// // //   }

// // //   // Expose globally
// // //   global.VoiceActions = VoiceActions;
// // //   global.__maybeHandleLocalVoice = __maybeHandleLocalVoice;
// // // })(window);


















// // // // (function (global) {
// // // //   const VoiceActions = {
// // // //     _hot: null,
// // // //     _containerEl: null,
// // // //     _zoom: 1,

// // // //     init(hotInstance, containerEl) {
// // // //       this._hot = hotInstance;
// // // //       this._containerEl = containerEl || hotInstance.rootElement;
// // // //       console.info("[VoiceActions] initialized");
// // // //     },

// // // //     execute(cmd) {
// // // //       if (!cmd || !this._hot) return false;

// // // //       // ---- Deictic fan-out aware path for delete/write ----
// // // //       if (cmd.action === "delete") {
// // // //         // allow A1 ("A1" or "A1:C3") OR deictic ("this"/"here"/"there")
// // // //         return this._clearMulti(cmd.range);
// // // //       }
// // // //       if (cmd.action === "write") {
// // // //         // write <value> into A1 or BOTH hands when range is deictic
// // // //         if (cmd.value == null) return false;
// // // //         return this._writeMulti(cmd.range, String(cmd.value));
// // // //       }

// // // //       // ---- NEW actions (non-breaking extensions) ----
// // // //       // remove duplicates in the selected rows/rect (keeps first occurrence)
// // // //       if (cmd.action === "dedupe" || cmd.action === "remove_duplicates") {
// // // //         return this._dedupeRowsMulti(cmd.range);
// // // //       }
// // // //       // insert row/col relative to a deictic or A1 target
// // // //       if (cmd.action === "insert") {
// // // //         // cmd.target: "row" | "col"
// // // //         // cmd.position: "before" | "after" (default "before")
// // // //         // cmd.count: number (default 1)
// // // //         const target   = (cmd.target || "").toLowerCase();
// // // //         const position = (cmd.position || "before").toLowerCase();
// // // //         const count    = Math.max(1, parseInt(cmd.count || 1, 10));
// // // //         return this._insertAt(target, cmd.where || cmd.range || "this", position, count);
// // // //       }
// // // //       // fill missing (null/empty) cells within range with a value (default "N/A")
// // // //       if (cmd.action === "fillna" || cmd.action === "fill_missing" || cmd.action === "impute") {
// // // //         const fillVal = (cmd.value != null) ? String(cmd.value) : "N/A";
// // // //         return this._fillMissingMulti(cmd.range, fillVal);
// // // //       }
// // // //       // merge aliases for convenience
// // // //       if (cmd.action === "merge_rows" || cmd.action === "merge_cols" || cmd.action === "merge_cells") {
// // // //         if (!cmd.range) cmd.range = "this";
// // // //         return this.merge(cmd.range);
// // // //       }

// // // //       // ---- Legacy actions (unchanged semantics) ----
// // // //       if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
// // // //       if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
// // // //       if (cmd.action === "undo") return this.undo();
// // // //       if (cmd.action === "redo") return this.redo();
// // // //       if (cmd.action === "merge" && cmd.range) return this.merge(cmd.range);
// // // //       if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
// // // //       if (cmd.action === "copy") return this.copyTSV(cmd.range);
// // // //       if (cmd.action === "paste") return this.pasteTSV(cmd.at);
// // // //       if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

// // // //       // Defer to your page-level handlers (sum/average/sort/etc.)
// // // //       return false;
// // // //     },

// // // //     // ---------- parsing helpers ----------
// // // //     _colLettersToIndex(colLetters) {
// // // //       const s = String(colLetters || "").toUpperCase().trim();
// // // //       let n = 0;
// // // //       for (let i = 0; i < s.length; i++) {
// // // //         const code = s.charCodeAt(i);
// // // //         if (code < 65 || code > 90) return -1;
// // // //         n = n * 26 + (code - 64);
// // // //       }
// // // //       return n - 1; // zero-based
// // // //     },

// // // //     _parseA1Range(a1) {
// // // //       // "A1:C3" -> {r1,c1,r2,c2} zero-based
// // // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
// // // //       if (!m) return null;
// // // //       const c1 = this._colLettersToIndex(m[1]);
// // // //       const r1 = parseInt(m[2], 10) - 1;
// // // //       const c2 = this._colLettersToIndex(m[3]);
// // // //       const r2 = parseInt(m[4], 10) - 1;
// // // //       if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
// // // //       return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
// // // //     },

// // // //     _parseA1Cell(a1) {
// // // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
// // // //       if (!m) return null;
// // // //       const c = this._colLettersToIndex(m[1]);
// // // //       const r = parseInt(m[2], 10) - 1;
// // // //       if (c < 0 || r < 0) return null;
// // // //       return { r, c };
// // // //     },

// // // //     _rectFromA1(a1) {
// // // //       return this._parseA1Range(a1) || this._parseA1Cell(a1);
// // // //     },

// // // //     _currentSelectionRect() {
// // // //       // fallback when no hand rects and no A1 provided
// // // //       const sel = this._hot.getSelectedLast && this._hot.getSelectedLast();
// // // //       if (!sel) return null;
// // // //       return { r1: Math.min(sel[0], sel[2]), c1: Math.min(sel[1], sel[3]), r2: Math.max(sel[0], sel[2]), c2: Math.max(sel[1], sel[3]) };
// // // //     },

// // // //     _readBothHandRects() {
// // // //       // Pull from global live tracker set by deicticTargetBothHands.js
// // // //       const live = global.__handLiveRects || {};
// // // //       const out = [];
// // // //       const same = (a,b)=> a && b && a.r1===b.r1 && a.c1===b.c1 && a.r2===b.r2 && a.c2===b.c2;

// // // //       if (live.L) out.push(live.L);
// // // //       if (live.R && (!out.length || !same(out[0], live.R))) out.push(live.R);

// // // //       if (!out.length) {
// // // //         const cur = this._currentSelectionRect();
// // // //         if (cur) out.push(cur);
// // // //       }
// // // //       return out;
// // // //     },

// // // //     _isDeictic(s) {
// // // //       const t = String(s || "").trim().toLowerCase();
// // // //       return t === "this" || t === "here" || t === "there" || t === "hear" || t === "hair"; // include common ASR confusions
// // // //     },

// // // //     _resolveToRects(spec) {
// // // //       // Returns array of rects: [{r1,c1,r2,c2}, ...]
// // // //       if (!spec || this._isDeictic(spec)) {
// // // //         return this._readBothHandRects();
// // // //       }
// // // //       // Allow a single A1 or A1:A2
// // // //       const single = this._rectFromA1(spec);
// // // //       if (single) {
// // // //         if ("r2" in single) return [single];
// // // //         return [{ r1: single.r, c1: single.c, r2: single.r, c2: single.c }];
// // // //       }
// // // //       // Allow array of A1 strings (optional upstream feature)
// // // //       if (Array.isArray(spec)) {
// // // //         const arr = [];
// // // //         spec.forEach(s => {
// // // //           const r = this._rectFromA1(s);
// // // //           if (r) {
// // // //             if ("r2" in r) arr.push(r);
// // // //             else arr.push({ r1: r.r, c1: r.c, r2: r.r, c2: r.c });
// // // //           }
// // // //         });
// // // //         return arr;
// // // //       }
// // // //       return [];
// // // //     },

// // // //     // ---------- actions (legacy) ----------
// // // //     select(a1) {
// // // //       const r = this._rectFromA1(a1);
// // // //       if (!r) return false;

// // // //       if ("r2" in r) {
// // // //         this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // // //       } else {
// // // //         this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
// // // //       }
// // // //       return true;
// // // //     },

// // // //     scroll(row1Based, colRef) {
// // // //       const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
// // // //       let col = 0;
// // // //       if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
// // // //       else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
// // // //       this._hot.scrollViewportTo(row, col);
// // // //       return true;
// // // //     },

// // // //     undo() {
// // // //       const u = this._hot.getPlugin("undoRedo");
// // // //       if (!u) return false;
// // // //       u.undo();
// // // //       return true;
// // // //     },

// // // //     redo() {
// // // //       const u = this._hot.getPlugin("undoRedo");
// // // //       if (!u) return false;
// // // //       u.redo();
// // // //       return true;
// // // //     },

// // // //     clearRange(a1) {
// // // //       // kept for backward compatibility (single target)
// // // //       const r = this._rectFromA1(a1);
// // // //       if (!r) return false;

// // // //       if ("r2" in r) {
// // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // // //         }
// // // //       } else {
// // // //         this._hot.setDataAtCell(r.r, r.c, "");
// // // //       }
// // // //       return true;
// // // //     },

// // // //     // ---------- actions (BOTH hands) ----------
// // // //     _clearMulti(rangeSpec) {
// // // //       const rects = this._resolveToRects(rangeSpec);
// // // //       if (!rects.length) return false;

// // // //       rects.forEach(r=>{
// // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // // //         }
// // // //       });
// // // //       // keep last rect selected for user feedback
// // // //       const last = rects[rects.length - 1];
// // // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // // //       return true;
// // // //     },

// // // //     _writeMulti(rangeSpec, value) {
// // // //       const rects = this._resolveToRects(rangeSpec);
// // // //       if (!rects.length) return false;

// // // //       rects.forEach(r=>{
// // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, value);
// // // //         }
// // // //       });
// // // //       const last = rects[rects.length - 1];
// // // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // // //       return true;
// // // //     },

// // // //     merge(a1) {
// // // //       const r = this._parseA1Range(a1);
// // // //       if (!r) return false;
// // // //       const plugin = this._hot.getPlugin("mergeCells");
// // // //       if (!plugin) return false;
// // // //       this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // // //       try {
// // // //         plugin.mergeSelection();
// // // //         this._hot.render();
// // // //         return true;
// // // //       } catch (e) {
// // // //         console.warn("[VoiceActions] merge failed", e);
// // // //         return false;
// // // //       }
// // // //     },

// // // //     zoom(direction = "in", step = 0.1) {
// // // //       if (!this._containerEl) return false;
// // // //       if (direction === "reset") this._zoom = 1;
// // // //       else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
// // // //       else this._zoom = Math.min(2, this._zoom + step);

// // // //       this._containerEl.style.transformOrigin = "top left";
// // // //       this._containerEl.style.transform = `scale(${this._zoom})`;
// // // //       return true;
// // // //     },

// // // //     copyTSV(rangeA1) {
// // // //       let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
// // // //       if (!r) {
// // // //         const sel = this._hot.getSelectedLast();
// // // //         if (!sel) return false;
// // // //         r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
// // // //       }
// // // //       const lines = [];
// // // //       for (let i = r.r1; i <= r.r2; i++) {
// // // //         const row = [];
// // // //         for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
// // // //         lines.push(row.join("\t"));
// // // //       }
// // // //       const tsv = lines.join("\n");
// // // //       if (navigator.clipboard && navigator.clipboard.writeText) {
// // // //         navigator.clipboard.writeText(tsv).catch(() => {});
// // // //       }
// // // //       return true;
// // // //     },

// // // //     async pasteTSV(atA1) {
// // // //       try {
// // // //         const txt = await navigator.clipboard.readText();
// // // //         if (!txt) return false;

// // // //         const start = atA1 ? this._parseA1Cell(atA1) : null;
// // // //         let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

// // // //         const rows = txt.split(/\r?\n/);
// // // //         rows.forEach((line, i) => {
// // // //           const cells = line.split("\t");
// // // //           cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
// // // //         });
// // // //         return true;
// // // //       } catch (e) {
// // // //         console.warn("[VoiceActions] paste failed", e);
// // // //         return false;
// // // //       }
// // // //     },

// // // //     autofill(rangeA1, pattern = "repeat") {
// // // //       const r = this._parseA1Range(rangeA1);
// // // //       if (!r) return false;

// // // //       const height = r.r2 - r.r1 + 1;
// // // //       const width  = r.c2 - r.c1 + 1;

// // // //       if (pattern === "series" && (width === 1 || height === 1)) {
// // // //         const values = [];
// // // //         for (let k = 0; k < (width === 1 ? height : width); k++) {
// // // //           const v = width === 1
// // // //             ? this._hot.getDataAtCell(r.r1 + k, r.c1)
// // // //             : this._hot.getDataAtCell(r.r1, r.c1 + k);
// // // //           values.push(parseFloat(v));
// // // //         }
// // // //         if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
// // // //           const step = values[1] - values[0];
// // // //           for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
// // // //             const val = values[0] + step * idx;
// // // //             if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
// // // //             else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
// // // //           }
// // // //           return true;
// // // //         }
// // // //       }

// // // //       // repeat
// // // //       const seed = this._hot.getDataAtCell(r.r1, r.c1);
// // // //       for (let i = r.r1; i <= r.r2; i++) {
// // // //         for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
// // // //       }
// // // //       return true;
// // // //     },

// // // //     // ---------- NEW helpers (append-only; do not alter existing behavior) ----------
// // // //     _dedupeRowsMulti(rangeSpec) {
// // // //       const rects = this._resolveToRects(rangeSpec);
// // // //       if (!rects.length) return false;
// // // //       const hot = this._hot;

// // // //       rects.forEach(r => {
// // // //         const rows = r.r2 - r.r1 + 1;
// // // //         const cols = r.c2 - r.c1 + 1;

// // // //         // read submatrix
// // // //         const data = [];
// // // //         for (let i = 0; i < rows; i++) {
// // // //           const row = [];
// // // //           for (let j = 0; j < cols; j++) row.push(hot.getDataAtCell(r.r1 + i, r.c1 + j) ?? "");
// // // //           data.push(row);
// // // //         }

// // // //         // dedupe by full-row signature (keep first)
// // // //         const seen = new Set();
// // // //         const unique = [];
// // // //         for (const row of data) {
// // // //           const sig = row.join("\u0001"); // unlikely separator
// // // //           if (!seen.has(sig)) {
// // // //             seen.add(sig);
// // // //             unique.push(row);
// // // //           }
// // // //         }

// // // //         // write back unique rows
// // // //         // 1) clear rect
// // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // //           for (let j = r.c1; j <= r.c2; j++) hot.setDataAtCell(i, j, "");
// // // //         }
// // // //         // 2) populate unique, top-aligned
// // // //         unique.forEach((row, i) => {
// // // //           row.forEach((val, j) => hot.setDataAtCell(r.r1 + i, r.c1 + j, val));
// // // //         });
// // // //       });

// // // //       const last = rects[rects.length - 1];
// // // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // // //       return true;
// // // //     },

// // // //     _insertAt(target, whereSpec, position = "before", count = 1) {
// // // //       const hot = this._hot;
// // // //       const rects = this._resolveToRects(whereSpec);
// // // //       if (!rects.length) return false;
// // // //       const r = rects[0]; // use first target for the anchor

// // // //       try {
// // // //         if (target === "row") {
// // // //           const idx = (position === "after") ? (r.r2 + 1) : r.r1;
// // // //           hot.alter("insert_row", idx, count);
// // // //           hot.selectCell(idx, r.c1, idx + Math.max(0, count - 1), r.c1, true);
// // // //           return true;
// // // //         }
// // // //         if (target === "col" || target === "column") {
// // // //           const idx = (position === "after") ? (r.c2 + 1) : r.c1;
// // // //           hot.alter("insert_col", idx, count);
// // // //           hot.selectCell(r.r1, idx, r.r1, idx + Math.max(0, count - 1), true);
// // // //           return true;
// // // //         }
// // // //       } catch (e) {
// // // //         console.warn("[VoiceActions] insert failed", e);
// // // //       }
// // // //       return false;
// // // //     },

// // // //     _fillMissingMulti(rangeSpec, value) {
// // // //       const rects = this._resolveToRects(rangeSpec);
// // // //       if (!rects.length) return false;
// // // //       const hot = this._hot;

// // // //       rects.forEach(r => {
// // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // //           for (let j = r.c1; j <= r.c2; j++) {
// // // //             const v = hot.getDataAtCell(i, j);
// // // //             if (v == null || v === "") hot.setDataAtCell(i, j, value);
// // // //           }
// // // //         }
// // // //       });
// // // //       const last = rects[rects.length - 1];
// // // //       hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // // //       return true;
// // // //     },
// // // //   };

// // // //   // Optional local voice interceptor (helps when server LLM says {"action":"none"})
// // // //   // In your caller (e.g., voicechat.js), run this BEFORE posting to /api/voice-command:
// // // //   //   if (window.__maybeHandleLocalVoice && window.__maybeHandleLocalVoice(transcript)) return;
// // // //   function __maybeHandleLocalVoice(transcript){
// // // //     if (!transcript) return false;
// // // //     const s = String(transcript).trim().toLowerCase();

// // // //     const has = (w)=>s.includes(w);
// // // //     const anyDeictic = (has(" this") || has(" here") || has(" there") || has(" hear") || has(" hair") || /^this$/.test(s) || /^here$/.test(s));

// // // //     // delete/clear this
// // // //     if ((has("delete") || has("clear") || has("remove")) && anyDeictic) {
// // // //       return VoiceActions._clearMulti("this");
// // // //     }

// // // //     // write/put/fill/set <value> ... this/here
// // // //     // Try to grab the token(s) right after the verb
// // // //     const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
// // // //     if (m && m[2]) {
// // // //       return VoiceActions._writeMulti("this", m[2].trim());
// // // //     }

// // // //     // Simple "write 50 here" without prepositions also covered above.
// // // //     return false;
// // // //   }

// // // //   // Expose globally
// // // //   global.VoiceActions = VoiceActions;
// // // //   global.__maybeHandleLocalVoice = __maybeHandleLocalVoice;
// // // // })(window);













// // // // // /* static/js/voiceActions.js
// // // // //  * Thin action layer for Handsontable actions triggered by voice.
// // // // //  * NOW WITH: deictic fan-out to BOTH hands ("this"/"here"/"there") using window.__handLiveRects.
// // // // //  *
// // // // //  * Exposes:
// // // // //  *  - VoiceActions.init(hot, containerEl)
// // // // //  *  - VoiceActions.execute(cmd)            // accepts A1 or "this"/"here"/"there"
// // // // //  *  - window.__maybeHandleLocalVoice(str)  // optional: parse "delete this", "write 50 here" locally
// // // // //  */

// // // // // (function (global) {
// // // // //   const VoiceActions = {
// // // // //     _hot: null,
// // // // //     _containerEl: null,
// // // // //     _zoom: 1,

// // // // //     init(hotInstance, containerEl) {
// // // // //       this._hot = hotInstance;
// // // // //       this._containerEl = containerEl || hotInstance.rootElement;
// // // // //       console.info("[VoiceActions] initialized");
// // // // //     },

// // // // //     execute(cmd) {
// // // // //       if (!cmd || !this._hot) return false;

// // // // //       // ---- Deictic fan-out aware path for delete/write ----
// // // // //       if (cmd.action === "delete") {
// // // // //         // allow A1 ("A1" or "A1:C3") OR deictic ("this"/"here"/"there")
// // // // //         return this._clearMulti(cmd.range);
// // // // //       }
// // // // //       if (cmd.action === "write") {
// // // // //         // write <value> into A1 or BOTH hands when range is deictic
// // // // //         if (cmd.value == null) return false;
// // // // //         return this._writeMulti(cmd.range, String(cmd.value));
// // // // //       }

// // // // //       // ---- Legacy actions (unchanged semantics) ----
// // // // //       if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
// // // // //       if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
// // // // //       if (cmd.action === "undo") return this.undo();
// // // // //       if (cmd.action === "redo") return this.redo();
// // // // //       if (cmd.action === "merge" && cmd.range) return this.merge(cmd.range);
// // // // //       if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
// // // // //       if (cmd.action === "copy") return this.copyTSV(cmd.range);
// // // // //       if (cmd.action === "paste") return this.pasteTSV(cmd.at);
// // // // //       if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

// // // // //       // Defer to your page-level handlers (sum/average/sort/etc.)
// // // // //       return false;
// // // // //     },

// // // // //     // ---------- parsing helpers ----------
// // // // //     _colLettersToIndex(colLetters) {
// // // // //       const s = String(colLetters || "").toUpperCase().trim();
// // // // //       let n = 0;
// // // // //       for (let i = 0; i < s.length; i++) {
// // // // //         const code = s.charCodeAt(i);
// // // // //         if (code < 65 || code > 90) return -1;
// // // // //         n = n * 26 + (code - 64);
// // // // //       }
// // // // //       return n - 1; // zero-based
// // // // //     },

// // // // //     _parseA1Range(a1) {
// // // // //       // "A1:C3" -> {r1,c1,r2,c2} zero-based
// // // // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
// // // // //       if (!m) return null;
// // // // //       const c1 = this._colLettersToIndex(m[1]);
// // // // //       const r1 = parseInt(m[2], 10) - 1;
// // // // //       const c2 = this._colLettersToIndex(m[3]);
// // // // //       const r2 = parseInt(m[4], 10) - 1;
// // // // //       if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
// // // // //       return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
// // // // //     },

// // // // //     _parseA1Cell(a1) {
// // // // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
// // // // //       if (!m) return null;
// // // // //       const c = this._colLettersToIndex(m[1]);
// // // // //       const r = parseInt(m[2], 10) - 1;
// // // // //       if (c < 0 || r < 0) return null;
// // // // //       return { r, c };
// // // // //     },

// // // // //     _rectFromA1(a1) {
// // // // //       return this._parseA1Range(a1) || this._parseA1Cell(a1);
// // // // //     },

// // // // //     _currentSelectionRect() {
// // // // //       // fallback when no hand rects and no A1 provided
// // // // //       const sel = this._hot.getSelectedLast && this._hot.getSelectedLast();
// // // // //       if (!sel) return null;
// // // // //       return { r1: Math.min(sel[0], sel[2]), c1: Math.min(sel[1], sel[3]), r2: Math.max(sel[0], sel[2]), c2: Math.max(sel[1], sel[3]) };
// // // // //     },

// // // // //     _readBothHandRects() {
// // // // //       // Pull from global live tracker set by deicticTargetBothHands.js
// // // // //       const live = global.__handLiveRects || {};
// // // // //       const out = [];
// // // // //       const same = (a,b)=> a && b && a.r1===b.r1 && a.c1===b.c1 && a.r2===b.r2 && a.c2===b.c2;

// // // // //       if (live.L) out.push(live.L);
// // // // //       if (live.R && (!out.length || !same(out[0], live.R))) out.push(live.R);

// // // // //       if (!out.length) {
// // // // //         const cur = this._currentSelectionRect();
// // // // //         if (cur) out.push(cur);
// // // // //       }
// // // // //       return out;
// // // // //     },

// // // // //     _isDeictic(s) {
// // // // //       const t = String(s || "").trim().toLowerCase();
// // // // //       return t === "this" || t === "here" || t === "there" || t === "hear" || t === "hair"; // include common ASR confusions
// // // // //     },

// // // // //     _resolveToRects(spec) {
// // // // //       // Returns array of rects: [{r1,c1,r2,c2}, ...]
// // // // //       if (!spec || this._isDeictic(spec)) {
// // // // //         return this._readBothHandRects();
// // // // //       }
// // // // //       // Allow a single A1 or A1:A2
// // // // //       const single = this._rectFromA1(spec);
// // // // //       if (single) {
// // // // //         if ("r2" in single) return [single];
// // // // //         return [{ r1: single.r, c1: single.c, r2: single.r, c2: single.c }];
// // // // //       }
// // // // //       // Allow array of A1 strings (optional upstream feature)
// // // // //       if (Array.isArray(spec)) {
// // // // //         const arr = [];
// // // // //         spec.forEach(s => {
// // // // //           const r = this._rectFromA1(s);
// // // // //           if (r) {
// // // // //             if ("r2" in r) arr.push(r);
// // // // //             else arr.push({ r1: r.r, c1: r.c, r2: r.r, c2: r.c });
// // // // //           }
// // // // //         });
// // // // //         return arr;
// // // // //       }
// // // // //       return [];
// // // // //     },

// // // // //     // ---------- actions (legacy) ----------
// // // // //     select(a1) {
// // // // //       const r = this._rectFromA1(a1);
// // // // //       if (!r) return false;

// // // // //       if ("r2" in r) {
// // // // //         this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // // // //       } else {
// // // // //         this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
// // // // //       }
// // // // //       return true;
// // // // //     },

// // // // //     scroll(row1Based, colRef) {
// // // // //       const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
// // // // //       let col = 0;
// // // // //       if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
// // // // //       else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
// // // // //       this._hot.scrollViewportTo(row, col);
// // // // //       return true;
// // // // //     },

// // // // //     undo() {
// // // // //       const u = this._hot.getPlugin("undoRedo");
// // // // //       if (!u) return false;
// // // // //       u.undo();
// // // // //       return true;
// // // // //     },

// // // // //     redo() {
// // // // //       const u = this._hot.getPlugin("undoRedo");
// // // // //       if (!u) return false;
// // // // //       u.redo();
// // // // //       return true;
// // // // //     },

// // // // //     clearRange(a1) {
// // // // //       // kept for backward compatibility (single target)
// // // // //       const r = this._rectFromA1(a1);
// // // // //       if (!r) return false;

// // // // //       if ("r2" in r) {
// // // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // // // //         }
// // // // //       } else {
// // // // //         this._hot.setDataAtCell(r.r, r.c, "");
// // // // //       }
// // // // //       return true;
// // // // //     },

// // // // //     // ---------- actions (BOTH hands) ----------
// // // // //     _clearMulti(rangeSpec) {
// // // // //       const rects = this._resolveToRects(rangeSpec);
// // // // //       if (!rects.length) return false;

// // // // //       rects.forEach(r=>{
// // // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // // // //         }
// // // // //       });
// // // // //       // keep last rect selected for user feedback
// // // // //       const last = rects[rects.length - 1];
// // // // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // // // //       return true;
// // // // //     },

// // // // //     _writeMulti(rangeSpec, value) {
// // // // //       const rects = this._resolveToRects(rangeSpec);
// // // // //       if (!rects.length) return false;

// // // // //       rects.forEach(r=>{
// // // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, value);
// // // // //         }
// // // // //       });
// // // // //       const last = rects[rects.length - 1];
// // // // //       this._hot.selectCell(last.r1, last.c1, last.r2, last.c2, true);
// // // // //       return true;
// // // // //     },

// // // // //     merge(a1) {
// // // // //       const r = this._parseA1Range(a1);
// // // // //       if (!r) return false;
// // // // //       const plugin = this._hot.getPlugin("mergeCells");
// // // // //       if (!plugin) return false;
// // // // //       this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // // // //       try {
// // // // //         plugin.mergeSelection();
// // // // //         this._hot.render();
// // // // //         return true;
// // // // //       } catch (e) {
// // // // //         console.warn("[VoiceActions] merge failed", e);
// // // // //         return false;
// // // // //       }
// // // // //     },

// // // // //     zoom(direction = "in", step = 0.1) {
// // // // //       if (!this._containerEl) return false;
// // // // //       if (direction === "reset") this._zoom = 1;
// // // // //       else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
// // // // //       else this._zoom = Math.min(2, this._zoom + step);

// // // // //       this._containerEl.style.transformOrigin = "top left";
// // // // //       this._containerEl.style.transform = `scale(${this._zoom})`;
// // // // //       return true;
// // // // //     },

// // // // //     copyTSV(rangeA1) {
// // // // //       let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
// // // // //       if (!r) {
// // // // //         const sel = this._hot.getSelectedLast();
// // // // //         if (!sel) return false;
// // // // //         r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
// // // // //       }
// // // // //       const lines = [];
// // // // //       for (let i = r.r1; i <= r.r2; i++) {
// // // // //         const row = [];
// // // // //         for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
// // // // //         lines.push(row.join("\t"));
// // // // //       }
// // // // //       const tsv = lines.join("\n");
// // // // //       if (navigator.clipboard && navigator.clipboard.writeText) {
// // // // //         navigator.clipboard.writeText(tsv).catch(() => {});
// // // // //       }
// // // // //       return true;
// // // // //     },

// // // // //     async pasteTSV(atA1) {
// // // // //       try {
// // // // //         const txt = await navigator.clipboard.readText();
// // // // //         if (!txt) return false;

// // // // //         const start = atA1 ? this._parseA1Cell(atA1) : null;
// // // // //         let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

// // // // //         const rows = txt.split(/\r?\n/);
// // // // //         rows.forEach((line, i) => {
// // // // //           const cells = line.split("\t");
// // // // //           cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
// // // // //         });
// // // // //         return true;
// // // // //       } catch (e) {
// // // // //         console.warn("[VoiceActions] paste failed", e);
// // // // //         return false;
// // // // //       }
// // // // //     },

// // // // //     autofill(rangeA1, pattern = "repeat") {
// // // // //       const r = this._parseA1Range(rangeA1);
// // // // //       if (!r) return false;

// // // // //       const height = r.r2 - r.r1 + 1;
// // // // //       const width  = r.c2 - r.c1 + 1;

// // // // //       if (pattern === "series" && (width === 1 || height === 1)) {
// // // // //         const values = [];
// // // // //         for (let k = 0; k < (width === 1 ? height : width); k++) {
// // // // //           const v = width === 1
// // // // //             ? this._hot.getDataAtCell(r.r1 + k, r.c1)
// // // // //             : this._hot.getDataAtCell(r.r1, r.c1 + k);
// // // // //           values.push(parseFloat(v));
// // // // //         }
// // // // //         if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
// // // // //           const step = values[1] - values[0];
// // // // //           for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
// // // // //             const val = values[0] + step * idx;
// // // // //             if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
// // // // //             else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
// // // // //           }
// // // // //           return true;
// // // // //         }
// // // // //       }

// // // // //       // repeat
// // // // //       const seed = this._hot.getDataAtCell(r.r1, r.c1);
// // // // //       for (let i = r.r1; i <= r.r2; i++) {
// // // // //         for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
// // // // //       }
// // // // //       return true;
// // // // //     },
// // // // //   };

// // // // //   // Optional local voice interceptor (helps when server LLM says {"action":"none"})
// // // // //   // In your caller (e.g., voicechat.js), run this BEFORE posting to /api/voice-command:
// // // // //   //   if (window.__maybeHandleLocalVoice && window.__maybeHandleLocalVoice(transcript)) return;
// // // // //   function __maybeHandleLocalVoice(transcript){
// // // // //     if (!transcript) return false;
// // // // //     const s = String(transcript).trim().toLowerCase();

// // // // //     const has = (w)=>s.includes(w);
// // // // //     const anyDeictic = (has(" this") || has(" here") || has(" there") || has(" hear") || has(" hair") || /^this$/.test(s) || /^here$/.test(s));

// // // // //     // delete/clear this
// // // // //     if ((has("delete") || has("clear") || has("remove")) && anyDeictic) {
// // // // //       return VoiceActions._clearMulti("this");
// // // // //     }

// // // // //     // write/put/fill/set <value> ... this/here
// // // // //     // Try to grab the token(s) right after the verb
// // // // //     const m = s.match(/\b(write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on)?\s*(this|here|there|hear|hair)\b/);
// // // // //     if (m && m[2]) {
// // // // //       return VoiceActions._writeMulti("this", m[2].trim());
// // // // //     }

// // // // //     // Simple "write 50 here" without prepositions also covered above.
// // // // //     return false;
// // // // //   }

// // // // //   // Expose globally
// // // // //   global.VoiceActions = VoiceActions;
// // // // //   global.__maybeHandleLocalVoice = __maybeHandleLocalVoice;
// // // // // })(window);










// // // // // /* static/js/voiceActions.js
// // // // //  * Thin action layer for Handsontable actions triggered by voice.
// // // // //  * No UI changes; just call VoiceActions.execute(cmd) with the parsed JSON.
// // // // //  *
// // // // //  * Supported actions (cmd.action):
// // // // //  * - "select"  { range:"A1:C3" }
// // // // //  * - "scroll"  { row: <1-based>, col: <A1 letters OR 1-based> }
// // // // //  * - "undo"    {}
// // // // //  * - "redo"    {}
// // // // //  * - "delete"  { range:"A1:C3" }  // clears contents
// // // // //  * - "merge"   { range:"A1:C3" }
// // // // //  * - "zoom"    { direction:"in|out|reset", step:0.1 }  // optional step
// // // // //  * - "copy"    { range:"A1:C3" }  // if omitted, uses current selection
// // // // //  * - "paste"   { at:"B7" }        // pastes clipboard text (TSV) at top-left
// // // // //  * - "autofill"{ range:"A1:A10", pattern:"series|repeat" } // simple behaviors
// // // // //  *
// // // // //  * This file doesn’t rely on your backend. It only needs a live `hot` instance.
// // // // //  */

// // // // // (function (global) {
// // // // //   const VoiceActions = {
// // // // //     _hot: null,
// // // // //     _containerEl: null,
// // // // //     _zoom: 1,

// // // // //     init(hotInstance, containerEl) {
// // // // //       this._hot = hotInstance;
// // // // //       this._containerEl = containerEl || hotInstance.rootElement;
// // // // //       console.info("[VoiceActions] initialized");
// // // // //     },

// // // // //     execute(cmd) {
// // // // //       if (!cmd || !this._hot) return false;

// // // // //       // Maintain backward compatibility with your existing actions
// // // // //       if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
// // // // //       if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
// // // // //       if (cmd.action === "undo") return this.undo();
// // // // //       if (cmd.action === "redo") return this.redo();
// // // // //       if (cmd.action === "delete" && cmd.range) return this.clearRange(cmd.range);
// // // // //       if (cmd.action === "merge" && cmd.range) return this.merge(cmd.range);
// // // // //       if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
// // // // //       if (cmd.action === "copy") return this.copyTSV(cmd.range);
// // // // //       if (cmd.action === "paste") return this.pasteTSV(cmd.at);
// // // // //       if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

// // // // //       // Defer to your existing handlers (sum/average/write/sort) in view.html
// // // // //       return false;
// // // // //     },

// // // // //     // ---------- helpers ----------
// // // // //     _colLettersToIndex(colLetters) {
// // // // //       const s = String(colLetters || "").toUpperCase().trim();
// // // // //       let n = 0;
// // // // //       for (let i = 0; i < s.length; i++) {
// // // // //         const code = s.charCodeAt(i);
// // // // //         if (code < 65 || code > 90) return -1;
// // // // //         n = n * 26 + (code - 64);
// // // // //       }
// // // // //       return n - 1; // zero-based
// // // // //     },

// // // // //     _parseA1Range(a1) {
// // // // //       // "A1:C3" -> {r1,c1,r2,c2} zero-based
// // // // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i);
// // // // //       if (!m) return null;
// // // // //       const c1 = this._colLettersToIndex(m[1]);
// // // // //       const r1 = parseInt(m[2], 10) - 1;
// // // // //       const c2 = this._colLettersToIndex(m[3]);
// // // // //       const r2 = parseInt(m[4], 10) - 1;
// // // // //       if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return null;
// // // // //       return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
// // // // //     },

// // // // //     _parseA1Cell(a1) {
// // // // //       const m = String(a1).match(/^\s*([A-Z]+)(\d+)\s*$/i);
// // // // //       if (!m) return null;
// // // // //       const c = this._colLettersToIndex(m[1]);
// // // // //       const r = parseInt(m[2], 10) - 1;
// // // // //       if (c < 0 || r < 0) return null;
// // // // //       return { r, c };
// // // // //     },

// // // // //     // ---------- actions ----------
// // // // //     select(a1) {
// // // // //       const r = this._parseA1Range(a1) || this._parseA1Cell(a1);
// // // // //       if (!r) return false;

// // // // //       if ("r2" in r) {
// // // // //         this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // // // //       } else {
// // // // //         this._hot.selectCell(r.r, r.c, r.r, r.c, true, true);
// // // // //       }
// // // // //       return true;
// // // // //     },

// // // // //     scroll(row1Based, colRef) {
// // // // //       const row = row1Based ? Math.max(0, parseInt(row1Based, 10) - 1) : 0;
// // // // //       let col = 0;
// // // // //       if (typeof colRef === "string") col = this._colLettersToIndex(colRef);
// // // // //       else if (typeof colRef === "number") col = Math.max(0, colRef - 1);
// // // // //       this._hot.scrollViewportTo(row, col);
// // // // //       return true;
// // // // //     },

// // // // //     undo() {
// // // // //       const u = this._hot.getPlugin("undoRedo");
// // // // //       if (!u) return false;
// // // // //       u.undo();
// // // // //       return true;
// // // // //     },

// // // // //     redo() {
// // // // //       const u = this._hot.getPlugin("undoRedo");
// // // // //       if (!u) return false;
// // // // //       u.redo();
// // // // //       return true;
// // // // //     },

// // // // //     clearRange(a1) {
// // // // //       const r = this._parseA1Range(a1) || this._parseA1Cell(a1);
// // // // //       if (!r) return false;

// // // // //       if ("r2" in r) {
// // // // //         for (let i = r.r1; i <= r.r2; i++) {
// // // // //           for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
// // // // //         }
// // // // //       } else {
// // // // //         this._hot.setDataAtCell(r.r, r.c, "");
// // // // //       }
// // // // //       return true;
// // // // //     },

// // // // //     merge(a1) {
// // // // //       const r = this._parseA1Range(a1);
// // // // //       if (!r) return false;
// // // // //       const plugin = this._hot.getPlugin("mergeCells");
// // // // //       if (!plugin) return false;
// // // // //       // If nothing selected, select then merge
// // // // //       this._hot.selectCells([[r.r1, r.c1, r.r2, r.c2]]);
// // // // //       try {
// // // // //         plugin.mergeSelection();
// // // // //         this._hot.render();
// // // // //         return true;
// // // // //       } catch (e) {
// // // // //         console.warn("[VoiceActions] merge failed", e);
// // // // //         return false;
// // // // //       }
// // // // //     },

// // // // //     zoom(direction = "in", step = 0.1) {
// // // // //       if (!this._containerEl) return false;
// // // // //       if (direction === "reset") this._zoom = 1;
// // // // //       else if (direction === "out") this._zoom = Math.max(0.5, this._zoom - step);
// // // // //       else this._zoom = Math.min(2, this._zoom + step);

// // // // //       this._containerEl.style.transformOrigin = "top left";
// // // // //       this._containerEl.style.transform = `scale(${this._zoom})`;
// // // // //       return true;
// // // // //     },

// // // // //     copyTSV(rangeA1) {
// // // // //       // Gather selection or the specified range
// // // // //       let r = rangeA1 ? this._parseA1Range(rangeA1) : null;
// // // // //       if (!r) {
// // // // //         const sel = this._hot.getSelectedLast();
// // // // //         if (!sel) return false;
// // // // //         r = { r1: sel[0], c1: sel[1], r2: sel[2], c2: sel[3] };
// // // // //       }
// // // // //       const lines = [];
// // // // //       for (let i = r.r1; i <= r.r2; i++) {
// // // // //         const row = [];
// // // // //         for (let j = r.c1; j <= r.c2; j++) row.push(this._hot.getDataAtCell(i, j) ?? "");
// // // // //         lines.push(row.join("\t"));
// // // // //       }
// // // // //       const tsv = lines.join("\n");
// // // // //       if (navigator.clipboard && navigator.clipboard.writeText) {
// // // // //         navigator.clipboard.writeText(tsv).catch(() => {});
// // // // //       }
// // // // //       return true;
// // // // //     },

// // // // //     async pasteTSV(atA1) {
// // // // //       try {
// // // // //         const txt = await navigator.clipboard.readText();
// // // // //         if (!txt) return false;

// // // // //         const start = atA1 ? this._parseA1Cell(atA1) : null;
// // // // //         let { r: r0, c: c0 } = start || (this._hot.getSelectedLast() ? { r: this._hot.getSelectedLast()[0], c: this._hot.getSelectedLast()[1] } : { r: 0, c: 0 });

// // // // //         const rows = txt.split(/\r?\n/);
// // // // //         rows.forEach((line, i) => {
// // // // //           const cells = line.split("\t");
// // // // //           cells.forEach((val, j) => this._hot.setDataAtCell(r0 + i, c0 + j, val));
// // // // //         });
// // // // //         return true;
// // // // //       } catch (e) {
// // // // //         console.warn("[VoiceActions] paste failed", e);
// // // // //         return false;
// // // // //       }
// // // // //     },

// // // // //     autofill(rangeA1, pattern = "repeat") {
// // // // //       const r = this._parseA1Range(rangeA1);
// // // // //       if (!r) return false;

// // // // //       // Simple behaviors:
// // // // //       // - "repeat": fill everything with the top-left cell value
// // // // //       // - "series": if first two cells in the column are numbers, extend linear series
// // // // //       const height = r.r2 - r.r1 + 1;
// // // // //       const width = r.c2 - r.c1 + 1;

// // // // //       if (pattern === "series" && (width === 1 || height === 1)) {
// // // // //         // 1D series
// // // // //         const values = [];
// // // // //         for (let k = 0; k < (width === 1 ? height : width); k++) {
// // // // //           const v = width === 1
// // // // //             ? this._hot.getDataAtCell(r.r1 + k, r.c1)
// // // // //             : this._hot.getDataAtCell(r.r1, r.c1 + k);
// // // // //           values.push(parseFloat(v));
// // // // //         }
// // // // //         if (values.length >= 2 && values.every((x) => !Number.isNaN(x))) {
// // // // //           const step = values[1] - values[0];
// // // // //           for (let idx = 0; idx < (width === 1 ? height : width); idx++) {
// // // // //             const val = values[0] + step * idx;
// // // // //             if (width === 1) this._hot.setDataAtCell(r.r1 + idx, r.c1, val);
// // // // //             else this._hot.setDataAtCell(r.r1, r.c1 + idx, val);
// // // // //           }
// // // // //           return true;
// // // // //         }
// // // // //         // Fallback to repeat if not numeric series
// // // // //       }

// // // // //       // repeat
// // // // //       const seed = this._hot.getDataAtCell(r.r1, r.c1);
// // // // //       for (let i = r.r1; i <= r.r2; i++) {
// // // // //         for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
// // // // //       }
// // // // //       return true;
// // // // //     },
// // // // //   };

// // // // //   // Expose globally
// // // // //   global.VoiceActions = VoiceActions;
// // // // // })(window);
