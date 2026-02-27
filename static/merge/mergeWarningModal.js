(function (global) {
  "use strict";

  const STORAGE_KEY = "flexee_merge_warning_suppress_until";

  function nowMs() {
    return Date.now();
  }

  function shouldSuppressWarning() {
    try {
      const until = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
      return until && nowMs() < until;
    } catch (e) {
      return false;
    }
  }

  function suppressFor5Minutes() {
    try {
      const until = nowMs() + 5 * 60 * 1000;
      localStorage.setItem(STORAGE_KEY, String(until));
    } catch (e) {}
  }

  function ensureModal() {
    let root = document.getElementById("flexee-merge-warning-root");
    if (root) return root;

    root = document.createElement("div");
    root.id = "flexee-merge-warning-root";
    root.style.position = "fixed";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.zIndex = "99999";
    root.style.background = "rgba(0,0,0,0.25)";

    root.innerHTML = `
      <div id="flexee-merge-warning-card" style="
        width: 720px;
        max-width: calc(100% - 32px);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 12px 28px rgba(0,0,0,0.20);
        padding: 28px 28px 20px 28px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        position: relative;
      ">
        <button id="flexee-merge-warning-close" aria-label="close" style="
          position:absolute;
          right:18px; top:14px;
          border:none;
          background:transparent;
          font-size:24px;
          cursor:pointer;
          color:#666;
        ">×</button>

        <div style="font-size:44px; font-weight:700; color:#222; margin: 8px 0 10px 0;">
          Heads up!
        </div>

        <div style="font-size:18px; color:#444; margin-bottom: 16px; line-height: 1.4;">
          Merging cells will only preserve the top-leftmost value. Merge anyway?
        </div>

        <label style="display:flex; align-items:center; gap:12px; font-size:16px; color:#333; margin: 12px 0 26px 0;">
          <input id="flexee-merge-warning-suppress" type="checkbox" style="width:18px; height:18px;" />
          Don't show this again for 5 minutes
        </label>

        <div style="display:flex; justify-content:flex-end; gap:14px;">
          <button id="flexee-merge-warning-cancel" style="
            padding: 10px 22px;
            border-radius: 10px;
            border: 1px solid #d0d0d0;
            background: #fff;
            font-size: 16px;
            cursor: pointer;
          ">Cancel</button>

          <button id="flexee-merge-warning-ok" style="
            padding: 10px 22px;
            border-radius: 10px;
            border: none;
            background: #188038; /* Google-ish green */
            color: #fff;
            font-size: 16px;
            cursor: pointer;
          ">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  function openMergeWarning({ onOk, onCancel }) {
    const root = ensureModal();
    const closeBtn = root.querySelector("#flexee-merge-warning-close");
    const cancelBtn = root.querySelector("#flexee-merge-warning-cancel");
    const okBtn = root.querySelector("#flexee-merge-warning-ok");
    const suppressBox = root.querySelector("#flexee-merge-warning-suppress");

    function cleanup() {
      root.style.display = "none";
      closeBtn.onclick = null;
      cancelBtn.onclick = null;
      okBtn.onclick = null;
    }

    function doCancel() {
      cleanup();
      if (typeof onCancel === "function") onCancel();
    }

    function doOk() {
      if (suppressBox && suppressBox.checked) suppressFor5Minutes();
      cleanup();
      if (typeof onOk === "function") onOk();
    }

    closeBtn.onclick = doCancel;
    cancelBtn.onclick = doCancel;
    okBtn.onclick = doOk;

    root.style.display = "flex";
  }

  global.FlexeeMergeWarningModal = {
    shouldSuppressWarning,
    openMergeWarning
  };
})(window);
