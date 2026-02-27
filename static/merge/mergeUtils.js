(function (global) {
  "use strict";

  function isEmptyValue(v) {
    // Treat null/undefined/"" as empty. Whitespace-only string also empty.
    if (v === null || v === undefined) return true;
    if (typeof v === "string" && v.trim() === "") return true;
    return false;
  }

  function getCellValue(hot, r, c) {
    // Handsontable: getDataAtCell returns underlying data
    return hot.getDataAtCell(r, c);
  }

  function setCellValue(hot, r, c, value) {
    hot.setDataAtCell(r, c, value, "voice-merge");
  }

  function clearRangeExceptTopLeft(hot, range) {
    const { r1, c1, r2, c2 } = range;
    hot.batch(() => {
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          if (r === r1 && c === c1) continue;
          setCellValue(hot, r, c, "");
        }
      }
    });
  }

  function countNonEmptyAndFirstValue(hot, range) {
    const { r1, c1, r2, c2 } = range;

    let nonEmptyCount = 0;
    let firstNonEmpty = null; // {r,c,value}
    let topLeftValue = getCellValue(hot, r1, c1);

    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = getCellValue(hot, r, c);
        if (!isEmptyValue(v)) {
          nonEmptyCount++;
          if (!firstNonEmpty) firstNonEmpty = { r, c, value: v };
        }
      }
    }

    return { nonEmptyCount, firstNonEmpty, topLeftValue };
  }

  function moveSingleValueToTopLeftIfNeeded(hot, range) {
    const { r1, c1 } = range;
    const { nonEmptyCount, firstNonEmpty } = countNonEmptyAndFirstValue(hot, range);

    if (nonEmptyCount === 0) {
      // nothing to move
      return { moved: false, valueToKeep: "" };
    }

    if (nonEmptyCount === 1 && firstNonEmpty) {
      // ensure value ends up at top-left
      const valueToKeep = firstNonEmpty.value;
      hot.batch(() => {
        setCellValue(hot, r1, c1, valueToKeep);
        // clear others (including original cell if not top-left)
        clearRangeExceptTopLeft(hot, range);
      });
      return { moved: true, valueToKeep };
    }

    // If multiple values, do not move automatically (warning will handle)
    return { moved: false, valueToKeep: getCellValue(hot, r1, c1) };
  }

  global.FlexeeMergeUtils = {
    isEmptyValue,
    countNonEmptyAndFirstValue,
    moveSingleValueToTopLeftIfNeeded,
    clearRangeExceptTopLeft
  };
})(window);
