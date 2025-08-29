/* static/js/voiceHotword.js
 * Passive hotword -> one-command capture (5s silence timeout).
 * Works alongside your existing mic button + VoiceActions.
 *
 * Requirements: Chrome (webkitSpeechRecognition), microphone permission.
 * Non‑destructive: you can keep your current mic flow; this only adds hotword.
 */
(function (global) {
    const HotwordVoice = {
        // configurable
        hotwords: [
        /\bflexee\b/i,
        /\bhey\s*flexee\b/i,
        /\bok\s*flexee\b/i
        ],
        lang: "en-US",
        silenceMs: 5000,         // stop command session after 5s of silence
        minCommandChars: 2,      // ignore tiny noises

        // internals
        _rec: null,
        _mode: "hotword",        // "hotword" | "command"
        _lastPartial: "",
        _silenceTimer: 0,
        _startedOnce: false,

        init(hot, container) {
        // optional references; not strictly required
        this._hot = hot || null;
        this._container = container || null;

        // build recognizer if available
        if (!("webkitSpeechRecognition" in global)) {
            console.warn("[HotwordVoice] Web Speech API not available");
            return;
        }
        this._rec = new webkitSpeechRecognition();
        this._rec.lang = this.lang;
        this._rec.continuous = true;
        this._rec.interimResults = true;

        this._wireEvents();
        // don’t auto-start until the page has some user gesture OR permission exists.
        // We try to start immediately; if blocked, user can click anywhere once and we retry.
        this.startHotword();
        global.addEventListener("click", () => {
            if (!this._startedOnce && this._rec) this.startHotword();
        }, { once: true });

        console.info("[HotwordVoice] ready");
        },

        startHotword() {
        if (!this._rec) return;
        if (global.isRecording) return; // cooperate with your mic button flow
        if (this._recIsActive()) return;

        this._mode = "hotword";
        this._lastPartial = "";
        try {
            this._rec.start();
            this._startedOnce = true;
            this._logUI("bot", "👂 Hotword listening… (say “Flexee…”)");
        } catch (e) {
            // Safari/Chrome may throw if already started; safe to ignore
        }
        },

        _startCommandWindow() {
        this._mode = "command";
        this._lastPartial = "";
        this._resetSilenceTimer();
        this._logUI("bot", "🎙 Listening for one command…");
        },

        _endCommandWindow(reason = "stopped") {
        this._clearSilenceTimer();
        // let recognition continue so we can fall back into hotword mode,
        // but switch state so we only look for hotwords again.
        this._mode = "hotword";
        this._lastPartial = "";
        this._logUI("bot", reason === "silence" ? "⏹️ (no speech) back to hotword…" : "⏹️ Back to hotword…");
        },

        pause() {
        // external pause (e.g., when the old mic button is used)
        if (!this._rec) return;
        try { this._rec.stop(); } catch (_) {}
        this._clearSilenceTimer();
        this._mode = "hotword";
        },

        resume() { this.startHotword(); },

        // ---- recognition plumbing ----
        _wireEvents() {
        const rec = this._rec;

        rec.onresult = (evt) => {
            // pick the latest result
            const r = evt.results[evt.results.length - 1];
            const text = r[0].transcript.trim();

            if (this._mode === "hotword") {
            // check any hotword anywhere in the utterance
            if (this.hotwords.some(rx => rx.test(text))) {
                this._logUI("user", text);
                this._startCommandWindow();
                return;
            }
            // (keep waiting—no UI noise in hotword mode)
            return;
            }

            // command mode
            if (r.isFinal) {
            const finalText = text;
            if (finalText.length >= this.minCommandChars) {
                this._logUI("user", finalText);
                this._dispatchCommand(finalText);
            }
            // after a single final command, flip back to hotword mode
            this._endCommandWindow("stopped");
            } else {
            // interim results → keep resetting silence window as long as we hear something
            this._lastPartial = text;
            this._resetSilenceTimer();
            }
        };

        rec.onend = () => {
            // if manual mic is active, stay paused
            if (global.isRecording) return;
            // keep the loop alive
            this._clearSilenceTimer();
            setTimeout(() => this.startHotword(), 200);
        };

        rec.onerror = (e) => {
            console.warn("[HotwordVoice] error:", e);
            // try to recover
            this._clearSilenceTimer();
            setTimeout(() => this.startHotword(), 600);
        };
        },

        _recIsActive() {
        // Chrome doesn’t expose a direct state; this heuristic avoids rapid restarts
        return !!this._rec && (this._rec._activeFlag === true);
        },

        _resetSilenceTimer() {
        this._clearSilenceTimer();
        this._silenceTimer = setTimeout(() => {
            // no interim/final activity for N ms → stop command window
            this._endCommandWindow("silence");
        }, this.silenceMs);
        },
        _clearSilenceTimer() { clearTimeout(this._silenceTimer); this._silenceTimer = 0; },

        // ---- integration helpers ----
        _logUI(sender, msg) {
        try {
            const box = document.getElementById("voiceTranscript");
            if (!box) return;
            const div = document.createElement("div");
            div.className = sender === "user" ? "chat-message user" : "chat-message bot";
            div.textContent = (sender === "user" ? "" : "🤖: ") + msg;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        } catch (_) {}
        },

        _dispatchCommand(transcript) {
            // 1) Local parse first (quick wins)
        const local = window.VDM_parse && window.VDM_parse(transcript);
        if (local) {
            // Try the standard path
            if (window.VoiceActions && window.VoiceActions.execute(local)) return;
            // Special local fallback for unmerge
            if (local.action === 'unmerge' && window.VDM_tryLocalUnmerge && window.VDM_tryLocalUnmerge(local)) return;
        }
        // Mirror your existing /api/voice-command flow + VoiceActions.execute fallback
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
            this._logUI("bot", "⚠️ " + (cmd && cmd.error ? cmd.error : "Command failed") + (status ? ` (HTTP ${status})` : ""));
            return;
            }

            // First let your VoiceActions handle extended commands
            if (global.VoiceActions && global.VoiceActions.execute(cmd)) return;

            // Fallback to the helpers defined in view.html (sum/avg/write/sort)
            if (cmd.action === "sum" && (cmd.range || cmd.target)) {
            const total = global.executeSum(cmd.range || cmd.target);
            this._logUI("bot", `🧮 Sum(${cmd.range || cmd.target}) = ${total}`);
            return;
            }
            if (cmd.action === "average" && (cmd.range || cmd.target)) {
            const avg = global.executeAverage(cmd.range || cmd.target);
            this._logUI("bot", `📊 Average(${cmd.range || cmd.target}) = ${avg}`);
            return;
            }
            if (cmd.action === "write" && cmd.range && typeof cmd.value !== "undefined") {
            const wrote = global.executeWriteValue(cmd.range, cmd.value);
            this._logUI("bot", wrote ? `✍️ Wrote "${cmd.value}" into ${cmd.range}` : "⚠️ Write failed.");
            return;
            }
            if (cmd.action === "sort" && cmd.column) {
            const dir = (cmd.direction || "asc").toLowerCase();
            const ok = global.executeSortColumn(cmd.column, dir);
            this._logUI("bot", ok ? `⇅ Sorted column ${cmd.column} (${dir})` : "⚠️ Sort failed.");
            return;
            }

            this._logUI("bot", "No valid action recognized.");
        })
        .catch(err => {
            console.error("[HotwordVoice] dispatch error:", err);
            this._logUI("bot", "⚠️ Command failed.");
        });
        }
    };

    // simple cooperation with the existing mic button
    Object.defineProperty(webkitSpeechRecognition.prototype, "_activeFlag", {
        configurable: true,
        writable: true,
        value: false
    });
    const _origStart = webkitSpeechRecognition.prototype.start;
    const _origStop  = webkitSpeechRecognition.prototype.stop;
    webkitSpeechRecognition.prototype.start = function () { this._activeFlag = true;  return _origStart.apply(this, arguments); };
    webkitSpeechRecognition.prototype.stop  = function () { this._activeFlag = false; return _origStop.apply(this, arguments); };

    global.HotwordVoice = HotwordVoice;
})(window);
