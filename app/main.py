"""Aplicação FastAPI: API JSON + frontend estático."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .runtime import runtime
from .services import ErroDeDominio
from .sheets_nivelamento import SheetsNivelamento

BASE = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE / "static"


app = FastAPI(title="Vôlei Djalmer", version="0.1.0")
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


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
