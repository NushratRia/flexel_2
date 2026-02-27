(function (global) {
  "use strict";

  function normalizeRange(r1, c1, r2, c2) {
    const nr1 = Math.min(r1, r2);
    const nr2 = Math.max(r1, r2);
    const nc1 = Math.min(c1, c2);
    const nc2 = Math.max(c1, c2);
    return { r1: nr1, c1: nc1, r2: nr2, c2: nc2 };
  }

  function getLastSelectionRange(hot) {
    // Prefer getSelectedRangeLast if available
    if (typeof hot.getSelectedRangeLast === "function") {
      const sr = hot.getSelectedRangeLast();
      if (!sr) return null;
      const from = sr.from;
      const to = sr.to;
      return normalizeRange(from.row, from.col, to.row, to.col);
    }

    // Fallback: getSelectedLast -> [r1,c1,r2,c2]
    if (typeof hot.getSelectedLast === "function") {
      const s = hot.getSelectedLast();
      if (!s || s.length < 4) return null;
      return normalizeRange(s[0], s[1], s[2], s[3]);
    }

    // Fallback: getSelected -> can return multiple ranges; take last
    if (typeof hot.getSelected === "function") {
      const sels = hot.getSelected();
      if (!sels || sels.length === 0) return null;
      const s = sels[sels.length - 1];
      if (!s || s.length < 4) return null;
      return normalizeRange(s[0], s[1], s[2], s[3]);
    }

    return null;
  }

  function isMergeableSelection(range) {
    if (!range) return false;
    const { r1, c1, r2, c2 } = range;
    // must include at least 2 cells
    const rowspan = r2 - r1 + 1;
    const colspan = c2 - c1 + 1;
    return rowspan * colspan >= 2;
  }

  global.FlexeeMergeSelection = {
    getLastSelectionRange,
    isMergeableSelection
  };
})(window);
