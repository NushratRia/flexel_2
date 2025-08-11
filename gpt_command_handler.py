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
    "You convert natural language into spreadsheet commands for a Handsontable-based UI.\n"
    "Reply with ONLY a single JSON object. No prose, no code fences.\n"
    "Use this schema:\n"
    '{ "action": "<one-of: sum|average|sort|filter|select|write>",\n'
    '  "range": "A1:C10",        // for sum/average/select/write\n'
    '  "column": "C",            // for sort/filter\n'
    '  "direction": "asc|desc",  // for sort\n'
    '  "value": "foo"            // for filter or write\n'
    "}\n"
    "Examples:\n"
    ' - "total of C2 to C8" -> {"action":"sum","range":"C2:C8"}\n'
    ' - "average of column B" -> {"action":"average","range":"B:B"}\n'
    ' - "sort column D descending" -> {"action":"sort","column":"D","direction":"desc"}\n'
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


# -----------------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------------
def process_command(transcript: str) -> Dict[str, Any]:
    """
    Convert a natural-language command (spoken text) into a spreadsheet action.

    Parameters
    ----------
    transcript : str
        The user's natural-language instruction (e.g., "sum C2 to C8")

    Returns
    -------
    dict
        On success: a structured command dict, e.g. {"action":"sum","range":"C2:C8"}
        On failure: {"error": "...", "status": <http_status_like_int>}
    """
    logger.info(f"Received voice command: {transcript}")

    # Sanity check before we call the API
    if not _API_KEY:
        return {"error": "Server misconfigured: missing OPENAI_API_KEY", "status": 500}

    try:
        client = _get_client()

        # OpenAI Python v1: client.chat.completions.create(...)
        resp = client.chat.completions.create(
            model=DEFAULT_MODEL,
            temperature=0,  # deterministic output -> easier to parse
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

        # Minimal schema validation (optional; extend as needed)
        if "action" not in parsed:
            logger.error(f"Missing 'action' in parsed JSON: {parsed}")
            return {"error": "Invalid command format (no 'action')", "status": 422, "raw": raw}

        return parsed

    except Exception as e:
        # Normalize and surface meaningful status for the frontend
        msg = str(e)
        logger.error(f"Error in GPT processing: {msg}")

        # Heuristics for common conditions
        lower = msg.lower()
        if "insufficient_quota" in lower or "429" in lower:
            return {
                "error": "You’ve exceeded your OpenAI quota. Check plan & billing.",
                "status": 429,
            }
        if "invalid_api_key" in lower or "incorrect api key" in lower:
            return {
                "error": "Invalid API key. Update OPENAI_API_KEY on the server.",
                "status": 401,
            }

        return {"error": "GPT processing failed", "status": 500}
