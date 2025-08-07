

---

### ✅ `Flexel

```markdown

This project is a **Flask-based web application** that allows users to view and interact with Google Sheets using traditional input, voice commands, and hand gestures (via webcam). It combines:

- ✅ Handsontable for dynamic spreadsheet rendering
- ✅ Voice input using Web Speech API + OpenAI Whisper API
- ✅ Hand gesture recognition using MediaPipe Hands
- ✅ Modular gesture control (17+ gestures supported)
- ✅ Google OAuth integration for authorized saving

---

## 📁 Project Structure

```

├── app.py                     # Flask backend
├── templates/
│   ├── index.html             # Home page for pasting Google Sheet URL
│   └── view\.html              # Sheet viewer with gesture + voice UI
├── static/
│   └── js/
│       ├── gestureController.js
│       ├── gestureHighlight\_debug.js
│       ├── pinchSelect.js
│       ├── voicechat.js
│       └── ... (more gestures)
├── rebuild.json               # OAuth client secrets
├── .env                       # API keys and Flask secret
└── README.md                  # You're here

````

---

## 🚀 How It Works

### 1. **Google Sheet Import**
- User pastes a public or shared Google Sheet URL.
- The app converts it into a downloadable CSV format and renders it via Handsontable.

### 2. **Voice Interaction**
- Web Speech API for live transcription.
- Optionally integrates OpenAI Whisper API for better transcription.
- Chatbox shows real-time transcript log.

### 3. **Gesture Interaction**
- Uses webcam + MediaPipe Hands in-browser (no server-side CV).
- Supports:
  - Highlighting cells, rows, columns
  - Pinch-to-select
  - Zooming in/out
  - Scroll gestures
  - Modular extension for custom gestures

---

## 🧠 Setup Instructions

### 1. 📦 Install Python dependencies
```bash
pip install -r requirements.txt
# or manually
pip install flask python-dotenv google-auth google-auth-oauthlib google-api-python-client
````

### 2. 🔐 Set up `.env`

Create a `.env` file:

```
FLASK_SECRET_KEY=your_secret_here
API_KEY=your_google_api_key
```

Place your Google OAuth client in:

```
rebuild.json
```

### 3. ▶️ Run the Flask app

```bash
python app.py
```

Go to `http://localhost:5000`

---

## 🌐 Frontend Features

* `view.html` is the main interface
* `<video>` and `<canvas>` overlay used for hand tracking
* Modular gesture system in `/static/js/` using `setupGestureXYZ()` functions
* `voicechat.js` handles Web Speech recognition and log display

---

## ✋ Adding New Gestures

Add a new JS file in `/static/js/`:

```js
export function setupTwoFingerDrag(hands, canvasElement, canvasCtx) {
  hands.onResults(results => {
    // Gesture logic
  });
}
```

Then register it in `gestureController.js`:

```js
import { setupTwoFingerDrag } from './twoFingerDrag.js';
setupTwoFingerDrag(hands, canvas, ctx);
```

---

## 🔐 Google OAuth (optional)

* Sign in via `/authorize`
* Authenticated users can autosave back to their own Google Sheet
* Uses Google Sheets + Drive APIs

---

## 🗂 Handsontable Customizations

* Freeze headers
* Resize/drag/drop columns
* Inline editing
* Filter + sort support
* CSV export

---

## 📸 Dependencies

* [MediaPipe Hands](https://google.github.io/mediapipe/)
* [Handsontable](https://handsontable.com/)
* [OpenAI Whisper API (optional)](https://platform.openai.com/docs/guides/speech-to-text)
* [Flask](https://flask.palletsprojects.com/)

---

## 🧪 Debug Tips

* Gesture logs go to `console` + can be sent to `app.log`
* You can test with `combined_sheet.xlsx` if offline
* Use browser devtools to inspect `.gesture-highlight`, `.gesture-selected`

---

## 📄 License

MIT License. Free to use and extend for research, prototyping, or personal use.

---

> Built with ❤️ to explore natural input interaction models: WIMP, Voice, and Gesture.

```

---

```
