/******************************************************
 * Gesture Highlight Debug Script
 * - Highlights single cells
 * - Highlights entire column if over column header (A,B,C...)
 * - Highlights entire row if over row header (1,2,3...)
 ******************************************************/
let highlightedCellsDebug = [];
let debugPointerMain;

function createDebugPointerMain() {
    debugPointerMain = document.createElement("div");
    debugPointerMain.style.position = "fixed";
    debugPointerMain.style.width = "16px";
    debugPointerMain.style.height = "16px";
    debugPointerMain.style.background = "red";
    debugPointerMain.style.borderRadius = "50%";
    debugPointerMain.style.border = "2px solid white";
    debugPointerMain.style.zIndex = "999999";
    debugPointerMain.style.pointerEvents = "none";
    debugPointerMain.style.display = "none";
    document.body.appendChild(debugPointerMain);
}

function setupGestureHighlightDebug(hands, canvasElement, canvasCtx) {
    if (!debugPointerMain) createDebugPointerMain();

    hands.onResults(results => {
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.translate(canvasElement.width, 0);
        canvasCtx.scale(-1, 1);

        // Clear old highlights
        highlightedCellsDebug.forEach(cell => cell.classList.remove("gesture-highlight"));
        highlightedCellsDebug = [];

        if (results.multiHandLandmarks) {
            for (const landmarks of results.multiHandLandmarks) {
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#888888', lineWidth: 2 });
                drawLandmarks(canvasCtx, [landmarks[8]], { color: '#00ff00', radius: 5 });
                [4, 12, 16, 20].forEach(i => drawLandmarks(canvasCtx, [landmarks[i]], { color: 'orange', radius: 4 }));

                const rawX = landmarks[8].x * canvasElement.width;
                const rawY = landmarks[8].y * canvasElement.height;
                const mirroredX = window.innerWidth - rawX;
                const mirroredY = rawY;

                // Move debug pointer
                debugPointerMain.style.left = `${mirroredX - 8}px`;
                debugPointerMain.style.top = `${mirroredY - 8}px`;
                debugPointerMain.style.display = "block";

                // Detect DOM element under fingertip
                let el = document.elementFromPoint(mirroredX, mirroredY);
                if (!el) continue;

                console.log("👆 Finger element:", el, "Parent containers:",
                    el.closest('.ht_clone_top'), el.closest('.ht_clone_left'));

                // ✅ Column header detection
                if (el.closest('.ht_clone_top')) {
                    const headerCell = el.closest('th') || el.closest('div');
                    if (headerCell) {
                        console.log("📌 Highlight entire column");
                        const colIndex = headerCell.cellIndex !== undefined ? headerCell.cellIndex + 1 : (Array.from(headerCell.parentNode.children).indexOf(headerCell) + 1);
                        document.querySelectorAll(`.ht_master .htCore tr td:nth-child(${colIndex})`).forEach(td => {
                            td.classList.add("gesture-highlight");
                            highlightedCellsDebug.push(td);
                        });
                        headerCell.classList.add("gesture-highlight");
                        highlightedCellsDebug.push(headerCell);
                    }
                }
                // ✅ Row header detection
                else if (el.closest('.ht_clone_left')) {
                    const headerCell = el.closest('th') || el.closest('div');
                    if (headerCell) {
                        const rowLabel = parseInt(headerCell.innerText.trim(), 10); // Get number like 3
                        console.log("📌 Highlighting entire row:", rowLabel);

                        // Convert to 1-based index for nth-child
                        const rowSelector = `.ht_master .htCore tr:nth-child(${rowLabel})`;

                        const targetRow = document.querySelector(rowSelector);
                        if (targetRow) {
                            targetRow.querySelectorAll('td').forEach(td => {
                                td.classList.add("gesture-highlight");
                                highlightedCellsDebug.push(td);
                            });
                        }

                        headerCell.classList.add("gesture-highlight");
                        highlightedCellsDebug.push(headerCell);
                    }
                }
                // ✅ Otherwise single cell
                else if (el.closest && el.closest('td, .htCore td')) {
                    const td = el.closest('td, .htCore td');
                    td.classList.add("gesture-highlight");
                    highlightedCellsDebug.push(td);
                }
            }
        } else {
            debugPointerMain.style.display = "none";
        }

        canvasCtx.restore();
    });
}









/*let highlightedCellsDebug = [];
let debugPointerMain;

// Create debug pointer element once
function createDebugPointerMain() {
    debugPointerMain = document.createElement("div");
    debugPointerMain.style.position = "fixed";
    debugPointerMain.style.width = "16px";
    debugPointerMain.style.height = "16px";
    debugPointerMain.style.background = "red";
    debugPointerMain.style.borderRadius = "50%";
    debugPointerMain.style.border = "2px solid white";
    debugPointerMain.style.zIndex = "999999";
    debugPointerMain.style.pointerEvents = "none";
    debugPointerMain.style.display = "none";
    document.body.appendChild(debugPointerMain);
}

/**
 * Main setup function for gesture-based highlighting
 * @param {object} hands - Mediapipe Hands instance
 * @param {HTMLCanvasElement} canvasElement - The canvas element
 * @param {CanvasRenderingContext2D} canvasCtx - Canvas 2D context
 */
/*function setupGestureHighlightDebug(hands, canvasElement, canvasCtx) {
    if (!debugPointerMain) createDebugPointerMain();

    hands.onResults(results => {
        // Clear previous frame
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        // Flip canvas horizontally to mirror webcam
        canvasCtx.translate(canvasElement.width, 0);
        canvasCtx.scale(-1, 1);

        // Remove old highlights
        highlightedCellsDebug.forEach(cell => cell.classList.remove("gesture-highlight"));
        highlightedCellsDebug = [];

        // If any hand detected
        if (results.multiHandLandmarks) {
            for (const landmarks of results.multiHandLandmarks) {
                // Draw hand skeleton
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#888888', lineWidth: 2 });

                // Draw index fingertip (green dot)
                drawLandmarks(canvasCtx, [landmarks[8]], { color: '#00ff00', radius: 5 });

                // Draw orange dots on other fingertips
                const otherFingertips = [4, 12, 16, 20]; 
                otherFingertips.forEach(i => {
                    drawLandmarks(canvasCtx, [landmarks[i]], { color: 'orange', radius: 4 });
                });

                // Convert normalized coords (0..1) → pixels
                const rawX = landmarks[8].x * canvasElement.width;
                const rawY = landmarks[8].y * canvasElement.height;

                // Mirror horizontally for DOM coordinate mapping
                const mirroredX = window.innerWidth - rawX;
                const mirroredY = rawY;

                // Move debug pointer to mirrored fingertip position
                debugPointerMain.style.left = `${mirroredX - 8}px`;
                debugPointerMain.style.top = `${mirroredY - 8}px`;
                debugPointerMain.style.display = "block";

                // Detect DOM element under fingertip
                let el = document.elementFromPoint(mirroredX, mirroredY);
                console.log("👆 Finger over element:", el);

                // If a TD cell is found, highlight it
                if (el && el.closest) {
                    const td = el.closest('td, .htCore td');
                    if (td) {
                        td.classList.add("gesture-highlight");
                        highlightedCellsDebug.push(td);
                        console.log("✅ Highlighting cell:", td);
                    }
                }
            }
        } else {
            debugPointerMain.style.display = "none";
        }

        canvasCtx.restore();
    });
} 
*/
