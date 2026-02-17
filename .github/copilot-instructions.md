# Flexel AI Coding Instructions

## Architecture Overview
This is a Flask-based web application that enables natural interaction with Google Sheets through voice commands and hand gestures. The system combines:

- **Backend**: Python Flask server handling Google Sheets API integration and OpenAI-powered voice command processing
- **Frontend**: Handsontable spreadsheet renderer with MediaPipe hand tracking and modular gesture recognition
- **Data Flow**: Google Sheets → CSV export → Handsontable display → Voice/Gesture input → Spreadsheet actions

## Key Components
- `app.py`: Main Flask routes for sheet loading, OAuth, and API endpoints
- `gpt_command_handler.py`: OpenAI GPT integration for natural language voice commands
- `static/js/gestureActions.js`: Central gesture coordination and Handsontable integration
- `static/js/` (various): Modular gesture implementations (pinch, scroll, zoom, etc.)
- `templates/view.html`: Main spreadsheet viewer with webcam overlay

## Critical Workflows

### Development Setup
```bash
pip install -r requirements.txt
# Create .env with: FLASK_SECRET_KEY, API_KEY (Google), OPENAI_API_KEY
# Place Google OAuth client secrets in rebuild.json
python app.py  # Runs on localhost:5050 with debug=True
```

### Adding New Gestures
1. Create `static/js/newGesture.js` with `setupNewGesture(hands, canvas, ctx)` function
2. Register in `gestureActions.js` init method
3. Use global `GestureUtils` for common helpers (tdAt, rcFromTD, etc.)

### Voice Command Processing
- Commands processed via OpenAI GPT-4o-mini with structured JSON schema
- Confidence gating: different thresholds per action (delete: 0.80, write: 0.65, default: 0.55)
- Actions: sum, average, sort, filter, select, write, scroll, undo, delete, merge, zoom, copy, paste, autofill

## Project Conventions

### Gesture System Patterns
- **Global State**: Use `global.__handRegions`, `global.__lastTwoHandTargets` for cross-gesture coordination
- **Meta Classes**: `hot.setCellMeta(row, col, 'className', 'gesture-selected')` for persistent styling
- **Hysteresis**: Pinch gestures use PINCH_IN (0.065) / PINCH_OUT (0.085) thresholds with HOLD_MS (80ms)
- **Cooldown**: 350ms between gesture actions to prevent spam

### Voice Integration
- API endpoint: `POST /api/voice-command` returns JSON action objects
- Logging: All voice processing logged to `app.log` with timestamps
- Error handling: Graceful fallbacks for API failures (quota, invalid key)

### Handsontable Integration
- Access via `HOT()` function: `const hot = HOT();`
- Cell coordinates: Use `GU.rcFromTD(td)` to convert DOM elements to row/col
- Selection: `hot.selectCell(r1, c1, r2, c2, true)` for range selection
- Rendering: Call `hot.render()` after meta changes

### File Organization
- **Backend**: Pure Python modules in root (app.py, gpt_command_handler.py)
- **Frontend**: Modular JS in `static/js/`, HTML templates in `templates/`
- **Config**: Environment variables in `.env`, OAuth secrets in `rebuild.json`

## Integration Points
- **Google Sheets API**: Read via CSV export, write via authenticated API calls
- **OpenAI API**: Voice command interpretation with custom system prompts
- **MediaPipe Hands**: Client-side gesture recognition (no server-side CV)
- **Handsontable**: Spreadsheet rendering with custom gesture overlays

## Common Patterns
- **Error Handling**: Try/catch with logging to `app.log`, user-friendly error messages
- **Async Operations**: Voice commands are synchronous, gestures are real-time event-driven
- **State Management**: Global objects for gesture state, session storage for OAuth
- **Testing**: Manual testing with webcam, console logs, browser dev tools

## Deployment Notes
- Python 3.11.9 runtime (runtime.txt)
- Gunicorn for production serving
- Environment variables required: OPENAI_API_KEY, API_KEY (Google), FLASK_SECRET_KEY