/* static/js/quickButtons.js
 * Positions 🎙/💡 quick buttons to the LEFT of #controlPanel, never overlapping.
 * Wires the chat "×" to hide the thread.
 * Makes Tips open on load, and the Tips “×” closes it.
 */
(function (global) {
    "use strict";

    // ----- helpers -----
    const $ = (id) => document.getElementById(id);

    const strip       = $("quickButtons");      // container of quick buttons
    const panel       = $("controlPanel");      // floating control panel
    const voiceBtn    = $("voiceQB");
    const tipsBtn     = $("tipsBtnQB");         // quick button version of Tips
    const chatbox     = $("voiceChatbox");
    const closeBtn    = $("hideChatBtn");       // the "×" inside the chat thread
    const pillBtn     = $("toggleChatBtn");     // the round 💬 pill
    const modeSel     = $("modeSelector");

    // Tips elements
    const tipsPanel   = $("tipsPanel");
    const closeTips   = $("closeTipsBtn");      // the "×" inside Tips panel

    if (!strip || !panel) return;  // nothing to do

    // ----- chat visibility helpers -----
    const isChatVisible = () => chatbox && getComputedStyle(chatbox).display !== "none";
    const showChat = () => {
        if (!chatbox) return;
        chatbox.style.display = "flex";
        if (pillBtn) { pillBtn.classList.add("hidden"); pillBtn.style.display = "none"; }
        if (voiceBtn) voiceBtn.title = "Voice commands (stop)";
    };
    const hideChat = () => {
        if (!chatbox) return;
        chatbox.style.display = "none";
        if (pillBtn) { pillBtn.classList.remove("hidden"); pillBtn.style.display = "flex"; }
        if (voiceBtn) voiceBtn.title = "Voice commands (start)";
    };

    // ----- Tips helpers -----
    function setTipsOpen(open) {
        if (!tipsPanel) return;
        const willOpen = !!open;
        tipsPanel.classList.toggle("open", willOpen);
        tipsPanel.setAttribute("aria-hidden", String(!willOpen));
        // keep offset/body class consistent with your CSS
        const w = tipsPanel.getBoundingClientRect().width || 0;
        document.documentElement.style.setProperty("--tips-offset", willOpen ? `${w}px` : "0px");
        document.body.classList.toggle("tips-open", willOpen);
        if (tipsBtn) tipsBtn.classList.toggle("active", willOpen);
        // quick strip may need to move when tips changes layout
        place();
    }
    const isTipsOpen = () => !!(tipsPanel && tipsPanel.classList.contains("open"));

    // ----- positioning: always to the LEFT of #controlPanel -----
    const GAP = 10;          // space between strip and panel
    const EDGE = 8;          // viewport padding
    const SAFE_W = 72;       // fallback width before first layout

    function place() {
        try {
        const pr = panel.getBoundingClientRect();
        const sw = strip.offsetWidth || SAFE_W;
        const sh = strip.offsetHeight || 40;

        // left-of-panel, vertically centered
        let left = pr.left - sw - GAP;
        let top  = pr.top + (pr.height - sh) / 2;

        // clamp inside viewport
        const vw = Math.max(document.documentElement.clientWidth,  window.innerWidth  || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        left = Math.max(EDGE, Math.min(left, vw - sw - EDGE));
        top  = Math.max(EDGE, Math.min(top,  vh - sh - EDGE));

        strip.style.position = "fixed";
        strip.style.left = left + "px";
        strip.style.top  = top  + "px";
        strip.style.right = "auto";
        strip.style.display = "flex";
        strip.setAttribute("aria-hidden", "false");
        if (!strip.style.zIndex) strip.style.zIndex = "100002";
        } catch (_) {
        // visible fallback (top-right)
        strip.style.position = "fixed";
        strip.style.top = "16px";
        strip.style.right = "16px";
        strip.style.left = "auto";
        strip.style.display = "flex";
        }
    }

    // Initial + reflow retries
    requestAnimationFrame(place);
    setTimeout(place, 0);
    setTimeout(place, 100);

    // Reposition on window changes
    window.addEventListener("resize", place);

    // Reposition when the panel moves (style changes) or resizes
    new ResizeObserver(place).observe(panel);
    try {
        new MutationObserver(place).observe(panel, { attributes: true, attributeFilter: ["style", "class"] });
    } catch (_) {}

    // ----- wire the buttons -----

    // 🎙 quick button toggles only the chat UI (recognizer may run hands-free)
    if (voiceBtn && chatbox) {
        voiceBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        isChatVisible() ? hideChat() : showChat();
        }, true); // capture to neutralize any old handlers
    }

    // 💡 quick button: let original tips handler run; if nothing toggled, do fallback toggle.
    if (tipsBtn) {
        tipsBtn.addEventListener("click", () => {
        const before = isTipsOpen();
        setTimeout(() => {
            if (isTipsOpen() === before) setTipsOpen(!before);
        }, 0);
        }, false); // bubbling phase — don’t block other handlers
    }

    // Tips “×” closes the panel (guaranteed)
    if (closeTips) {
        closeTips.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setTipsOpen(false);
        }, false);
    }

    // Chat “×” hides the thread
    if (closeBtn && chatbox) {
        closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        hideChat();
        e.stopPropagation();
        e.stopImmediatePropagation();
        });
    }

    // Keep UI consistent with the selected Mode
    if (modeSel) {
        const apply = () => {
        const wantsVoice = (modeSel.value === "voice" || modeSel.value === "combination");
        if (!wantsVoice) hideChat();
        if (voiceBtn) {
            voiceBtn.disabled = !wantsVoice;
            voiceBtn.style.opacity = wantsVoice ? "1" : ".5";
        }
        place();
        };
        modeSel.addEventListener("change", apply);
        apply();
    }

    // --- Show Tips on first load ---
    setTipsOpen(true);

})(window);
