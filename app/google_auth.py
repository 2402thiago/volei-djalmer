"""OAuth Google somente para identidade; tokens nunca são enviados ao navegador."""
from __future__ import annotations

import os
import secrets
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException, Request as FastAPIRequest
from fastapi.responses import RedirectResponse


def enabled():
    return os.getenv("GOOGLE_OAUTH_ENABLED", "false").casefold() == "true"


def setting(name):
    # Names without the prefix are the documented settings; prefixed names keep old deployments usable.
    return os.getenv(name, "") or os.getenv("GOOGLE_OAUTH_" + name, "")


def require_config():
    missing = [x for x in ("CLIENT_ID", "CLIENT_SECRET", "REDIRECT_URI", "SESSION_SECRET") if not setting(x)]
    if not enabled() or missing:
        raise HTTPException(status_code=503, detail="Login Google não configurado. Defina GOOGLE_OAUTH_ENABLED=true e CLIENT_ID, CLIENT_SECRET, REDIRECT_URI e SESSION_SECRET.")


def login(request: FastAPIRequest, next_url="/"):
    require_config()
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    request.session["oauth_next"] = next_url if next_url.startswith("/") and not next_url.startswith("//") else "/"
    query = urlencode({"client_id": setting("CLIENT_ID"), "redirect_uri": setting("REDIRECT_URI"), "response_type": "code", "scope": "openid email profile", "state": state, "prompt": "select_account"})
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
        identity = id_token.verify_oauth2_token(tokens["id_token"], GoogleRequest(), setting("CLIENT_ID"))
        if not identity.get("sub") or not identity.get("email") or not identity.get("name") or identity.get("email_verified") is not True:
            raise ValueError("perfil incompleto")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Não foi possível validar a identidade Google.") from exc
    request.session["user"] = {"sub": identity["sub"], "email": identity["email"], "name": identity["name"]}
    return RedirectResponse(request.session.pop("oauth_next", "/"), status_code=302)


def user(request: FastAPIRequest):
    value = request.session.get("user")
    if not value: raise HTTPException(status_code=401, detail="Faça login com Google para continuar.")
    return value
