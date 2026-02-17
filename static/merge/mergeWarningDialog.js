/* static/js/mergeWarningDialog.js
 * Google-Sheets-like merge warning dialog (OK / Cancel + "Don't show again for 5 minutes")
 * Exposes: window.MergeWarningDialog.confirm({ message, onOk, onCancel })
 */

(function (global) {
  const KEY_SUPPRESS_UNTIL = "merge_warn_suppress_until_ts";

  function now() { return Date.now(); }

  function isSuppressed() {
    try {
      const ts = parseInt(localStorage.getItem(KEY_SUPPRESS_UNTIL) || "0", 10);
      return ts && ts > now();
    } catch (_) {
      return false;
    }
  }

  function suppressFor5Minutes() {
    try {
      localStorage.setItem(KEY_SUPPRESS_UNTIL, String(now() + 5 * 60 * 1000));
    } catch (_) {}
  }

  function ensureStyles() {
    if (document.getElementById("mergeWarnDialogStyles")) return;

    const style = document.createElement("style");
    style.id = "mergeWarnDialogStyles";
    style.textContent = `
      .mw-overlay{
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.35);
        display: flex; align-items: center; justify-content: center;
        z-index: 99999;
      }
      .mw-card{
        width: min(720px, calc(100vw - 48px));
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.35);
        padding: 28px 28px 22px 28px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
      .mw-top{
        display:flex; align-items:center; justify-content: space-between;
        margin-bottom: 10px;
      }
      .mw-title{
        font-size: 42px;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin: 0;
        color: #111;
      }
      .mw-x{
        border: none;
        background: transparent;
        font-size: 26px;
        cursor: pointer;
        color: #666;
        line-height: 1;
      }
      .mw-body{
        font-size: 22px;
        line-height: 1.35;
        color: #222;
        margin-top: 10px;
        margin-bottom: 18px;
      }
      .mw-checkrow{
        display:flex; align-items:center;
        gap: 12px;
        margin-bottom: 22px;
        font-size: 20px;
        color: #333;
      }
      .mw-actions{
        display:flex;
        justify-content: flex-end;
        gap: 16px;
      }
      .mw-btn{
        border-radius: 10px;
        padding: 14px 26px;
        font-size: 22px;
        font-weight: 700;
        border: 2px solid #cfcfcf;
        cursor: pointer;
        background: #fff;
      }
      .mw-btn-ok{
        background: #1a7f37;
        border-color: #1a7f37;
        color: #fff;
      }
      .mw-btn-cancel{
        background: #fff;
        color: #1a7f37;
        border-color: #d7d7d7;
      }
      @media (max-width: 520px){
        .mw-title{ font-size: 32px; }
        .mw-body{ font-size: 18px; }
        .mw-btn{ font-size: 18px; padding: 12px 18px; }
        .mw-checkrow{ font-size: 16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildDialog(message) {
    ensureStyles();

    const overlay = document.createElement("div");
    overlay.className = "mw-overlay";

    const card = document.createElement("div");
    card.className = "mw-card";

    const top = document.createElement("div");
    top.className = "mw-top";

    const title = document.createElement("h2");
    title.className = "mw-title";
    title.textContent = "Heads up!";

    const closeBtn = document.createElement("button");
    closeBtn.className = "mw-x";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";

    top.appendChild(title);
    top.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "mw-body";
    body.textContent = message || "Merging cells will only preserve the top-leftmost value. Merge anyway?";

    const checkRow = document.createElement("label");
    checkRow.className = "mw-checkrow";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.style.transform = "scale(1.3)";
    const chkText = document.createElement("span");
    chkText.textContent = "Don't show this again for 5 minutes";
    checkRow.appendChild(chk);
    checkRow.appendChild(chkText);

    const actions = document.createElement("div");
    actions.className = "mw-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "mw-btn mw-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const okBtn = document.createElement("button");
    okBtn.className = "mw-btn mw-btn-ok";
    okBtn.textContent = "OK";

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);

    card.appendChild(top);
    card.appendChild(body);
    card.appendChild(checkRow);
    card.appendChild(actions);

    overlay.appendChild(card);
    return { overlay, okBtn, cancelBtn, closeBtn, chk };
  }

  async function confirm({ message, onOk, onCancel } = {}) {
    // If suppressed, auto-OK
    if (isSuppressed()) {
      try { onOk && onOk(); } catch (_) {}
      return true;
    }

    return new Promise((resolve) => {
      const { overlay, okBtn, cancelBtn, closeBtn, chk } = buildDialog(message);

      function cleanup(result) {
        try { overlay.remove(); } catch (_) {}
        resolve(result);
      }

      function ok() {
        if (chk && chk.checked) suppressFor5Minutes();
        try { onOk && onOk(); } catch (_) {}
        cleanup(true);
      }

      function cancel() {
        try { onCancel && onCancel(); } catch (_) {}
        cleanup(false);
      }

      okBtn.addEventListener("click", ok);
      cancelBtn.addEventListener("click", cancel);
      closeBtn.addEventListener("click", cancel);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cancel();
      });

      document.body.appendChild(overlay);
    });
  }

  global.MergeWarningDialog = { confirm };
})(window);
