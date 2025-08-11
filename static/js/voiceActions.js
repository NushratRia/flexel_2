/* static/js/voiceActions.js
 * Thin action layer for Handsontable actions triggered by voice.
 * No UI changes; just call VoiceActions.execute(cmd) with the parsed JSON.
 *
 * Supported actions (cmd.action):
 * - "select"  { range:"A1:C3" }
 * - "scroll"  { row: <1-based>, col: <A1 letters OR 1-based> }
 * - "undo"    {}
 * - "redo"    {}
 * - "delete"  { range:"A1:C3" }  // clears contents
 * - "merge"   { range:"A1:C3" }
 * - "zoom"    { direction:"in|out|reset", step:0.1 }  // optional step
 * - "copy"    { range:"A1:C3" }  // if omitted, uses current selection
 * - "paste"   { at:"B7" }        // pastes clipboard text (TSV) at top-left
 * - "autofill"{ range:"A1:A10", pattern:"series|repeat" } // simple behaviors
 *
 * This file doesn’t rely on your backend. It only needs a live `hot` instance.
 */

(function (global) {
  const VoiceActions = {
    _hot: null,
    _containerEl: null,
    _zoom: 1,

    init(hotInstance, containerEl) {
      this._hot = hotInstance;
      this._containerEl = containerEl || hotInstance.rootElement;
      console.info("[VoiceActions] initialized");
    },

    execute(cmd) {
      if (!cmd || !this._hot) return false;

      // Maintain backward compatibility with your existing actions
      if (cmd.action === "select" && cmd.range) return this.select(cmd.range);
      if (cmd.action === "scroll") return this.scroll(cmd.row, cmd.col);
      if (cmd.action === "undo") return this.undo();
      if (cmd.action === "redo") return this.redo();
      if (cmd.action === "delete" && cmd.range) return this.clearRange(cmd.range);
      if (cmd.action === "merge" && cmd.range) return this.merge(cmd.range);
      if (cmd.action === "zoom") return this.zoom(cmd.direction, cmd.step);
      if (cmd.action === "copy") return this.copyTSV(cmd.range);
      if (cmd.action === "paste") return this.pasteTSV(cmd.at);
      if (cmd.action === "autofill") return this.autofill(cmd.range, cmd.pattern);

      // Defer to your existing handlers (sum/average/write/sort) in view.html
      return false;
    },

    // ---------- helpers ----------
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
      // "A1:C3" -> {r1,c1,r2,c2} zero-based
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
      return { r, c };
    },

    // ---------- actions ----------
    select(a1) {
      const r = this._parseA1Range(a1) || this._parseA1Cell(a1);
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
      const r = this._parseA1Range(a1) || this._parseA1Cell(a1);
      if (!r) return false;

      if ("r2" in r) {
        for (let i = r.r1; i <= r.r2; i++) {
          for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, "");
        }
      } else {
        this._hot.setDataAtCell(r.r, r.c, "");
      }
      return true;
    },

    merge(a1) {
      const r = this._parseA1Range(a1);
      if (!r) return false;
      const plugin = this._hot.getPlugin("mergeCells");
      if (!plugin) return false;
      // If nothing selected, select then merge
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
      // Gather selection or the specified range
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

      // Simple behaviors:
      // - "repeat": fill everything with the top-left cell value
      // - "series": if first two cells in the column are numbers, extend linear series
      const height = r.r2 - r.r1 + 1;
      const width = r.c2 - r.c1 + 1;

      if (pattern === "series" && (width === 1 || height === 1)) {
        // 1D series
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
        // Fallback to repeat if not numeric series
      }

      // repeat
      const seed = this._hot.getDataAtCell(r.r1, r.c1);
      for (let i = r.r1; i <= r.r2; i++) {
        for (let j = r.c1; j <= r.c2; j++) this._hot.setDataAtCell(i, j, seed);
      }
      return true;
    },
  };

  // Expose globally
  global.VoiceActions = VoiceActions;
})(window);
