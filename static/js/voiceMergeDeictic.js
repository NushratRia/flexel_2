/* static/js/voiceMergeDeictic.js
 * Extends VoiceActions with deictic merge support for both-hand selections.
 *
 * Allows users to:
 * 1. Select two different rows/columns/cells using gestures (one per hand)
 * 2. Say "merge", "merge these", "merge columns", "merge rows" to merge them
 *
 * The union rectangle spanning both selections is computed and merged.
 */
(function (global) {
    'use strict';

    // Wait for VoiceActions to be available
    function patchVoiceActions() {
        const VA = global.VoiceActions;
        if (!VA) {
            console.warn('[VoiceMergeDeictic] VoiceActions not found, retrying...');
            return false;
        }

        // Skip if already patched
        if (VA._mergeMulti) {
            return true;
        }

        // Helper: compute union of two rectangles
        function unionRects(r1, r2) {
            if (!r1 && !r2) return null;
            if (!r1) return r2;
            if (!r2) return r1;
            return {
                r1: Math.min(r1.r1, r2.r1),
                c1: Math.min(r1.c1, r2.c1),
                r2: Math.max(r1.r2, r2.r2),
                c2: Math.max(r1.c2, r2.c2)
            };
        }

        // Helper: convert column index to letters (A, B, ... Z, AA, AB, ...)
        function colLetters(i) {
            let n = i, s = '';
            do {
                s = String.fromCharCode(65 + (n % 26)) + s;
                n = Math.floor(n / 26) - 1;
            } while (n >= 0);
            return s;
        }

        // Helper: convert rect to A1 notation
        function rectToA1(rect) {
            if (!rect) return null;
            const c1 = colLetters(rect.c1);
            const c2 = colLetters(rect.c2);
            return `${c1}${rect.r1 + 1}:${c2}${rect.r2 + 1}`;
        }

        /**
         * _mergeMulti - Merge cells using deictic (both-hand) selection
         *
         * @param {string} rangeSpec - "this"/"here"/"there" for deictic, or A1 notation
         * @returns {boolean} - true if merge succeeded
         */
        VA._mergeMulti = function(rangeSpec) {
            const hot = this._hot;
            if (!hot) return false;

            const plugin = hot.getPlugin('mergeCells');
            if (!plugin) {
                console.warn('[VoiceMergeDeictic] mergeCells plugin not available');
                return false;
            }

            // Resolve range to rectangles
            const rects = this._resolveToRects(rangeSpec);

            if (!rects || rects.length === 0) {
                console.warn('[VoiceMergeDeictic] No selection found for merge');
                return false;
            }

            // Compute union of all rectangles (typically 2 from both hands)
            let unionRect = null;
            for (const rect of rects) {
                unionRect = unionRects(unionRect, rect);
            }

            if (!unionRect) {
                console.warn('[VoiceMergeDeictic] Could not compute union rectangle');
                return false;
            }

            // Ensure we have a valid range (not just a single cell)
            if (unionRect.r1 === unionRect.r2 && unionRect.c1 === unionRect.c2) {
                console.warn('[VoiceMergeDeictic] Cannot merge a single cell');
                return false;
            }

            const a1Range = rectToA1(unionRect);
            console.info('[VoiceMergeDeictic] Merging range:', a1Range);

            // Select the union range and merge
            try {
                hot.selectCells([[unionRect.r1, unionRect.c1, unionRect.r2, unionRect.c2]]);
                plugin.mergeSelection();
                hot.render();

                // Show toast feedback
                showMergeToast(a1Range, rects.length);

                return true;
            } catch (e) {
                console.warn('[VoiceMergeDeictic] merge failed', e);
                return false;
            }
        };

        // Toast notification for merge feedback
        function showMergeToast(range, selectionCount) {
            const msg = selectionCount > 1
                ? `Merged ${selectionCount} selections: ${range}`
                : `Merged: ${range}`;

            // Try using existing toast system
            if (global.DeicticToast && global.DeicticToast.show) {
                global.DeicticToast.show('Merged', [], { value: range });
                return;
            }

            // Fallback toast
            try {
                const id = 'merge_deictic_toast';
                let el = document.getElementById(id);
                if (!el) {
                    el = document.createElement('div');
                    el.id = id;
                    Object.assign(el.style, {
                        position: 'fixed',
                        left: '50%',
                        top: '60px',
                        transform: 'translateX(-50%)',
                        background: 'rgba(32, 120, 32, 0.92)',
                        color: '#fff',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        font: '14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                        zIndex: 99999,
                        pointerEvents: 'none',
                        opacity: '0',
                        transition: 'opacity 150ms ease, transform 180ms ease'
                    });
                    document.body.appendChild(el);
                }
                el.textContent = msg;
                requestAnimationFrame(() => {
                    el.style.opacity = '1';
                    el.style.transform = 'translate(-50%, -10%)';
                });
                clearTimeout(el.__t);
                el.__t = setTimeout(() => {
                    el.style.opacity = '0';
                    el.style.transform = 'translate(-50%, -20%)';
                }, 1500);
            } catch (_) {}
        }

        // Store original execute function
        const originalExecute = VA.execute.bind(VA);

        // Patch execute to handle deictic merge
        VA.execute = function(cmd) {
            if (!cmd) return false;

            // Handle merge with deictic references
            if (cmd.action === 'merge') {
                const range = cmd.range || 'this';

                // Check if it's a deictic reference
                if (this._isDeictic(range)) {
                    return this._mergeMulti(range);
                }

                // Also handle merge without explicit range (defaults to current selection)
                if (!cmd.range) {
                    return this._mergeMulti('this');
                }
            }

            // Call original execute for all other cases
            return originalExecute(cmd);
        };

        console.info('[VoiceMergeDeictic] VoiceActions patched with _mergeMulti support');
        return true;
    }

    /**
     * Local voice handler for merge commands with deictic references.
     * Intercepts commands like:
     * - "merge"
     * - "merge this" / "merge these" / "merge here"
     * - "merge columns" / "merge rows"
     * - "merge selection"
     */
    function handleLocalMergeVoice(transcript) {
        if (!transcript) return false;

        const s = String(transcript).trim().toLowerCase()
            // Normalize common ASR mishears
            .replace(/\b(march|marsh|merch|marge)\b/g, 'merge')
            .replace(/\b(mercedes)\b/g, 'merge this')
            .replace(/\b(hair|hare|hear)\b/g, 'here')
            .replace(/\b(dis|diss)\b/g, 'this');

        // Patterns that should trigger deictic merge
        const mergePatterns = [
            /^merge$/,                                    // just "merge"
            /^merge\s+(this|these|here|there|them)$/,   // merge this/these/here
            /^merge\s+(the\s+)?selection$/,             // merge selection
            /^merge\s+(the\s+)?columns?$/,              // merge columns
            /^merge\s+(the\s+)?rows?$/,                 // merge rows
            /^merge\s+(the\s+)?cells?$/,                // merge cells
            /\bmerge\b.*\b(this|these|here|there)\b/,   // merge ... this/here
            /\b(this|these|here|there)\b.*\bmerge\b/    // this/here ... merge
        ];

        const isDeicticMerge = mergePatterns.some(pattern => pattern.test(s));

        if (!isDeicticMerge) return false;

        // Execute the merge using VoiceActions
        if (global.VoiceActions && global.VoiceActions._mergeMulti) {
            const success = global.VoiceActions._mergeMulti('this');
            if (success) {
                console.info('[VoiceMergeDeictic] Local merge command executed');
                return true;
            }
        }

        return false;
    }

    // Expose the local handler for voicechat.js integration
    global.__handleLocalMergeVoice = handleLocalMergeVoice;

    // Patch the existing __maybeHandleLocalVoice to include merge
    const originalLocalHandler = global.__maybeHandleLocalVoice;
    global.__maybeHandleLocalVoice = function(transcript) {
        // Try merge first
        if (handleLocalMergeVoice(transcript)) {
            return true;
        }
        // Fall back to original handler
        if (originalLocalHandler) {
            return originalLocalHandler(transcript);
        }
        return false;
    };

    // Initialize when ready
    function init() {
        if (patchVoiceActions()) {
            console.info('[VoiceMergeDeictic] Ready: deictic merge via gesture + voice');
        } else {
            // Retry until VoiceActions is available
            const retryId = setInterval(() => {
                if (patchVoiceActions()) {
                    clearInterval(retryId);
                }
            }, 250);
            setTimeout(() => clearInterval(retryId), 15000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window);
