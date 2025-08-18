/* static/js/hotwordBootstrap.js
 * Purpose: Get mic permission with the smallest possible friction and
 *          auto-start hotword mode once permission is granted.
 * No changes to your existing files are required.
 *
 * Works with: window.VoiceChat (from voicechat.js)
 */
(function (global) {
    const Boot = {
        _askedThisSession: false,

        async init() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn("[HotwordBootstrap] getUserMedia not available");
            return;
        }

        // If the permission was granted in the past on this origin, we can start hands-free.
        const state = await this._queryMicPermission();
        if (state === "granted") {
            this._startRecognitionQuietly();
            return;
        }

        // Otherwise, wait for the first user gesture to legally open the mic prompt.
        const arm = () => {
            if (this._askedThisSession) return;
            this._askedThisSession = true;
            document.removeEventListener("click", arm, true);
            document.removeEventListener("keydown", arm, true);
            this._requestOnce();
        };
        document.addEventListener("click", arm, true);
        document.addEventListener("keydown", arm, true);

        // Optional: small hint for the user
        console.info("[HotwordBootstrap] Mic permission will be requested on first click or key press.");
        },

        async _queryMicPermission() {
        try {
            if (!navigator.permissions || !navigator.permissions.query) return "prompt";
            const res = await navigator.permissions.query({ name: "microphone" });
            return res.state; // "granted" | "prompt" | "denied"
        } catch (_) { return "prompt"; }
        },

        async _requestOnce() {
        // Use getUserMedia directly to trigger the standard permission UI.
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Immediately stop tracks — we only needed the grant. VoiceChat handles actual listening.
            for (const t of stream.getAudioTracks()) t.stop();
            this._startRecognitionQuietly();
        } catch (err) {
            console.warn("[HotwordBootstrap] Mic permission denied or failed:", err);
        }
        },

        _startRecognitionQuietly() {
        // Hand over to your existing hotword listener
        if (global.VoiceChat) {
            try {
            global.VoiceChat.start(); // voicechat.js already auto-restarts & runs hotword mode
            console.info("[HotwordBootstrap] Hotword mode active.");
            } catch (e) {
            console.warn("[HotwordBootstrap] Could not start VoiceChat:", e);
            }
        }
        }
    };

    global.HotwordBootstrap = Boot;
})(window);
