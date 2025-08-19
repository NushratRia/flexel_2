/* static/js/tipsCollapsible.js
 * Collapsible sections in the Tips panel.
 * - Initial state: collapsed
 * - Images remain visible when collapsed
 * - No toggle for the "Interaction Modes" heading
 */
(function (global) {
    "use strict";

    const panel = document.getElementById("tipsPanel");
    if (!panel) return;

    function headingLevel(el) {
        const m = (el.tagName || "").match(/^H([2-6])$/);
        return m ? parseInt(m[1], 10) : 99;
    }

    function isInteractionModes(text) {
        return /^\s*interaction\s+modes?\s*$/i.test(text || "");
    }

    function enhance() {
        // Find section headings inside Tips
        const heads = Array.from(panel.querySelectorAll("h2, h3, h4"));

        heads.forEach((h) => {
        const title = (h.textContent || "").trim();
        if (h.dataset.collapsible === "done") return;

        // Skip the top umbrella heading "Interaction Modes"
        if (isInteractionModes(title)) {
            h.dataset.collapsible = "done";
            return;
        }

        // Only treat headings that look like section titles (contain "Mode")
        if (!/mode/i.test(title)) return;

        h.dataset.collapsible = "done";
        h.classList.add("tips-c-title");

        const lvl = headingLevel(h);

        // Collect siblings until the next heading of same or higher level
        const contentText = document.createElement("div");
        contentText.className = "tips-c-content";
        const contentImages = document.createElement("div");
        contentImages.className = "tips-c-images";

        let n = h.nextSibling;
        while (n) {
            const next = n.nextSibling;
            const isElem = n.nodeType === 1;

            // Stop at next section heading of same/higher level
            if (
            isElem &&
            /^H[2-6]$/.test(n.nodeName) &&
            headingLevel(n) <= lvl
            ) break;

            // Separate images from text so images stay visible when collapsed
            if (
            isElem &&
            (
                n.matches("img, figure, .illustrations, .tips-illustration") ||
                n.querySelector?.("img")
            )
            ) {
            contentImages.appendChild(n);
            } else {
            contentText.appendChild(n);
            }

            n = next;
        }

        // Insert image block (always visible) then the collapsible text block
        if (contentImages.childNodes.length) {
            h.parentNode.insertBefore(contentImages, n || null);
        }
        h.parentNode.insertBefore(contentText, n || null);

        // Add a toggle button at the right end of the heading
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tips-c-toggle";
        btn.setAttribute("aria-expanded", "false");
        btn.innerHTML = '<span class="twisty" aria-hidden="true">▸</span>';
        h.appendChild(btn);

        // Start collapsed (hide text content only)
        contentText.style.display = "none";
        h.classList.add("collapsed");

        function toggle(open) {
            const willOpen = typeof open === "boolean" ? open : btn.getAttribute("aria-expanded") !== "true";
            btn.setAttribute("aria-expanded", String(willOpen));
            h.classList.toggle("collapsed", !willOpen);
            contentText.style.display = willOpen ? "" : "none";
        }

        // Click on button OR on the heading area toggles it (ignore links inside)
        btn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
        h.addEventListener("click", (e) => {
            if (e.target.closest("a, button") && e.target !== btn) return;
            if (e.target === btn) return;
            toggle();
        });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", enhance);
    } else {
        requestAnimationFrame(enhance);
    }
})(window);
