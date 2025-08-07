/******************************************************
 * Pinch-to-Select Gesture Script
 * - Detects pinch between thumb (#4) and index finger (#8)
 * - If pinch occurs over a highlighted cell, marks it as "selected"
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
            if (el && el.closest('td, .htCore td')) {
                const targetCell = el.closest('td, .htCore td');

                // Avoid multiple selections per second
                if (Date.now() - lastPinchTime > 500) {
                    // Remove previous selection if any
                    if (currentSelectedCell) {
                        currentSelectedCell.classList.remove("gesture-selected");
                    }
                    // Apply new selection
                    targetCell.classList.add("gesture-selected");
                    currentSelectedCell = targetCell;
                    lastPinchTime = Date.now();

                    console.log("✅ Pinch selection applied:", targetCell);
                }
            }
        }
    });
}
