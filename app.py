import flask
from flask import Flask, request, render_template, redirect, url_for, session, jsonify
import requests
import csv
import io
import re
from dotenv import load_dotenv
import os
import google.oauth2.credentials
import google_auth_oauthlib.flow
import googleapiclient.discovery
import logging
from gpt_command_handler import process_command


# Configure logging
logging.basicConfig(
    filename='app.log',
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

load_dotenv()
API_KEY = os.getenv("API_KEY")
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
]
CLIENT_SECRET_FILE = 'rebuild.json'

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "dev-secret")  # Use secure key in production

def get_spreadsheet_title(sheet_id, api_key):
    try:
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}?fields=properties.title&key={api_key}"
        logging.debug(f"Fetching spreadsheet title for Sheet ID: {sheet_id}")
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        logging.info(f"Successfully fetched spreadsheet title: {data['properties']['title']}")
        return data['properties']['title']
    except Exception as e:
        logging.error(f"Title fetch error: {e}", exc_info=True)
    return "Untitled Spreadsheet"

@app.route('/view')
def view_sheet():
    csv_url = request.args.get('csv_url')
    sheet_name = request.args.get('sheet_name', 'Untitled Sheet')
    logging.debug(f"Accessing /view with csv_url={csv_url} and sheet_name={sheet_name}")

    if not csv_url:
        logging.warning("Missing sheet URL on /view")
        return "Missing sheet URL."

    try:
        response = requests.get(csv_url)
        response.raise_for_status()
        f = io.StringIO(response.text)
        reader = list(csv.reader(f))
        headers = reader[0]
        data = reader[1:]
        user_logged_in = 'credentials' in session
        is_authed = 'credentials' in session
        logging.info("CSV data successfully fetched and parsed.")
        return render_template('view.html', headers=headers, data=data, sheet_name=sheet_name, user_logged_in=user_logged_in, is_authed=is_authed)
    except Exception as e:
        logging.error(f"Failed to load sheet: {e}", exc_info=True)
        return f"Failed to load sheet: {e}"

@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        sheet_url = request.form['sheet_url']
        logging.debug(f"Received POST with sheet_url: {sheet_url}")

        match = re.search(r'/d/([a-zA-Z0-9-_]+)', sheet_url)
        if not match:
            logging.warning("Invalid Google Sheets URL format.")
            return "Invalid Google Sheets URL."
        sheet_id = match.group(1)

        gid_match = re.search(r'gid=([0-9]+)', sheet_url)
        gid = gid_match.group(1) if gid_match else '0'

        spreadsheet_title = get_spreadsheet_title(sheet_id, API_KEY)
        csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
        return redirect(url_for('view_sheet', csv_url=csv_url, sheet_name=spreadsheet_title))

    return render_template('index.html')

@app.route('/authorize')
def authorize():
    logging.debug("Initiating OAuth2 flow")
    flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
        CLIENT_SECRET_FILE, scopes=SCOPES)
    flow.redirect_uri = url_for('oauth2callback', _external=True)

    authorization_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true')
    session['state'] = state
    logging.info("Redirecting user to Google's OAuth2 consent screen")
    return redirect(authorization_url)

@app.route('/oauth2callback')
def oauth2callback():
    logging.debug("Handling OAuth2 callback")
    state = session['state']
    flow = google_auth_oauthlib.flow.Flow.from_client_secrets_file(
        CLIENT_SECRET_FILE, scopes=SCOPES, state=state)
    flow.redirect_uri = url_for('oauth2callback', _external=True)

    flow.fetch_token(authorization_response=request.url)

    credentials = flow.credentials
    session['credentials'] = credentials_to_dict(credentials)
    logging.info("OAuth2 authentication successful")
    return redirect(url_for('index'))

def credentials_to_dict(credentials):
    return {
        'token': credentials.token,
        'refresh_token': credentials.refresh_token,
        'token_uri': credentials.token_uri,
        'client_id': credentials.client_id,
        'client_secret': credentials.client_secret,
        'scopes': credentials.scopes
    }

@app.route('/save', methods=['POST'])
def save_to_sheet():
    if 'credentials' not in session:
        logging.warning("Attempt to save without authentication")
        return redirect(url_for('authorize'))

    credentials = google.oauth2.credentials.Credentials(**session['credentials'])
    service = googleapiclient.discovery.build('sheets', 'v4', credentials=credentials)

    spreadsheet_id = request.form.get('sheet_id')
    range_ = request.form.get('range', 'Sheet1!A1')
    data = request.form.getlist('data[]')

    logging.debug(f"Saving data to spreadsheet_id={spreadsheet_id}, range={range_}")

    values = [row.split(',') for row in data]
    body = {'values': values}

    try:
        result = service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range_,
            valueInputOption='RAW',
            body=body
        ).execute()
        logging.info(f"Data successfully saved to sheet {spreadsheet_id} at {range_}")
        return "Saved successfully!"
    except Exception as e:
        logging.error(f"Failed to save to sheet: {e}", exc_info=True)
        return f"Error saving to sheet: {e}"
    
    
@app.route("/api/voice-command", methods=["POST"])
def voice_command():
    transcript = (request.json or {}).get("transcript", "")
    result = process_command(transcript)  # dict
    status = result.get("status", 200) if "error" in result else 200
    return jsonify(result), status




if __name__ == '__main__':
    app.run(debug=True)
