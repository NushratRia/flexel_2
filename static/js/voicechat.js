/* static/js/voicechat.js
 * Hotword + one-shot voice command handler using Web Speech API.
 * - Hotwords: "flexee", "hey flexee", "ok flexee"
 * - After hotword: listens for ONE final command; if none within 5s, disarms
 * - Auto-resumes listening for hotword after each command or timeout
 *
 * Exposes: window.VoiceChat.init(hot, container), .start(), .stop()
 * Depends on (optionally): addToChatLog(), executeSum/executeAverage/executeWriteValue/executeSortColumn()
 * And (important): window.VoiceActions + window.__maybeHandleLocalVoice (from voiceActions.js)
 */
(function (global) {
    const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;

    // Accepts "flexee", "hey flexee", "ok flexee", and tiny misspeaks like "flexi"
    const HOTWORD_REGEX = /\b(?:hey\s+|ok\s+)?flexe?i?e?\b/i;

    // Deictic tokens (incl. common ASR confusions)
    const DEIXIS = /\b(this|here|there|selection|hair|hear)\b/i;
    const LOCAL_VERBS = /\b(delete|clear|write|put|fill|set)\b/i;

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

        _armForCommand() {
        this.MODE = "command";
        this.ARMED = true;
        this.lastTranscript = "";
        this._showListeningCue();

        clearTimeout(this.commandSilenceTimer);
        this.commandSilenceTimer = setTimeout(() => {
            this._hideListeningCue();
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
        },
        _hideListeningCue() {
        if (!this._listeningCueShown) return;
        this._listeningCueShown = false;
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

            // Log the user command
            this._hideListeningCue();
            addToChatLog && addToChatLog("user", transcript);

            // 🔸 LOCAL SHORT-CIRCUIT for deictic both-hands (“delete this”, “write 50 here”, etc.)
            if (this._tryLocalBothHands(transcript)) {
            this._disarm();
            return;
            }

            // Otherwise, ask backend to parse into JSON
            fetch("/api/voice-command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript })
            })
            .then(async res => {
            const body = await res.json().catch(() => ({}));
            return { ok: res.ok, status: res.status, body };
            })
            .then(({ ok, status, body }) => {
            const cmd = body && body.result ? body.result : body;

            if (!ok || !cmd || cmd.error) {
                addToChatLog && addToChatLog(
                "bot",
                "⚠️ " + (cmd && cmd.error ? cmd.error : "Command failed") + (status ? ` (HTTP ${status})` : "")
                );
                return;
            }

            // If backend says "none" (as in your logs), try local BOTH-hands once more before giving up
            if (cmd.action === "none" || (typeof cmd.confidence === "number" && cmd.confidence < 0.55)) {
                if (this._tryLocalBothHands(transcript, /*announce*/ true)) return;
                addToChatLog && addToChatLog("bot", "🕊️ No sheet action detected.");
                return;
            }

            // Built-in actions already in your view.html
            if (cmd.action === "sum" && (cmd.range || cmd.target)) {
                const range = cmd.range || cmd.target;
                const total = executeSum(range);
                addToChatLog && addToChatLog("bot", `🧮 Sum(${range}) = ${total}`);
                return;
            }

            if (cmd.action === "average" && (cmd.range || cmd.target)) {
                const range = cmd.range || cmd.target;
                const avg = executeAverage(range);
                addToChatLog && addToChatLog("bot", `📊 Average(${range}) = ${avg}`);
                return;
            }

            if (cmd.action === "write" && cmd.range && typeof cmd.value !== "undefined") {
                const okWrite = executeWriteValue(cmd.range, cmd.value);
                addToChatLog && addToChatLog("bot", okWrite ? `✍️ Wrote "${cmd.value}" into ${cmd.range}` : "⚠️ Write failed.");
                return;
            }

            if (cmd.action === "sort" && cmd.column) {
                const dir = (cmd.direction || "asc").toLowerCase();
                const okSort = executeSortColumn(cmd.column, dir);
                addToChatLog && addToChatLog("bot", okSort ? `⇅ Sorted column ${cmd.column} (${dir})` : "⚠️ Sort failed.");
                return;
            }

            // Extended actions via voiceActions.js (select/scroll/undo/redo/delete/merge/zoom/copy/paste/autofill)
            if (global.VoiceActions && global.VoiceActions.execute(cmd)) return;

            addToChatLog && addToChatLog("bot", "🤖 No valid action recognized.");
            })
            .catch(err => {
            console.error("[VoiceChat] Command error:", err);
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











// /* static/js/voicechat.js
//  * Hotword + one-shot voice command handler using Web Speech API.
//  * - Hotwords: "flexee", "hey flexee", "ok flexee" (case/spacing tolerant)
//  * - After hotword: listens for ONE final command; if none within 5s, disarms
//  * - Auto-resumes listening for hotword after each command or timeout
//  *
//  * Exposes: window.VoiceChat.init(hot, container), .start(), .stop()
//  * Assumes: addToChatLog(), executeSum/executeAverage/executeWriteValue/executeSortColumn()
//  *          and (optionally) window.VoiceActions.execute(cmd)
//  */

// (function (global) {
//     const SpeechRecognition =
//         global.SpeechRecognition || global.webkitSpeechRecognition;

//     // Accepts "flexee", "hey flexee", "ok flexee", and tiny misspeaks like "flexi"
//     const HOTWORD_REGEX = /\b(?:hey\s+|ok\s+)?flexe?i?e?\b/i;

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
//         // --- ADDED: keep track of a “listening…” line we inject in chat ---
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
//             // Auto-recover on transient errors
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

//         // auto-restart when idling in hotword mode
//         this.recognition.onend = () => {
//             if (this.MODE === "hotword") {
//             try { this.recognition.start(); } catch (_) {}
//             }
//         };

//         // Mark ready
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
//             // Chrome throws if recognition is already running; make it harmless
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

//         _armForCommand() {
//         this.MODE = "command";
//         this.ARMED = true;
//         this.lastTranscript = "";
//         // --- ADDED: visual cue while waiting for the one-shot command
//         this._showListeningCue();

//         clearTimeout(this.commandSilenceTimer);
//         this.commandSilenceTimer = setTimeout(() => {
//             // timeout without a real command
//             this._hideListeningCue();
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

//         // --- ADDED: chat cue management ---
//         _showListeningCue() {
//         if (this._listeningCueShown) return;
//         addToChatLog && addToChatLog("bot", "🎤 Listening… (5s)");
//         this._listeningCueShown = true;
//         },
//         _hideListeningCue() {
//         if (!this._listeningCueShown) return;
//         // We can’t delete existing chat entries without changing chat code;
//         // simply mark the cue as no longer active so we don’t add duplicates.
//         this._listeningCueShown = false;
//         },

//         _onResult(event) {
//         const last = event.results[event.results.length - 1];
//         const transcript = (last && last[0] && last[0].transcript) ? last[0].transcript : "";

//         // --- Hotword detection from interim text ---
//         if (this.MODE === "hotword") {
//             let detected = HOTWORD_REGEX.test(transcript);
//             if (!detected) {
//             // scan a couple of recent results for safety
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

//             // ✨ NEW: If the *final* text is just the hotword, do nothing (don’t log)
//             if (HOTWORD_REGEX.test(transcript.trim())) {
//             console.info("[VoiceChat] Hotword only (final) — not logging or sending.");
//             return;
//             }

//             // This is a real command → log & process
//             this._hideListeningCue();
//             addToChatLog && addToChatLog("user", transcript);

//             // send to backend -> get structured cmd -> execute
//             fetch("/api/voice-command", {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify({ transcript })
//             })
//             .then(async res => {
//                 const body = await res.json().catch(() => ({}));
//                 return { ok: res.ok, status: res.status, body };
//             })
//             .then(({ ok, status, body }) => {
//                 const cmd = body && body.result ? body.result : body;

//                 if (!ok || !cmd || cmd.error) {
//                 addToChatLog && addToChatLog(
//                     "bot",
//                     "⚠️ " + (cmd && cmd.error ? cmd.error : "Command failed") + (status ? ` (HTTP ${status})` : "")
//                 );
//                 return;
//                 }

//                 // Optional: ignore chatter using confidence (if backend includes it)
//                 // if (cmd.action === "none" || (typeof cmd.confidence === "number" && cmd.confidence < 0.55)) {
//                 // addToChatLog && addToChatLog("bot", "🕊️ No sheet action detected.");
//                 // return;
//                 // }

//                 // >>> LOCAL FALLBACK for deictic phrases like "delete this"
//             {
//             const t = (transcript || "").toLowerCase();
//             const opMatch = t.match(/\b(delete|clear|merge|copy|paste|select|undo|redo)\b/);
//             const hasDeixis = /\b(this|that|these|those|here|selection)\b/.test(t);

//             // Helpers to convert Handsontable selection -> A1
//             const a1FromSel = (sel) => {
//                 if (!sel) return null;
//                 const r1 = Math.min(sel[0], sel[2]), c1 = Math.min(sel[1], sel[3]);
//                 const r2 = Math.max(sel[0], sel[2]), c2 = Math.max(sel[1], sel[3]);
//                 const col = (n)=>{let s=""; do{ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; }while(n>=0); return s;};
//                 return `${col(c1)}${r1+1}:${col(c2)}${r2+1}`;
//             };
//             const topLeftA1 = (sel) => {
//                 if (!sel) return null;
//                 const r = Math.min(sel[0], sel[2]), c = Math.min(sel[1], sel[3]);
//                 const col = (n)=>{let s=""; do{ s=String.fromCharCode(65+(n%26))+s; n=Math.floor(n/26)-1; }while(n>=0); return s;};
//                 return `${col(c)}${r+1}`;
//             };

//             let executed = false;
//             if (this.hot && opMatch && hasDeixis) {
//                 const sel = this.hot.getSelectedLast();
//                 if (!sel) {
//                 // No selection to act on — tell the user how to proceed.
//                 addToChatLog && addToChatLog("bot", "⚠️ No selection — pinch to select a cell/row/col, then say the command.");
//                 } else {
//                 const op = opMatch[1];
//                 const range = a1FromSel(sel);
//                 if (window.VoiceActions) {
//                     if (op === "delete" || op === "clear") executed = VoiceActions.execute({ action: "delete", range });
//                     else if (op === "merge")               executed = VoiceActions.execute({ action: "merge",  range });
//                     else if (op === "copy")                executed = VoiceActions.execute({ action: "copy",   range });
//                     else if (op === "paste")               executed = VoiceActions.execute({ action: "paste",  at: topLeftA1(sel) });
//                     else if (op === "select")              executed = VoiceActions.execute({ action: "select", range });
//                     else if (op === "undo")                executed = VoiceActions.execute({ action: "undo" });
//                     else if (op === "redo")                executed = VoiceActions.execute({ action: "redo" });
//                 }
//                 }
//             }
//             if (executed) return; // stop here — we handled it locally
//             }

//             // If we get here, backend gave "none" and local fallback didn’t fire
//             if (cmd.action === "none" || (typeof cmd.confidence === "number" && cmd.confidence < 0.55)) {
//             addToChatLog && addToChatLog("bot", "🕊️ No sheet action detected.");
//             return;
//             }





//                 // Built-in actions already in your view.html
//                 if (cmd.action === "sum" && (cmd.range || cmd.target)) {
//                 const range = cmd.range || cmd.target;
//                 const total = executeSum(range);
//                 addToChatLog && addToChatLog("bot", `🧮 Sum(${range}) = ${total}`);
//                 return;
//                 }

//                 if (cmd.action === "average" && (cmd.range || cmd.target)) {
//                 const range = cmd.range || cmd.target;
//                 const avg = executeAverage(range);
//                 addToChatLog && addToChatLog("bot", `📊 Average(${range}) = ${avg}`);
//                 return;
//                 }

//                 if (cmd.action === "write" && cmd.range && typeof cmd.value !== "undefined") {
//                 const okWrite = executeWriteValue(cmd.range, cmd.value);
//                 addToChatLog && addToChatLog("bot", okWrite ? `✍️ Wrote "${cmd.value}" into ${cmd.range}` : "⚠️ Write failed.");
//                 return;
//                 }

//                 if (cmd.action === "sort" && cmd.column) {
//                 const dir = (cmd.direction || "asc").toLowerCase();
//                 const okSort = executeSortColumn(cmd.column, dir);
//                 addToChatLog && addToChatLog("bot", okSort ? `⇅ Sorted column ${cmd.column} (${dir})` : "⚠️ Sort failed.");
//                 return;
//                 }

//                 // Extended actions via voiceActions.js (select/scroll/undo/redo/delete/merge/zoom/copy/paste/autofill)
//                 if (global.VoiceActions && global.VoiceActions.execute(cmd)) return;

//                 addToChatLog && addToChatLog("bot", "🤖 No valid action recognized.");
//             })
//             .catch(err => {
//                 console.error("[VoiceChat] Command error:", err);
//                 addToChatLog && addToChatLog("bot", "⚠️ Command failed.");
//             })
//             .finally(() => {
//                 // disarm after one command (success or fail) and return to hotword mode
//                 this._disarm();
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
