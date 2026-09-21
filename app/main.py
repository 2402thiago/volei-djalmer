"""Aplicação FastAPI: API JSON + frontend estático."""
from __future__ import annotations

from pathlib import Path

import os

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles

from .runtime import runtime
from .services import ErroDeDominio
from .sheets_nivelamento import SheetsNivelamento
from .google_auth import callback as oauth_callback, drive_authorized, drive_credentials, login as oauth_login, setting as oauth_setting, user as oauth_user
from .organizacao import EVENTS, PAYMENT_PROOFS, ConfigError, DomainError, organization

BASE = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE / "static"


app = FastAPI(title="Vôlei Djalmer", version="0.1.0")
app.add_middleware(SessionMiddleware, secret_key=oauth_setting("SESSION_SECRET") or "oauth-not-configured", https_only=os.getenv("APP_ENV", "local") != "local" or bool(os.getenv("VERCEL")), same_site="lax")
sheets_nivelamento = SheetsNivelamento()


def _resposta(fn):
    """Executa a função e converte ErroDeDominio em HTTP 400."""
    try:
        return fn()
    except ErroDeDominio as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -- Participantes ----------------------------------------------------
@app.get("/api/participantes")
def listar_participantes(incluir_inativos: bool = False):
    return _resposta(lambda: [
        {
            "id": p.id, "nome": p.nome, "sexo": p.sexo,
            "nivel": p.nivel, "ranking": p.ranking,
            "status": p.status,
        }
        for p in runtime.servico_participantes.listar(incluir_inativos)
    ])


@app.post("/api/participantes")
def criar_participante(payload: dict):
    return _resposta(lambda: runtime.servico_participantes.criar(
        payload.get("nome", ""), payload.get("nivel"),
        payload.get("sexo", ""), payload.get("ranking")
    ).to_linha())


@app.patch("/api/participantes/{id_}")
def editar_participante(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_participantes.editar(
        id_, payload.get("nome"), payload.get("nivel"),
        payload.get("sexo"), payload.get("ranking")
    ).to_linha())


@app.patch("/api/participantes/{id_}/status")
def alterar_status_participante(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_participantes.alterar_status(
        id_, payload.get("status", "ativo")
    ).to_linha())


@app.delete("/api/participantes/{id_}")
def remover_participante(id_: str):
    return _resposta(lambda: {"ok": runtime.servico_participantes.remover(id_)})


@app.post("/api/participantes/importar")
def importar_participantes(payload: dict):
    """Limpa lista atual e importa até 24 titulares sem nível."""
    def importar():
        nomes = payload.get("nomes", [])[:24]
        if not nomes:
            raise ErroDeDominio("Lista de nomes vazia.")
        runtime.servico_participantes.limpar_todos()
        criados = runtime.servico_participantes.criar_em_lote(nomes, nivel=None)
        return {"importados": len(criados), "nomes": [p.nome for p in criados]}

    return _resposta(importar)


# -- Times ------------------------------------------------------------
@app.post("/api/times/montar")
def montar_times(payload: dict):
    return _resposta(lambda: [
        {"id": t.id, "nome": t.nome, "nivel_medio": t.nivel_medio,
         "jogadores": t.jogadores}
        for t in runtime.servico_times.montar(payload.get("num_times", 2))
    ])


@app.get("/api/times")
def listar_times():
    return _resposta(lambda: [
        {
            "id": t.id, "nome": t.nome, "nivel_medio": t.nivel_medio,
            "jogadores": t.jogadores,
        }
        for t in runtime.servico_times.listar()
    ])


@app.get("/api/times/{id_}/composicao")
def composicao_time(id_: str):
    return _resposta(lambda: (lambda time, comp: {
        "id": time.id, "nome": time.nome, "nivel_medio": time.nivel_medio,
        "participantes": [
            {"id": p.id, "nome": p.nome, "nivel": p.nivel} for p in comp
        ],
    })(*runtime.servico_times.composicao(id_)))


# -- Sincronização / saúde -------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "env": runtime.modo}


def cadastro_payload(payload: dict) -> list[dict]:
    return payload.get("atletas", [])


def configurar_sheets(payload: dict) -> None:
    sheets_nivelamento.configurar(payload.get("sheet_id", ""), payload.get("service_account_info", ""))


def detalhe_sheets(exc: Exception) -> str:
    mensagem = str(exc).strip()
    resposta = getattr(exc, "response", None)
    if resposta is not None:
        try:
            mensagem = resposta.json().get("error", {}).get("message", mensagem)
        except Exception:
            pass
    if mensagem:
        return mensagem
    return "Não foi possível conectar ao Google Sheets. Confira o ID da planilha, a credencial e o compartilhamento com a conta de serviço."


@app.post("/api/nivelamento/conectar")
def conectar_nivelamento(payload: dict):
    try:
        configurar_sheets(payload)
        sheets_nivelamento.conectar_resetar()
        return {"ok": True, "mensagem": "Planilha preparada com a aba Nivelamento."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=detalhe_sheets(exc))


@app.post("/api/nivelamento/testar")
def testar_nivelamento(payload: dict):
    try:
        configurar_sheets(payload)
        sheets_nivelamento._spreadsheet()
        return {"ok": True, "mensagem": "Conexão com Google Sheets validada."}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=detalhe_sheets(exc))


@app.post("/api/nivelamento/sincronizar")
def sincronizar_nivelamento(payload: dict):
    try:
        configurar_sheets(payload)
        return {"ok": True, **sheets_nivelamento.sincronizar(cadastro_payload(payload))}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=detalhe_sheets(exc))


@app.post("/api/nivelamento/importar")
def importar_nivelamento(payload: dict):
    try:
        configurar_sheets(payload)
        return {"ok": True, "atletas": sheets_nivelamento.importar()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=detalhe_sheets(exc))


# -- Organização ------------------------------------------------------
def _organization(fn):
    try:
        return fn()
    except ConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except (DomainError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except KeyError as exc:
        raise HTTPException(status_code=503, detail="A estrutura das abas da Organização é inválida. Atualize os cabeçalhos ou crie as abas Organizacao.") from exc


@app.get("/auth/login")
def login_google(request: Request, next: str = "/"):
    return oauth_login(request, next)


@app.get("/auth/callback")
def callback_google(request: Request, code: str = "", state: str = ""):
    return oauth_callback(request, code, state)


@app.post("/auth/logout")
def logout_google(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/auth/me")
def me_google(request: Request):
    actor = oauth_user(request)
    return {"name": actor["name"], "email": actor["email"]}


@app.get("/api/auth/drive-status")
def drive_status_google(request: Request):
    oauth_user(request)
    return {"authorized": drive_authorized(request)}


@app.post("/api/organizacao/prepare")
def prepare_organization(request: Request):
    oauth_user(request)
    return _organization(lambda: (organization.prepare(), {"ok": True})[1])


@app.get("/api/organizacao/access")
def organization_access(request: Request):
    def action():
        actor = oauth_user(request)
        return {"email": actor["email"], "allowed": organization.organizer_allowed(actor["email"])}
    return _organization(action)


@app.post("/api/organizacao/events")
def create_event(request: Request, payload: dict):
    return _organization(lambda: organization.create_event(payload, oauth_user(request)))


@app.get("/api/organizacao/events")
def open_organization_events(request: Request):
    return _organization(lambda: organization.open_events(oauth_user(request)))


@app.get("/api/public/events/{slug}")
def public_event(slug: str):
    return _organization(lambda: organization.public_event(slug))


@app.post("/api/public/events/{slug}/join")
def join_event(slug: str, request: Request):
    return _organization(lambda: organization.join(slug, oauth_user(request)))


@app.post("/api/public/events/{slug}/guests")
def add_guest(slug: str, request: Request, payload: dict):
    return _organization(lambda: organization.add_guest(slug, payload.get("nome", ""), oauth_user(request)))


@app.get("/api/public/events/{slug}/mine")
def my_event_registration(slug: str, request: Request):
    return _organization(lambda: organization.mine(slug, oauth_user(request)))


@app.post("/api/public/events/{slug}/proofs")
async def upload_own_proof(slug: str, request: Request, subject_id: str = Form(...), file: UploadFile = File(...)):
    return _organization(lambda: organization.upload_proof(slug, "registration", subject_id, oauth_user(request), file.filename or "comprovante", file.content_type or "", file.file.read(), drive_credentials(request)))


@app.post("/api/organizacao/events/{slug}/guests/{guest_id}/proofs")
async def upload_guest_proof(slug: str, guest_id: str, request: Request, file: UploadFile = File(...)):
    return _organization(lambda: organization.upload_proof(slug, "guest", guest_id, oauth_user(request), file.filename or "comprovante", file.content_type or "", file.file.read(), drive_credentials(request)))


@app.get("/api/organizacao/events/{slug}/proofs")
def list_proofs(slug: str, request: Request):
    return _organization(lambda: organization.proofs(slug, oauth_user(request)))


@app.get("/api/organizacao/events/{slug}/details")
def commission_event_details(slug: str, request: Request):
    return _organization(lambda: organization.commission_details(slug, oauth_user(request)))


@app.post("/api/organizacao/proofs/{proof_id}/approve")
def approve_proof(proof_id: str, request: Request):
    return _organization(lambda: organization.approve(proof_id, oauth_user(request)))


@app.get("/api/organizacao/proofs/{proof_id}/download")
def download_proof(proof_id: str, request: Request):
    def action():
        proof = next((p for p in organization.store.rows(PAYMENT_PROOFS) if p["id"] == proof_id), None)
        event = proof and next((e for e in organization.store.rows(EVENTS) if e["id"] == proof["event_id"]), None)
        if not proof or not event or not organization.commission(event, oauth_user(request)["email"]): raise DomainError("Apenas a comissão pode baixar comprovantes.")
        return Response(organization.store.download(proof["drive_file_id"]), media_type=proof["mime_type"], headers={"Content-Disposition": f'attachment; filename="{proof["nome_arquivo"]}"'})
    return _organization(action)


@app.get("/lista/{slug}")
def lista_publica(slug: str):
    return FileResponse(STATIC_DIR / "lista.html")


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
