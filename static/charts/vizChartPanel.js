// static/charts/vizChartPanel.js
(function (global) {
  function $(id) { return document.getElementById(id); }

  function ensureCanvasSize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = global.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, dpr };
  }

  function drawBarChart(canvas, labels, values) {
    // ✅ 2-line guard (prevents "values is not iterable")
    labels = Array.isArray(labels) ? labels : [];
    values = Array.isArray(values) ? values : [];

    const ctx = canvas.getContext("2d");
    const { w, h } = ensureCanvasSize(canvas);

    ctx.clearRect(0, 0, w, h);

    // padding
    const padL = 42, padR = 10, padT = 12, padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // axes
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // scale
    const minV = Math.min(0, ...values);
    const maxV = Math.max(...values);
    const span = (maxV - minV) || 1;

    function yOf(v) {
      const t = (v - minV) / span;
      return padT + plotH - t * plotH;
    }

    // y ticks
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = `${Math.max(10, Math.floor(w / 60))}px sans-serif`;
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const tv = minV + (span * i / ticks);
      const y = yOf(tv);
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(tv.toFixed(1), 4, y + 3);
    }

    // bars
    const n = values.length;
    const gap = Math.max(2, Math.floor(plotW * 0.02));
    const barW = Math.max(6, Math.floor((plotW - gap * (n + 1)) / n));

    for (let i = 0; i < n; i++) {
      const x = padL + gap + i * (barW + gap);
      const y0 = yOf(0);
      const y1 = yOf(values[i]);
      const top = Math.min(y0, y1);
      const bh = Math.abs(y1 - y0);

      ctx.fillStyle = "rgba(52, 120, 246, 0.85)";
      ctx.fillRect(x, top, barW, bh);

      // simple x labels (truncate)
      const lab = String(labels[i] ?? "").slice(0, 10);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.font = `${Math.max(9, Math.floor(w / 70))}px sans-serif`;
      ctx.fillText(lab, x, padT + plotH + 16);
    }
  }

  function showPanel(title, meta) {
    // Auto-open Tips panel so the viz is visible
    const tips = document.getElementById("tipsPanel");
    if (tips && !tips.classList.contains("open")) {
      const btn = document.getElementById("tipsBtnQB");
      if (btn) btn.click();
      else { tips.classList.add("open"); tips.setAttribute("aria-hidden", "false"); }
    }

    const panel = $("flexeeVizPanel");
    if (!panel) return;
    $("flexeeVizTitle").textContent = title || "Chart";
    $("flexeeVizMeta").textContent = meta || "";
    panel.classList.remove("hidden");
  }

  function hidePanel() {
    const panel = $("flexeeVizPanel");
    if (!panel) return;
    panel.classList.add("hidden");
  }

  function renderBar({ title, meta, labels, values }) {
    const canvas = $("flexeeVizCanvas");
    if (!canvas) return;
    showPanel(title, meta);
    drawBarChart(canvas, labels, values);
  }

  function init() {
    const closeBtn = $("flexeeVizClose");
    if (closeBtn) closeBtn.addEventListener("click", hidePanel);

    // re-draw on resize if visible
    global.addEventListener("resize", () => {
      const panel = $("flexeeVizPanel");
      if (!panel || panel.classList.contains("hidden")) return;
      // If last data exists, redraw
      if (global.FlexeeVizPanel._last) renderBar(global.FlexeeVizPanel._last);
    });
  }

  global.FlexeeVizPanel = {
    init,
    hide: hidePanel,
    bar: (payload) => {
      global.FlexeeVizPanel._last = payload;
      renderBar(payload);
    },
    _last: null
  };

  document.addEventListener("DOMContentLoaded", init);
})(window);
