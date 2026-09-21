"""OAuth Google para identidade e comprovantes privados no Drive do usuário."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException, Request as FastAPIRequest
from fastapi.responses import RedirectResponse

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"


def enabled():
    return os.getenv("GOOGLE_OAUTH_ENABLED", "false").casefold() == "true"


def setting(name):
    # Names without the prefix are the documented settings; prefixed names keep old deployments usable.
    return os.getenv(name, "") or os.getenv("GOOGLE_OAUTH_" + name, "")


def require_config():
    missing = [x for x in ("CLIENT_ID", "CLIENT_SECRET", "REDIRECT_URI", "SESSION_SECRET") if not setting(x)]
    if not enabled() or missing:
        raise HTTPException(status_code=503, detail="Login Google não configurado. Defina GOOGLE_OAUTH_ENABLED=true e CLIENT_ID, CLIENT_SECRET, REDIRECT_URI e SESSION_SECRET.")


def _cipher():
    from cryptography.fernet import Fernet
    key = base64.urlsafe_b64encode(hashlib.sha256(setting("SESSION_SECRET").encode()).digest())
    return Fernet(key)


def _save_drive_credentials(request, credentials):
    request.session["drive_credentials"] = _cipher().encrypt(credentials.to_json().encode()).decode()


def login(request: FastAPIRequest, next_url="/"):
    require_config()
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    request.session["oauth_next"] = next_url if next_url.startswith("/") and not next_url.startswith("//") else "/"
    query = urlencode({"client_id": setting("CLIENT_ID"), "redirect_uri": setting("REDIRECT_URI"), "response_type": "code", "scope": f"openid email profile {DRIVE_SCOPE}", "state": state, "access_type": "offline", "prompt": "consent select_account"})
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + query, status_code=302)


def callback(request: FastAPIRequest, code: str, state: str):
    require_config()
    if not state or not secrets.compare_digest(state, request.session.pop("oauth_state", "")):
        raise HTTPException(status_code=400, detail="Estado OAuth inválido.")
    payload = urlencode({"code": code, "client_id": setting("CLIENT_ID"), "client_secret": setting("CLIENT_SECRET"), "redirect_uri": setting("REDIRECT_URI"), "grant_type": "authorization_code"}).encode()
    try:
        with urlopen(Request("https://oauth2.googleapis.com/token", data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=10) as response:
            tokens = __import__("json").load(response)
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2 import id_token
        from google.oauth2.credentials import Credentials
        identity = id_token.verify_oauth2_token(tokens["id_token"], GoogleRequest(), setting("CLIENT_ID"))
        if not identity.get("sub") or not identity.get("email") or not identity.get("name") or identity.get("email_verified") is not True:
            raise ValueError("perfil incompleto")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Não foi possível validar a identidade Google.") from exc
    request.session["user"] = {"sub": identity["sub"], "email": identity["email"], "name": identity["name"]}
    credentials = Credentials(token=tokens["access_token"], refresh_token=tokens.get("refresh_token"), token_uri="https://oauth2.googleapis.com/token", client_id=setting("CLIENT_ID"), client_secret=setting("CLIENT_SECRET"), scopes=[DRIVE_SCOPE], expiry=datetime.now(timezone.utc) + timedelta(seconds=int(tokens.get("expires_in", 3600))))
    _save_drive_credentials(request, credentials)
    return RedirectResponse(request.session.pop("oauth_next", "/"), status_code=302)


def user(request: FastAPIRequest):
    value = request.session.get("user")
    if not value: raise HTTPException(status_code=401, detail="Faça login com Google para continuar.")
    return value


def drive_credentials(request: FastAPIRequest):
    value = request.session.get("drive_credentials")
    if not value:
        raise HTTPException(status_code=401, detail="Faça login novamente para autorizar o envio ao seu Google Drive.")
    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials
        credentials = Credentials.from_authorized_user_info(json.loads(_cipher().decrypt(value.encode())))
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(GoogleRequest())
            _save_drive_credentials(request, credentials)
        if not credentials.valid:
            raise ValueError("credencial inválida")
        return credentials
    except HTTPException:
        raise
    except Exception as exc:
        request.session.pop("drive_credentials", None)
        raise HTTPException(status_code=401, detail="A autorização do Google Drive expirou. Faça login novamente.") from exc
