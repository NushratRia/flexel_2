/* static/js/voiceMergeHandler.js
 * Handles voice-triggered merge operations for two-hand deictic selections.
 * Supports: "merge", "merge these", "merge this", "merge rows", "merge columns"
 *
 * When two hands select different rows/columns/cells, this handler:
 * 1. Determines the selection type for each hand (row, col, or cell)
 * 2. Checks if selections are compatible for merging
 * 3. Performs merge if compatible, shows error feedback otherwise
 */
(function (global) {
    'use strict';

    const HOT = () => (global.GestureActions && global.GestureActions._hot) || global.hot || null;

    // ---------- Utility Functions ----------

    function colLettersFromIndex(i) {
        let n = i, s = '';
        do {
            s = String.fromCharCode(65 + (n % 26)) + s;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);
        return s;
    }

    function a1FromRect(r1, c1, r2, c2) {
        const A = `${colLettersFromIndex(c1)}${r1 + 1}`;
        const B = `${colLettersFromIndex(c2)}${r2 + 1}`;
        return `${A}:${B}`;
    }

    function rectEquals(a, b) {
        return a && b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
    }

    // ---------- Selection Type Detection ----------

    /**
     * Determine the type of selection based on rect dimensions and table size.
     * Returns: 'row' | 'col' | 'cell'
     */
    function getSelectionType(rect, hot) {
        if (!rect || !hot) return null;

        const totalRows = hot.countRows();
        const totalCols = hot.countCols();

        const rowSpan = rect.r2 - rect.r1 + 1;
        const colSpan = rect.c2 - rect.c1 + 1;

        // Full row selection: spans all columns (or most of them)
        if (colSpan >= totalCols - 1 && rect.c1 === 0) {
            return 'row';
        }

        // Full column selection: spans all rows (or most of them)
        if (rowSpan >= totalRows - 1 && rect.r1 === 0) {
            return 'col';
        }

        // Otherwise it's a cell/range selection
        return 'cell';
    }

    // ---------- Compatibility Check ----------

    /**
     * Check if two selections are compatible for merging.
     * Returns: { compatible: boolean, reason?: string }
     */
    function checkMergeCompatibility(rectL, rectR, hot) {
        if (!rectL || !rectR) {
            return { compatible: false, reason: 'Please select two areas to merge' };
        }

        const typeL = getSelectionType(rectL, hot);
        const typeR = getSelectionType(rectR, hot);

        // Same rect - just merge it
        if (rectEquals(rectL, rectR)) {
            return { compatible: true, singleSelection: true };
        }

        // Different types cannot be merged
        if (typeL !== typeR) {
            return {
                compatible: false,
                reason: 'Different types of data cannot be merged'
            };
        }

        // Both are rows
        if (typeL === 'row') {
            // Rows can be merged (creates a bounding box)
            return { compatible: true, type: 'row' };
        }

        // Both are columns
        if (typeL === 'col') {
            // Columns can be merged (creates a bounding box)
            return { compatible: true, type: 'col' };
        }

        // Both are cell selections - always allow (creates bounding box)
        return { compatible: true, type: 'cell' };
    }

    // ---------- Feedback Display ----------

    function showFeedback(message, isError = false) {
        const id = 'merge_feedback_toast';
        let el = document.getElementById(id);

        if (!el) {
            el = document.createElement('div');
            el.id = id;
            Object.assign(el.style, {
                position: 'fixed',
                left: '50%',
                top: '70px',
                transform: 'translateX(-50%)',
                padding: '12px 20px',
                borderRadius: '8px',
                font: '500 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                zIndex: 2147483647,
                pointerEvents: 'none',
                opacity: '0',
                transition: 'opacity 200ms ease, transform 200ms ease'
            });
            document.body.appendChild(el);
        }

        el.textContent = message;
        el.style.background = isError ? 'rgba(180, 40, 40, 0.95)' : 'rgba(40, 120, 40, 0.95)';
        el.style.color = '#fff';

        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%, 0)';
        });

        clearTimeout(el.__timeout);
        el.__timeout = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translate(-50%, -10px)';
        }, isError ? 2500 : 1500);
    }

    // ---------- Read Hand Selections ----------

    function readBothHandRects() {
        const live = global.__handLiveRects || {};
        const out = [];

        if (live.L) out.push({ ...live.L, hand: 'L' });
        if (live.R && (!out.length || !rectEquals(out[0], live.R))) {
            out.push({ ...live.R, hand: 'R' });
        }

        // Fallback to current Handsontable selection
        if (!out.length) {
            const hot = HOT();
            if (hot) {
                const sel = hot.getSelectedRangeLast && hot.getSelectedRangeLast();
                if (sel && sel.from && sel.to) {
                    out.push({
                        r1: Math.min(sel.from.row, sel.to.row),
                        c1: Math.min(sel.from.col, sel.to.col),
                        r2: Math.max(sel.from.row, sel.to.row),
                        c2: Math.max(sel.from.col, sel.to.col),
                        hand: 'selection'
                    });
                }
            }
        }

        return out;
    }

    // ---------- Union Rectangles ----------

    function unionRects(a, b) {
        if (!a) return b;
        if (!b) return a;
        return {
            r1: Math.min(a.r1, b.r1),
            r2: Math.max(a.r2, b.r2),
            c1: Math.min(a.c1, b.c1),
            c2: Math.max(a.c2, b.c2)
        };
    }

    // ---------- Main Merge Handler ----------

    /**
     * Execute a deictic merge operation using both hand selections.
     * Returns: true if merge was successful, false otherwise.
     */
    function executeDedicMerge() {
        const hot = HOT();
        if (!hot) {
            showFeedback('Spreadsheet not ready', true);
            return false;
        }

        const plugin = hot.getPlugin('mergeCells');
        if (!plugin) {
            showFeedback('Merge plugin not available', true);
            return false;
        }

        const rects = readBothHandRects();

        if (rects.length === 0) {
            showFeedback('Please select cells to merge', true);
            return false;
        }

        // Single selection - just merge it if it's more than one cell
        if (rects.length === 1) {
            const rect = rects[0];
            const cellCount = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);

            if (cellCount < 2) {
                showFeedback('Select multiple cells to merge', true);
                return false;
            }

            try {
                hot.selectCells([[rect.r1, rect.c1, rect.r2, rect.c2]]);
                plugin.mergeSelection();
                hot.render();
                showFeedback('Merged cells');
                return true;
            } catch (e) {
                console.warn('[VoiceMergeHandler] merge failed', e);
                showFeedback('Merge failed', true);
                return false;
            }
        }

        // Two selections - check compatibility
        const rectL = rects[0];
        const rectR = rects[1];

        const compatibility = checkMergeCompatibility(rectL, rectR, hot);

        if (!compatibility.compatible) {
            showFeedback(compatibility.reason, true);
            return false;
        }

        // Create union of both rectangles
        const merged = unionRects(rectL, rectR);
        const range = a1FromRect(merged.r1, merged.c1, merged.r2, merged.c2);

        try {
            hot.selectCells([[merged.r1, merged.c1, merged.r2, merged.c2]]);
            plugin.mergeSelection();
            hot.render();

            const typeMsg = compatibility.type === 'row' ? 'rows' :
                           compatibility.type === 'col' ? 'columns' : 'cells';
            showFeedback(`Merged ${typeMsg}`);
            return true;
        } catch (e) {
            console.warn('[VoiceMergeHandler] merge failed', e);
            showFeedback('Merge failed', true);
            return false;
        }
    }

    /**
     * Check if a voice command is a merge deictic command.
     */
    function isMergeDeicticCommand(cmd) {
        if (!cmd) return false;

        // Check action type
        const action = (cmd.action || '').toLowerCase();
        if (!['merge', 'merge_rows', 'merge_cols', 'merge_cells'].includes(action)) {
            return false;
        }

        // Check if range is deictic or absent
        const range = (cmd.range || '').toLowerCase().trim();
        return !range || range === 'this' || range === 'here' || range === 'there' ||
               range === 'these' || range === 'hear' || range === 'hair';
    }

    /**
     * Handle merge command - entry point for voice commands.
     * Returns: true if handled, false to fall through to default handler.
     */
    function handleMergeCommand(cmd) {
        if (!isMergeDeicticCommand(cmd)) {
            return false; // Let default handler process A1 notation merges
        }

        return executeDedicMerge();
    }

    // ---------- Expose Globally ----------

    global.VoiceMergeHandler = {
        execute: handleMergeCommand,
        executeDeictic: executeDedicMerge,
        isDeicticMerge: isMergeDeicticCommand,
        checkCompatibility: checkMergeCompatibility,
        showFeedback: showFeedback
    };

    console.info('[VoiceMergeHandler] ready for two-hand deictic merge operations.');
})(window);
