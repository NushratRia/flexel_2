/******************************************************
 * Pinch-to-Select Gesture Script
 * - Detects pinch between thumb (#4) and index finger (#8)
 * - If pinch occurs over a highlighted cell, marks it as "selected"
 *   (Extended: pinch over column header A/B/C selects full column;
 *              pinch over row header 1/2/3 selects full row)
 ******************************************************/

function setupPinchSelect(hands, canvasElement, canvasCtx) {
    let lastPinchTime = 0;
    const PINCH_THRESHOLD = 0.05; // Distance threshold (normalized 0–1)
    let currentSelectedCell = null;

    hands.onResults(results => {
        if (!results.multiHandLandmarks) return;

        const landmarks = results.multiHandLandmarks[0]; // Use first detected hand
        if (!landmarks) return;

        // Calculate distance between thumb tip (#4) and index tip (#8)
        const thumb = landmarks[4];
        const index = landmarks[8];
        const dx = thumb.x - index.x;
        const dy = thumb.y - index.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If distance below threshold => pinch detected
        if (distance < PINCH_THRESHOLD) {
            const fingerX = index.x * canvasElement.width;
            const fingerY = index.y * canvasElement.height;
            const mirroredX = window.innerWidth - fingerX;
            const mirroredY = fingerY;

            // Detect element under pinch point
            let el = document.elementFromPoint(mirroredX, mirroredY);
            if (el) {
                // Avoid multiple selections per 500ms
                if (Date.now() - lastPinchTime > 500) {

                    // 1) Clear any previous selection (rows/cols/cells)
                    document.querySelectorAll(".gesture-selected").forEach(n => n.classList.remove("gesture-selected"));

                    // 2) Work out what was pinched: column header, row header, or cell
                    const htCore = document.querySelector(".ht_master .htCore") || document.querySelector(".htCore");
                    const tbodyRows = htCore ? htCore.querySelectorAll("tbody tr") : null;

                    let targetCells = []; // list of TDs to mark selected

                    // Column header? (top clone area)
                    if (el.closest(".ht_clone_top")) {
                        const th = el.closest("th");
                        const colIdx = th && th.parentNode
                            ? (th.cellIndex != null ? th.cellIndex : Array.from(th.parentNode.children).indexOf(th))
                            : -1;
                        if (htCore && tbodyRows && colIdx >= 0) {
                            tbodyRows.forEach(tr => {
                                const td = tr.cells && tr.cells[colIdx];
                                if (td) targetCells.push(td);
                            });
                        }
                    }
                    // Row header? (left clone area)
                    else if (el.closest(".ht_clone_left")) {
                        const th = el.closest("th");
                        if (htCore && tbodyRows && th) {
                            const label = parseInt((th.innerText || "").trim(), 10);
                            const rowIdx = (!Number.isNaN(label) && label > 0) ? (label - 1) : -1;
                            if (rowIdx >= 0 && rowIdx < tbodyRows.length) {
                                const tr = tbodyRows[rowIdx];
                                if (tr && tr.cells) {
                                    targetCells = Array.from(tr.cells);
                                }
                            }
                        }
                    }
                    // Regular cell?
                    else if (el.closest("td, .htCore td")) {
                        const targetCell = el.closest("td, .htCore td");
                        if (targetCell) targetCells.push(targetCell);
                    }

                    // 3) Apply selection class
                    if (targetCells.length > 0) {
                        // Keep original behavior: track a single anchor cell
                        currentSelectedCell = targetCells[0];
                        // Mark all chosen cells (row/col/cell)
                        targetCells.forEach(td => td.classList.add("gesture-selected"));
                        lastPinchTime = Date.now();

                        console.log("✅ Pinch selection applied:", 
                            targetCells.length > 1 ? `${targetCells.length} cells` : currentSelectedCell);
                    }
                }
            }
        }
    });
}







// /******************************************************
//  * Pinch-to-Select Gesture Script
//  * - Detects pinch between thumb (#4) and index finger (#8)
//  * - If pinch occurs over a highlighted cell, marks it as "selected"
//  ******************************************************/

// function setupPinchSelect(hands, canvasElement, canvasCtx) {
//     let lastPinchTime = 0;
//     const PINCH_THRESHOLD = 0.05; // Distance threshold (normalized 0–1)
//     let currentSelectedCell = null;

//     hands.onResults(results => {
//         if (!results.multiHandLandmarks) return;

//         const landmarks = results.multiHandLandmarks[0]; // Use first detected hand
//         if (!landmarks) return;

//         // Calculate distance between thumb tip (#4) and index tip (#8)
//         const thumb = landmarks[4];
//         const index = landmarks[8];
//         const dx = thumb.x - index.x;
//         const dy = thumb.y - index.y;
//         const distance = Math.sqrt(dx * dx + dy * dy);

//         // If distance below threshold => pinch detected
//         if (distance < PINCH_THRESHOLD) {
//             const fingerX = index.x * canvasElement.width;
//             const fingerY = index.y * canvasElement.height;
//             const mirroredX = window.innerWidth - fingerX;
//             const mirroredY = fingerY;

//             // Detect element under pinch point
//             let el = document.elementFromPoint(mirroredX, mirroredY);
//             if (el && el.closest('td, .htCore td')) {
//                 const targetCell = el.closest('td, .htCore td');

//                 // Avoid multiple selections per second
//                 if (Date.now() - lastPinchTime > 500) {
//                     // Remove previous selection if any
//                     if (currentSelectedCell) {
//                         currentSelectedCell.classList.remove("gesture-selected");
//                     }
//                     // Apply new selection
//                     targetCell.classList.add("gesture-selected");
//                     currentSelectedCell = targetCell;
//                     lastPinchTime = Date.now();

//                     console.log("✅ Pinch selection applied:", targetCell);
//                 }
//             }
//         }
//     });
// }
