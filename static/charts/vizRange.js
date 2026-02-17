// static/vizRange.js
(function (global) {
  function colToIndex(colLetters) {
    let n = 0;
    const s = String(colLetters).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      n = n * 26 + (s.charCodeAt(i) - 64);
    }
    return n - 1; // 0-based
  }

  function parseA1(a1) {
    // e.g., A1, B12, AA7
    const m = String(a1).trim().match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
  }

  function parseA1Range(rng) {
    // e.g., A1:A9, B2:D10
    const s = String(rng).trim().toUpperCase();
    const parts = s.split(':');
    if (parts.length === 1) {
      const p = parseA1(parts[0]);
      if (!p) return null;
      return { r1: p.row, c1: p.col, r2: p.row, c2: p.col };
    }
    if (parts.length === 2) {
      const p1 = parseA1(parts[0]);
      const p2 = parseA1(parts[1]);
      if (!p1 || !p2) return null;
      return {
        r1: Math.min(p1.row, p2.row),
        c1: Math.min(p1.col, p2.col),
        r2: Math.max(p1.row, p2.row),
        c2: Math.max(p1.col, p2.col),
      };
    }
    return null;
  }

  function getHotInstance() {
    // Try common globals without changing your structure
    return global.hot || global.HOT || global.handsontable || null;
  }

  function getSelectedRangeRect(hot) {
    try {
      const sel = hot.getSelectedRangeLast && hot.getSelectedRangeLast();
      if (!sel) return null;
      // Handsontable returns {from:{row,col}, to:{row,col}}
      const r1 = Math.min(sel.from.row, sel.to.row);
      const r2 = Math.max(sel.from.row, sel.to.row);
      const c1 = Math.min(sel.from.col, sel.to.col);
      const c2 = Math.max(sel.from.col, sel.to.col);
      return { r1, c1, r2, c2 };
    } catch (e) {
      return null;
    }
  }

  function extractSeriesFromRect(hot, rect) {
    // We’ll chart the first numeric column we find in the rect
    const { r1, c1, r2, c2 } = rect;

    // label column: if multiple cols, first col used as label if non-numeric
    // value column: first numeric column scanning left->right
    let valueCol = null;

    for (let c = c1; c <= c2; c++) {
      let numericCount = 0;
      let total = 0;
      for (let r = r1; r <= r2; r++) {
        const v = hot.getDataAtCell(r, c);
        const num = (typeof v === "number") ? v : parseFloat(String(v).replace(/,/g, ""));
        if (!Number.isNaN(num) && Number.isFinite(num)) numericCount++;
        total++;
      }
      if (numericCount >= Math.max(2, Math.floor(total * 0.5))) {
        valueCol = c;
        break;
      }
    }

    if (valueCol == null) {
      return { labels: [], values: [], error: "No numeric column found in that range." };
    }

    const labels = [];
    const values = [];

    for (let r = r1; r <= r2; r++) {
      const rawVal = hot.getDataAtCell(r, valueCol);
      const val = (typeof rawVal === "number") ? rawVal : parseFloat(String(rawVal).replace(/,/g, ""));
      if (Number.isNaN(val) || !Number.isFinite(val)) continue;

      let label = `Row ${r + 1}`;
      if (c2 > c1 && valueCol !== c1) {
        const rawLab = hot.getDataAtCell(r, c1);
        if (rawLab != null && String(rawLab).trim() !== "") label = String(rawLab).trim();
      }
      labels.push(label);
      values.push(val);
    }

    if (!values.length) return { labels: [], values: [], error: "No numeric values to plot." };
    return { labels, values, error: null };
  }

  global.FlexeeVizRange = {
    parseA1Range,
    getHotInstance,
    getSelectedRangeRect,
    extractSeriesFromRect
  };
})(window);
