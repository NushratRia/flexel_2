// static/vizVoiceHandler.js
(function (global) {
  const RE_VIS = /\b(visuali[sz]e|chart|plot|bar\s*chart|bar\s*plot|graph)\b/i;
  const RE_BAR = /\bbar\s*chart|bar\s*plot\b/i;
  const RE_RANGE = /\b([A-Za-z]{1,3}\d+)\s*(?::|to|through|thru|-)\s*([A-Za-z]{1,3}\d+)\b/i;
  const RE_SINGLE = /\b([A-Za-z]{1,3}\d+)\b/;
  const RE_THESE = /\b(these|this|selection|selected|here)\b/i;

  function normalizeTranscript(t) {
    return String(t || "").trim();
  }

  function runVisualizationFromSelection(hot, titleHint) {
    const rect = global.FlexeeVizRange.getSelectedRangeRect(hot);
    if (!rect) {
      global.FlexeeVizPanel.bar({
        title: "Chart",
        meta: "No selection found. Select a range, then say “visualize these”.",
        labels: [" "],
        values: [0]
      });
      return true;
    }

    const { labels, values, error } = global.FlexeeVizRange.extractSeriesFromRect(hot, rect);
    if (error) {
      global.FlexeeVizPanel.bar({
        title: "Chart",
        meta: error,
        labels: [" "],
        values: [0]
      });
      return true;
    }

    global.FlexeeVizPanel.bar({
      title: titleHint || "Bar Chart (Selection)",
      meta: `Rows ${rect.r1 + 1}-${rect.r2 + 1}`,
      labels,
      values
    });
    return true;
  }

  function runVisualizationFromRangeText(hot, rangeText, titleHint) {
    const rect = global.FlexeeVizRange.parseA1Range(rangeText);
    if (!rect) return false;

    const { labels, values, error } = global.FlexeeVizRange.extractSeriesFromRect(hot, rect);
    if (error) {
      global.FlexeeVizPanel.bar({
        title: "Chart",
        meta: error,
        labels: [" "],
        values: [0]
      });
      return true;
    }

    global.FlexeeVizPanel.bar({
      title: titleHint || `Bar Chart (${rangeText.toUpperCase()})`,
      meta: rangeText.toUpperCase(),
      labels,
      values
    });
    return true;
  }

  function handle(transcript) {
    console.log("[VIZ] handle got:", transcript);
    const t = normalizeTranscript(transcript);
    if (!t) return false;
    if (!RE_VIS.test(t)) return false; // only act on viz-like commands

    const hot = global.FlexeeVizRange.getHotInstance();
    if (!hot || !hot.getDataAtCell) {
      console.warn("[FlexeeViz] Handsontable instance not found as window.hot (or similar).");
      return false;
    }

    const wantsBar = RE_BAR.test(t) || /\bbar\b/i.test(t);

    // Priority 1: explicit range A1:A9
    const mRange = t.match(RE_RANGE);
    if (mRange) {
      return runVisualizationFromRangeText(hot, `${mRange[1]}:${mRange[2]}`, wantsBar ? "Bar Chart" : "Chart");
    }

    // Priority 2: "visualize A1" (single cell → single bar)
    const mSingle = t.match(RE_SINGLE);
    if (mSingle && /\bvisuali[sz]e\b/i.test(t)) {
      return runVisualizationFromRangeText(hot, `${mSingle[1]}:${mSingle[1]}`, wantsBar ? "Bar Chart" : "Chart");
    }

    // Priority 3: "visualize these/selection"
    if (RE_THESE.test(t)) {
      return runVisualizationFromSelection(hot, wantsBar ? "Bar Chart (Selection)" : "Chart (Selection)");
    }

    // fallback: if command says visualize but no range, try selection anyway
    return runVisualizationFromSelection(hot, wantsBar ? "Bar Chart (Selection)" : "Chart (Selection)");
  }

  // expose
  global.FlexeeVizVoice = { handle };
})(window);
