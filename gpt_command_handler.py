"""
gpt_command_handler.py
----------------------

Small helper module to turn natural-language voice commands into
structured spreadsheet actions using the OpenAI API.

Design goals:
- Keep ALL integration isolated from the rest of your app
- Use OpenAI Python v1 client (no deprecated ChatCompletion module calls)
- Log everything to app.log for easy debugging
- Return Python dicts (Flask can jsonify these directly)
- Be robust to the model wrapping JSON in code fences or extra text
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from openai import OpenAI

# -----------------------------------------------------------------------------
# Logging setup (module-scoped, so every import shares the same handler)
# -----------------------------------------------------------------------------
logger = logging.getLogger(__name__)
if not logger.handlers:  # avoid duplicate handlers on hot reloads
    fh = logging.FileHandler("app.log")
    fh.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
    logger.addHandler(fh)
logger.setLevel(logging.INFO)

# -----------------------------------------------------------------------------
# Environment / Client
# -----------------------------------------------------------------------------
load_dotenv()  # allow local .env during dev
_API_KEY = os.getenv("OPENAI_API_KEY") or os.getenv("API_KEY")  # fallback for legacy var

# You can change this in one place if you want to try other chat models
DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Lazily created/OpenAI client (constructed on first use)
_client: Optional[OpenAI] = None


def _get_client() -> OpenAI:
    """
    Create (or return existing) OpenAI client.
    Reads API key from env. If missing, we still return a client but calls will fail.
    """
    global _client
    if _client is None:
        if not _API_KEY:
            logger.warning("No OPENAI_API_KEY/API_KEY found in env; API calls will fail until set.")
        _client = OpenAI(api_key=_API_KEY)
    return _client


# -----------------------------------------------------------------------------
# Prompt & JSON parsing helpers
# -----------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "You convert natural‑language requests into spreadsheet commands for a Handsontable-based UI.\n"
    "Be a CALIBRATED GATEKEEPER: accept semantically similar or shorthand commands (e.g., 'sum C two to eight', "
    "'put 42 in C3', 'sort D desc'), but if the user is clearly not trying to read/change/navigate the sheet, "
    "respond with {\"action\":\"none\",\"confidence\":0}.\n"
    "Reply with ONLY one JSON object (no prose, no code fences).\n"
    "Schema:\n"
    "{\n"
    "  \"action\": \"<one-of: none|sum|average|sort|filter|select|write|scroll|undo|redo|delete|merge|zoom|copy|paste|autofill>\",\n"
    "  \"range\":  \"A1:C10\",          // sum/average/select/write/delete/merge/autofill\n"
    "  \"column\": \"C\",               // sort/filter\n"
    "  \"direction\": \"asc|desc|in|out|reset\", // sort or zoom\n"
    "  \"value\":  \"foo\",             // write/filter\n"
    "  \"row\":    5,                   // scroll (1-based)\n"
    "  \"col\":    \"B\",               // scroll (letter) or number (1-based)\n"
    "  \"at\":     \"B7\",              // paste target cell\n"
    "  \"pattern\":\"series|repeat\",   // autofill\n"
    "  \"confidence\": 0.0              // 0–1: certainty this is a valid sheet action\n"
    "}\n"
    "Guidelines:\n"
    " - Map paraphrases and shorthand to supported actions.\n"
    " - If the intent lacks REQUIRED fields (e.g., 'write 42' with no cell), return action none.\n"
    " - Prefer column letters when possible (e.g., \"C\").\n"
    "Examples (VALID – accept paraphrases):\n"
    "  \"total of C2 to C8\"           -> {\"action\":\"sum\",\"range\":\"C2:C8\",\"confidence\":0.95}\n"
    "  \"sum C two through eight\"     -> {\"action\":\"sum\",\"range\":\"C2:C8\",\"confidence\":0.9}\n"
    "  \"average column B\"            -> {\"action\":\"average\",\"range\":\"B:B\",\"confidence\":0.95}\n"
    "  \"sort D descending\"           -> {\"action\":\"sort\",\"column\":\"D\",\"direction\":\"desc\",\"confidence\":0.9}\n"
    "  \"select A1 to C3\"             -> {\"action\":\"select\",\"range\":\"A1:C3\",\"confidence\":0.95}\n"
    "  \"put 42 in C3\"                -> {\"action\":\"write\",\"range\":\"C3\",\"value\":\"42\",\"confidence\":0.95}\n"
    "  \"go to row 50, column C\"      -> {\"action\":\"scroll\",\"row\":50,\"col\":\"C\",\"confidence\":0.9}\n"
    "  \"undo\"                        -> {\"action\":\"undo\",\"confidence\":0.95}\n"
    "  \"clear B2 through B10\"        -> {\"action\":\"delete\",\"range\":\"B2:B10\",\"confidence\":0.9}\n"
    "  \"merge A1:C1\"                 -> {\"action\":\"merge\",\"range\":\"A1:C1\",\"confidence\":0.9}\n"
    "  \"zoom in\"                     -> {\"action\":\"zoom\",\"direction\":\"in\",\"confidence\":0.9}\n"
    "  \"copy A2:C4\"                  -> {\"action\":\"copy\",\"range\":\"A2:C4\",\"confidence\":0.95}\n"
    "  \"paste at B7\"                 -> {\"action\":\"paste\",\"at\":\"B7\",\"confidence\":0.9}\n"
    "  \"autofill A1:A10 as series\"   -> {\"action\":\"autofill\",\"range\":\"A1:A10\",\"pattern\":\"series\",\"confidence\":0.9}\n"
    "Examples (IRRELEVANT → none):\n"
    "  \"is it working\", \"what is it doing\", \"hello there\", \"tell me a joke\" -> {\"action\":\"none\",\"confidence\":0}\n"
)




def _safe_parse_json(text: str) -> Optional[Dict[str, Any]]:
    """
    Extract the first JSON object from `text` and parse it.
    Handles cases where the model returns code fences or extra text.
    Returns None if parsing fails.
    """
    if not text:
        return None

    # Trim whitespace and code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # remove triple backticks blocks if any
        cleaned = cleaned.strip("`")
        # sometimes there's a leading "json\n"
        cleaned = cleaned.replace("json\n", "", 1).replace("JSON\n", "", 1)

    # Try a whole-string parse first
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    # Fallback: find outermost braces
    try:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(cleaned[start : end + 1])
    except Exception:
        pass

    return None



# Public API

def process_command(transcript: str) -> Dict[str, Any]:
    """
    Convert a natural-language command (spoken text) into a spreadsheet action.
    """
    logger.info(f"Received voice command: {transcript}")

    if not _API_KEY:
        return {"error": "Server misconfigured: missing OPENAI_API_KEY", "status": 500}

    try:
        client = _get_client()
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            temperature=0,  
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": transcript},
            ],
        )

        raw = (resp.choices[0].message.content or "").strip()
        logger.info(f"GPT raw response: {raw}")

        parsed = _safe_parse_json(raw)
        if not parsed:
            logger.error(f"Could not parse JSON from response: {raw}")
            return {"error": "Could not parse command", "status": 422, "raw": raw}

        if "action" not in parsed:
            logger.error(f"Missing 'action' in parsed JSON: {parsed}")
            return {"error": "Invalid command format (no 'action')", "status": 422, "raw": raw}

        # ---- Confidence gate (runs BEFORE returning) ----
        ALLOWED = {
            "none","sum","average","sort","filter","select","write","scroll",
            "undo","redo","delete","merge","zoom","copy","paste","autofill"
        }
        action = str(parsed.get("action", "")).lower()

        try:
            confidence = float(parsed.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0

        MIN_CONF = {
            "delete": 0.80,
            "merge":  0.80,
            "write":  0.65,
            "_default": 0.55,
        }
        threshold = MIN_CONF.get(action, MIN_CONF["_default"])

        if action not in ALLOWED or action == "none" or confidence < threshold:
            logger.info(f"Command gated: action={action} confidence={confidence} < {threshold}")
            return {"action": "none", "confidence": confidence}

        # Passed the gate 
        return parsed

    except Exception as e:
        msg = str(e)
        logger.error(f"Error in GPT processing: {msg}")

        lower = msg.lower()
        if "insufficient_quota" in lower or "429" in lower:
            return {"error": "You’ve exceeded your OpenAI quota. Check plan & billing.", "status": 429}
        if "invalid_api_key" in lower or "incorrect api key" in lower:
            return {"error": "Invalid API key. Update OPENAI_API_KEY on the server.", "status": 401}

        return {"error": "GPT processing failed", "status": 500}

