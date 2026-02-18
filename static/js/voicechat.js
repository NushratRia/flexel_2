//2/16

(function (global) {
    const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;

    // Accepts "flexee", "hey flexee", "ok flexee", and tiny misspeaks like "flexi"
    const HOTWORD_REGEX = /\b(?:hey\s+|ok\s+)?flexe?i?e?\b/i;

    // Deictic tokens (incl. common ASR confusions)
    const DEIXIS = /\b(this|here|there|selection|hair|hear)\b/i;
    const LOCAL_VERBS = /\b(delete|clear|write|put|fill|set)\b/i;

    // ✅ NEW: normalize common ASR mishears (esp. merge)
    // Does NOT affect logging; only used for parsing/execution + backend payload.
    function normalizeTranscriptForCommands(raw) {
        let s = String(raw || "");

        // Keep ":" for ranges; remove odd punctuation but keep letters/digits/spaces/:
        s = s.replace(/[’]/g, "'").replace(/[^\w\s:]/g, " ");
        s = s.replace(/\s+/g, " ").trim();

        // Normalize merge family mishears:
        // march/marge/marsh/merch/mart/merj/murj -> merge
        s = s.replace(/\b(march|marge|marsh|merch|mart|merj|murj)\b/gi, "merge");

        // "mercedes" is a super common "merge this" mishear
        s = s.replace(/\bmercedes\b/gi, "merge these");

        // "merge d's" / "marge d's" / "merge ds" -> merge these
        s = s.replace(/\bmerge\s+(d'?s|ds)\b/gi, "merge these");

        // "merge this/here/there/hair/hear" -> merge these
        s = s.replace(/\bmerge\s+(this|here|there|hair|hear)\b/gi, "merge these");

        // If user just says "merge" -> treat as deictic
        if (/^\s*merge\s*$/i.test(s)) s = "merge these";

        return s;
    }

    // --- Minimal range expander (adds support for "C:C", "C", "column C", "col c", "this") ---
    function _expandRangeLike(rangeLike) {
        if (!rangeLike) return null;
        let s = String(rangeLike).trim();

        // deictic → current column letter if available
        const SL = s.toLowerCase();
        if (SL === 'this' || SL === 'here' || SL === 'there') {
            try {
                if (global.DeicticTarget && DeicticTarget.getColLetter) {
                    const L = DeicticTarget.getColLetter();
                    if (L) s = L;
                }
            } catch (_) {}
        }

        // strip optional prefixes; uppercase
        s = s.replace(/^column\s+/i, '').replace(/^col\s+/i, '').toUpperCase();

        // already an A1 or A1:A1 → keep
        if (/^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(s)) return s;

        const rows = (global.hot && hot.countRows && hot.countRows()) || 999999;

        // "C:C" → "C1:C<rows>"
        const sameCol = s.match(/^([A-Z]+)\s*:\s*\1$/);
        if (sameCol) return `${sameCol[1]}1:${sameCol[1]}${rows}`;

        // bare "C" → "C1:C<rows>"
        if (/^[A-Z]+$/.test(s)) return `${s}1:${s}${rows}`;

        return null;
    }

    const VoiceChat = {
        _ready: false,
        recognition: null,
        listening: false,
        userStopped: false,

        // Simple finite states
        MODE: "hotword",   // "hotword" | "command" | "stopped"
        ARMED: false,
        lastTranscript: "",
        commandSilenceTimer: null,

        // Chat cue
        _listeningCueShown: false,

        isReady() { return !!this._ready; },

        init(hotInstance, containerEl) {
        if (!SpeechRecognition) {
            console.warn("[VoiceChat] Web Speech API not supported");
            return;
        }

        this.hot = hotInstance;
        this.container = containerEl;

        const rec = new SpeechRecognition();
        rec.lang = "en-US";
        rec.continuous = true;     // keep streaming to catch hotwords
        rec.interimResults = true; // detect hotwords quickly
        rec.maxAlternatives = 1;

        rec.onresult = (event) => this._onResult(event);

        rec.onerror = (e) => {
            console.warn("[VoiceChat] recognition error:", e.error);
            if (["no-speech", "audio-capture", "network"].includes(e.error)) {
            try { rec.stop(); } catch (_) {}
            }
        };

        // Keep listening (unless user intentionally stopped)
        rec.onend = () => {
            this.listening = false;
            if (!this.userStopped && this.MODE !== "stopped") {
            try { rec.start(); this.listening = true; } catch (_) {}
            }
        };

        this.recognition = rec;

        // Start immediately in hotword mode
        this.start();

        // Safety: resume after tab visibility changes
        document.addEventListener("visibilitychange", () => {
            if (!this.userStopped &&
                document.visibilityState === "visible" &&
                !this.listening &&
                this.MODE !== "stopped") {
            try { this.recognition.start(); this.listening = true; } catch (_) {}
            }
        });

        // Auto-restart when idling in hotword mode
        this.recognition.onend = () => {
            if (this.MODE === "hotword") {
            try { this.recognition.start(); } catch (_) {}
            }
        };

        this._ready = true;
        console.info("[VoiceChat] ready (hotword mode)");
        },

        start() {
        if (!this._ready || !this.recognition) {
            console.warn("[VoiceChat] start() called before init");
            return;
        }
        if (this.MODE !== "command") this.MODE = "hotword";
        this.userStopped = false;

        try {
            this.recognition.start();
            this.listening = true;
            console.info("[VoiceChat] recognition started");
        } catch (e) {
            console.debug("[VoiceChat] start skipped:", e && e.message);
        }
        },

        stop() {
        this.MODE = "stopped";
        this.userStopped = true;
        this._hideListeningCue();
        if (this.recognition) {
            try { this.recognition.stop(); } catch (_) {}
        }
        console.info("[VoiceChat] recognition stopped");
        },

        // ---------- internal helpers ----------

        // ✅ NEW: toggle chatbox glow during listening window (no behavior change otherwise)
        _setChatGlow(on) {
        const box = document.getElementById("voiceChatbox");
        if (!box) return;
        box.classList.toggle("listening-glow", !!on);
        },

        _armForCommand() {
        this.MODE = "command";
        this.ARMED = true;
        this.lastTranscript = "";
        this._showListeningCue();

        clearTimeout(this.commandSilenceTimer);
        this.commandSilenceTimer = setTimeout(() => {
            this._hideListeningCue();
            global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
            addToChatLog && addToChatLog("bot", "⏱️ No command heard — say “Flexee” again.");
            this._disarm();
        }, 5000);
        },

        _disarm() {
        this.MODE = "hotword";
        this.ARMED = false;
        clearTimeout(this.commandSilenceTimer);
        this.commandSilenceTimer = null;
        this._hideListeningCue();
        },

        _showListeningCue() {
        if (this._listeningCueShown) return;
        addToChatLog && addToChatLog("bot", "🎤 Listening… (5s)");
        this._listeningCueShown = true;

        // ✅ NEW: start glow
        this._setChatGlow(true);
        },
        _hideListeningCue() {
        if (!this._listeningCueShown) return;
        this._listeningCueShown = false;

        // ✅ NEW: stop glow
        this._setChatGlow(false);
        },

        // Try local both-hands handler (VoiceActions.__maybeHandleLocalVoice)
        _tryLocalBothHands(transcript, announce = true) {
        try {
            if (!transcript) return false;
            const s = String(transcript).toLowerCase();
            if (!LOCAL_VERBS.test(s) || !DEIXIS.test(s)) return false;
            if (global.__maybeHandleLocalVoice && global.__maybeHandleLocalVoice(transcript)) {
            if (announce) addToChatLog && addToChatLog("bot", "✅ Done (both hands).");
            return true;
            }
        } catch (e) {
            console.debug("[VoiceChat] local both-hands handler err:", e);
        }
        return false;
        },

        _onResult(event) {
        const last = event.results[event.results.length - 1];
        const transcript = (last && last[0] && last[0].transcript) ? last[0].transcript : "";

        // --- Hotword detection from interim text ---
        if (this.MODE === "hotword") {
            let detected = HOTWORD_REGEX.test(transcript);
            if (!detected) {
            for (let i = Math.max(0, event.results.length - 3); i < event.results.length; i++) {
                const seg = event.results[i] && event.results[i][0] ? event.results[i][0].transcript : "";
                if (HOTWORD_REGEX.test(seg)) { detected = true; break; }
            }
            }
            if (detected) {
            this._armForCommand();
            return; // wait for a final command
            }
        }

        // --- One-shot command mode: only act on final unique result ---
        if (this.MODE === "command" && this.ARMED && last && last.isFinal && transcript && transcript !== this.lastTranscript) {
            this.lastTranscript = transcript;

            // If the *final* text is just the hotword, ignore
            if (HOTWORD_REGEX.test(transcript.trim())) {
            console.info("[VoiceChat] Hotword only (final) — not logging or sending.");
            return;
            }

            // Log the user command (original transcript)
            this._hideListeningCue();
            addToChatLog && addToChatLog("user", transcript);

            // ✅ NEW: normalized transcript used only for parsing/execution/backend
            const normalizedTranscript = normalizeTranscriptForCommands(transcript);

            // 🔸 VIZ SHORT-CIRCUIT (local only)
            try {
            if (window.FlexeeVizVoice && window.FlexeeVizVoice.handle(normalizedTranscript)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess();
                this._disarm();
                return;
            }
            } catch (e) {}





            // 🔸 VIZ SHORT-CIRCUIT (bar chart / plot) — local only, doesn't touch backend
            try {
                console.log("[VIZ] trying:", normalizedTranscript);
            if (window.FlexeeVizVoice && window.FlexeeVizVoice.handle(normalizedTranscript)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess();
                this._disarm();
                return;
            }
            } catch (e) {}





            // 🔸 LOCAL SHORT-CIRCUIT for deictic both-hands (“delete this”, “write 50 here”, etc.)
            // Use normalized for better "hair/hear" handling
            if (this._tryLocalBothHands(normalizedTranscript)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                this._disarm();
                return;
            }

            // 🔸 Local semantic parser for select/scroll/zoom/copy/paste/merge/UNMERGE
            {
            const local = window.VDM_parse && window.VDM_parse(normalizedTranscript);
            if (local) {
                // Try your normal executor path first
                if (global.VoiceActions && global.VoiceActions.execute(local)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                this._disarm();
                return;
                }
                // Special local fallback for UNMERGE if executor doesn't handle it
                if (local.action === 'unmerge' && window.VDM_tryLocalUnmerge && window.VDM_tryLocalUnmerge(local)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                this._disarm();
                return;
                }
            }
            }

            // Otherwise, ask backend to parse into JSON
            // ✅ Send normalized transcript so backend also benefits (no UI change)
            fetch("/api/voice-command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: normalizedTranscript })
            })
            .then(async res => {
            const body = await res.json().catch(() => ({}));
            return { ok: res.ok, status: res.status, body };
            })
            .then(({ ok, status, body }) => {
            const cmd = body && body.result ? body.result : body;

            if (!ok || !cmd || cmd.error) {
                global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
                addToChatLog && addToChatLog(
                "bot",
                "⚠️ " + (cmd && cmd.error ? cmd.error : "Command failed") + (status ? ` (HTTP ${status})` : "")
                );
                return;
            }

            // If backend says "none" (as in your logs), try local BOTH-hands once more before giving up
            if (cmd.action === "none" || (typeof cmd.confidence === "number" && cmd.confidence < 0.55)) {
                if (this._tryLocalBothHands(normalizedTranscript, /*announce*/ true)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                return;
                }
                global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW (THIS fixes your case)
                addToChatLog && addToChatLog("bot", "🕊️ No sheet action detected.");
                return;
            }

            // Built-in actions already in your view.html
            if (cmd.action === "sum" && (cmd.range || cmd.target)) {
                const raw = cmd.range || cmd.target;
                const expanded = (global.normalizeA1 && global.normalizeA1(raw)) || _expandRangeLike(raw);
                if (!expanded) {
                global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
                addToChatLog && addToChatLog("bot", "⚠️ Invalid range.");
                return;
                }
                const total = executeSum(expanded);
                addToChatLog && addToChatLog("bot", `🧮 Sum(${expanded}) = ${total}`);
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                return;
            }

            if (cmd.action === "average" && (cmd.range || cmd.target)) {
                const raw = cmd.range || cmd.target;
                const expanded = (global.normalizeA1 && global.normalizeA1(raw)) || _expandRangeLike(raw);
                if (!expanded) {
                global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
                addToChatLog && addToChatLog("bot", "⚠️ Invalid range.");
                return;
                }
                const avg = executeAverage(expanded);
                addToChatLog && addToChatLog("bot", `📊 Average(${expanded}) = ${avg}`);
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                return;
            }

            if (cmd.action === "write" && cmd.range && typeof cmd.value !== "undefined") {
                const okWrite = executeWriteValue(cmd.range, cmd.value);
                addToChatLog && addToChatLog("bot", okWrite ? `✍️ Wrote "${cmd.value}" into ${cmd.range}` : "⚠️ Write failed.");
                global.VoiceGlow && global.VoiceGlow[okWrite ? "flashSuccess" : "flashError"](); // ✅ NEW
                return;
            }

            if (cmd.action === "sort" && cmd.column) {
                const dir = (cmd.direction || "asc").toLowerCase();
                const okSort = executeSortColumn(cmd.column, dir);
                addToChatLog && addToChatLog("bot", okSort ? `⇅ Sorted column ${cmd.column} (${dir})` : "⚠️ Sort failed.");
                global.VoiceGlow && global.VoiceGlow[okSort ? "flashSuccess" : "flashError"](); // ✅ NEW
                return;
            }

            // Extended actions via voiceActions.js (select/scroll/undo/redo/delete/merge/zoom/copy/paste/autofill)
            if (cmd && cmd.action === "merge" && (cmd.range === "this" || cmd.range === "here" || cmd.range === "there")) {
                cmd.action = "merge_cells";
            }

            if (global.VoiceActions && global.VoiceActions.execute(cmd)) {
                global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
                return;
            }

            global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
            addToChatLog && addToChatLog("bot", "🤖 No valid action recognized.");
            })
            .catch(err => {
            console.error("[VoiceChat] Command error:", err);
            global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
            addToChatLog && addToChatLog("bot", "⚠️ Command failed.");
            })
            .finally(() => {
            // disarm after one command and return to hotword mode
            this._disarm();
            });

            // Reset inactivity timer so it doesn’t cut off while the request is in flight
            clearTimeout(this.commandSilenceTimer);
            this.commandSilenceTimer = setTimeout(() => this._disarm(), 5000);
        }
        },
    };

    // expose globally — do not change this export line
    global.VoiceChat = VoiceChat;
})(window);




















// // 2/9/26
// (function (global) {
//     const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;

//     // Accepts "flexee", "hey flexee", "ok flexee", and tiny misspeaks like "flexi"
//     const HOTWORD_REGEX = /\b(?:hey\s+|ok\s+)?flexe?i?e?\b/i;

//     // Deictic tokens (incl. common ASR confusions)
//     const DEIXIS = /\b(this|here|there|selection|hair|hear)\b/i;
//     const LOCAL_VERBS = /\b(delete|clear|write|put|fill|set)\b/i;

//     // ✅ NEW: normalize common ASR mishears (esp. merge)
//     // Does NOT affect logging; only used for parsing/execution + backend payload.
//     function normalizeTranscriptForCommands(raw) {
//         let s = String(raw || "");

//         // Keep ":" for ranges; remove odd punctuation but keep letters/digits/spaces/:
//         s = s.replace(/[’]/g, "'").replace(/[^\w\s:]/g, " ");
//         s = s.replace(/\s+/g, " ").trim();

//         // Normalize merge family mishears:
//         // march/marge/marsh/merch/mart/merj/murj -> merge
//         s = s.replace(/\b(march|marge|marsh|merch|mart|merj|murj)\b/gi, "merge");

//         // "mercedes" is a super common "merge this" mishear
//         s = s.replace(/\bmercedes\b/gi, "merge these");

//         // "merge d's" / "marge d's" / "merge ds" -> merge these
//         s = s.replace(/\bmerge\s+(d'?s|ds)\b/gi, "merge these");

//         // "merge this/here/there/hair/hear" -> merge these
//         s = s.replace(/\bmerge\s+(this|here|there|hair|hear)\b/gi, "merge these");

//         // If user just says "merge" -> treat as deictic
//         if (/^\s*merge\s*$/i.test(s)) s = "merge these";

//         return s;
//     }

//     // --- Minimal range expander (adds support for "C:C", "C", "column C", "col c", "this") ---
//     function _expandRangeLike(rangeLike) {
//         if (!rangeLike) return null;
//         let s = String(rangeLike).trim();

//         // deictic → current column letter if available
//         const SL = s.toLowerCase();
//         if (SL === 'this' || SL === 'here' || SL === 'there') {
//             try {
//                 if (global.DeicticTarget && DeicticTarget.getColLetter) {
//                     const L = DeicticTarget.getColLetter();
//                     if (L) s = L;
//                 }
//             } catch (_) {}
//         }

//         // strip optional prefixes; uppercase
//         s = s.replace(/^column\s+/i, '').replace(/^col\s+/i, '').toUpperCase();

//         // already an A1 or A1:A1 → keep
//         if (/^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(s)) return s;

//         const rows = (global.hot && hot.countRows && hot.countRows()) || 999999;

//         // "C:C" → "C1:C<rows>"
//         const sameCol = s.match(/^([A-Z]+)\s*:\s*\1$/);
//         if (sameCol) return `${sameCol[1]}1:${sameCol[1]}${rows}`;

//         // bare "C" → "C1:C<rows>"
//         if (/^[A-Z]+$/.test(s)) return `${s}1:${s}${rows}`;

//         return null;
//     }

//     const VoiceChat = {
//         _ready: false,
//         recognition: null,
//         listening: false,
//         userStopped: false,

//         // Simple finite states
//         MODE: "hotword",   // "hotword" | "command" | "stopped"
//         ARMED: false,
//         lastTranscript: "",
//         commandSilenceTimer: null,

//         // Chat cue
//         _listeningCueShown: false,

//         isReady() { return !!this._ready; },

//         init(hotInstance, containerEl) {
//         if (!SpeechRecognition) {
//             console.warn("[VoiceChat] Web Speech API not supported");
//             return;
//         }

//         this.hot = hotInstance;
//         this.container = containerEl;

//         const rec = new SpeechRecognition();
//         rec.lang = "en-US";
//         rec.continuous = true;     // keep streaming to catch hotwords
//         rec.interimResults = true; // detect hotwords quickly
//         rec.maxAlternatives = 1;

//         rec.onresult = (event) => this._onResult(event);

//         rec.onerror = (e) => {
//             console.warn("[VoiceChat] recognition error:", e.error);
//             if (["no-speech", "audio-capture", "network"].includes(e.error)) {
//             try { rec.stop(); } catch (_) {}
//             }
//         };

//         // Keep listening (unless user intentionally stopped)
//         rec.onend = () => {
//             this.listening = false;
//             if (!this.userStopped && this.MODE !== "stopped") {
//             try { rec.start(); this.listening = true; } catch (_) {}
//             }
//         };

//         this.recognition = rec;

//         // Start immediately in hotword mode
//         this.start();

//         // Safety: resume after tab visibility changes
//         document.addEventListener("visibilitychange", () => {
//             if (!this.userStopped &&
//                 document.visibilityState === "visible" &&
//                 !this.listening &&
//                 this.MODE !== "stopped") {
//             try { this.recognition.start(); this.listening = true; } catch (_) {}
//             }
//         });

//         // Auto-restart when idling in hotword mode
//         this.recognition.onend = () => {
//             if (this.MODE === "hotword") {
//             try { this.recognition.start(); } catch (_) {}
//             }
//         };

//         this._ready = true;
//         console.info("[VoiceChat] ready (hotword mode)");
//         },

//         start() {
//         if (!this._ready || !this.recognition) {
//             console.warn("[VoiceChat] start() called before init");
//             return;
//         }
//         if (this.MODE !== "command") this.MODE = "hotword";
//         this.userStopped = false;

//         try {
//             this.recognition.start();
//             this.listening = true;
//             console.info("[VoiceChat] recognition started");
//         } catch (e) {
//             console.debug("[VoiceChat] start skipped:", e && e.message);
//         }
//         },

//         stop() {
//         this.MODE = "stopped";
//         this.userStopped = true;
//         this._hideListeningCue();
//         if (this.recognition) {
//             try { this.recognition.stop(); } catch (_) {}
//         }
//         console.info("[VoiceChat] recognition stopped");
//         },

//         // ---------- internal helpers ----------

//         // ✅ NEW: toggle chatbox glow during listening window (no behavior change otherwise)
//         _setChatGlow(on) {
//         const box = document.getElementById("voiceChatbox");
//         if (!box) return;
//         box.classList.toggle("listening-glow", !!on);
//         },

//         _armForCommand() {
//         this.MODE = "command";
//         this.ARMED = true;
//         this.lastTranscript = "";
//         this._showListeningCue();

//         clearTimeout(this.commandSilenceTimer);
//         this.commandSilenceTimer = setTimeout(() => {
//             this._hideListeningCue();
//             global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
//             addToChatLog && addToChatLog("bot", "⏱️ No command heard — say “Flexee” again.");
//             this._disarm();
//         }, 5000);
//         },

//         _disarm() {
//         this.MODE = "hotword";
//         this.ARMED = false;
//         clearTimeout(this.commandSilenceTimer);
//         this.commandSilenceTimer = null;
//         this._hideListeningCue();
//         },

//         _showListeningCue() {
//         if (this._listeningCueShown) return;
//         addToChatLog && addToChatLog("bot", "🎤 Listening… (5s)");
//         this._listeningCueShown = true;

//         // ✅ NEW: start glow
//         this._setChatGlow(true);
//         },
//         _hideListeningCue() {
//         if (!this._listeningCueShown) return;
//         this._listeningCueShown = false;

//         // ✅ NEW: stop glow
//         this._setChatGlow(false);
//         },

//         // Try local both-hands handler (VoiceActions.__maybeHandleLocalVoice)
//         _tryLocalBothHands(transcript, announce = true) {
//         try {
//             if (!transcript) return false;
//             const s = String(transcript).toLowerCase();
//             if (!LOCAL_VERBS.test(s) || !DEIXIS.test(s)) return false;
//             if (global.__maybeHandleLocalVoice && global.__maybeHandleLocalVoice(transcript)) {
//             if (announce) addToChatLog && addToChatLog("bot", "✅ Done (both hands).");
//             return true;
//             }
//         } catch (e) {
//             console.debug("[VoiceChat] local both-hands handler err:", e);
//         }
//         return false;
//         },

//         _onResult(event) {
//         const last = event.results[event.results.length - 1];
//         const transcript = (last && last[0] && last[0].transcript) ? last[0].transcript : "";

//         // --- Hotword detection from interim text ---
//         if (this.MODE === "hotword") {
//             let detected = HOTWORD_REGEX.test(transcript);
//             if (!detected) {
//             for (let i = Math.max(0, event.results.length - 3); i < event.results.length; i++) {
//                 const seg = event.results[i] && event.results[i][0] ? event.results[i][0].transcript : "";
//                 if (HOTWORD_REGEX.test(seg)) { detected = true; break; }
//             }
//             }
//             if (detected) {
//             this._armForCommand();
//             return; // wait for a final command
//             }
//         }

//         // --- One-shot command mode: only act on final unique result ---
//         if (this.MODE === "command" && this.ARMED && last && last.isFinal && transcript && transcript !== this.lastTranscript) {
//             this.lastTranscript = transcript;

//             // If the *final* text is just the hotword, ignore
//             if (HOTWORD_REGEX.test(transcript.trim())) {
//             console.info("[VoiceChat] Hotword only (final) — not logging or sending.");
//             return;
//             }

//             // Log the user command (original transcript)
//             this._hideListeningCue();
//             addToChatLog && addToChatLog("user", transcript);

//             // ✅ NEW: normalized transcript used only for parsing/execution/backend
//             const normalizedTranscript = normalizeTranscriptForCommands(transcript);

//             // 🔸 LOCAL SHORT-CIRCUIT for deictic both-hands (“delete this”, “write 50 here”, etc.)
//             // Use normalized for better "hair/hear" handling
//             if (this._tryLocalBothHands(normalizedTranscript)) {
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 this._disarm();
//                 return;
//             }

//             // 🔸 Local semantic parser for select/scroll/zoom/copy/paste/merge/UNMERGE
//             {
//             const local = window.VDM_parse && window.VDM_parse(normalizedTranscript);
//             if (local) {
//                 // Try your normal executor path first
//                 if (global.VoiceActions && global.VoiceActions.execute(local)) {
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 this._disarm();
//                 return;
//                 }
//                 // Special local fallback for UNMERGE if executor doesn't handle it
//                 if (local.action === 'unmerge' && window.VDM_tryLocalUnmerge && window.VDM_tryLocalUnmerge(local)) {
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 this._disarm();
//                 return;
//                 }
//             }
//             }

//             // Otherwise, ask backend to parse into JSON
//             // ✅ Send normalized transcript so backend also benefits (no UI change)
//             fetch("/api/voice-command", {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify({ transcript: normalizedTranscript })
//             })
//             .then(async res => {
//             const body = await res.json().catch(() => ({}));
//             return { ok: res.ok, status: res.status, body };
//             })
//             .then(({ ok, status, body }) => {
//             const cmd = body && body.result ? body.result : body;

//             if (!ok || !cmd || cmd.error) {
//                 global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
//                 addToChatLog && addToChatLog(
//                 "bot",
//                 "⚠️ " + (cmd && cmd.error ? cmd.error : "Command failed") + (status ? ` (HTTP ${status})` : "")
//                 );
//                 return;
//             }

//             // If backend says "none" (as in your logs), try local BOTH-hands once more before giving up
//             if (cmd.action === "none" || (typeof cmd.confidence === "number" && cmd.confidence < 0.55)) {
//                 if (this._tryLocalBothHands(normalizedTranscript, /*announce*/ true)) {
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 return;
//                 }
//                 global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW (THIS fixes your case)
//                 addToChatLog && addToChatLog("bot", "🕊️ No sheet action detected.");
//                 return;
//             }

//             // Built-in actions already in your view.html
//             if (cmd.action === "sum" && (cmd.range || cmd.target)) {
//                 const raw = cmd.range || cmd.target;
//                 const expanded = (global.normalizeA1 && global.normalizeA1(raw)) || _expandRangeLike(raw);
//                 if (!expanded) {
//                 global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
//                 addToChatLog && addToChatLog("bot", "⚠️ Invalid range.");
//                 return;
//                 }
//                 const total = executeSum(expanded);
//                 addToChatLog && addToChatLog("bot", `🧮 Sum(${expanded}) = ${total}`);
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 return;
//             }

//             if (cmd.action === "average" && (cmd.range || cmd.target)) {
//                 const raw = cmd.range || cmd.target;
//                 const expanded = (global.normalizeA1 && global.normalizeA1(raw)) || _expandRangeLike(raw);
//                 if (!expanded) {
//                 global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
//                 addToChatLog && addToChatLog("bot", "⚠️ Invalid range.");
//                 return;
//                 }
//                 const avg = executeAverage(expanded);
//                 addToChatLog && addToChatLog("bot", `📊 Average(${expanded}) = ${avg}`);
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 return;
//             }

//             if (cmd.action === "write" && cmd.range && typeof cmd.value !== "undefined") {
//                 const okWrite = executeWriteValue(cmd.range, cmd.value);
//                 addToChatLog && addToChatLog("bot", okWrite ? `✍️ Wrote "${cmd.value}" into ${cmd.range}` : "⚠️ Write failed.");
//                 global.VoiceGlow && global.VoiceGlow[okWrite ? "flashSuccess" : "flashError"](); // ✅ NEW
//                 return;
//             }

//             if (cmd.action === "sort" && cmd.column) {
//                 const dir = (cmd.direction || "asc").toLowerCase();
//                 const okSort = executeSortColumn(cmd.column, dir);
//                 addToChatLog && addToChatLog("bot", okSort ? `⇅ Sorted column ${cmd.column} (${dir})` : "⚠️ Sort failed.");
//                 global.VoiceGlow && global.VoiceGlow[okSort ? "flashSuccess" : "flashError"](); // ✅ NEW
//                 return;
//             }

//             // Extended actions via voiceActions.js (select/scroll/undo/redo/delete/merge/zoom/copy/paste/autofill)
//             if (global.VoiceActions && global.VoiceActions.execute(cmd)) {
//                 global.VoiceGlow && global.VoiceGlow.flashSuccess(); // ✅ NEW
//                 return;
//             }

//             global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
//             addToChatLog && addToChatLog("bot", "🤖 No valid action recognized.");
//             })
//             .catch(err => {
//             console.error("[VoiceChat] Command error:", err);
//             global.VoiceGlow && global.VoiceGlow.flashError(); // ✅ NEW
//             addToChatLog && addToChatLog("bot", "⚠️ Command failed.");
//             })
//             .finally(() => {
//             // disarm after one command and return to hotword mode
//             this._disarm();
//             });

//             // Reset inactivity timer so it doesn’t cut off while the request is in flight
//             clearTimeout(this.commandSilenceTimer);
//             this.commandSilenceTimer = setTimeout(() => this._disarm(), 5000);
//         }
//         },
//     };

//     // expose globally — do not change this export line
//     global.VoiceChat = VoiceChat;
// })(window);




















