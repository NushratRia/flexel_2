import openai
import logging
from dotenv import load_dotenv
import os

# Setup logging
logger = logging.getLogger(__name__)
handler = logging.FileHandler('app.log')
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
logger.setLevel(logging.INFO)
logger.addHandler(handler)

load_dotenv()
API_KEY = os.getenv("API_KEY")

SYSTEM_PROMPT = """
You are an assistant that converts natural language spreadsheet instructions into JavaScript-compatible JSON commands.
Respond only with JSON like:
{"action": "sum", "target": "B2:B10"}
"""

def process_command(transcript):
    logger.info(f"Received voice command: {transcript}")
    try:
        completion = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": transcript}
            ]
        )
        response_text = completion['choices'][0]['message']['content']
        logger.info(f"GPT-4 response: {response_text}")
        return response_text
    except Exception as e:
        logger.error(f"Error in GPT processing: {e}")
        return '{"error": "GPT processing failed"}'
