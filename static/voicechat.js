export function enableVoiceChat() {
    const micBtn = document.getElementById("micBtn");
    const transcriptBox = document.getElementById("voiceTranscript");
    let isRecording = false;
    let recognition;

    micBtn.addEventListener("click", () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    function startRecording() {
        isRecording = true;
        micBtn.textContent = "⏹ Stop";
        micBtn.style.background = "#dc3545";
        transcriptBox.textContent = "Listening... 🎙";

        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.lang = 'en-US';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let transcript = event.results[event.results.length - 1][0].transcript;
                if (event.results[event.results.length - 1].isFinal) {
                    addToChatLog("user", transcript);
                }
            };
            recognition.start();
        }
    }

    function stopRecording() {
        isRecording = false;
        micBtn.textContent = "🎤";
        micBtn.style.background = "#007bff";
        if (recognition) recognition.stop();
    }

    function addToChatLog(sender, message) {
        const logEntry = document.createElement("div");
        logEntry.textContent = (sender === "user" ? "👤: " : "🤖: ") + message;
        transcriptBox.appendChild(logEntry);
        transcriptBox.scrollTop = transcriptBox.scrollHeight;
    }
}
