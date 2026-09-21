from datetime import datetime, timedelta, timezone

from google.oauth2.credentials import Credentials

from app import google_auth


class Request:
    def __init__(self): self.session = {}


def test_drive_credentials_are_encrypted_in_session_and_reported_as_authorized(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_SESSION_SECRET", "segredo-de-teste")
    request = Request()
    credentials = Credentials(token="token", refresh_token="refresh", token_uri="https://oauth2.googleapis.com/token", client_id="client", client_secret="secret", scopes=[google_auth.DRIVE_SCOPE], expiry=datetime.now(timezone.utc) + timedelta(hours=1))
    google_auth._save_drive_credentials(request, credentials)
    assert "token" not in request.session["drive_credentials"]
    assert google_auth.drive_authorized(request)
    assert google_auth.drive_credentials(request).token == "token"


def test_drive_status_is_false_without_a_drive_session():
    assert not google_auth.drive_authorized(Request())
