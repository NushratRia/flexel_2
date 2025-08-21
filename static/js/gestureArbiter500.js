/* static/js/gestureArbiter500.js
 * Global arbitration for ALL gestures:
 *  - 500 ms cooldown between commits (any gesture)
 *  - Uses ranks gathered via GU.rank; commits only if top score is strong
 *  - If top vs second is too close (different categories), treat as ambiguous → no commit
 *  - No structural changes to existing code
 */
(function (global) {
    const GA = () => global.GestureActions;
    const GU = () => global.GestureUtils;

    const GLOBAL_COOLDOWN_MS = 500;  // 0.5s between ANY two gestures
    const MIN_SCORE          = 0.88; // require a confident top score
    const MARGIN             = 0.06; // top must beat second by this margin

    let installed = false;
    let lastCommitAt = 0;

    // ranks seen since last commit attempt
    let frameRanks = []; // [{name, value, payload}...]

    function ensure() {
        if (installed) return true;
        if (!GA() || !GU()) return false;

        const ga = GA();
        const gu = GU();

        // 1) Intercept GU.rank to mirror all ranks into our local buffer (doesn't change original behavior)
        if (typeof gu.rank === 'function' && !gu.__rankPatchedForArbiter) {
        const origRank = gu.rank.bind(gu);
        gu.rank = function(scoreboard, name, value, payload) {
            frameRanks.push({ name, value, payload });
            return origRank(scoreboard, name, value, payload);
        };
        gu.__rankPatchedForArbiter = true;
        }

        // 2) Wrap commit so we can gate by cooldown + ranking clarity
        if (typeof ga._commitTopGesture === 'function' && !ga.__arbiterPatched) {
        const origCommit = ga._commitTopGesture.bind(ga);
        ga._commitTopGesture = function() {
            const now = performance.now();

            // Global refractory period
            if (now - lastCommitAt < GLOBAL_COOLDOWN_MS) {
            frameRanks = []; // drop noisy ranks during cooldown
            return;          // swallow commit
            }

            // If we have ranks, arbitrate them; if not, let original proceed (keeps legacy safe)
            if (frameRanks.length) {
            // Find top two by value
            const sorted = frameRanks.slice().sort((a,b)=> b.value - a.value);
            const top    = sorted[0];
            const second = sorted[1];

            const okMin   = top.value >= MIN_SCORE;
            const okMargin= !second || (top.name === second.name) || ((top.value - second.value) >= MARGIN);

            if (!(okMin && okMargin)) {
                frameRanks = []; // ambiguous or weak -> ignore this frame
                return;
            }
            }

            // Pass through: clear buffer, stamp cooldown, and let GA do the actual gesture action
            frameRanks = [];
            lastCommitAt = now;
            return origCommit();
        };
        ga.__arbiterPatched = true;
        }

        installed = true;
        console.info('[gestureArbiter500] installed: global 500ms cooldown + rank arbitration');
        return true;
    }

    let tries = 0;
    const iv = setInterval(() => { if (ensure() || ++tries > 40) clearInterval(iv); }, 50);
})(window);
