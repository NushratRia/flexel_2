(function (global) {
  "use strict";

  function ensureMergePlugin(hot) {
    // Handsontable requires mergeCells plugin enabled in settings.
    // If it is already enabled, getPlugin will work.
    // If not enabled, we try to enable it (non-breaking attempt).
    try {
      const plugin = hot.getPlugin && hot.getPlugin("mergeCells");
      if (plugin) return plugin;
    } catch (e) {}

    // Attempt to enable without restructuring (safe try)
    try {
      if (typeof hot.updateSettings === "function") {
        hot.updateSettings({ mergeCells: true }, false);
        const plugin2 = hot.getPlugin("mergeCells");
        return plugin2 || null;
      }
    } catch (e) {}

    return null;
  }

  function mergeRange(hot, range) {
    const { r1, c1, r2, c2 } = range;
    const rowspan = r2 - r1 + 1;
    const colspan = c2 - c1 + 1;

    const plugin = ensureMergePlugin(hot);
    if (!plugin || typeof plugin.merge !== "function") {
      console.warn("[merge] mergeCells plugin not available/enabled.");
      return false;
    }

    // Optional: if range overlaps existing merged cells, unmerge first (prevents weirdness)
    try {
      if (typeof plugin.unmergeSelection === "function") {
        hot.selectCell(r1, c1, r2, c2, false);
        plugin.unmergeSelection();
      }
    } catch (e) {}

    try {
      plugin.merge(r1, c1, rowspan, colspan);
      return true;
    } catch (e) {
      console.warn("[merge] plugin.merge failed:", e);
      return false;
    }
  }

  function runMerge(hot) {
    if (!hot) {
      console.warn("[merge] hot instance missing");
      return;
    }

    const Sel = global.FlexeeMergeSelection;
    const U = global.FlexeeMergeUtils;
    const Modal = global.FlexeeMergeWarningModal;

    if (!Sel || !U || !Modal) {
      console.warn("[merge] missing modules", { Sel, U, Modal });
      return;
    }

    const range = Sel.getLastSelectionRange(hot);
    console.debug("[merge] selection range:", range);

    if (!Sel.isMergeableSelection(range)) {
      console.debug("[merge] selection not mergeable (need >=2 cells).");
      return;
    }

    const info = U.countNonEmptyAndFirstValue(hot, range);
    console.debug("[merge] nonEmptyCount:", info.nonEmptyCount, "topLeft:", info.topLeftValue);

    const doMerge = () => {
      // If exactly 1 non-empty anywhere, move it to top-left and clear others.
      // If 0 non-empty, just clear others (already empty).
      // If multiple non-empty, we preserve only top-left (Sheets behavior):
      //   keep top-left as-is, clear all others in range.
      hot.batch(() => {
        if (info.nonEmptyCount === 1) {
          U.moveSingleValueToTopLeftIfNeeded(hot, range);
        } else {
          // preserve top-left only
          U.clearRangeExceptTopLeft(hot, range);
        }
      });

      const ok = mergeRange(hot, range);
      if (ok) {
        try { hot.render(); } catch (e) {}
        console.debug("[merge] merge applied");
      }
    };

    if (info.nonEmptyCount >= 2 && !Modal.shouldSuppressWarning()) {
      Modal.openMergeWarning({
        onOk: doMerge,
        onCancel: () => console.debug("[merge] user cancelled")
      });
      return;
    }

    // no warning needed
    doMerge();
  }

  global.FlexeeMerge = {
    runMerge
  };
})(window);
