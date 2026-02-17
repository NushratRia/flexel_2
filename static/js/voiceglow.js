// voiceglow.js
// Visual-only glow feedback for voice command result (success/failure)
// Works even when #voiceChatbox has overflow:hidden by using INSET glow.

(function (global) {
  const BOX_ID = "voiceChatbox";

  function ensureStyles() {
    if (document.getElementById("voiceGlowStyles")) return;

    const css = `
      /* INSET glow animations (visible even with overflow:hidden) */
      @keyframes voiceGlowFlashGreenInset {
        0% {
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.22),
            inset 0 0 0 0 rgba(0, 200, 100, 0),
            inset 0 0 0 rgba(0, 200, 100, 0);
          border-color: #cfcfcf;
          filter: brightness(1);
        }
        50% {
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.22),
            inset 0 0 0 3px rgba(0, 200, 100, 0.95),
            inset 0 0 22px rgba(0, 200, 100, 0.55),
            inset 0 0 44px rgba(0, 200, 100, 0.35);
          border-color: rgba(0, 200, 100, 0.95);
          filter: brightness(1.08);
        }
        100% {
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.22),
            inset 0 0 0 0 rgba(0, 200, 100, 0),
            inset 0 0 0 rgba(0, 200, 100, 0);
          border-color: #cfcfcf;
          filter: brightness(1);
        }
      }

      @keyframes voiceGlowFlashRedInset {
        0% {
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.22),
            inset 0 0 0 0 rgba(255, 70, 70, 0),
            inset 0 0 0 rgba(255, 70, 70, 0);
          border-color: #cfcfcf;
          filter: brightness(1);
        }
        50% {
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.22),
            inset 0 0 0 3px rgba(255, 70, 70, 0.95),
            inset 0 0 22px rgba(255, 70, 70, 0.55),
            inset 0 0 44px rgba(255, 70, 70, 0.35);
          border-color: rgba(255, 70, 70, 0.95);
          filter: brightness(1.08);
        }
        100% {
          box-shadow:
            0 2px 10px rgba(0, 0, 0, 0.22),
            inset 0 0 0 0 rgba(255, 70, 70, 0),
            inset 0 0 0 rgba(255, 70, 70, 0);
          border-color: #cfcfcf;
          filter: brightness(1);
        }
      }

      /* Result flash classes (1s) */
      #${BOX_ID}.glow-success {
        border-width: 2px !important;
        border-style: solid !important;
        animation: voiceGlowFlashGreenInset 1s ease-in-out 1 !important;
      }
      #${BOX_ID}.glow-error {
        border-width: 2px !important;
        border-style: solid !important;
        animation: voiceGlowFlashRedInset 1s ease-in-out 1 !important;
      }
    `;

    const style = document.createElement("style");
    style.id = "voiceGlowStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getBox() {
    return document.getElementById(BOX_ID);
  }

  const VoiceGlow = {
    _timer: null,

    flashSuccess() { this._flash("glow-success"); },
    flashError() { this._flash("glow-error"); },

    _flash(className) {
      ensureStyles();
      const box = getBox();
      if (!box) return;

      if (this._timer) clearTimeout(this._timer);
      this._timer = null;

      // Make sure listening glow doesn't override the flash
      box.classList.remove("listening-glow");

      // Restart animation reliably
      box.classList.remove("glow-success", "glow-error");
      void box.offsetWidth; // force reflow
      box.classList.add(className);

      this._timer = setTimeout(() => {
        box.classList.remove("glow-success", "glow-error");
        this._timer = null;
      }, 1000);
    }
  };

  global.VoiceGlow = VoiceGlow;
})(window);
