"""Aplicação FastAPI: API JSON + servir o frontend estático.

Modelo serverless: a planilha do Google Sheets é a fonte única de dados.
Cada requisição lê/escreve diretamente na planilha (sem estado local).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .runtime import runtime
from .services import ErroDeDominio, classificacao

BASE = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Conecta ao Google Sheets (se credenciais estiverem configuradas)."""
    runtime.ativar_sheets()
    yield


app = FastAPI(title="Torneio de Vôlei", version="0.1.0", lifespan=lifespan)


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
            "id": p.id, "nome": p.nome, "nivel": p.nivel,
            "status": p.status,
        }
        for p in runtime.servico_participantes.listar(incluir_inativos)
    ])


@app.post("/api/participantes")
def criar_participante(payload: dict):
    return _resposta(lambda: runtime.servico_participantes.criar(
        payload.get("nome", ""), payload.get("nivel", 3)
    ).to_linha())


@app.patch("/api/participantes/{id_}")
def editar_participante(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_participantes.editar(
        id_, payload.get("nome"), payload.get("nivel")
    ).to_linha())


@app.patch("/api/participantes/{id_}/status")
def alterar_status_participante(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_participantes.alterar_status(
        id_, payload.get("status", "ativo")
    ).to_linha())


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


# -- Partidas ---------------------------------------------------------
@app.get("/api/partidas")
def listar_partidas(status: str | None = None):
    return _resposta(lambda: [p.to_linha() for p in runtime.servico_partidas.listar(status)])


@app.post("/api/partidas")
def criar_partida(payload: dict):
    return _resposta(lambda: runtime.servico_partidas.criar(
        payload["time_a_id"], payload["time_b_id"]
    ).to_linha())


@app.patch("/api/partidas/{id_}/placar")
def pontuar(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_partidas.pontuar(
        id_, payload["time"], payload.get("delta", 1)
    ).to_linha())


@app.patch("/api/partidas/{id_}/status")
def alterar_status_partida(id_: str, payload: dict):
    return _resposta(lambda: runtime.servico_partidas.alterar_status(
        id_, payload.get("status", "em_andamento")
    ).to_linha())


@app.get("/api/classificacao")
def obter_classificacao():
    return _resposta(lambda: classificacao(runtime.servico_partidas.listar()))


# -- Sincronização / saúde -------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "env": runtime.modo}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)