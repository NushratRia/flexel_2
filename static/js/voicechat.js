/* static/js/voicechat.js
 * Hotword + one-shot voice command handler using Web Speech API.
 * - Hotwords: "flexee", "hey flexee", "ok flexee" (case/spacing tolerant)
 * - After hotword: listens for ONE final command; if none within 5s, disarms
 * - Auto-resumes listening for hotword after each command or timeout
 *
 * Exposes: window.VoiceChat.init(hot, container), .start(), .stop()
 * Assumes: addToChatLog(), executeSum/executeAverage/executeWriteValue/executeSortColumn()
 *          and (optionally) window.VoiceActions.execute(cmd)
 */

(function (global) {
    const SpeechRecognition =
        global.SpeechRecognition || global.webkitSpeechRecognition;

    const HOTWORD_REGEX = /\b(?:hey\s+|ok\s+)?flexe?e\b/i; // "flexee" variants

    const VoiceChat = {
        recognition: null,
        listening: false,
        userStopped: false,

        // Modes: "hotword" (idle) -> "command" (armed for a single final)
        MODE: "hotword",
        ARMED: false,
        lastTranscript: "",
        commandSilenceTimer: null,

        init(hotInstance, containerEl) {
        if (!SpeechRecognition) {
            console.warn("[VoiceChat] Web Speech API not supported");
            return;
        }

        // stash refs in case other modules need them
        this.hot = hotInstance;
        this.container = containerEl;

        const rec = new SpeechRecognition();
        rec.lang = "en-US";
        rec.continuous = true;       // keep streaming to catch hotwords
        rec.interimResults = true;   // needed to detect hotwords quickly
        rec.maxAlternatives = 1;

        rec.onresult = (event) => this._onResult(event);
        rec.onerror = (e) => {
            console.warn("[VoiceChat] recognition error:", e.error);
            // Auto-recover on transient errors
            if (["no-speech", "audio-capture", "network"].includes(e.error)) {
            try { rec.stop(); } catch (_) {}
            }
        };

        // Keep listening (unless user intentionally stopped)
        rec.onend = () => {
            this.listening = false;
            if (!this.userStopped) {
            try { rec.start(); this.listening = true; } catch (_) {}
            }
        };

        this.recognition = rec;

        // Start immediately in hotword mode
        this.start();

        // Safety: resume after tab visibility changes
        document.addEventListener("visibilitychange", () => {
            if (!this.userStopped && document.visibilityState === "visible" && !this.listening) {
            try { this.recognition.start(); this.listening = true; } catch (_) {}
            }
        });

        console.info("[VoiceChat] initialized (hotword mode)");
        },

        start() {
        if (!this.recognition) return;
        this.userStopped = false;
        if (!this.listening) {
            try { this.recognition.start(); this.listening = true; } catch (_) {}
        }
        this.MODE = "hotword";
        this.ARMED = false;
        },

        stop() {
        if (!this.recognition) return;
        this.userStopped = true;
        try { this.recognition.stop(); } catch (_) {}
        this.listening = false;
        this._disarm();
        },

        _armForCommand() {
        this.MODE = "command";
        this.ARMED = true;
        this.lastTranscript = "";
        addToChatLog && addToChatLog("bot", "👂 Hotword detected — say your command");
        clearTimeout(this.commandSilenceTimer);
        this.commandSilenceTimer = setTimeout(() => {
            this._disarm();
            addToChatLog && addToChatLog("bot", "⏱️ No command heard — say “Flexee” again.");
        }, 5000);
        },

        _disarm() {
        this.MODE = "hotword";
        this.ARMED = false;
        clearTimeout(this.commandSilenceTimer);
        this.commandSilenceTimer = null;
        },

        _onResult(event) {
        const last = event.results[event.results.length - 1];
        const transcript = (last && last[0] && last[0].transcript) ? last[0].transcript : "";

        // --- Hotword detection from interim text ---
        if (this.MODE === "hotword") {
            let detected = HOTWORD_REGEX.test(transcript);
            if (!detected) {
            // scan a couple of recent results for safety
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
            addToChatLog && addToChatLog("user", transcript);

            // send to backend -> get structured cmd -> execute
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
                addToChatLog && addToChatLog("bot", "⚠️ " + (cmd && cmd.error ? cmd.error : "Command failed") + (status ? ` (HTTP ${status})` : ""));
                return;
            }

            //addToChatLog && addToChatLog("bot", "🧠 " + JSON.stringify(cmd));

            // Optional: ignore chatter using confidence (if backend includes it)
            if (cmd.action === "none" || (typeof cmd.confidence === "number" && cmd.confidence < 0.55)) {
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
            // disarm after one command (success or fail) and return to hotword mode
            this._disarm();
            });

            // Reset inactivity timer so it doesn’t cut off while the request is in flight
            clearTimeout(this.commandSilenceTimer);
            this.commandSilenceTimer = setTimeout(() => this._disarm(), 5000);
        }
        },
    };

    // expose globally
    global.VoiceChat = VoiceChat;
})(window);
